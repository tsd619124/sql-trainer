import Foundation

public enum Progress {
    public static let groups = ["done", "wrong", "notes", "lessons", "plan", "attempts", "sr", "mil", "days", "misc", "evidence", "tests"]
    public static var empty: JSONValue {
        var v: JSONValue = .object(["v": .number(1), "days": .array([]), "savedAt": .number(0), "_sync": .object(["reset": .object(["t": .number(0), "d": .string("")]), "records": .object([:])])])
        for g in groups.prefix(8) { v[g] = .object([:]) }; return v
    }
    static func map(_ s: JSONValue, _ g: String) -> [String: JSONValue] {
        if g == "days" { return Dictionary(uniqueKeysWithValues: (s[g].array ?? []).compactMap { $0.string }.map { ($0, .number(1)) }) }
        if g == "misc" { return (s.object ?? [:]).filter { ["history", "lastBackup", "srSeeded", "lastTest", "learningProfile"].contains($0.key) } }
        return s[g].object ?? [:]
    }
    static func setMap(_ s: inout JSONValue, _ g: String, _ entries: [String: JSONValue]) {
        if g == "days" { s[g] = .array(entries.keys.sorted().map(JSONValue.string)) }
        else if g == "misc" {
            var obj = s.object ?? [:]; for k in ["history", "lastBackup", "srSeeded", "lastTest", "learningProfile"] { obj.removeValue(forKey: k) }
            obj.merge(entries) { _, b in b }; s = .object(obj)
        } else { s[g] = .object(entries) }
    }
    static func number(_ v: JSONValue, integer: Bool = false) -> Bool {
        guard let n = v.number else { return false }
        return n.isFinite && n >= 0 && n <= 8_640_000_000_000_000 && (!integer || n.rounded() == n)
    }
    public static func normalize(_ input: JSONValue, catalog: Catalog) throws -> JSONValue {
        let error = LabError.message("学习数据格式无效，原文件未修改。")
        guard input["v"].number == 1, input["done"].object != nil else { throw error }
        let questions = Set(catalog.allQuestions.map(\.id)), lessons = Set(catalog.lessons.map(\.id))
        func known(_ g: String, _ id: String) -> Bool {
            switch g {
            case "days": return LocalDay.valid(id)
            case "misc": return ["history", "lastBackup", "srSeeded", "lastTest", "learningProfile"].contains(id)
            case "evidence", "tests": return Learning.validRecordID(id)
            case "plan": return ["env_mysql", "env_nowcoder", "env_sqlbolt", "env_notebook", "acc_nowcoder", "acc_timed", "acc_demo"].contains(id)
            case "mil": return ["first", "d3", "d7", "l5", "t10", "w1", "half", "all"].contains(id)
            case "lessons": return lessons.contains(id)
            default: return questions.contains(id)
            }
        }
        var out = empty
        if input["savedAt"] != .null { guard number(input["savedAt"]) else { throw error }; out["savedAt"] = input["savedAt"] }
        for g in groups.prefix(8) {
            guard input[g] == .null || input[g].object != nil else { throw error }
            var entries: [String: JSONValue] = [:]
            for (id, original) in input[g].object ?? [:] {
                guard known(g, id) else { throw error }; var v = original
                switch g {
                case "done":
                    guard number(v["ts"]), [.null, .number(0), .number(1)].contains(v["used"]) else { throw error }
                    v = .object(["ts": v["ts"], "used": v["used"] == .null ? .number(0) : v["used"]])
                case "wrong", "attempts": guard number(v, integer: true) else { throw error }
                case "notes": guard let t = v.string, t.count <= 10000 else { throw error }
                case "lessons", "plan", "mil": guard [.number(1), .bool(true)].contains(v) else { throw error }
                case "sr":
                    guard LocalDay.valid(v["due"].string ?? ""), number(v["iv"], integer: true), number(v["rep"], integer: true), let ef = v["ef"].number, (1...10).contains(ef), v["lapse"] == .null || number(v["lapse"], integer: true), v["last"] == .null || LocalDay.valid(v["last"].string ?? "") else { throw error }
                    v = .object(["due": v["due"], "iv": v["iv"], "rep": v["rep"], "ef": v["ef"], "lapse": v["lapse"] == .null ? .number(0) : v["lapse"]])
                    if original["last"] != .null { v["last"] = original["last"] }
                default: break
                }
                entries[id] = v
            }; out[g] = .object(entries)
        }
        for group in ["evidence", "tests"] where input[group] != .null {
            guard let entries = input[group].object else { throw error }
            var clean: [String: JSONValue] = [:]
            for (id, value) in entries {
                guard Learning.validRecordID(id) else { throw error }
                clean[id] = try group == "evidence" ? Learning.normalizeEvidence(value, catalog: catalog) : Learning.normalizeTest(value, catalog: catalog)
                if group == "tests", value["id"].string != id { throw error }
            }
            out[group] = .object(clean)
        }
        if input["learningProfile"] != .null { out["learningProfile"] = try Learning.normalizeProfile(input["learningProfile"], catalog: catalog) }
        guard input["days"] == .null || input["days"].array != nil else { throw error }
        let days = input["days"].array ?? []; guard days.allSatisfy({ LocalDay.valid($0.string ?? "") }) else { throw error }
        out["days"] = .array(Set(days.compactMap(\.string)).sorted().map(JSONValue.string))
        if input["lastBackup"] != .null { guard number(input["lastBackup"]) else { throw error }; out["lastBackup"] = input["lastBackup"] }
        if input["srSeeded"] != .null { guard [.number(1), .bool(true)].contains(input["srSeeded"]) else { throw error }; out["srSeeded"] = .number(1) }
        if input["history"] != .null {
            guard let h = input["history"].array, h.count <= 1000, h.allSatisfy({ (questions.contains($0["q"].string ?? "") || $0["q"].string == "play") && $0["s"].string != nil && ($0["s"].string?.count ?? 0) <= 100000 && [.number(0), .number(1)].contains($0["ok"]) && number($0["t"]) && ($0["kind"] == .null || Learning.resultKinds.contains($0["kind"].string ?? "")) && [.null, .number(0), .number(1)].contains($0["used"]) }) else { throw error }
            out["history"] = .array(h.prefix(12).map { item in
                var clean: JSONValue = .object(["q": item["q"], "s": item["s"], "ok": item["ok"], "t": item["t"]])
                for key in ["kind", "used"] where item[key] != .null { clean[key] = item[key] }
                return clean
            })
        }
        if input["lastTest"] != .null {
            out["lastTest"] = try Learning.normalizeTest(input["lastTest"], catalog: catalog)
        }
        if input["_sync"] != .null {
            guard let records = input["_sync"]["records"].object, input["_sync"]["reset"]["deleted"] == .null else { throw error }
            func revision(_ r: JSONValue) throws -> JSONValue {
                guard number(r["t"], integer: true), let d = r["d"].string, d.count <= 100, [.null, .number(1)].contains(r["deleted"]) else { throw error }; var clean: JSONValue = .object(["t": r["t"], "d": r["d"]]); if r["deleted"] == .number(1) { clean["deleted"] = .number(1) }; return clean
            }
            out["_sync"]["reset"] = try revision(input["_sync"]["reset"])
            for (g, records) in records {
                guard groups.contains(g), let entries = records.object else { throw error }
                for (id, r) in entries { guard known(g, id) else { throw error }; out["_sync"]["records"][g][id] = try revision(r) }
            }
        }
        for g in groups {
            if ["evidence", "tests"].contains(g), out[g] == .null, out["_sync"]["records"][g] == .null { continue }
            let entries = map(out, g); var revisions = out["_sync"]["records"][g].object ?? [:]
            for (id, v) in entries {
                if revisions[id] == nil { revisions[id] = .object(["t": g == "done" ? v["ts"] : out["savedAt"], "d": .string("legacy")]) }
                guard revisions[id]?["deleted"] != .number(1) else { throw error }
            }
            guard revisions.allSatisfy({ entries[$0.key] != nil || $0.value["deleted"] == .number(1) }) else { throw error }
            out["_sync"]["records"][g] = .object(revisions)
        }; return out
    }
    static func compare(_ a: JSONValue, _ b: JSONValue) -> Int {
        if a["t"].number != b["t"].number { return (a["t"].number ?? 0) > (b["t"].number ?? 0) ? 1 : -1 }
        let x = a["d"].string ?? "", y = b["d"].string ?? ""; return x == y ? 0 : (x > y ? 1 : -1)
    }
    static func nextTime(_ states: [JSONValue]) -> Double {
        var t = floor(Date().timeIntervalSince1970 * 1000)
        for s in states {
            t = max(t, (s["savedAt"].number ?? 0) + 1, (s["_sync"]["reset"]["t"].number ?? 0) + 1)
            for g in groups { for r in (s["_sync"]["records"][g].object ?? [:]).values { t = max(t, (r["t"].number ?? 0) + 1) } }
        }; return t
    }
    public static func stamp(_ next: JSONValue, before: JSONValue, device: String) -> JSONValue {
        var out = next; let t = nextTime([next, before])
        for g in groups {
            let a = map(before, g), b = map(next, g)
            for id in Set(a.keys).union(b.keys) where a[id] != b[id] {
                var r: JSONValue = .object(["t": .number(t), "d": .string(device)])
                if b[id] == nil { r["deleted"] = .number(1) }; out["_sync"]["records"][g][id] = r
            }
        }; out["savedAt"] = .number(t); return out
    }
    public static func merge(_ left: JSONValue, _ right: JSONValue, catalog: Catalog) throws -> JSONValue {
        let a = try normalize(left, catalog: catalog), b = try normalize(right, catalog: catalog); var out = empty
        let floor = compare(a["_sync"]["reset"], b["_sync"]["reset"]) >= 0 ? a["_sync"]["reset"] : b["_sync"]["reset"]
        out["_sync"]["reset"] = floor; out["savedAt"] = .number(max(a["savedAt"].number ?? 0, b["savedAt"].number ?? 0))
        for g in groups {
            let av = map(a, g), bv = map(b, g), ar = a["_sync"]["records"][g].object ?? [:], br = b["_sync"]["records"][g].object ?? [:]
            if ["evidence", "tests"].contains(g), a[g] == .null, b[g] == .null, ar.isEmpty, br.isEmpty { continue }
            var entries: [String: JSONValue] = [:], revisions: [String: JSONValue] = [:]
            for id in Set(ar.keys).union(br.keys) {
                var useA = br[id] == nil || (ar[id] != nil && compare(ar[id]!, br[id]!) > 0)
                if let ra = ar[id], let rb = br[id], compare(ra, rb) == 0 { useA = ra["deleted"] == .number(1) || (rb["deleted"] != .number(1) && (av[id]?.canonical ?? "") >= (bv[id]?.canonical ?? "")) }
                var r = (useA ? ar[id] : br[id])!
                if compare(r, floor) <= 0 { r["deleted"] = .number(1) }
                if r["deleted"] != .number(1) { entries[id] = useA ? av[id] : bv[id] }; revisions[id] = r
            }; setMap(&out, g, entries); out["_sync"]["records"][g] = .object(revisions)
        }; return out
    }
}

@MainActor public final class ProgressStore {
    public private(set) var state: JSONValue
    public private(set) var session: JSONValue
    public private(set) var metadata: JSONValue = .object([:])
    public let url: URL
    private let catalog: Catalog
    private let device = "native-" + UUID().uuidString
    public init(directory: URL? = nil, catalog: Catalog) throws {
        self.catalog = catalog
        let base = try directory ?? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("SQLLab")
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        url = base.appendingPathComponent("native-learning.json")
        state = try Progress.normalize(Progress.empty, catalog: catalog); session = .object(["v": .number(1), "codes": .object([:])])
        if FileManager.default.fileExists(atPath: url.path) {
            let e = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
            state = try Progress.normalize(e["state"], catalog: catalog); session = try Self.validateSession(e["session"], catalog: catalog)
            metadata = Self.cleanMetadata(e["metadata"])
        } else {
            let legacy = base.appendingPathComponent("learning.json")
            if FileManager.default.fileExists(atPath: legacy.path) {
                let entries = try JSONDecoder().decode([String: String].self, from: Data(contentsOf: legacy))
                if let raw = entries["sqltrain_state"] { state = try Progress.normalize(JSONDecoder().decode(JSONValue.self, from: Data(raw.utf8)), catalog: catalog) }
                if let raw = entries["sqltrain_session"] { session = try Self.validateSession(JSONDecoder().decode(JSONValue.self, from: Data(raw.utf8)), catalog: catalog) }
                try persist(state, session)
            }
        }
    }
    static func validateSession(_ v: JSONValue, catalog: Catalog) throws -> JSONValue {
        guard v["v"].number == 1, v.object != nil else { throw LabError.message("学习会话损坏，原文件已保留。") }
        var out = v; var codes: [String: JSONValue] = [:]
        for (key, code) in v["codes"].object ?? [:] {
            let id = key.hasPrefix("test_") ? String(key.dropFirst(5)) : key
            if (id == "play" || catalog.question(id) != nil), let t = code.string, t.count <= 100000 { codes[key] = code }
        }; out["codes"] = .object(codes)
        if v["test"] != .null {
            let t = v["test"], ids = t["qids"].array?.compactMap(\.string) ?? []
            guard (1...5).contains(ids.count), Set(ids).count == ids.count, ids.allSatisfy({ catalog.question($0) != nil }), let index = t["idx"].number, index >= 0, index < Double(ids.count), index.rounded() == index, Progress.number(t["endAt"]), let id = t["id"].string, id.range(of: "^[A-Za-z0-9_-]{8,100}$", options: .regularExpression) != nil else { throw LabError.message("周测会话无效，原文件已保留。") }
            if t["startedAt"] != .null {
                guard Progress.number(t["startedAt"]), t["startedAt"].number! <= t["endAt"].number!, let week = t["week"].number, (0...8).contains(week), week.rounded() == week else { throw LabError.message("周测起始时间无效，原文件已保留。") }
            }
        }; return out
    }
    private func persist(_ state: JSONValue, _ session: JSONValue) throws {
        try JSONValue.object(["state": state, "session": session, "metadata": metadata]).data(pretty: true).write(to: url, options: .atomic)
    }
    public func update(_ change: (inout JSONValue) -> Void) throws {
        try update(change, updatingSession: { _ in })
    }
    public func update(_ change: (inout JSONValue) -> Void, updatingSession: (inout JSONValue) -> Void) throws {
        var next = state, nextSession = session
        change(&next); updatingSession(&nextSession)
        next = Progress.stamp(next, before: state, device: device)
        next = try Progress.normalize(next, catalog: catalog); nextSession = try Self.validateSession(nextSession, catalog: catalog)
        try persist(next, nextSession); state = next; session = nextSession
    }
    public func updateSession(_ change: (inout JSONValue) -> Void) throws {
        var next = session; change(&next); next = try Self.validateSession(next, catalog: catalog)
        try persist(state, next); session = next
    }
    public func exportBackup() throws -> Data { try state.data(pretty: true) }
    public func importBackup(_ data: Data, merge: Bool) throws {
        guard data.count <= 10000000 else { throw LabError.message("备份超过 10 MB。") }
        let raw = (try? JSONDecoder().decode(JSONValue.self, from: data)) ?? (try? JSONDecoder().decode(JSONValue.self, from: Data(base64Encoded: String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)) ?? Data()))
        guard let raw else { throw LabError.message("无法识别备份。") }
        var next = try Progress.normalize(raw, catalog: catalog)
        if merge { next = try Progress.merge(state, next, catalog: catalog) }
        else {
            let time = Progress.nextTime([next, state]); next["_sync"] = .object(["reset": .object(["t": .number(time), "d": .string(device)]), "records": .object([:])])
            for g in Progress.groups { for id in Progress.map(next, g).keys { next["_sync"]["records"][g][id] = .object(["t": .number(time + 1), "d": .string(device)]) } }; next["savedAt"] = .number(time + 1)
        }
        try JSONValue.object(["state": state, "session": session]).data(pretty: true).write(to: url.appendingPathExtension("before-import"), options: .atomic)
        _ = try createRecoveryPoint(label: merge ? "合并进度前" : "替换进度前")
        let nextSession: JSONValue = merge ? session : .object(["v": .number(1), "codes": .object([:])])
        try persist(next, nextSession); state = next; session = nextSession
    }
    public func undoImport() throws {
        let old = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url.appendingPathExtension("before-import")))
        try restoreSnapshot(old)
    }
    private func restoreSnapshot(_ old: JSONValue) throws {
        var next = try Progress.normalize(old["state"], catalog: catalog)
        let nextSession = try Self.validateSession(old["session"], catalog: catalog)
        _ = try createRecoveryPoint(label: "恢复操作前")
        let time = Progress.nextTime([next, state])
        next["_sync"] = .object(["reset": .object(["t": .number(time), "d": .string(device)]), "records": .object([:])])
        for g in Progress.groups { for id in Progress.map(next, g).keys { next["_sync"]["records"][g][id] = .object(["t": .number(time + 1), "d": .string(device)]) } }
        next["savedAt"] = .number(time + 1)
        try persist(next, nextSession); state = next; session = nextSession
    }
    private static func cleanMetadata(_ input: JSONValue) -> JSONValue {
        var clean: JSONValue = .object([:])
        for key in ["lastBackupAt", "lastSyncAt"] where Progress.number(input[key]) { clean[key] = input[key] }
        for key in ["backupFingerprint", "syncFingerprint"] where input[key].string?.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil { clean[key] = input[key] }
        if let message = input["syncError"].string { clean["syncError"] = .string(String(message.prefix(500))) }
        return clean
    }
    public func updateMetadata(_ change: (inout JSONValue) -> Void) throws {
        var next = metadata; change(&next); next = Self.cleanMetadata(next)
        try JSONValue.object(["state": state, "session": session, "metadata": next]).data(pretty: true).write(to: url, options: .atomic)
        metadata = next
    }
    public func recoveryPoints() -> [RecoveryPoint] {
        let directory = url.deletingLastPathComponent().appendingPathComponent("RecoveryPoints")
        return ((try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []).compactMap { file in
            guard file.pathExtension == "json", Learning.validRecordID(file.deletingPathExtension().lastPathComponent),
                  let data = try? Data(contentsOf: file), let value = try? JSONDecoder().decode(JSONValue.self, from: data),
                  let label = value["label"].string, let created = value["createdAt"].number, created.isFinite else { return nil }
            return RecoveryPoint(id: file.deletingPathExtension().lastPathComponent, label: label, createdAt: created)
        }.sorted { $0.createdAt > $1.createdAt }
    }
    @discardableResult public func createRecoveryPoint(label: String) throws -> RecoveryPoint {
        let point = RecoveryPoint(id: UUID().uuidString, label: String(label.prefix(100)), createdAt: Date().timeIntervalSince1970 * 1000)
        let directory = url.deletingLastPathComponent().appendingPathComponent("RecoveryPoints")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONValue.object(["state": state, "session": session, "label": .string(point.label), "createdAt": .number(point.createdAt)]).data(pretty: true).write(to: directory.appendingPathComponent(point.id + ".json"), options: .atomic)
        return point
    }
    public func restoreRecoveryPoint(_ point: RecoveryPoint) throws {
        guard Learning.validRecordID(point.id) else { throw LabError.message("恢复点无效。") }
        let file = url.deletingLastPathComponent().appendingPathComponent("RecoveryPoints").appendingPathComponent(point.id + ".json")
        let snapshot = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: file))
        try restoreSnapshot(snapshot)
    }
}

public struct RecoveryPoint: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let createdAt: Double
}
