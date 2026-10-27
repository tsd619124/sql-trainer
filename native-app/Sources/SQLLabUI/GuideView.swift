import SwiftUI
import SQLLabCore

struct GuideView: View {
    let model: LabModel
    let kind: String
    @State private var content: JSONValue?
    @State private var error: String?
    @State private var expanded: Set<String> = ["section-0"]
    private var sections: [GuideSection] { (content?["sections"][kind].array ?? []).compactMap(GuideSection.init) }
    var body: some View {
        ScrollViewReader { proxy in
          List {
            Section("分节目录") {
                ForEach(sections) { section in Button(section.title) { jump(to: section.id, using: proxy) }.accessibilityIdentifier("guide-jump-" + section.id) }
            }
            ForEach(sections) { section in
                Section {
                    DisclosureGroup(section.title, isExpanded: Binding(get: { expanded.contains(section.id) }, set: { if $0 { expanded.insert(section.id) } else { expanded.remove(section.id) } })) {
                        if !section.text.isEmpty { Text(section.text).textSelection(.enabled) }
                        ForEach(section.tables) { table in SQLTable(result: table.result) }
                        ForEach(section.links) { link in if let url = URL(string: link.url), url.scheme == "https" { Link(destination: url) { Label(link.title, systemImage: "arrow.up.right") } } }
                    }.accessibilityIdentifier("guide-section-" + section.id).id("guide-content-" + section.id)
                }
            }
            if kind == "plan", let checks = content?["checks"].array {
                Section("学习检查清单") {
                    ForEach(checks.compactMap { v -> Check? in guard let id = v["id"].string, let title = v["title"].string else { return nil }; return Check(id: id, title: title) }) { item in
                        Toggle(item.title, isOn: Binding(get: { model.state["plan"][item.id] != .null }, set: { on in model.change { s in var plan = s["plan"].object ?? [:]; if on { plan[item.id] = .number(1) } else { plan.removeValue(forKey: item.id) }; s["plan"] = .object(plan) } }))
                    }
                }
            }
            if sections.isEmpty, let text = content?[kind].string { Text(text).textSelection(.enabled) }
            if let error { Text(error) }
          }.navigationTitle(kind == "plan" ? "八周学习计划" : "语法速查")
            .toolbar { ToolbarItem(placement: .primaryAction) { Menu("目录", systemImage: "list.bullet") { ForEach(sections) { section in Button(section.title) { jump(to: section.id, using: proxy) } } } } }
        }
        .task { do { content = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: Catalog.resource("guides", extension: "json"))) } catch { self.error = error.localizedDescription } }
    }
    private func jump(to section: String, using proxy: ScrollViewProxy) {
        expanded.insert(section)
        Task { @MainActor in
            await Task.yield()
            proxy.scrollTo("guide-content-" + section, anchor: .top)
        }
    }
    private struct Check: Identifiable { let id: String; let title: String }
}

struct GuideSection: Identifiable {
    let id: String
    let title: String
    let text: String
    let tables: [GuideTable]
    let links: [GuideLink]
    init?(_ value: JSONValue) {
        guard let id = value["id"].string, let title = value["title"].string else { return nil }
        self.id = id; self.title = title; text = value["text"].string ?? ""
        tables = (value["tables"].array ?? []).compactMap(GuideTable.init)
        links = (value["links"].array ?? []).compactMap(GuideLink.init)
    }
}

struct GuideTable: Identifiable {
    let id: String
    let result: SQLResult
    init?(_ value: JSONValue) {
        guard let id = value["id"].string, let rows = value["rows"].array, let header = rows.first?.array else { return nil }
        self.id = id; result = SQLResult(columns: header.map(\.display), values: rows.dropFirst().compactMap(\.array))
    }
}

struct GuideLink: Identifiable {
    let title: String
    let url: String
    var id: String { url }
    init?(_ value: JSONValue) { guard let title = value["title"].string, let url = value["url"].string else { return nil }; self.title = title; self.url = url }
}
