import XCTest
@testable import SQLLabCore
@testable import SQLLabUI

@MainActor final class InterfaceTests: XCTestCase {
    private var directories: [URL] = []
    private func model() throws -> LabModel {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        directories.append(directory); return try LabModel(directory: directory)
    }
    override func tearDown() { for directory in directories { try? FileManager.default.removeItem(at: directory) }; directories = [] }

    func testDifferencesDistinguishColumnsRowsValuesAndOrder() throws {
        let reference = SQLResult(columns: ["name", "value"], values: [[.string("a"), .number(1)], [.string("b"), .number(2)]])
        XCTAssertEqual(SQLResult(columns: ["name"], values: [[.string("a")]]).difference(from: reference, orderedBy: nil)?.kind, .columns)
        let missing = SQLResult(columns: reference.columns, values: [reference.values[0]]).difference(from: reference, orderedBy: nil)
        XCTAssertEqual(missing?.kind, .missing); XCTAssertEqual(missing?.missingCount, 1); XCTAssertEqual(missing?.missing.values, [reference.values[1]])
        let extra = SQLResult(columns: reference.columns, values: reference.values + [reference.values[0]]).difference(from: reference, orderedBy: nil)
        XCTAssertEqual(extra?.kind, .extra); XCTAssertEqual(extra?.extraCount, 1)
        XCTAssertEqual(SQLResult(columns: reference.columns, values: [[.string("a"), .number(9)], reference.values[1]]).difference(from: reference, orderedBy: nil)?.kind, .values)
        let reversed = SQLResult(columns: reference.columns, values: reference.values.reversed())
        XCTAssertEqual(reversed.difference(from: reference, orderedBy: [1])?.kind, .order)
        XCTAssertNil(reversed.difference(from: reference, orderedBy: nil))
        let equivalent = SQLResult(columns: reference.columns, values: [[.string(" a "), .number(1.004)], reference.values[1]])
        XCTAssertNil(equivalent.difference(from: reference, orderedBy: [1]))
        let ties = SQLResult(columns: reference.columns, values: [[.string("a"), .number(1)], [.string("b"), .number(1)]])
        XCTAssertNil(SQLResult(columns: ties.columns, values: ties.values.reversed()).difference(from: ties, orderedBy: [1]))
    }

    func testDuplicateDifferencesKeepMultiplicityAndBoundExamples() {
        let actual = SQLResult(columns: ["n"], values: Array(repeating: [.number(1)], count: 6))
        let reference = SQLResult(columns: ["n"], values: [[.number(1)]])
        let difference = actual.difference(from: reference, orderedBy: nil)
        XCTAssertEqual(difference?.extraCount, 5); XCTAssertEqual(difference?.extra.values.count, 3)
        XCTAssertEqual(difference?.missingCount, 0)
    }

    func testInlineSchemaUsesRealTypesAndProtectsDatabaseBoundary() async throws {
        let engine = try SQLExecutor()
        let table = try await engine.tableOverview("products")
        XCTAssertEqual(table.columns.map(\.name), table.sample.columns)
        XCTAssertTrue(table.columns.contains { $0.name == "price" && !$0.type.isEmpty })
        XCTAssertLessThanOrEqual(table.sample.values.count, 5)
        let events = try await engine.tableOverview("events", training: true)
        XCTAssertTrue(events.columns.contains { $0.name == "session_id" })
        do { _ = try await engine.tableOverview("events"); XCTFail("核心训练不能读取拓展库") } catch {}
        do { _ = try await engine.tableOverview("products; DROP TABLE users"); XCTFail("必须拒绝非目录表名") } catch {}
    }

    func testSearchCombinesBodyNotesTopicDifficultyAndCompletion() throws {
        let model = try model(), question = model.catalog.questions[0]
        model.change { $0["notes"][question.id] = .string("only-note-marker 光标") }
        var query = CatalogQuery(search: "only-note-marker 光标")
        XCTAssertTrue(query.matches(question, model: model)); XCTAssertFalse(query.matches(model.catalog.questions[1], model: model))
        query.week = question.w + 1; XCTAssertFalse(query.matches(question, model: model))
        query.week = 0; query.difficulty = .advanced; XCTAssertFalse(query.matches(question, model: model))
        query.difficulty = .foundation; query.status = .independent; XCTAssertFalse(query.matches(question, model: model))
        try model.record(question.id, sql: question.answer, passed: true, used: false)
        XCTAssertTrue(query.matches(question, model: model))
        query.search = question.text; XCTAssertTrue(query.matches(question, model: model))
    }

    func testFavoritesSurviveReopenWithoutChangingLearningProgress() throws {
        let model = try model(), question = model.catalog.questions[0], lesson = model.catalog.lessons[0]
        let before = model.state
        model.toggleFavorite(question.id); model.toggleFavorite(lesson.id)
        XCTAssertEqual(model.state, before)
        let reopened = try LabModel(directory: XCTUnwrap(directories.last))
        XCTAssertTrue(reopened.isFavorite(question.id)); XCTAssertTrue(reopened.isFavorite(lesson.id))
        let query = CatalogQuery(favoritesOnly: true)
        XCTAssertTrue(query.matches(question, model: reopened)); XCTAssertTrue(query.matches(lesson, model: reopened))
        XCTAssertFalse(query.matches(model.catalog.questions[1], model: reopened))
        reopened.toggleFavorite(question.id); XCTAssertFalse(reopened.isFavorite(question.id))
        XCTAssertNil(try JSONDecoder().decode(JSONValue.self, from: reopened.backup())["favorites"].object)
    }

    func testSQLSyntaxPreservesLiteralCommentAndUnicodeRanges() {
        let sql = "SELECT 'FROM 中文', 12 -- WHERE\nFROM products"
        let tokens = SQLSyntax.tokens(in: sql), source = sql as NSString
        XCTAssertEqual(tokens.filter { $0.kind == .keyword }.map { source.substring(with: $0.range) }, ["SELECT", "FROM"])
        XCTAssertEqual(tokens.filter { $0.kind == .string }.count, 1); XCTAssertEqual(tokens.filter { $0.kind == .comment }.count, 1)
        XCTAssertEqual(SQLSyntax.indentation(in: "  SELECT (", at: 10), "      ")
        XCTAssertEqual(SQLSyntax.matchingBrackets(in: "SELECT '(' , (1 + 2)", selection: 14).count, 2)
        XCTAssertTrue(SQLSyntax.matchingBrackets(in: "SELECT '('", selection: 9).isEmpty)
        let editor = SQLEditorController()
        editor.selection = NSRange(location: 7, length: 1)
        XCTAssertEqual(editor.inserting("price", into: "SELECT 星 FROM products"), "SELECT price FROM products")
        XCTAssertEqual(editor.selection, NSRange(location: 12, length: 0))
    }

    func testGuideSectionsRetainTablesLinksAndDialectOperators() throws {
        let value = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: Catalog.resource("guides", extension: "json")))
        let plan = (value["sections"]["plan"].array ?? []).compactMap(GuideSection.init)
        let cheat = (value["sections"]["cheat"].array ?? []).compactMap(GuideSection.init)
        XCTAssertGreaterThan(plan.count, 5); XCTAssertGreaterThan(cheat.count, 5)
        XCTAssertEqual(plan.flatMap(\.tables).first?.result.values.count, 8)
        XCTAssertEqual(plan.flatMap(\.links).count, 3)
        XCTAssertTrue(plan.flatMap(\.links).allSatisfy { URL(string: $0.url)?.scheme == "https" })
        XCTAssertTrue(cheat.flatMap(\.tables).contains { $0.result.values.contains { $0.contains(.string("a || b")) } })
        XCTAssertTrue(cheat.flatMap(\.tables).allSatisfy { table in table.result.values.allSatisfy { $0.count == table.result.columns.count } })
    }

    func testResultCopyAndContinuationPreserveLearningState() throws {
        let result = SQLResult(columns: ["文本", "n"], values: [[.string("a\tb\nc"), .null]])
        XCTAssertEqual(result.tabSeparated, "文本\tn\n\"a\tb\nc\"\tNULL")
        let model = try model(), first = model.catalog.questions[0]
        XCTAssertEqual(model.nextQuestion(after: first)?.id, model.catalog.questions[1].id)
        model.open(first); model.saveDraft(first.id, "SELECT 1")
        let state = model.state
        model.endLearning(); XCTAssertNil(model.route); XCTAssertEqual(model.session["lastLearning"], .null)
        XCTAssertEqual(model.draft(first.id), "SELECT 1"); XCTAssertEqual(model.state, state)
    }
}
