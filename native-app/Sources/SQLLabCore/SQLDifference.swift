import Foundation

public struct SQLDifference: Sendable {
    public enum Kind: String, Sendable { case columns = "列数不一致", missing = "缺少记录", extra = "多出记录", values = "值不一致", order = "排序不一致" }
    public let kind: Kind
    public let actualRows: Int
    public let expectedRows: Int
    public let actualColumns: Int
    public let expectedColumns: Int
    public let missing: SQLResult
    public let extra: SQLResult
    public let missingCount: Int
    public let extraCount: Int
    public var hint: String {
        switch kind {
        case .columns: return "检查 SELECT 的字段数量与题目要求，避免用 * 带入额外字段。"
        case .missing: return "先检查 WHERE 条件是否过严，以及 INNER JOIN 是否漏掉了需要保留的记录。"
        case .extra: return "先检查筛选范围和 JOIN 粒度；一对多关联可能产生重复行。"
        case .values: return "行数相同但部分值不同。检查聚合粒度、NULL、去重及整数除法。"
        case .order: return "记录内容一致，顺序不符合要求。检查 ORDER BY 的字段与升降序；并列行按题目规则比较。"
        }
    }
}

extension SQLResult {
    public func difference(from reference: SQLResult, orderedBy order: [Int]?) -> SQLDifference? {
        guard !matches(reference, orderedBy: order) else { return nil }
        func unmatched(_ source: SQLResult, against other: SQLResult) -> [[JSONValue]] {
            var counts: [String: Int] = [:]
            for row in other.normalizedValues { counts[JSONValue.array(row).canonical, default: 0] += 1 }
            var output: [[JSONValue]] = []
            for (position, row) in source.normalizedValues.enumerated() {
                let key = JSONValue.array(row).canonical
                if counts[key, default: 0] > 0 { counts[key, default: 0] -= 1 }
                else { output.append(source.values[position]) }
            }
            return output
        }
        let missing = unmatched(reference, against: self), extra = unmatched(self, against: reference)
        let kind: SQLDifference.Kind
        if columns.count != reference.columns.count { kind = .columns }
        else if values.count < reference.values.count { kind = .missing }
        else if values.count > reference.values.count { kind = .extra }
        else if missing.isEmpty && extra.isEmpty { kind = .order }
        else { kind = .values }
        return SQLDifference(kind: kind, actualRows: values.count, expectedRows: reference.values.count, actualColumns: columns.count, expectedColumns: reference.columns.count,
                             missing: SQLResult(columns: reference.columns, values: Array(missing.prefix(3))), extra: SQLResult(columns: columns, values: Array(extra.prefix(3))), missingCount: missing.count, extraCount: extra.count)
    }
}
