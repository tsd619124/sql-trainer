import XCTest
@testable import SQLLabCore
@testable import SQLLabUI

@MainActor final class ProductTests: XCTestCase {
    private var directories: [URL] = []
    private func model() throws -> LabModel {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        directories.append(directory); return try LabModel(directory: directory)
    }
    override func tearDown() { for directory in directories { try? FileManager.default.removeItem(at: directory) }; directories = [] }
    private func profile(start: Int = 1, skip: Bool = false, minutes: Int = 30) -> JSONValue {
        .object(["level": .string("some"), "goal": .string("job"), "minutes": .number(Double(minutes)), "startWeek": .number(Double(start)), "skipKnown": .bool(skip), "updatedAt": .number(1)])
    }
    func testDailyPlanPrioritizesDueWorkAndDoesNotReplaceCompletedTasks() throws {
        let model = try model(), date = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-10-27T04:00:00Z"))
        try model.record("q6", sql: "SELECT 1", passed: true, used: false, at: date.addingTimeInterval(-86400 * 2))
        try model.record("q1", sql: "SELECT 1", passed: true, used: true, at: date)
        model.prepareDailyPlan(at: date)
        let plan = try XCTUnwrap(model.dailyPlan)
        XCTAssertEqual(plan.tasks.first?.target, "q6"); XCTAssertEqual(plan.tasks.first?.kind, .review)
        XCTAssertTrue(plan.tasks.contains { $0.kind == .lesson }); XCTAssertTrue(plan.tasks.contains { $0.target == "q1" && $0.kind == .practice })
        XCTAssertLessThanOrEqual(plan.tasks.reduce(0) { $0 + $1.minutes }, 30)
        XCTAssertLessThanOrEqual(plan.selected(short: true).reduce(0) { $0 + $1.minutes }, 15)
        let practice = try XCTUnwrap(plan.tasks.first { $0.kind == .practice })
        XCTAssertFalse(plan.completed(practice, state: model.state))
        try model.record(practice.target, sql: "SELECT 1", passed: true, used: false, at: date)
        XCTAssertTrue(plan.completed(practice, state: model.state))
        model.prepareDailyPlan(at: date); XCTAssertEqual(model.dailyPlan, plan)
        let reopened = try LabModel(directory: directories.last!); XCTAssertEqual(reopened.dailyPlan, plan)
        model.prepareDailyPlan(at: date.addingTimeInterval(86400))
        XCTAssertNotEqual(model.dailyPlan?.day, plan.day)
        XCTAssertTrue(model.dailyPlan!.tasks.contains { $0.kind == .lesson && $0.reason.contains("上次") })
    }
    func testDiagnosisAndSkippingNeverFabricateMasteryAndKeepEarlierReviews() throws {
        let model = try model(), date = Date()
        let answers = Learning.diagnosticIDs.map { JSONValue.object(["qid": .string($0), "ok": .bool(true), "kind": .string("passed")]) }
        XCTAssertEqual(Learning.recommendedWeek(answers, catalog: model.catalog), 6)
        var selected = profile(start: 3, skip: true); selected["diagnostic"] = .array(answers)
        try model.saveLearningProfile(selected)
        XCTAssertEqual(model.completed, 0); XCTAssertEqual(model.state["lessons"].object?.count, 0)
        XCTAssertEqual(model.dailyPlan?.week, 3)
        try model.record("q1", sql: "SELECT 1", passed: false, used: false, at: date.addingTimeInterval(-86400 * 2))
        let plan = DailyPlan.make(catalog: model.catalog, state: model.state, at: date)
        XCTAssertEqual(plan.tasks.first?.target, "q1"); XCTAssertEqual(plan.tasks.first?.kind, .review)
        let reopened = try LabModel(directory: directories.last!); XCTAssertEqual(reopened.state["learningProfile"], selected)
        var invalid = selected; invalid["diagnostic"] = .array([answers[0], answers[0], answers[0], answers[0]])
        XCTAssertThrowsError(try model.saveLearningProfile(invalid)); XCTAssertEqual(model.state["learningProfile"], selected)
    }
    func testReadingAndIndependentReviewStatesRemainSeparate() throws {
        let model = try model(), lesson = model.catalog.lessons[0], question = model.catalog.questions[0]
        let date = Date().addingTimeInterval(-86400 * 5)
        model.finishLesson(lesson); XCTAssertEqual(model.completed, 0); XCTAssertEqual(model.independentCompleted, 0)
        try model.record(question.id, sql: question.answer, passed: true, used: true, at: date)
        XCTAssertEqual(model.completionStatus(question.id), .assisted)
        try model.record(question.id, sql: question.answer, passed: true, used: false, at: date)
        XCTAssertEqual(model.completionStatus(question.id), .independent)
        try model.record(question.id, sql: question.answer, passed: true, used: false, at: date.addingTimeInterval(86400))
        XCTAssertEqual(model.completionStatus(question.id), .reviewed); XCTAssertEqual(model.reviewPassed, 1)
        try model.record(question.id, sql: "SELECT 0", passed: false, used: false, at: date.addingTimeInterval(86400 * 2))
        XCTAssertEqual(model.mastered, 0); XCTAssertEqual(model.reviewPassed, 0)
        let plan = DailyPlan.make(catalog: model.catalog, state: model.state, at: date.addingTimeInterval(86400 * 2))
        XCTAssertTrue(plan.tasks.contains { $0.target == question.id })
    }
    func testAbilityEvidenceSurvivesHistoryLimitBackupAndReopen() throws {
        let model = try model(), question = model.catalog.questions[0]
        try model.record(question.id, sql: question.answer, passed: true, used: true)
        try model.record(question.id, sql: "SELEC 1", passed: false, used: false, kind: "syntax")
        try model.record(question.id, sql: "SELECT 0", passed: false, used: false)
        try model.record(question.id, sql: question.answer, passed: true, used: false)
        for _ in 0..<13 { try model.record("q13", sql: "SELECT 0", passed: false, used: false) }
        let summary = try XCTUnwrap(model.skillSummaries.first { $0.id == "basics" })
        XCTAssertEqual(summary.independentAttempts.count, 3); XCTAssertEqual(summary.passed, 1); XCTAssertEqual(summary.repeated.map(\.id), [question.id])
        XCTAssertFalse(model.state["history"].array!.contains { $0["q"].string == question.id })
        let backup = try model.backup(), other = try self.model(); other.importBackup(backup, merge: true)
        XCTAssertEqual(other.state["evidence"], model.state["evidence"])
        let reopened = try LabModel(directory: directories.first!); XCTAssertEqual(reopened.skillSummaries.first?.rate, summary.rate)
    }
    func testMultipleExamHistoryIncludesTimingReasonsAndIdempotency() async throws {
        let model = try model(); model.startExam(week: 1)
        let firstExam = model.exam, ids = firstExam["qids"].array!.compactMap(\.string)
        model.saveDraft("test_" + ids[0], model.catalog.question(ids[0])!.answer)
        model.saveDraft("test_" + ids[1], "SELEC 1")
        await model.finishExam()
        let first = model.state["lastTest"]
        XCTAssertEqual(first["results"].array?.filter { $0["kind"].string == "unanswered" }.count, ids.count - 2)
        XCTAssertNotNil(first["elapsed"].number)
        model.startExam(week: 2)
        for id in model.exam["qids"].array!.compactMap(\.string) { model.saveDraft("test_" + id, model.catalog.question(id)!.answer) }
        await model.finishExam(); XCTAssertEqual(model.examHistory.count, 2)
        let evidence = model.state["evidence"]
        model.changeSession { $0["test"] = firstExam }
        XCTAssertFalse(model.examActive); await model.finishExam(); XCTAssertEqual(model.state["evidence"], evidence)
        let reopened = try LabModel(directory: directories.last!); XCTAssertEqual(reopened.examHistory.count, 2)
        let other = try self.model(); other.importBackup(try model.backup(), merge: true); XCTAssertEqual(other.state["tests"], model.state["tests"])
    }
    func testRecoveryRestoresDraftsAndCreatesFreshRevisionsWithoutExportingMetadata() throws {
        let model = try model()
        model.change { $0["notes"]["q1"] = .string("恢复前笔记") }; model.saveDraft("q1", "SELECT 1")
        model.createRecoveryPoint(); let point = try XCTUnwrap(model.recoveryPoints.first)
        let backup = try model.backup(); XCTAssertEqual(model.metadata["lastBackupAt"], .null)
        model.backupExported(backup); XCTAssertNotNil(model.metadata["lastBackupAt"].number)
        model.change { $0["notes"]["q1"] = .string("新笔记") }; model.saveDraft("q1", "SELECT 2")
        let before = model.state["savedAt"].number!
        model.restore(point)
        XCTAssertEqual(model.draft("q1"), "SELECT 1"); XCTAssertEqual(model.state["notes"]["q1"].string, "恢复前笔记")
        XCTAssertGreaterThan(model.state["savedAt"].number!, before); XCTAssertEqual(model.recoveryPoints.count, 2)
        let reopened = try LabModel(directory: directories.last!)
        XCTAssertEqual(reopened.metadata, model.metadata); XCTAssertEqual(reopened.draft("q1"), "SELECT 1")
        let exported = try JSONDecoder().decode(JSONValue.self, from: model.backup())
        XCTAssertEqual(exported["metadata"], .null); XCTAssertEqual(exported["session"], .null); XCTAssertEqual(exported["syncFingerprint"], .null)
    }
    func testWebAndNativePreserveProductDataAndMergeSeparateEvidence() throws {
        let catalog = try Catalog.load()
        let fixture = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: Catalog.resource("product-compatibility", extension: "json")))
        XCTAssertEqual(try Progress.normalize(fixture["left"], catalog: catalog), fixture["left"])
        XCTAssertEqual(try Progress.merge(fixture["left"], fixture["right"], catalog: catalog), fixture["merged"])
        XCTAssertEqual(try Progress.merge(fixture["right"], fixture["left"], catalog: catalog), fixture["merged"])
        var bad = fixture["left"]; bad["evidence"]["product-event-1"]["kind"] = .string("unknown")
        XCTAssertThrowsError(try Progress.normalize(bad, catalog: catalog))
    }
}
