import XCTest
@testable import SQLLabCore
@testable import SQLLabUI

@MainActor final class TrainingTests: XCTestCase {
    func testExamResumeAndIdempotentSubmission() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let model = try LabModel(directory: dir)
        model.startExam(week: 1)
        let original = model.exam
        for id in original["qids"].array!.compactMap(\.string) { model.saveDraft("test_" + id, model.catalog.question(id)!.answer) }
        let resumed = try LabModel(directory: dir)
        XCTAssertEqual(resumed.exam, original)
        XCTAssertTrue(resumed.examActive)
        await resumed.finishExam()
        XCTAssertFalse(resumed.examActive)
        let result = resumed.state["lastTest"]
        XCTAssertTrue(result["results"].array!.allSatisfy { $0["ok"].bool == true })
        let attempts = resumed.state["attempts"]
        await resumed.finishExam()
        XCTAssertEqual(resumed.state["attempts"], attempts)
        let reopened = try LabModel(directory: dir)
        XCTAssertEqual(reopened.state["lastTest"], result); XCTAssertFalse(reopened.examActive)
    }
    func testWrongAnswerRecoveryAndLessonPersistence() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let model = try LabModel(directory: dir), q = model.catalog.questions[0]
        try model.record(q.id, sql: "SELECT 0", passed: false, used: false)
        XCTAssertEqual(model.wrong.map(\.id), [q.id])
        try model.record(q.id, sql: q.answer, passed: true, used: true)
        XCTAssertEqual(model.wrong.map(\.id), [q.id])
        try model.record(q.id, sql: q.answer, passed: true, used: false)
        XCTAssertTrue(model.wrong.isEmpty)
        model.finishLesson(model.catalog.lessons[0])
        let reopened = try LabModel(directory: dir)
        XCTAssertEqual(reopened.completed, 1); XCTAssertEqual(reopened.state["lessons"][model.catalog.lessons[0].id], .number(1))
        XCTAssertNotNil(reopened.state["sr"][q.id]["due"].string)
    }
}
