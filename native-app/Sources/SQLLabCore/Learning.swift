import Foundation

public struct LearningSkill: Identifiable, Sendable {
    public let id: String
    public let name: String
    public let weeks: [Int]
    public static let all = [
        LearningSkill(id: "basics", name: "取数与筛选", weeks: [1]),
        LearningSkill(id: "aggregation", name: "聚合统计", weeks: [2]),
        LearningSkill(id: "join", name: "多表 JOIN", weeks: [3]),
        LearningSkill(id: "cte", name: "子查询与 CTE", weeks: [4]),
        LearningSkill(id: "window", name: "窗口函数", weeks: [5, 6]),
        LearningSkill(id: "business", name: "业务综合", weeks: [7, 8])
    ]
}

public enum Learning {
    public static let diagnosticIDs = ["q1", "q7", "q13", "q24"]
    public static let resultKinds = ["passed", "result", "syntax", "query", "limit", "unanswered"]
    public static func independent(_ state: JSONValue, _ id: String) -> Bool {
        state["done"][id] != .null && state["done"][id]["used"].number == 0
    }
    public static func reason(_ kind: String?) -> String {
        switch kind {
        case "passed": return "独立通过"
        case "result": return "结果不符：检查条件、聚合和排序"
        case "syntax": return "语法错误：检查关键字、括号和逗号"
        case "query": return "查询错误：检查表名、列名与 SQL 方言"
        case "limit": return "执行超限：检查连接条件与递归范围"
        case "unanswered": return "未作答：先完成对应微课，再独立重练"
        default: return "旧记录未保存错误原因，可独立重练确认"
        }
    }
    public static func normalizeProfile(_ value: JSONValue, catalog: Catalog) throws -> JSONValue {
        guard ["beginner", "some", "confident"].contains(value["level"].string ?? ""),
              ["job", "analysis", "foundation"].contains(value["goal"].string ?? ""),
              [15.0, 30, 60].contains(value["minutes"].number ?? 0),
              let week = value["startWeek"].number, (1...8).contains(week), week.rounded() == week,
              value["skipKnown"].bool != nil, Progress.number(value["updatedAt"]) else { throw LabError.message("学习路径数据无效。") }
        var clean: JSONValue = .object([:])
        for key in ["level", "goal", "minutes", "startWeek", "skipKnown", "updatedAt"] { clean[key] = value[key] }
        if value["diagnostic"] != .null {
            guard let rows = value["diagnostic"].array, rows.count == diagnosticIDs.count,
                  Set(rows.compactMap { $0["qid"].string }) == Set(diagnosticIDs),
                  rows.allSatisfy({ $0["ok"].bool != nil && resultKinds.contains($0["kind"].string ?? "") && ($0["ok"].bool == true) == ($0["kind"].string == "passed") }) else { throw LabError.message("入门诊断数据无效。") }
            clean["diagnostic"] = .array(rows.map { .object(["qid": $0["qid"], "ok": $0["ok"], "kind": $0["kind"]]) })
        }
        return clean
    }
    public static func normalizeEvidence(_ value: JSONValue, catalog: Catalog) throws -> JSONValue {
        guard catalog.question(value["qid"].string ?? "") != nil, value["ok"].bool != nil,
              value["used"].bool != nil, Progress.number(value["t"]),
              resultKinds.contains(value["kind"].string ?? ""),
              (value["ok"].bool == true) == (value["kind"].string == "passed") else { throw LabError.message("学习证据无效。") }
        return .object(["qid": value["qid"], "ok": value["ok"], "used": value["used"], "t": value["t"], "kind": value["kind"]])
    }
    public static func normalizeTest(_ value: JSONValue, catalog: Catalog) throws -> JSONValue {
        guard validRecordID(value["id"].string ?? ""), Progress.number(value["endedAt"]),
              let rows = value["results"].array, (1...5).contains(rows.count),
              Set(rows.compactMap { $0["qid"].string }).count == rows.count else { throw LabError.message("周测记录无效。") }
        let cleanRows: [JSONValue] = try rows.map { row in
            guard catalog.question(row["qid"].string ?? "") != nil, row["ok"].bool != nil else { throw LabError.message("周测题目无效。") }
            var clean: JSONValue = .object(["qid": row["qid"], "ok": row["ok"]])
            if row["kind"] != .null {
                guard resultKinds.contains(row["kind"].string ?? ""), (row["ok"].bool == true) == (row["kind"].string == "passed") else { throw LabError.message("周测错误类型无效。") }
                clean["kind"] = row["kind"]
            }
            if row["sql"] != .null {
                guard let sql = row["sql"].string, sql.count <= 100000 else { throw LabError.message("周测作答过长。") }; clean["sql"] = row["sql"]
            }
            return clean
        }
        var clean: JSONValue = .object(["id": value["id"], "endedAt": value["endedAt"], "results": .array(cleanRows)])
        if value["startedAt"] != .null {
            guard Progress.number(value["startedAt"]), value["startedAt"].number! <= value["endedAt"].number!,
                  let elapsed = value["elapsed"].number, (0...2700).contains(elapsed),
                  let week = value["week"].number, (0...8).contains(week), week.rounded() == week else { throw LabError.message("周测用时无效。") }
            for key in ["startedAt", "elapsed", "week"] { clean[key] = value[key] }
        }
        return clean
    }
    public static func validRecordID(_ id: String) -> Bool { !["__proto__", "constructor", "prototype"].contains(id) && id.range(of: "^[A-Za-z0-9_-]{8,100}$", options: .regularExpression) != nil }
    public static func recommendedWeek(_ results: [JSONValue], catalog: Catalog) -> Int {
        for id in diagnosticIDs where results.first(where: { $0["qid"].string == id })?["ok"].bool != true { return catalog.question(id)?.w ?? 1 }
        return 6
    }
}

public struct DailyTask: Codable, Identifiable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable { case lesson, practice, review }
    public let kind: Kind
    public let target: String
    public let minutes: Int
    public let reason: String
    public var id: String { kind.rawValue + "-" + target }
}

public struct DailyPlan: Codable, Equatable, Sendable {
    public let day: String
    public let createdAt: Double
    public let week: Int
    public let tasks: [DailyTask]
    public var json: JSONValue { (try? JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(self))) ?? .null }
    public init?(_ value: JSONValue) {
        guard let data = try? value.data(), let plan = try? JSONDecoder().decode(Self.self, from: data), LocalDay.valid(plan.day), plan.createdAt.isFinite, plan.createdAt >= 0,
              (1...8).contains(plan.week), plan.tasks.count <= 8, plan.tasks.allSatisfy({ (1...60).contains($0.minutes) && $0.reason.count <= 200 }), Set(plan.tasks.map(\.target)).count == plan.tasks.count else { return nil }
        self = plan
    }
    private init(day: String, createdAt: Double, week: Int, tasks: [DailyTask]) { self.day = day; self.createdAt = createdAt; self.week = week; self.tasks = tasks }
    public func completed(_ task: DailyTask, state: JSONValue) -> Bool {
        if task.kind == .lesson { return state["lessons"][task.target] != .null }
        return Learning.independent(state, task.target) && state["done"][task.target]["ts"].number.map { LocalDay.string(Date(timeIntervalSince1970: $0 / 1000)) == day } == true && (state["sr"][task.target]["rep"].number ?? 0) >= 1
    }
    public func selected(short: Bool) -> [DailyTask] {
        guard short else { return tasks }
        var minutes = 0
        return tasks.filter { task in guard minutes + task.minutes <= 15 else { return false }; minutes += task.minutes; return true }
    }
    public static func make(catalog: Catalog, state: JSONValue, previous: DailyPlan? = nil, at date: Date = Date()) -> DailyPlan {
        let profile = state["learningProfile"], start = Int(profile["startWeek"].number ?? 1), budget = Int(profile["minutes"].number ?? 30), today = LocalDay.string(date)
        func lessonNeeded(_ lesson: Lesson) -> Bool {
            state["lessons"][lesson.id] == .null && !(profile["skipKnown"].bool == true && !lesson.qs.isEmpty && lesson.qs.allSatisfy { Learning.independent(state, $0) && state["wrong"][$0] == .null })
        }
        func practiceNeeded(_ question: Question) -> Bool { !Learning.independent(state, question.id) || state["wrong"][question.id] != .null }
        let week = catalog.weeks.first { week in week.w >= start && (catalog.questions.contains { $0.w == week.w && practiceNeeded($0) } || catalog.lessons.contains { $0.w == week.w && lessonNeeded($0) }) }?.w ?? 8
        var tasks: [DailyTask] = [], minutes = 0
        func append(_ task: DailyTask) {
            guard !tasks.contains(where: { $0.target == task.target }), minutes + task.minutes <= budget else { return }
            tasks.append(task); minutes += task.minutes
        }
        let due = catalog.questions.filter { state["sr"][$0.id]["due"].string.map { $0 <= today } == true }.sorted { (state["sr"][$0.id]["due"].string ?? "") < (state["sr"][$1.id]["due"].string ?? "") }
        for question in due.prefix(budget == 60 ? 3 : 1) { append(DailyTask(kind: .review, target: question.id, minutes: 5, reason: "已到复习日期，独立重做巩固")) }
        if let previous {
            for task in previous.tasks where !previous.completed(task, state: state) && task.kind != .review {
                let valid = task.kind == .lesson ? catalog.lesson(task.target).map { $0.w >= start && lessonNeeded($0) } == true : catalog.question(task.target).map { $0.w >= start && practiceNeeded($0) } == true
                if valid { append(DailyTask(kind: task.kind, target: task.target, minutes: task.minutes, reason: "继续上次未完成的任务")) }
            }
        }
        if !tasks.contains(where: { $0.kind == .lesson }), let lesson = catalog.lessons.first(where: { $0.w == week && lessonNeeded($0) }) { append(DailyTask(kind: .lesson, target: lesson.id, minutes: lesson.min, reason: "当前 W\(week) 阶段尚未读完的课程")) }
        let pool = catalog.questions.filter { $0.w == week && practiceNeeded($0) }
        let prioritized = pool.filter { state["wrong"][$0.id] != .null || state["done"][$0.id]["used"].number == 1 } + pool.filter { state["wrong"][$0.id] == .null && state["done"][$0.id]["used"].number != 1 }
        for question in prioritized.prefix(budget == 60 ? 4 : 2) { append(DailyTask(kind: .practice, target: question.id, minutes: 8, reason: state["done"][question.id]["used"].number == 1 ? "辅助完成后，需要独立通过" : state["wrong"][question.id] != .null ? "针对尚未解决的错误重练" : "当前阶段尚未独立完成")) }
        return DailyPlan(day: today, createdAt: date.timeIntervalSince1970 * 1000, week: week, tasks: tasks)
    }
}
