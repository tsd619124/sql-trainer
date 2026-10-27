import SwiftUI
import SQLLabCore
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

func copyLearningText(_ text: String) {
    #if canImport(UIKit)
    UIPasteboard.general.string = text
    #elseif canImport(AppKit)
    NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string)
    #endif
}

struct SQLTable: View {
    let result: SQLResult
    @State private var copied = false
    @ScaledMetric(relativeTo: .caption) private var characterWidth = 8.0
    private var columns: [DisplayColumn] {
        var occurrences: [String: Int] = [:]
        return result.columns.enumerated().map { position, title in
            occurrences[title, default: 0] += 1
            let longest = ([title.count] + result.values.prefix(200).compactMap { $0.indices.contains(position) ? $0[position].display.count : nil }).max() ?? 12
            return DisplayColumn(id: title + "-\(occurrences[title]!)", title: title, position: position, width: max(112, min(280, Double(longest + 3) * characterWidth)))
        }
    }
    private var rows: [DisplayRow] {
        var occurrences: [String: Int] = [:]
        return result.values.prefix(200).map { values in
            let key = JSONValue.array(values).canonical
            occurrences[key, default: 0] += 1
            return DisplayRow(id: key + "-\(occurrences[key]!)", values: values)
        }
    }
    var body: some View {
        let layout = columns
        VStack(alignment: .leading, spacing: 10) {
            ScrollView(.horizontal) {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .top, spacing: 0) {
                        ForEach(layout) { column in Text(column.title).fontWeight(.semibold).frame(width: column.width, alignment: .leading).padding(10).accessibilityAddTraits(.isHeader) }
                    }.background(.quaternary)
                    ForEach(rows) { row in
                        HStack(alignment: .top, spacing: 0) {
                            ForEach(layout) { column in
                                let value = row.values.indices.contains(column.position) ? row.values[column.position] : .null
                                Text(value.display).foregroundStyle(color(value)).frame(width: column.width, alignment: value.number == nil ? .leading : .trailing).padding(10)
                                    .accessibilityLabel(column.title + ": " + (value == .null ? "空值 NULL" : value.display))
                            }
                        }
                        Divider()
                    }
                }.font(.system(.caption, design: .monospaced)).textSelection(.enabled)
            }.accessibilityLabel("查询结果表格，可横向滚动").accessibilityIdentifier("sql-result-table")
            HStack {
                Text("共 \(result.values.count) 行" + (result.values.count > 200 ? "，显示前 200 行" : "")).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button(copied ? "已复制表格" : "复制表格") { copyLearningText(result.tabSeparated); copied = true }.font(.caption).accessibilityIdentifier("copy-result")
            }
        }.onChange(of: result) { copied = false }
    }
    private func color(_ value: JSONValue) -> Color {
        if value == .null { return .orange }
        if value.number != nil { return .teal }
        if let text = value.string, text.range(of: #"^\d{4}-\d{2}-\d{2}(?:[ T].*)?$"#, options: .regularExpression) != nil { return .blue }
        return .primary
    }
    private struct DisplayColumn: Identifiable { let id: String; let title: String; let position: Int; let width: Double }
    private struct DisplayRow: Identifiable { let id: String; let values: [JSONValue] }
}

extension SQLResult {
    var tabSeparated: String {
        func escaped(_ value: String) -> String { value.contains(where: { "\t\n\r\"".contains($0) }) ? "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\"" : value }
        return ([columns] + values.map { $0.map(\.display) }).map { $0.map(escaped).joined(separator: "\t") }.joined(separator: "\n")
    }
}

struct InlineSchemaView: View {
    let model: LabModel
    let tables: [String]
    var training = false
    var insert: ((String) -> Void)? = nil
    @State private var overviews: [TableOverview] = []
    @State private var failure: String?
    @State private var expanded: Set<String> = []
    var body: some View {
        ForEach(overviews) { overview in
            DisclosureGroup(isExpanded: Binding(get: { expanded.contains(overview.name) }, set: { if $0 { expanded.insert(overview.name) } else { expanded.remove(overview.name) } })) {
                Text(relationship(overview.name)).font(.caption).foregroundStyle(.secondary)
                ForEach(overview.columns) { column in
                    HStack(alignment: .top) {
                        if let insert {
                            Button { insert(column.name) } label: { Label(column.name, systemImage: "plus.circle").font(.system(.callout, design: .monospaced)).frame(minHeight: 44) }
                                .buttonStyle(.borderless).accessibilityLabel("插入字段 " + column.name).accessibilityIdentifier("insert-column-" + overview.name + "-" + column.name)
                        } else { Text(column.name).font(.system(.callout, design: .monospaced)) }
                        Spacer()
                        VStack(alignment: .trailing) {
                            Text(column.type).font(.caption).foregroundStyle(.secondary)
                            if let position = overview.columns.firstIndex(where: { $0.name == column.name }), let row = overview.sample.values.first, row.indices.contains(position) { Text("例：" + row[position].display).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                        }
                    }
                }
                DisclosureGroup("样例数据 · 最多 5 行") { SQLTable(result: overview.sample) }
            } label: { Label(overview.name + " · \(overview.columns.count) 个字段", systemImage: "tablecells").font(.subheadline.bold()) }
        }
        if let failure { Text(failure).foregroundStyle(.orange); Button("重试读取数据表") { Task { await load() } } }
        if overviews.isEmpty && failure == nil { ProgressView("读取本题数据…").task(id: tables.joined(separator: ",") + String(training)) { await load() } }
        Group { if insert != nil { Text("点按字段插入 SQL").font(.caption).foregroundStyle(.secondary) } }
    }
    private func load() async {
        failure = nil
        do {
            var loaded: [TableOverview] = []
            for table in tables { loaded.append(try await model.engine.tableOverview(table, training: training)) }
            overviews = loaded
        } catch { failure = "无法读取表结构：" + error.localizedDescription }
    }
    private func relationship(_ table: String) -> String {
        switch table {
        case "users": return "每行一位用户。users.user_id → orders.user_id；同名用户仍按 ID 区分。"
        case "products": return "每行一个商品。products.product_id → order_items.product_id。"
        case "orders": return "每行一笔订单。orders.order_id → order_items.order_id；orders.user_id → users.user_id。"
        case "order_items": return "每行一条订单明细。关联 orders 与 products；一笔订单可含多条明细，订单计数需留意去重。"
        case "events": return "每行一条行为日志。同日登录先去重；漏斗要求同一用户、同一会话且时间递增。"
        case "campaigns": return "每行一个活动。campaign_id 关联 leads 与 ad_spend，两张明细表宜先聚合再关联。"
        case "leads": return "每行一条线索，campaign_id 关联 campaigns。"
        case "ad_spend": return "每行是一个活动某天的花费，campaign_id 关联 campaigns。"
        case "inventory": return "库存粒度是商品 × 仓库。与 shipments 关联必须同时匹配 sku 和 warehouse。"
        case "shipments": return "每行一次发货。与 inventory 关联同时使用 sku、warehouse；未签收不计入已签收准时率。"
        default: return "按题目要求检查数据粒度与连接条件。"
        }
    }
}

struct DifferenceFeedback: View {
    let difference: SQLDifference
    var sample: String? = nil
    var body: some View {
        Label(difference.kind.rawValue + (sample.map { " · " + $0 } ?? ""), systemImage: "exclamationmark.circle").font(.headline).foregroundStyle(.orange).accessibilityIdentifier("feedback-kind")
        Text("你的结果：\(difference.actualRows) 行 / \(difference.actualColumns) 列；预期：\(difference.expectedRows) 行 / \(difference.expectedColumns) 列。").font(.caption)
        if difference.kind != .order && difference.kind != .columns {
            DisclosureGroup("查看差异示例 · 每类最多 3 行") {
                if difference.missingCount > 0 { Text("未匹配的预期记录 · \(difference.missingCount) 行").font(.caption.bold()); SQLTable(result: difference.missing) }
                if difference.extraCount > 0 { Text("未匹配的实际记录 · \(difference.extraCount) 行").font(.caption.bold()); SQLTable(result: difference.extra) }
                Text("重复行按出现次数比较，数字沿用判题的两位小数规则。").font(.caption).foregroundStyle(.secondary)
            }.accessibilityIdentifier("difference-examples")
        }
    }
}
