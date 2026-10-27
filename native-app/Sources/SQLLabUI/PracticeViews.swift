import SwiftUI
import UniformTypeIdentifiers
import SQLLabCore

struct PracticeLibraryView: View {
    let model: LabModel
    var week: Int = 0
    var parentID: String? = nil
    @State private var query = CatalogQuery()
    @State private var filter = "全部"
    private let filters = ["全部", "条件变化", "综合迁移", "专题训练", "SQL 纠错", "补全语句", "选择辨析", "结果预测", "综合项目"]
    private var questions: [Question] {
        (model.catalog.practice ?? []).filter {
            (week == 0 || $0.w == week) && (parentID == nil || $0.parentID == parentID) &&
            (filter == "全部" || $0.trainingLabel == filter) &&
            query.matches($0, model: model)
        }
    }
    var body: some View {
        List {
            Section {
                Text("42 道基础核心 → 条件变化 → 综合迁移。拓展记录独立保存，不增加核心题通过数。").font(.callout)
                TextField("搜索题干、专题与笔记", text: $query.search).accessibilityIdentifier("practice-search").autocorrectionDisabled()
                Picker("题型", selection: $filter) { ForEach(filters, id: \.self) { Text($0).tag($0) } }
                DisclosureGroup("知识点、难度与完成状态") { LibraryFilters(model: model, query: $query) }
            }
            Section("\(questions.count) 项训练 · \(questions.filter { Learning.independent(model.state, $0.id) }.count) 项独立通过") {
                ForEach(questions) { question in
                    HStack {
                        Button { model.open(question) } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(question.title).foregroundStyle(.primary)
                                Text("W\(question.w) · \(question.trainingLabel) · " + (question.topic ?? question.dataset ?? "")).font(.caption).foregroundStyle(.secondary)
                                if model.completionStatus(question.id) != .unfinished { CompletionLabel(status: model.completionStatus(question.id)).font(.caption) }
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }.buttonStyle(.borderless).accessibilityIdentifier("practice-" + question.id)
                        FavoriteButton(model: model, id: question.id)
                    }
                }
                if questions.isEmpty { Text("没有匹配的训练，可清除搜索或调整筛选。").foregroundStyle(.secondary) }
            }
            Section("数据与判分") {
                NavigationLink("四类业务表与样本") { SchemaView(model: model, training: true) }
                Text("SQL 使用业务、边界、空集三组数据。选择辨析和结果预测按选项判分；面试表达与项目分析使用自查标准。").font(.caption).foregroundStyle(.secondary)
            }
        }.navigationTitle("变式与专题")
    }
}

struct PracticeQuestionView: View {
    let model: LabModel
    let question: Question
    @State private var continuation: Question?
    var body: some View {
        let current = continuation ?? question
        Group {
            if current.isChoice { ChoicePracticeView(model: model, question: current, onContinue: { continuation = $0 }) }
            else { QuestionView(model: model, question: current, onContinue: { continuation = $0 }) }
        }.id(current.id).onAppear { remember(current) }.onChange(of: current.id) { remember(current) }
    }
    private func remember(_ question: Question) { model.changeSession { $0["lastLearning"] = .object(["type": .string("question"), "id": .string(question.id)]) } }
}

struct PracticeBriefSection: View {
    let question: Question
    var body: some View {
        Section("\(question.trainingLabel) · W\(question.w)") {
            if let parent = question.parentID { Text("关联核心题：" + parent).font(.caption).foregroundStyle(.secondary) }
            Text("先说明取数粒度、条件和表关系，再写 SQL；通过后解释结果与适用条件。").font(.callout)
            Text("本题 SQL 同时检查业务、边界与空集样本。每组比较列数、值、重复行和题目指定顺序。").font(.caption).foregroundStyle(.secondary)
        }
    }
}

struct ChoicePracticeView: View {
    let model: LabModel
    let question: Question
    var onContinue: (Question) -> Void
    @State private var selected = ""
    @State private var feedback: String?
    @State private var answer = false
    @State private var passed = false
    @State private var initialAttempts = 0
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        List {
            Section(question.trainingLabel) { Text(question.text); if let starter = question.starter { Text(starter).font(.system(.caption, design: .monospaced)).textSelection(.enabled) } }
            Section("选择答案") {
                ForEach(question.choices ?? []) { choice in
                    Button { selected = choice.id; model.saveDraft(question.id, choice.id); feedback = nil; passed = false } label: {
                        Label(choice.text, systemImage: selected == choice.id ? "checkmark.circle.fill" : "circle")
                    }.accessibilityIdentifier("choice-" + choice.id)
                }
                Button("提交选择") {
                    do {
                        let correct = selected == question.correctOption
                        try model.record(question.id, sql: "选项：" + selected, passed: correct, used: model.session["viewed"][question.id].bool == true)
                        passed = correct
                        feedback = passed ? "通过！请用自己的话解释原因。" : "未通过，请重新比较口径。已保存作答记录。"
                    } catch { model.error = error.localizedDescription }
                }.disabled(selected.isEmpty).accessibilityIdentifier("submit-choice")
                if let feedback { Text(feedback).accessibilityIdentifier("choice-verdict") }
            }
            if passed { CompletionActions(model: model, question: question, attempts: max(0, Int(model.state["attempts"][question.id].number ?? 0) - initialAttempts), onContinue: onContinue, onEnd: { model.endLearning(); dismiss() }) }
            Section {
                DisclosureGroup("参考答案与解析", isExpanded: Binding(get: { answer }, set: { expanded in
                    do { if expanded { try model.viewAnswer(question.id) }; answer = expanded }
                    catch { model.error = error.localizedDescription }
                })) { Text("正确选项：" + (question.correctOption ?? "")); Text(question.explanation ?? question.hint) }
                Button("独立重做") {
                    do { try model.restartIndependently(question.id); answer = false; selected = ""; feedback = nil; passed = false }
                    catch { model.error = error.localizedDescription }
                }
                if model.completionStatus(question.id) != .unfinished { CompletionLabel(status: model.completionStatus(question.id)) }
            }
        }.navigationTitle(question.title).toolbar { ToolbarItem(placement: .primaryAction) { FavoriteButton(model: model, id: question.id) }; ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }.onAppear { initialAttempts = Int(model.state["attempts"][question.id].number ?? 0); selected = model.draft(question.id) }
    }
}

struct ProjectReportSection: View {
    let question: Question
    let sql: String
    @Binding var note: String
    let result: SQLResult?
    let cases: [CaseVerdict]
    @State private var exporting = false
    @State private var exportError: String?
    private var report: String {
        "# SQL Lab · " + question.title + "\n\n" + question.text + "\n\n## 分析与表达\n\n" + note +
        "\n\n## SQLite SQL\n\n```sql\n" + sql + "\n```\n\n## 本次结果\n\n" +
        (result.map { $0.columns.joined(separator: " | ") + "\n" + $0.values.map { $0.map(\.display).joined(separator: " | ") }.joined(separator: "\n") } ?? "尚未执行") +
        "\n\n## 样本判分\n\n" + cases.map { $0.name + ($0.passed ? "：通过" : "：未通过") }.joined(separator: "\n") +
        "\n\n## 人工自查标准\n\n" + (question.rubric ?? []).joined(separator: "\n\n") + "\n\n表达与业务结论未自动评分。\n"
    }
    var body: some View {
        Section("面试表达与作品") {
            Text("在此分别写下「口径与思路」和「结果解释与建议」，结合实际结果引用数字。SQL 判分不代替业务表达评价。").font(.caption).foregroundStyle(.secondary)
            TextEditor(text: $note).frame(minHeight: 160).accessibilityIdentifier("project-analysis")
            ForEach(question.rubric ?? [], id: \.self) { Text($0).font(.caption) }
            Button("导出分析作品 Markdown") { exporting = true }.disabled(note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || result == nil).accessibilityIdentifier("export-project")
            if let exportError { Text(exportError).foregroundStyle(.red) }
        }.fileExporter(isPresented: $exporting, document: PracticeReportDocument(text: report), contentType: PracticeReportDocument.readableContentTypes[0], defaultFilename: "SQLLab-营销投入复盘.md") { outcome in
            if case .failure(let error) = outcome { exportError = error.localizedDescription }
        }
    }
}

struct PracticeReportDocument: FileDocument {
    static var readableContentTypes: [UTType] { [UTType(filenameExtension: "md") ?? .plainText] }
    let text: String
    init(text: String) { self.text = text }
    init(configuration: ReadConfiguration) throws { text = String(data: configuration.file.regularFileContents ?? Data(), encoding: .utf8) ?? "" }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: Data(text.utf8)) }
}

struct TrainingTableView: View {
    let model: LabModel
    let table: String
    @State private var result: SQLResult?
    @State private var failure: String?
    var body: some View {
        List {
            Text("业务样本前 20 行。判题另有边界和空集样本。").font(.caption).foregroundStyle(.secondary)
            if let result { SQLTable(result: result) }
            if let failure { Text(failure) }
        }.navigationTitle(table).task {
            do {
                guard ["users","products","orders","order_items","events","campaigns","leads","ad_spend","inventory","shipments"].contains(table) else { throw LabError.message("表名无效。") }
                result = try await model.engine.trainingQuery("SELECT * FROM " + table + " LIMIT 20")
            } catch { failure = error.localizedDescription }
        }
    }
}
