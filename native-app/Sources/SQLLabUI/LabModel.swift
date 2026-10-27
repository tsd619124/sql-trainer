import Foundation
import Observation
import SQLLabCore
import CryptoKit

enum CompletionStatus: String {
    case unfinished = "未完成", assisted = "辅助完成", independent = "独立完成", reviewed = "复习通过", mastered = "稳定掌握"
}

@MainActor @Observable public final class LabModel {
    public let catalog: Catalog
    let engine: SQLExecutor
    private let store: ProgressStore
    var state: JSONValue
    var session: JSONValue
    var error: String?
    var busy = false
    var tab = 0
    var route: Question?
    var lessonRoute: Lesson?
    var metadata: JSONValue
    var recoveryPoints: [RecoveryPoint]
    var syncing = false
    init(directory: URL? = nil) throws {
        catalog = try Catalog.load(); engine = try SQLExecutor()
        store = try ProgressStore(directory: directory, catalog: catalog); state = store.state; session = store.session
        metadata = store.metadata; recoveryPoints = store.recoveryPoints()
        if session["test"] == .null, let id = session["lastLearning"]["id"].string {
            if session["lastLearning"]["type"].string == "question" { route = catalog.question(id) }
            else { lessonRoute = catalog.lesson(id) }
        }
    }
    var due: [Question] { catalog.allQuestions.filter { let due = state["sr"][$0.id]["due"].string; return due != nil && due! <= LocalDay.string() } }
    var wrong: [Question] { catalog.allQuestions.filter { state["wrong"][$0.id] != .null } }
    var completed: Int { catalog.questions.filter { state["done"][$0.id] != .null }.count }
    var independentCompleted: Int { catalog.questions.filter { Learning.independent(state, $0.id) }.count }
    var reviewPassed: Int { catalog.questions.filter { [.reviewed, .mastered].contains(completionStatus($0.id)) }.count }
    var mastered: Int { catalog.questions.filter { completionStatus($0.id) == .mastered }.count }
    func completionStatus(_ id: String) -> CompletionStatus {
        guard state["done"][id] != .null else { return .unfinished }
        if state["done"][id]["used"].number == 1 { return .assisted }
        let repetitions = state["sr"][id]["last"].string == nil ? 0 : state["sr"][id]["rep"].number ?? 0
        return repetitions >= 3 ? .mastered : repetitions >= 2 ? .reviewed : .independent
    }
    var streak: Int {
        let days = Set(state["days"].array?.compactMap(\.string) ?? [])
        var offset = days.contains(LocalDay.string()) ? 0 : -1; var count = 0
        while days.contains(LocalDay.adding(offset)) { count += 1; offset -= 1 }; return count
    }
    func change(_ action: (inout JSONValue) -> Void) {
        do { try store.update { action(&$0); Self.milestones(&$0, catalog: catalog) }; state = store.state } catch { self.error = error.localizedDescription }
    }
    func changeSession(_ action: (inout JSONValue) -> Void) {
        do { try store.updateSession(action); session = store.session } catch { self.error = error.localizedDescription }
    }
    func draft(_ id: String) -> String { session["codes"][id].string ?? "" }
    func saveDraft(_ id: String, _ sql: String) { changeSession { $0["codes"][id] = .string(sql) } }
    func open(_ question: Question) {
        changeSession { $0["lastLearning"] = .object(["type": .string("question"), "id": .string(question.id)]) }; route = question
    }
    func viewAnswer(_ id: String) throws {
        try store.updateSession { $0["viewed"][id] = .bool(true); $0["independent"][id] = .bool(false) }; session = store.session
    }
    func restartIndependently(_ id: String) throws {
        try store.updateSession { $0["viewed"][id] = .bool(false); $0["codes"][id] = .string(""); $0["independent"][id] = .bool(true) }; session = store.session
    }
    func submit(_ question: Question, sql: String) async throws -> Verdict {
        let used = session["viewed"][question.id].bool ?? false
        do {
            let verdict = try await engine.grade(question, sql: sql)
            try record(question.id, sql: sql, passed: verdict.passed, used: used)
            return verdict
        } catch let error as SQLLearningError {
            try record(question.id, sql: sql, passed: false, used: used, kind: error.kind)
            throw error
        }
    }
    func record(_ id: String, sql: String, passed: Bool, used: Bool, kind: String? = nil, at date: Date = Date()) throws {
        try store.update({ state in
            Self.applyResult(&state, id: id, sql: sql, passed: passed, used: used, kind: kind, at: date); Self.milestones(&state, catalog: catalog)
        }, updatingSession: { session in if passed { session["independent"][id] = .bool(false) } })
        state = store.state; session = store.session
    }
    private static func applyResult(_ s: inout JSONValue, id: String, sql: String, passed: Bool, used: Bool, kind: String? = nil, at date: Date = Date()) {
        let now = date.timeIntervalSince1970 * 1000, today = LocalDay.string(date)
        s["evidence"][UUID().uuidString] = .object(["qid": .string(id), "ok": .bool(passed), "used": .bool(used), "t": .number(now), "kind": .string(kind ?? (passed ? "passed" : "result"))])
        s["attempts"][id] = .number((s["attempts"][id].number ?? 0) + 1)
        if passed {
            s["done"][id] = .object(["ts": .number(now), "used": .number(used ? 1 : 0)])
            if !used { var wrong = s["wrong"].object ?? [:]; wrong.removeValue(forKey: id); s["wrong"] = .object(wrong) }
        } else { s["wrong"][id] = .number((s["wrong"][id].number ?? 0) + 1) }
        var days = Set(s["days"].array?.compactMap(\.string) ?? []); days.insert(today); s["days"] = .array(days.sorted().map(JSONValue.string))
        let previous = s["sr"][id]
        let rep: Double = !passed || used ? 0 : previous["last"].string == nil ? 1 : previous["last"].string == today ? max(1, previous["rep"].number ?? 0) : (previous["rep"].number ?? 0) + 1
        let interval = used || rep == 0 ? 1 : previous["last"].string == today && rep == previous["rep"].number ? max(1, previous["iv"].number ?? 1) : rep == 1 ? 1 : rep == 2 ? 3 : min(60, max(1, (previous["iv"].number ?? 1) * (previous["ef"].number ?? 2.5)).rounded())
        s["sr"][id] = .object(["due": .string(LocalDay.adding(Int(interval), to: date)), "iv": .number(interval), "rep": .number(rep), "ef": .number(used && passed ? max(1.6, (previous["ef"].number ?? 2.5) - 0.05) : previous["ef"].number ?? 2.5), "lapse": .number((previous["lapse"].number ?? 0) + (passed ? 0 : 1)), "last": .string(today)])
        let entry: JSONValue = .object(["q": .string(id), "s": .string(sql), "ok": .number(passed ? 1 : 0), "t": .number(now), "kind": .string(kind ?? (passed ? "passed" : "result")), "used": .number(used ? 1 : 0)])
        s["history"] = .array(Array(([entry] + (s["history"].array ?? [])).prefix(12)))
        if !(s["done"].object ?? [:]).isEmpty { s["mil"]["first"] = .number(1) }
    }
    private static func milestones(_ s: inout JSONValue, catalog: Catalog) {
        let done = catalog.questions.filter { s["done"][$0.id] != .null }.count
        let days = Set(s["days"].array?.compactMap(\.string) ?? [])
        var count = 0, offset = days.contains(LocalDay.string()) ? 0 : -1
        while days.contains(LocalDay.adding(offset)) { count += 1; offset -= 1 }
        let flags = ["first": done >= 1, "d3": count >= 3, "d7": count >= 7, "l5": (s["lessons"].object?.count ?? 0) >= 5, "t10": done >= 10, "w1": catalog.questions.filter { $0.w == 1 }.allSatisfy { s["done"][$0.id] != .null }, "half": done >= 21, "all": done == catalog.questions.count]
        for (id, achieved) in flags where achieved { s["mil"][id] = .number(1) }
    }
    func finishLesson(_ lesson: Lesson) {
        change { s in
            s["lessons"][lesson.id] = .number(1)
            var days = Set(s["days"].array?.compactMap(\.string) ?? []); days.insert(LocalDay.string()); s["days"] = .array(days.sorted().map(JSONValue.string))
            if (s["lessons"].object?.count ?? 0) >= 5 { s["mil"]["l5"] = .number(1) }
        }
    }
    var exam: JSONValue { session["test"] }
    var examActive: Bool { exam != .null && state["lastTest"]["id"] != exam["id"] && state["tests"][exam["id"].string ?? ""] == .null }
    var examHistory: [JSONValue] {
        var records = state["tests"].object ?? [:]
        if let id = state["lastTest"]["id"].string, records[id] == nil { records[id] = state["lastTest"] }
        return records.values.sorted { ($0["endedAt"].number ?? 0) > ($1["endedAt"].number ?? 0) }
    }
    func startExam(week: Int) {
        guard !examActive else { return }
        let pool = catalog.questions.filter { week == 0 || $0.w == week }
        let picked = Array((pool.filter { state["done"][$0.id] == .null }.shuffled() + pool.filter { state["done"][$0.id] != .null }.shuffled()).prefix(5))
        changeSession { s in
            for q in picked { s["codes"]["test_" + q.id] = .string("") }
            let started = Date().timeIntervalSince1970 * 1000
            s["test"] = .object(["id": .string(UUID().uuidString), "qids": .array(picked.map { .string($0.id) }), "idx": .number(0), "startedAt": .number(started), "week": .number(Double(week)), "endAt": .number(started + 2_700_000), "finished": .bool(false)])
        }
    }
    func finishExam() async {
        guard examActive, !busy else { return }; busy = true; defer { busy = false }
        let current = exam, drafts = session["codes"]
        var results: [(String, String, Bool, String)] = []
        do {
            for id in current["qids"].array?.compactMap(\.string) ?? [] {
                guard let q = catalog.question(id) else { continue }
                let sql = drafts["test_" + id].string ?? ""
                if sql.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { results.append((id, sql, false, "unanswered")); continue }
                do {
                    let verdict = try await engine.grade(q, sql: sql)
                    results.append((id, sql, verdict.passed, verdict.passed ? "passed" : "result"))
                } catch let error as SQLLearningError { results.append((id, sql, false, error.kind)) }
            }
            let started = current["startedAt"].number ?? (current["endAt"].number ?? 0) - 2_700_000
            let ended = max(started, Date().timeIntervalSince1970 * 1000)
            let record: JSONValue = .object(["id": current["id"], "startedAt": .number(started), "endedAt": .number(ended), "elapsed": .number(min(2700, (ended - started) / 1000)), "week": current["week"] == .null ? .number(0) : current["week"], "results": .array(results.map { .object(["qid": .string($0.0), "sql": .string($0.1), "ok": .bool($0.2), "kind": .string($0.3)]) })])
            try store.update({ state in
                for (id, sql, passed, kind) in results { Self.applyResult(&state, id: id, sql: sql, passed: passed, used: false, kind: kind) }
                state["lastTest"] = record; state["tests"][current["id"].string!] = record
                Self.milestones(&state, catalog: catalog)
            }, updatingSession: { $0["test"] = .null })
            state = store.state; session = store.session
        } catch { self.error = error.localizedDescription }
    }
    func mergeRemote(_ progress: JSONValue) throws {
        try store.importBackup(progress.data(), merge: true); refresh()
    }
    func backup() throws -> Data { try store.exportBackup() }
    func importBackup(_ data: Data, merge: Bool) {
        do { try store.importBackup(data, merge: merge); refresh(); route = nil; lessonRoute = nil; prepareDailyPlan() } catch { self.error = error.localizedDescription }
    }
    func undo() { do { try store.undoImport(); refresh(); route = nil; lessonRoute = nil; prepareDailyPlan() } catch { self.error = error.localizedDescription } }
    private func refresh() { state = store.state; session = store.session; metadata = store.metadata; recoveryPoints = store.recoveryPoints() }
    var dailyPlan: DailyPlan? {
        guard let plan = DailyPlan(session["dailyPlan"]), plan.tasks.allSatisfy({ $0.kind == .lesson ? catalog.lesson($0.target) != nil : catalog.question($0.target) != nil }) else { return nil }
        return plan
    }
    func prepareDailyPlan(at date: Date = Date()) {
        guard dailyPlan?.day != LocalDay.string(date) else { return }
        let plan = DailyPlan.make(catalog: catalog, state: state, previous: dailyPlan, at: date)
        changeSession { $0["dailyPlan"] = plan.json }
    }
    func openTask(_ task: DailyTask) {
        if task.kind == .lesson { lessonRoute = catalog.lesson(task.target) }
        else if let question = catalog.question(task.target) {
            do {
                if task.kind == .review && session["independent"][question.id].bool != true { try restartIndependently(question.id) }
                open(question)
            } catch { self.error = error.localizedDescription }
        }
    }
    func saveLearningProfile(_ profile: JSONValue) throws {
        let clean = try Learning.normalizeProfile(profile, catalog: catalog)
        try store.update({ $0["learningProfile"] = clean }, updatingSession: { $0["dailyPlan"] = .null })
        refresh(); prepareDailyPlan()
    }
    static func fingerprint(_ state: JSONValue) -> String { SHA256.hash(data: (try? state.data()) ?? Data()).map { String(format: "%02x", $0) }.joined() }
    var pendingSync: Bool { metadata["syncFingerprint"].string != Self.fingerprint(state) }
    func backupExported(_ data: Data) {
        do {
            let snapshot = try JSONDecoder().decode(JSONValue.self, from: data)
            try store.updateMetadata { $0["lastBackupAt"] = .number(Date().timeIntervalSince1970 * 1000); $0["backupFingerprint"] = .string(Self.fingerprint(snapshot)) }; metadata = store.metadata
        } catch { self.error = "备份已导出，但备份状态未能保存：" + error.localizedDescription }
    }
    func createRecoveryPoint() {
        do { try store.createRecoveryPoint(label: "手动恢复点"); recoveryPoints = store.recoveryPoints() } catch { self.error = error.localizedDescription }
    }
    func restore(_ point: RecoveryPoint) {
        do { try store.restoreRecoveryPoint(point); refresh(); route = nil; lessonRoute = nil; prepareDailyPlan() } catch { self.error = error.localizedDescription }
    }
    func synchronize(config original: JSONValue, service: CloudSync = CloudSync(), saveConfiguration: (JSONValue) throws -> Void = SyncCredentials.save) async throws -> JSONValue {
        guard !syncing else { throw LabError.message("同步正在进行，请等待完成。") }
        syncing = true; defer { syncing = false }
        do {
            var config = original
            let remote = try await service.pull(config: config)
            if let progress = remote.progress { try mergeRemote(progress) }
            let snapshot = state
            let id = try await service.push(snapshot, config: config, remoteID: remote.remoteID)
            if config["provider"].string != "lc" { config["gistId"] = .string(id) }
            let now = Date().timeIntervalSince1970 * 1000; config["lastSync"] = .number(now)
            try saveConfiguration(config)
            try store.updateMetadata { $0["lastSyncAt"] = .number(now); $0["syncFingerprint"] = .string(Self.fingerprint(snapshot)); $0["syncError"] = .string("") }
            metadata = store.metadata
            return config
        } catch {
            try? store.updateMetadata { $0["syncError"] = .string(error.localizedDescription) }; metadata = store.metadata
            throw error
        }
    }
}
