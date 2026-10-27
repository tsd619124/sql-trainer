import XCTest
@testable import SQLLabCore
@testable import SQLLabUI

final class CatalogQualityTests: XCTestCase {
    func testAllLessonSectionsRetainTheirSourceFields() throws {
        let catalog = try Catalog.load()
        let source = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: Catalog.resource("catalog", extension: "json")))
        let encoded = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(catalog))
        XCTAssertEqual(encoded["lessons"], source["lessons"])
        XCTAssertEqual(catalog.lessons.filter { $0.secs.contains { $0.traps != nil } }.count, 27)
        XCTAssertEqual(catalog.lessons.flatMap(\.secs).flatMap { $0.traps ?? [] }.count, 80)
        XCTAssertTrue(catalog.lessons.allSatisfy { $0.qs.allSatisfy { catalog.question($0) != nil } })
    }

    func testExampleExecutionRequiresSQLiteAndExplicitPermission() async throws {
        let catalog = try Catalog.load(), engine = try SQLExecutor()
        let hive = try XCTUnwrap(catalog.lesson("w3l4")?.secs.first { $0.dialect == "Hive" })
        XCTAssertFalse(hive.canRun)
        XCTAssertTrue(hive.exampleDescription.contains("阅读示例"))
        XCTAssertFalse(try JSONDecoder().decode(LessonSection.self, from: Data(#"{"code":"SELECT 1","run":1,"dialect":"Hive"}"#.utf8)).canRun)
        XCTAssertFalse(try JSONDecoder().decode(LessonSection.self, from: Data(#"{"code":"SELECT 1","run":0}"#.utf8)).canRun)
        for section in catalog.lessons.flatMap(\.secs) where section.canRun {
            _ = try await engine.practice(try XCTUnwrap(section.code))
        }
    }

    func testMovingAverageUsesEveryCalendarDayAndRejectsOldAnswer() async throws {
        let catalog = try Catalog.load(), engine = try SQLExecutor()
        let question = try XCTUnwrap(catalog.question("q33"))
        let grouped = try await engine.query("SELECT order_date, COUNT(*) FROM orders WHERE status='已完成' GROUP BY order_date ORDER BY order_date")
        let counts = Dictionary(uniqueKeysWithValues: grouped.values.map { ($0[0].string!, $0[1].number!) })
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        var date = try XCTUnwrap(formatter.date(from: counts.keys.min()!))
        let last = try XCTUnwrap(formatter.date(from: counts.keys.max()!))
        var window: [Double] = [], expected: [[JSONValue]] = []
        while date <= last {
            let day = formatter.string(from: date), count = counts[formatter.string(from: date)] ?? 0
            window.append(count); window = Array(window.suffix(7))
            let average = (window.reduce(0, +) / Double(window.count) * 100).rounded() / 100
            expected.append([.string(day), .number(count), .number(average)])
            date = date.addingTimeInterval(86400)
        }
        let result = try await engine.query(question.answer)
        XCTAssertEqual(result.values, expected)
        XCTAssertTrue(expected.contains { $0[1] == .number(0) })
        let oldAnswer = "WITH d AS (SELECT order_date, COUNT(*) AS cnt FROM orders WHERE status='已完成' GROUP BY order_date) SELECT order_date, cnt, ROUND(AVG(cnt) OVER (ORDER BY order_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW),2) AS ma7 FROM d;"
        let oldVerdict = try await engine.grade(question, sql: oldAnswer)
        XCTAssertFalse(oldVerdict.passed)
        let wrongZeroCount = try await engine.grade(question, sql: question.answer.replacingOccurrences(of: "COUNT(o.order_id)", with: "COUNT(*)"))
        XCTAssertFalse(wrongZeroCount.passed)
        let reversed = try await engine.grade(question, sql: question.answer.replacingOccurrences(of: "FROM daily ORDER BY order_date;", with: "FROM daily ORDER BY order_date DESC;"))
        XCTAssertFalse(reversed.passed)
    }
}

@MainActor final class TrainingQualityTests: XCTestCase {
    func testAssistedCompletionCanRestartIndependentlyAndResume() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let model = try LabModel(directory: directory), question = model.catalog.questions[0]
        model.saveDraft(question.id, question.answer)
        try model.viewAnswer(question.id)
        _ = try await model.submit(question, sql: question.answer)
        XCTAssertEqual(model.completionStatus(question.id), .assisted)
        XCTAssertEqual(model.independentCompleted, 0)
        let completed = model.state["done"][question.id]
        try model.restartIndependently(question.id)
        XCTAssertEqual(model.state["done"][question.id], completed)
        let reopened = try LabModel(directory: directory)
        XCTAssertEqual(reopened.draft(question.id), "")
        XCTAssertEqual(reopened.session["viewed"][question.id], .bool(false))
        XCTAssertEqual(reopened.session["independent"][question.id], .bool(true))
        _ = try await reopened.submit(question, sql: question.answer)
        XCTAssertEqual(reopened.completionStatus(question.id), .independent)
        XCTAssertEqual(reopened.session["independent"][question.id], .bool(false))
        XCTAssertEqual(try LabModel(directory: directory).session["independent"][question.id], .bool(false))
        XCTAssertEqual(reopened.state["history"].array?.first?["used"], .number(0))
        try reopened.viewAnswer(question.id)
        _ = try await reopened.submit(question, sql: question.answer)
        XCTAssertEqual(reopened.completionStatus(question.id), .assisted)
        XCTAssertEqual(reopened.state["sr"][question.id]["rep"], .number(0))
    }

    func testMasteryRequiresIndependentSuccessOnDifferentDays() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let model = try LabModel(directory: directory), question = model.catalog.questions[0]
        let start = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-10-20T12:00:00Z"))
        for _ in 0..<4 { try model.record(question.id, sql: question.answer, passed: true, used: false, at: start) }
        XCTAssertEqual(model.completionStatus(question.id), .independent)
        XCTAssertEqual(model.state["sr"][question.id]["rep"], .number(1))
        try model.record(question.id, sql: question.answer, passed: true, used: false, at: start.addingTimeInterval(86400))
        XCTAssertEqual(model.completionStatus(question.id), .reviewed)
        let thirdDay = start.addingTimeInterval(86400 * 2)
        try model.record(question.id, sql: question.answer, passed: true, used: false, at: thirdDay)
        XCTAssertEqual(model.completionStatus(question.id), .mastered)
        let review = model.state["sr"][question.id]
        try model.record(question.id, sql: question.answer, passed: true, used: false, at: thirdDay)
        XCTAssertEqual(model.state["sr"][question.id], review)
        let reopened = try LabModel(directory: directory)
        XCTAssertEqual(reopened.completionStatus(question.id), .mastered)
        XCTAssertEqual(reopened.mastered, 1)
    }

    func testSyntaxErrorsEnterAttemptsWrongAnswersHistoryAndBackup() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let model = try LabModel(directory: directory), question = model.catalog.questions[0]
        do {
            _ = try await model.submit(question, sql: "SELEC product_name FROM products;")
            XCTFail("应返回语法错误")
        } catch let error as SQLLearningError { XCTAssertEqual(error.kind, "syntax") }
        XCTAssertEqual(model.state["attempts"][question.id], .number(1))
        XCTAssertEqual(model.wrong.map(\.id), [question.id])
        XCTAssertEqual(model.completionStatus(question.id), .unfinished)
        let entry = try XCTUnwrap(model.state["history"].array?.first)
        XCTAssertEqual(entry["kind"], .string("syntax"))
        let reopened = try LabModel(directory: directory)
        XCTAssertEqual(reopened.state["history"].array?.first, entry)
        let backup = try JSONDecoder().decode(JSONValue.self, from: reopened.backup())
        XCTAssertEqual(try Progress.normalize(backup, catalog: model.catalog)["history"].array?.first, entry)
        _ = try await reopened.submit(question, sql: question.answer)
        XCTAssertEqual(reopened.state["attempts"][question.id], .number(2))
        XCTAssertTrue(reopened.wrong.isEmpty)
    }

    func testSystemAndStorageFailuresDoNotCreateLearningErrors() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let model = try LabModel(directory: directory), question = model.catalog.questions[0]
        var malformed = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(question))
        malformed["answer"] = .string("SELECT * FROM missing_reference_table")
        let invalidReference = try JSONDecoder().decode(Question.self, from: malformed.data())
        let before = model.state
        do { _ = try await model.submit(invalidReference, sql: question.answer); XCTFail("应返回系统错误") }
        catch { XCTAssertFalse(error is SQLLearningError) }
        XCTAssertEqual(model.state, before)
        try FileManager.default.createDirectory(at: directory.appendingPathComponent("native-learning.json"), withIntermediateDirectories: true)
        do { _ = try await model.submit(question, sql: question.answer); XCTFail("应返回保存错误") }
        catch { XCTAssertFalse(error is SQLLearningError) }
        XCTAssertEqual(model.state, before)
        XCTAssertEqual(model.session["independent"][question.id], .null)
    }

    func testExamSyntaxErrorsUseTheSameLearningRecordPath() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let model = try LabModel(directory: directory)
        model.startExam(week: 1)
        let ids = model.exam["qids"].array!.compactMap(\.string)
        for id in ids { model.saveDraft("test_" + id, "SELEC 1;") }
        await model.finishExam()
        XCTAssertFalse(model.examActive)
        XCTAssertTrue(ids.allSatisfy { model.state["attempts"][$0] == .number(1) && model.state["wrong"][$0] == .number(1) })
        XCTAssertTrue(model.state["history"].array!.allSatisfy { $0["kind"] == .string("syntax") })
    }
}
