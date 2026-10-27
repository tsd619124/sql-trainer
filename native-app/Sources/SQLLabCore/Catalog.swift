import Foundation

public struct Catalog: Codable, Sendable {
    public let schemaVersion: Int
    public let sourceVersion: String
    public let sourceSHA256: String
    public let weeks: [Week]
    public let questions: [Question]
    public let practice: [Question]?
    public let lessons: [Lesson]
    public let templates: [SQLTemplate]
    public let explanations: [String: String]

    public static func load() throws -> Catalog {
        guard let url = Bundle.module.url(forResource: "catalog", withExtension: "json") else { throw LabError.message("内置课程缺失，请重新安装应用。") }
        let catalog = try JSONDecoder().decode(Catalog.self, from: Data(contentsOf: url))
        guard catalog.schemaVersion == 1, Set(catalog.allQuestions.map(\.id)).count == catalog.allQuestions.count,
              Set(catalog.lessons.map(\.id)).count == catalog.lessons.count else { throw LabError.message("课程索引校验失败。") }
        return catalog
    }

    public var allQuestions: [Question] { questions + (practice ?? []) }
    public func question(_ id: String) -> Question? { allQuestions.first { $0.id == id } }
    public func lesson(_ id: String) -> Lesson? { lessons.first { $0.id == id } }
    public static func resource(_ name: String, extension suffix: String) throws -> URL {
        guard let url = Bundle.module.url(forResource: name, withExtension: suffix) else { throw LabError.message("缺少内置训练资源。") }
        return url
    }
}

public struct Week: Codable, Identifiable, Hashable, Sendable {
    public let w: Int
    public let name: String
    public var id: Int { w }
}

public struct Question: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let w: Int
    public let pts: Int
    public let title: String
    public let tables: [String]
    public let orderCols: [Int]?
    public let text: String
    public let hint: String
    public let answer: String
    public let parentID: String?
    public let level: Int?
    public let kind: String?
    public let dataset: String?
    public let topic: String?
    public let starter: String?
    public let explanation: String?
    public let mysql: String?
    public let dialectNote: String?
    public let choices: [PracticeChoice]?
    public let correctOption: String?
    public let rubric: [String]?
    public let prompts: [String]?
    public var isChoice: Bool { kind == "choice" || kind == "predict" }
    public var trainingLabel: String {
        if kind == "project" { return "综合项目" }
        if kind == "debug" { return "SQL 纠错" }
        if kind == "complete" { return "补全语句" }
        if kind == "choice" { return "选择辨析" }
        if kind == "predict" { return "结果预测" }
        if topic != nil { return "专题训练" }
        return level == 2 ? "条件变化" : level == 3 ? "综合迁移" : "基础核心"
    }
}

public struct PracticeChoice: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let text: String
}

public struct Lesson: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let w: Int
    public let min: Int
    public let title: String
    public let goal: String
    public let secs: [LessonSection]
    public let biz: String
    public let qs: [String]
    public let key: String
}

public struct LessonSection: Codable, Hashable, Sendable {
    public let h: String?
    public let p: String?
    public let code: String?
    public let run: Int?
    public let dialect: String?
    public let note: String?
    public let traps: [String]?
    public var canRun: Bool { code != nil && run == 1 && (dialect ?? "SQLite").lowercased() == "sqlite" }
    public var exampleDescription: String {
        canRun ? "SQLite · 可运行示例" : "\(dialect ?? "SQLite") · 阅读示例（不在本机执行）"
    }
}

public struct SQLTemplate: Codable, Hashable, Identifiable, Sendable {
    public let name: String
    public let biz: String
    public let code: String
    public var id: String { name }
}

public enum LabError: Error, LocalizedError, Equatable {
    case message(String)
    public var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}
