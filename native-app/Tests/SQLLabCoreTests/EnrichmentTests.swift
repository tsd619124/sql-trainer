import XCTest
@testable import SQLLabCore
@testable import SQLLabUI

final class EnrichmentTests: XCTestCase {
    func testEveryPracticeAnswerMatchesWebOnThreeDatasets() async throws {
        let catalog = try Catalog.load(), engine = try SQLExecutor()
        let practice = try XCTUnwrap(catalog.practice)
        XCTAssertEqual(catalog.questions.count, 42)
        XCTAssertEqual(practice.count, 109)
        XCTAssertEqual(practice.filter { !$0.isChoice }.count, 101)
        let fixtures = try JSONDecoder().decode([JSONValue].self, from: Data(contentsOf: Catalog.resource("practice-results", extension: "json")))
        for core in catalog.questions { XCTAssertEqual(practice.filter { $0.parentID == core.id }.map(\.level), [2, 3]) }
        for fixture in fixtures {
            let caseID = try XCTUnwrap(fixture["id"].string)
            for question in practice {
                let actual = try await engine.trainingQuery(question.answer, caseID: caseID)
                let expected = try XCTUnwrap(fixture["results"].array?.first { $0["id"].string == question.id })
                XCTAssertEqual(actual.columns, expected["columns"].array?.compactMap(\.string), question.id + ":" + caseID)
                XCTAssertEqual(actual.values, expected["values"].array?.compactMap(\.array), question.id + ":" + caseID)
            }
        }
        for question in practice where !question.isChoice {
            let verdict = try await engine.grade(question, sql: question.answer)
            XCTAssertTrue(verdict.passed, question.id)
            XCTAssertEqual(verdict.cases.count, 3)
        }
    }

    func testIndependentBusinessExpectationsAndIncorrectQueries() async throws {
        let catalog = try Catalog.load(), engine = try SQLExecutor()
        let streak = try XCTUnwrap(catalog.question("topic-streak-1"))
        let result = try await engine.trainingQuery(streak.answer, caseID: "edge")
        XCTAssertEqual(result.values, [[.number(1),.string("2026-08-31"),.string("2026-09-02"),.number(3)], [.number(5),.string("2026-09-30"),.string("2026-10-03"),.number(4)]])
        let funnel = try XCTUnwrap(catalog.question("topic-funnel-1"))
        let counts = try await engine.trainingQuery(funnel.answer, caseID: "edge")
        XCTAssertEqual(counts.values, [[.number(5),.number(2),.number(2)]])
        let hardcoded = try await engine.grade(funnel, sql: "SELECT 4,1,1")
        XCTAssertTrue(hardcoded.cases[0].passed)
        XCTAssertFalse(hardcoded.passed)
        let duplicate = try await engine.grade(streak, sql: streak.answer.replacingOccurrences(of: "SELECT DISTINCT user_id", with: "SELECT user_id"))
        XCTAssertFalse(duplicate.passed)
        for question in catalog.practice ?? [] where question.kind == "debug" {
            let verdict = try await engine.grade(question, sql: try XCTUnwrap(question.starter))
            XCTAssertFalse(verdict.passed, question.id)
        }
        let median = try await engine.trainingQuery(try XCTUnwrap(catalog.question("topic-median-1")).answer, caseID: "edge")
        XCTAssertEqual(median.values, [[.number(100)]])
        let project = try await engine.trainingQuery(try XCTUnwrap(catalog.question("project-marketing")).answer)
        XCTAssertEqual(project.values.first, [.number(1),.string("秋季搜索"),.string("搜索"),.number(3),.number(2),.number(400),.number(250),.number(66.67),.number(125)])
    }

    @MainActor func testPracticeProgressReopensAndDoesNotInflateCoreMilestones() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let model = try LabModel(directory: directory)
        let question = try XCTUnwrap(model.catalog.question("q1-v2"))
        model.saveDraft(question.id, question.answer)
        _ = try await model.submit(question, sql: question.answer)
        XCTAssertEqual(model.completed, 0)
        XCTAssertEqual(model.independentCompleted, 0)
        XCTAssertEqual(model.state["mil"]["all"], .null)
        let reopened = try LabModel(directory: directory)
        XCTAssertEqual(reopened.draft(question.id), question.answer)
        XCTAssertEqual(reopened.completionStatus(question.id), .independent)
        XCTAssertEqual(reopened.skillSummaries.first?.completed, 1)
        let backup = try JSONDecoder().decode(JSONValue.self, from: model.backup())
        XCTAssertEqual(try Progress.normalize(backup, catalog: model.catalog)["done"][question.id]["used"], .number(0))
        try model.record("choice-count", sql: "选项：2", passed: true, used: false)
        XCTAssertEqual(model.completed, 0)
        try model.viewAnswer(question.id)
        _ = try await model.submit(question, sql: question.answer)
        XCTAssertEqual(model.completionStatus(question.id), .assisted)
        try model.restartIndependently(question.id)
        _ = try await model.submit(question, sql: question.answer)
        XCTAssertEqual(model.completionStatus(question.id), .independent)
    }
}
