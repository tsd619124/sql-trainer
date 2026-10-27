import XCTest
@testable import SQLLabCore

final class EngineTests: XCTestCase {
    func testAllReferenceAnswersMatchWebFixture() async throws {
        let catalog = try Catalog.load(), engine = try SQLExecutor()
        let rows = try JSONDecoder().decode([JSONValue].self, from: Data(contentsOf: Catalog.resource("reference-results", extension: "json")))
        XCTAssertEqual(catalog.questions.count, 42); XCTAssertEqual(catalog.lessons.count, 28)
        for q in catalog.questions {
            let expected = try XCTUnwrap(rows.first { $0["id"].string == q.id })
            let result = try await engine.query(q.answer)
            XCTAssertEqual(result.columns, expected["columns"].array?.compactMap(\.string), q.id)
            XCTAssertEqual(result.values, expected["values"].array?.compactMap(\.array), q.id)
            let verdict = try await engine.grade(q, sql: q.answer); XCTAssertTrue(verdict.passed, q.id)
        }
    }
    func testReadOnlyIsolationAndBatchRollback() async throws {
        let engine = try SQLExecutor()
        let baseline = try await engine.query("SELECT COUNT(*) FROM products")
        for sql in ["DELETE FROM products", "ATTACH DATABASE ':memory:' AS other", "PRAGMA user_version=1", "SELECT 1; SELECT 2"] {
            do { _ = try await engine.query(sql); XCTFail("应拒绝 \(sql)") } catch { }
        }
        let batch = try await engine.practice("CREATE TABLE scratch (id INTEGER); INSERT INTO scratch VALUES (7); SELECT * FROM scratch;")
        XCTAssertEqual(batch.values, [[.number(7)]])
        do { _ = try await engine.practice("INSERT INTO scratch VALUES (8); SELECT * FROM missing_table;"); XCTFail("应回滚") } catch { }
        let rolled = try await engine.practice("SELECT * FROM scratch"); XCTAssertEqual(rolled.values, [[.number(7)]])
        _ = try await engine.practice("DELETE FROM products")
        let actual = try await engine.query("SELECT COUNT(*) FROM products"); XCTAssertEqual(actual, baseline)
        await engine.resetPractice()
        let reset = try await engine.practice("SELECT COUNT(*) FROM products"); XCTAssertEqual(reset, baseline)
    }
    func testResultComparisonKeepsDuplicatesAndTies() {
        let expected = SQLResult(columns: ["rank", "value"], values: [[.number(1), .string("a")], [.number(1), .string("b")], [.number(2), .null]])
        let tied = SQLResult(columns: expected.columns, values: [expected.values[1], expected.values[0], expected.values[2]])
        XCTAssertTrue(tied.matches(expected, orderedBy: [0]))
        let reversed = SQLResult(columns: expected.columns, values: Array(expected.values.reversed()))
        XCTAssertFalse(reversed.matches(expected, orderedBy: [0])); XCTAssertTrue(reversed.matches(expected, orderedBy: nil))
        let duplicates = SQLResult(columns: ["v"], values: [[.number(1)], [.number(1)]])
        XCTAssertFalse(duplicates.matches(SQLResult(columns: ["v"], values: [[.number(1)], [.number(2)]]), orderedBy: nil))
    }
    func testQueryLimits() async throws {
        let engine = try SQLExecutor()
        do { _ = try await engine.query("WITH RECURSIVE x(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM x WHERE n<5001) SELECT * FROM x"); XCTFail("行数限制") } catch { }
        do { _ = try await engine.query("WITH RECURSIVE x(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM x) SELECT SUM(n) FROM x"); XCTFail("超时限制") } catch { }
        let result = try await engine.query("SELECT 1"); XCTAssertEqual(result.values, [[.number(1)]])
    }
}

final class ProgressTests: XCTestCase {
    func testWebCompatibilityFixturesAndTombstones() throws {
        let catalog = try Catalog.load()
        let fixture = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: Catalog.resource("compatibility", extension: "json")))
        XCTAssertEqual(try Progress.normalize(fixture["old"], catalog: catalog), fixture["normalized"])
        XCTAssertEqual(try Progress.merge(fixture["changed"], fixture["normalized"], catalog: catalog), fixture["merged"])
        var next = fixture["normalized"]; next["wrong"] = .object([:])
        next = Progress.stamp(next, before: fixture["normalized"], device: "test")
        XCTAssertEqual(next["_sync"]["records"]["wrong"]["q2"]["deleted"], .number(1))
        XCTAssertEqual(try Progress.merge(next, fixture["normalized"], catalog: catalog)["wrong"]["q2"], .null)
    }
    @MainActor func testAtomicPersistenceMigrationAndInvalidImport() throws {
        let catalog = try Catalog.load(), directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true); defer { try? FileManager.default.removeItem(at: directory) }
        let fixture = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: Catalog.resource("compatibility", extension: "json")))
        let legacy: [String: String] = ["sqltrain_state": fixture["old"].canonical, "sqltrain_session": "{\"v\":1,\"codes\":{\"q1\":\"SELECT 1\"}}"]
        let legacyData = try JSONEncoder().encode(legacy); try legacyData.write(to: directory.appendingPathComponent("learning.json"))
        let store = try ProgressStore(directory: directory, catalog: catalog)
        XCTAssertEqual(store.state["notes"]["q1"].string, "旧笔记"); XCTAssertEqual(store.session["codes"]["q1"].string, "SELECT 1")
        try store.updateSession { $0["codes"]["q1"] = .string("SELECT 2") }
        try store.update { $0["notes"]["q1"] = .string("原生笔记") }
        let reopened = try ProgressStore(directory: directory, catalog: catalog)
        XCTAssertEqual(reopened.session["codes"]["q1"].string, "SELECT 2"); XCTAssertEqual(reopened.state, store.state)
        let before = try Data(contentsOf: store.url)
        XCTAssertThrowsError(try store.importBackup(Data("{}".utf8), merge: false))
        XCTAssertEqual(try Data(contentsOf: store.url), before)
        try store.importBackup(fixture["old"].data(), merge: false)
        XCTAssertEqual(store.state["notes"]["q1"].string, "旧笔记")
        try store.undoImport(); XCTAssertEqual(store.state["notes"]["q1"].string, "原生笔记")
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("learning.json")), legacyData)
        let backup = try JSONDecoder().decode(JSONValue.self, from: store.exportBackup())
        XCTAssertNotNil(try Progress.normalize(backup, catalog: catalog)); XCTAssertNil(backup.object?["session"])
        try Data("broken".utf8).write(to: store.url)
        XCTAssertThrowsError(try ProgressStore(directory: directory, catalog: catalog)); XCTAssertEqual(try String(contentsOf: store.url), "broken")
    }
    func testRejectsMalformedProgress() throws {
        let catalog = try Catalog.load()
        for bad in [JSONValue.object(["v": .number(9), "done": .object([:])]), .object(["v": .number(1), "done": .object(["unknown": .object(["ts": .number(1)])])]), .object(["v": .number(1), "done": .object([:]), "days": .array([.string("2026-02-30")])])] {
            XCTAssertThrowsError(try Progress.normalize(bad, catalog: catalog))
        }
    }
}

final class CipherTests: XCTestCase {
    func testWebEncryptionCompatibility() throws {
        let f = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: Catalog.resource("encryption-fixture", extension: "json")))
        XCTAssertEqual(try SyncCipher.decrypt(f["payload"].string!, code: f["code"].string!), f["plaintext"])
        XCTAssertThrowsError(try SyncCipher.decrypt(f["payload"].string!, code: "wrong-password"))
        let encrypted = try SyncCipher.encrypt(f["plaintext"], code: "native-roundtrip")
        XCTAssertEqual(try SyncCipher.decrypt(encrypted, code: "native-roundtrip"), f["plaintext"])
    }
}
