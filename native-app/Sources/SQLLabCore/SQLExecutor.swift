import Foundation
import CSQLite

public struct SQLResult: Codable, Equatable, Sendable {
    public var columns: [String]
    public var values: [[JSONValue]]

    public init(columns: [String], values: [[JSONValue]]) { self.columns = columns; self.values = values }

    var normalizedValues: [[JSONValue]] {
        values.map { row in row.map { value in
            switch value {
            case .number(let number): return .number(floor(number * 100 + 0.5) / 100)
            case .string(let text): return .string(text.trimmingCharacters(in: .whitespacesAndNewlines))
            default: return value
            }
        } }
    }

    public func matches(_ reference: SQLResult, orderedBy columns: [Int]?) -> Bool {
        guard self.columns.count == reference.columns.count, values.count == reference.values.count else { return false }
        let mine = normalizedValues, expected = reference.normalizedValues
        func sameBag(_ left: ArraySlice<[JSONValue]>, _ right: ArraySlice<[JSONValue]>) -> Bool {
            left.map { JSONValue.array($0).canonical }.sorted() == right.map { JSONValue.array($0).canonical }.sorted()
        }
        guard let columns, !columns.isEmpty else { return sameBag(mine[...], expected[...]) }
        guard columns.allSatisfy({ $0 >= 0 && $0 < self.columns.count }) else { return false }
        var start = 0
        while start < expected.count {
            let key = columns.map { expected[start][$0] }
            var end = start + 1
            while end < expected.count, columns.map({ expected[end][$0] }) == key { end += 1 }
            if !sameBag(mine[start..<end], expected[start..<end]) { return false }
            start = end
        }
        return true
    }
}

public struct Verdict: Sendable {
    public let result: SQLResult
    public let reference: SQLResult
    public let passed: Bool
    public var cases: [CaseVerdict] = []
}

public struct CaseVerdict: Sendable {
    public let name: String
    public let passed: Bool
    public var difference: SQLDifference? = nil
}

public struct SchemaColumn: Sendable, Identifiable {
    public let name: String
    public let type: String
    public var id: String { name }
}

public struct TableOverview: Sendable, Identifiable {
    public let name: String
    public let columns: [SchemaColumn]
    public let sample: SQLResult
    public var id: String { name }
}

public enum SQLLearningError: Error, LocalizedError, Equatable {
    case syntax(String), query(String), limit(String)
    public var kind: String {
        switch self { case .syntax: return "syntax"; case .query: return "query"; case .limit: return "limit" }
    }
    public var errorDescription: String? {
        switch self { case .syntax(let message), .query(let message), .limit(let message): return message }
    }
}

private final class QueryBudget {
    let deadline = ProcessInfo.processInfo.systemUptime + 2
}

private final class SQLiteConnection {
    private var handle: OpaquePointer?

    init(seed: URL, writable: Bool) throws {
        if writable {
            guard sqlite3_open(":memory:", &handle) == SQLITE_OK else { throw LabError.message("无法创建练习数据库。") }
            var source: OpaquePointer?
            guard sqlite3_open_v2(seed.path, &source, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
                sqlite3_close(source); throw LabError.message("无法打开内置数据库。")
            }
            defer { sqlite3_close(source) }
            guard let backup = sqlite3_backup_init(handle, "main", source, "main") else { throw LabError.message("无法初始化练习数据库。") }
            let status = sqlite3_backup_step(backup, -1)
            sqlite3_backup_finish(backup)
            guard status == SQLITE_DONE else { throw LabError.message("练习数据库复制失败。") }
        } else {
            guard sqlite3_open_v2(seed.path, &handle, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else { throw LabError.message("无法打开内置数据库。") }
        }
        sqlite3_limit(handle, SQLITE_LIMIT_LENGTH, 2_000_000)
        sqlite3_limit(handle, SQLITE_LIMIT_SQL_LENGTH, 100_000)
        sqlite3_limit(handle, SQLITE_LIMIT_COLUMN, 100)
        sqlite3_set_authorizer(handle, { context, action, _, argument, _, _ in
            let writable = context != nil
            if action == SQLITE_ATTACH || action == SQLITE_DETACH || action == SQLITE_PRAGMA || action == SQLITE_TRANSACTION || action == SQLITE_SAVEPOINT { return SQLITE_DENY }
            if action == SQLITE_FUNCTION, let argument, ["load_extension", "readfile", "writefile"].contains(String(cString: argument).lowercased()) { return SQLITE_DENY }
            if writable { return SQLITE_OK }
            return [SQLITE_SELECT, SQLITE_READ, SQLITE_FUNCTION, SQLITE_RECURSIVE].contains(action) ? SQLITE_OK : SQLITE_DENY
        }, writable ? UnsafeMutableRawPointer(bitPattern: 1) : nil)
    }

    deinit { sqlite3_close(handle) }

    func columnTypes(_ table: String) throws -> [SchemaColumn] {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, "SELECT * FROM \"" + table + "\" LIMIT 0", -1, &statement, nil) == SQLITE_OK, let statement else { throw failure() }
        defer { sqlite3_finalize(statement) }
        return (0..<sqlite3_column_count(statement)).map { column in
            SchemaColumn(name: String(cString: sqlite3_column_name(statement, column)), type: sqlite3_column_decltype(statement, column).map { String(cString: $0) } ?? "未声明")
        }
    }

    func query(_ sql: String, single: Bool) throws -> SQLResult {
        guard !sql.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw SQLLearningError.query("请写一条 SQL 查询。") }
        guard sql.utf8.count <= 100_000 else { throw SQLLearningError.limit("SQL 长度不超过 100 KB。") }
        let budget = QueryBudget()
        let context = Unmanaged.passUnretained(budget).toOpaque()
        sqlite3_progress_handler(handle, 1000, { pointer in
            guard let pointer else { return 1 }
            return ProcessInfo.processInfo.systemUptime > Unmanaged<QueryBudget>.fromOpaque(pointer).takeUnretainedValue().deadline ? 1 : 0
        }, context)
        defer { sqlite3_progress_handler(handle, 0, nil, nil) }
        return try sql.withCString { start in
            var cursor: UnsafePointer<CChar>? = start
            var output = SQLResult(columns: [], values: [])
            var statementCount = 0
            while let current = cursor, current.pointee != 0 {
                var statement: OpaquePointer?
                var tail: UnsafePointer<CChar>?
                let prepared = sqlite3_prepare_v2(handle, current, -1, &statement, &tail)
                guard prepared == SQLITE_OK else { sqlite3_finalize(statement); throw failure() }
                cursor = tail == current ? nil : tail
                guard let statement else { continue }
                defer { sqlite3_finalize(statement) }
                statementCount += 1
                guard statementCount <= (single ? 1 : 30) else { throw SQLLearningError.query(single ? "判题一次只接受一条查询。" : "一次最多运行 30 条语句。") }
                if single, sqlite3_stmt_readonly(statement) == 0 { throw SQLLearningError.query("判题只接受查询，修改表请进入自由练习。") }
                let count = Int(sqlite3_column_count(statement))
                var result = SQLResult(columns: (0..<count).map { String(cString: sqlite3_column_name(statement, Int32($0))) }, values: [])
                while true {
                    let status = sqlite3_step(statement)
                    if status == SQLITE_DONE { break }
                    guard status == SQLITE_ROW else { throw failure() }
                    guard result.values.count < 5_000 else { throw SQLLearningError.limit("结果超过 5000 行，请添加 LIMIT 或缩小查询范围。") }
                    result.values.append((0..<count).map { index in
                        let column = Int32(index)
                        switch sqlite3_column_type(statement, column) {
                        case SQLITE_NULL: return .null
                        case SQLITE_INTEGER, SQLITE_FLOAT: return .number(sqlite3_column_double(statement, column))
                        default: return .string(String(cString: sqlite3_column_text(statement, column)))
                        }
                    })
                }
                output = result
            }
            guard statementCount > 0 else { throw SQLLearningError.query("请写一条 SQL 查询。") }
            return output
        }
    }

    func atomicPractice(_ sql: String) throws -> SQLResult {
        // Internal transactions run before installing the user statement authorizer.
        sqlite3_set_authorizer(handle, nil, nil)
        guard sqlite3_exec(handle, "SAVEPOINT practice", nil, nil, nil) == SQLITE_OK else { throw failure() }
        sqlite3_set_authorizer(handle, { _, action, _, argument, _, _ in
            if [SQLITE_ATTACH, SQLITE_DETACH, SQLITE_PRAGMA, SQLITE_TRANSACTION, SQLITE_SAVEPOINT].contains(action) { return SQLITE_DENY }
            if action == SQLITE_FUNCTION, let argument, ["load_extension", "readfile", "writefile"].contains(String(cString: argument).lowercased()) { return SQLITE_DENY }
            return SQLITE_OK
        }, nil)
        do {
            let result = try query(sql, single: false)
            sqlite3_set_authorizer(handle, nil, nil)
            guard sqlite3_exec(handle, "RELEASE practice", nil, nil, nil) == SQLITE_OK else { throw failure() }
            return result
        } catch {
            sqlite3_set_authorizer(handle, nil, nil)
            sqlite3_exec(handle, "ROLLBACK TO practice; RELEASE practice", nil, nil, nil)
            throw error
        }
    }

    private func failure() -> any Error {
        let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "数据库不可用"
        let code = sqlite3_errcode(handle)
        if code == SQLITE_AUTH || code == SQLITE_READONLY { return SQLLearningError.query("判题只允许查询；自由练习也不能访问外部文件或修改数据库配置。") }
        if code == SQLITE_INTERRUPT { return SQLLearningError.limit("查询超过时间限制，请简化查询后重试。") }
        if [SQLITE_ERROR, SQLITE_MISMATCH, SQLITE_CONSTRAINT].contains(code) {
            if ["syntax error", "incomplete input", "unrecognized token"].contains(where: message.contains) { return SQLLearningError.syntax(message) }
            return SQLLearningError.query(message)
        }
        if code == SQLITE_TOOBIG { return SQLLearningError.limit(message) }
        return LabError.message(message)
    }
}

public actor SQLExecutor {
    private let seed: URL
    private var playground: SQLiteConnection?

    public init(seed: URL? = nil) throws { self.seed = try seed ?? Catalog.resource("training", extension: "sqlite") }
    public func query(_ sql: String) throws -> SQLResult { try SQLiteConnection(seed: seed, writable: false).query(sql, single: true) }
    public func grade(_ question: Question, sql: String) throws -> Verdict {
        if question.dataset != nil {
            var cases: [CaseVerdict] = []
            var primary: SQLResult?
            var expected: SQLResult?
            for (id, name) in [("standard", "业务样本"), ("edge", "边界样本"), ("empty", "空集样本")] {
                let source = try Catalog.resource("training-" + id, extension: "sqlite")
                let reference: SQLResult
                do { reference = try SQLiteConnection(seed: source, writable: false).query(question.answer, single: true) }
                catch { throw LabError.message("参考样本暂时无法验证，请稍后重试。") }
                let result = try SQLiteConnection(seed: source, writable: false).query(sql, single: true)
                if primary == nil { primary = result; expected = reference }
                cases.append(CaseVerdict(name: name, passed: result.matches(reference, orderedBy: question.orderCols), difference: result.difference(from: reference, orderedBy: question.orderCols)))
            }
            return Verdict(result: primary!, reference: expected!, passed: cases.allSatisfy(\.passed), cases: cases)
        }
        let reference: SQLResult
        do { reference = try query(question.answer) }
        catch { throw LabError.message("参考答案暂时无法验证，请稍后重试。") }
        let result = try query(sql)
        return Verdict(result: result, reference: reference, passed: result.matches(reference, orderedBy: question.orderCols))
    }
    public func trainingQuery(_ sql: String, caseID: String = "standard") throws -> SQLResult {
        guard ["standard", "edge", "empty"].contains(caseID) else { throw LabError.message("训练样本无效。") }
        return try SQLiteConnection(seed: Catalog.resource("training-" + caseID, extension: "sqlite"), writable: false).query(sql, single: true)
    }
    public func tableOverview(_ table: String, training: Bool = false) throws -> TableOverview {
        let allowed = training ? ["users", "products", "orders", "order_items", "events", "campaigns", "leads", "ad_spend", "inventory", "shipments"] : ["users", "products", "orders", "order_items"]
        guard allowed.contains(table) else { throw LabError.message("表名无效。") }
        let source = training ? try Catalog.resource("training-standard", extension: "sqlite") : seed
        let connection = try SQLiteConnection(seed: source, writable: false)
        return try TableOverview(name: table, columns: connection.columnTypes(table), sample: connection.query("SELECT * FROM \"" + table + "\" LIMIT 5", single: true))
    }
    public func practice(_ sql: String) throws -> SQLResult {
        if playground == nil { playground = try SQLiteConnection(seed: seed, writable: true) }
        return try playground!.atomicPractice(sql)
    }
    public func resetPractice() { playground = nil }
}
