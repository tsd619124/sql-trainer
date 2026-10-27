import SwiftUI
import Combine
import SQLLabCore
import UniformTypeIdentifiers
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

public struct SQLLabRootView: View {
    @State private var model: LabModel?
    @State private var failure: String?
    @AppStorage("native-appearance") private var appearance = "system"
    public init() {}
    public var body: some View {
        Group {
            if let model { LabTabs(model: model) }
            else if let failure { ContentUnavailableView("无法读取学习数据", systemImage: "externaldrive.badge.exclamationmark", description: Text(failure + "\n原文件已保留，请重新打开应用。")) }
            else { ProgressView("载入课程…") }
        }.preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil).task { if model == nil { do { model = try LabModel() } catch { failure = error.localizedDescription } } }
    }
}

struct LabTabs: View {
    @Bindable var model: LabModel
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        TabView(selection: $model.tab) {
            NavigationStack { TodayView(model: model) }.tabItem { Label("今天", systemImage: "sun.max") }.tag(0)
            NavigationStack { TrainingView(model: model) }.tabItem { Label("训练", systemImage: "curlybraces") }.tag(1)
            NavigationStack { ExamView(model: model) }.tabItem { Label("测验", systemImage: "checkmark.seal") }.tag(2)
            NavigationStack { ProfileView(model: model) }.tabItem { Label("我的", systemImage: "person.crop.circle") }.tag(3)
        }
        .tint(.indigo)
        .sheet(item: $model.route) { q in NavigationStack { PracticeQuestionView(model: model, question: q) } }
        .sheet(item: $model.lessonRoute) { lesson in NavigationStack { LessonView(model: model, lesson: lesson) } }
        .alert("操作未完成", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) { Button("知道了") { model.error = nil } } message: { Text(model.error ?? "") }
        .task(id: scenePhase) {
            if scenePhase == .active {
                model.prepareDailyPlan()
                if model.examActive, (model.exam["endAt"].number ?? 0) <= Date().timeIntervalSince1970 * 1000 { await model.finishExam() }
            }
        }
    }
}

struct TodayView: View {
    let model: LabModel
    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 12) {
                    Text("继续把 SQL 练成能力").font(.title2.bold())
                    Text("连续 \(model.streak) 天 · 独立完成 \(model.independentCompleted) / \(model.catalog.questions.count) 题").foregroundStyle(.secondary)
                    ProgressView("独立完成", value: Double(model.independentCompleted), total: Double(model.catalog.questions.count))
                }.padding(.vertical, 12)
                if let id = model.session["lastLearning"]["id"].string, let q = model.catalog.question(id) { Button { model.open(q) } label: { Label("继续练习：" + q.title, systemImage: "play.circle.fill").font(.headline) }.accessibilityIdentifier("continue-learning") }
                if let id = model.session["lastLearning"]["id"].string, let lesson = model.catalog.lesson(id) { Button { model.lessonRoute = lesson } label: { Label("继续学习：" + lesson.title, systemImage: "play.circle.fill").font(.headline) }.accessibilityIdentifier("continue-learning") }
            }
            DailyTasksSection(model: model)
            Section("到期复习 · \(model.due.count) 题") {
                if model.due.isEmpty { Label("今天没有到期题目", systemImage: "checkmark.circle").foregroundStyle(.secondary) }
                ForEach(model.due.prefix(3)) { q in QuestionRow(model: model, question: q) }
                if model.due.count > 3 { NavigationLink("查看全部到期复习") { List(model.due) { QuestionRow(model: model, question: $0) }.navigationTitle("到期复习") } }
            }
            Section("完整学习路径") {
                DisclosureGroup("查看全部八周") {
                    ForEach(model.catalog.weeks) { week in
                        NavigationLink { WeekView(model: model, week: week) } label: {
                            VStack(alignment: .leading) { Text("W\(week.w)  " + week.name); Text("\(model.catalog.questions.filter { $0.w == week.w && Learning.independent(model.state, $0.id) }.count) 题独立完成").font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                }
            }
        }.navigationTitle("SQL Lab")
        .task { model.prepareDailyPlan() }
        .onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { model.prepareDailyPlan(at: $0) }
    }
}
struct QuestionRow: View {
    let model: LabModel
    let question: Question
    var body: some View {
        HStack {
            Button { model.open(question) } label: {
                VStack(alignment: .leading, spacing: 5) {
                    Text(question.title).foregroundStyle(.primary)
                    Text("W\(question.w) · " + LibraryDifficulty.stage(question.w).rawValue + " · \(question.pts) 分").font(.caption).foregroundStyle(.secondary)
                    if model.completionStatus(question.id) != .unfinished { CompletionLabel(status: model.completionStatus(question.id)).font(.caption) }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }.buttonStyle(.borderless).accessibilityIdentifier("question-" + question.id)
            FavoriteButton(model: model, id: question.id)
        }
    }
}
struct CompletionLabel: View {
    let status: CompletionStatus
    var body: some View {
        Label(status.rawValue, systemImage: status == .assisted ? "book.circle" : status == .mastered ? "checkmark.seal.fill" : "checkmark.circle.fill")
            .foregroundStyle(status == .assisted ? Color.orange : Color.green)
    }
}
struct WeekView: View {
    let model: LabModel
    let week: Week
    var body: some View {
        List {
            Section("微课 · 阅读与掌握分开记录") { ForEach(model.catalog.lessons.filter { $0.w == week.w }) { lesson in LessonRow(model: model, lesson: lesson) } }
            Section("动手练习") { ForEach(model.catalog.questions.filter { $0.w == week.w }) { QuestionRow(model: model, question: $0) } }
            Section("拓展与迁移") { NavigationLink("本周变式、多题型与专题") { PracticeLibraryView(model: model, week: week.w) } }
        }.navigationTitle(week.name)
    }
}
struct TrainingView: View {
    let model: LabModel
    @State private var query = CatalogQuery()
    @State private var category = "课程"
    @State private var expandedFilters = false
    private var lessons: [Lesson] { model.catalog.lessons.filter { query.matches($0, model: model) && (category != "收藏" || model.isFavorite($0.id)) } }
    private var questions: [Question] { (query.search.isEmpty && category != "收藏" ? model.catalog.questions : model.catalog.allQuestions).filter { query.matches($0, model: model) && (category != "收藏" || model.isFavorite($0.id)) } }
    var body: some View {
        List {
            Section {
                HStack { Image(systemName: "magnifyingglass").foregroundStyle(.secondary); TextField("搜索题干、知识点与笔记", text: $query.search).accessibilityIdentifier("catalog-search").autocorrectionDisabled() }
                Picker("训练内容", selection: $category) { ForEach(["课程", "题库", "收藏"], id: \.self) { Text($0).tag($0) } }.pickerStyle(.segmented).accessibilityIdentifier("catalog-category")
                DisclosureGroup("筛选知识点、难度与状态", isExpanded: $expandedFilters) { LibraryFilters(model: model, query: $query); Text("难度按阶段划分：W1–2 基础、W3–5 进阶、W6–8 综合。收藏保存在本机。").font(.caption).foregroundStyle(.secondary) }
            }
            Section("分层练习") { NavigationLink("变式与专题训练") { PracticeLibraryView(model: model) }.accessibilityIdentifier("practice-library") }
            if category != "题库" || !query.search.isEmpty {
                Section("课程 · \(lessons.count) 节") {
                    ForEach(lessons) { lesson in LessonRow(model: model, lesson: lesson) }
                    if lessons.isEmpty { Text("没有匹配的课程。可调整筛选或收藏课程。").foregroundStyle(.secondary) }
                }
            }
            if category != "课程" || !query.search.isEmpty {
                Section("题目 · \(questions.count) 项") {
                    ForEach(questions) { QuestionRow(model: model, question: $0) }
                    if questions.isEmpty { Text("没有匹配的题目。可调整筛选或搜索词。").foregroundStyle(.secondary) }
                }
            }
            Section("练习工具") {
                NavigationLink("八周学习计划") { GuideView(model: model, kind: "plan") }
                NavigationLink("语法速查") { GuideView(model: model, kind: "cheat") }
                NavigationLink("自由练习") { PlaygroundView(model: model) }
                NavigationLink("表结构") { SchemaView(model: model) }
                NavigationLink("SQL 模板") { List(model.catalog.templates) { template in NavigationLink(template.name) { ScrollView { VStack(alignment: .leading, spacing: 20) { Text(template.biz); Text(template.code).font(.system(.body, design: .monospaced)).textSelection(.enabled); NavigationLink("带入自由练习") { PlaygroundView(model: model, initial: template.code) } }.padding() }.navigationTitle(template.name) } } .navigationTitle("SQL 模板") }
            }
        }.navigationTitle("训练").scrollDismissesKeyboard(.interactively)
    }
}
struct LessonView: View {
    let model: LabModel
    let lesson: Lesson
    @State private var copiedExample: String?
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        List {
            Section {
                Text(lesson.goal).font(.headline); Text("预计 \(lesson.min) 分钟 · W\(lesson.w)").foregroundStyle(.secondary)
                Text("阅读：" + (model.state["lessons"][lesson.id] == .null ? "未读完" : "已阅读") + " · 配套练习独立通过 \(lesson.qs.filter { Learning.independent(model.state, $0) }.count) / \(lesson.qs.count)").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(lesson.secs, id: \.self) { section in
                Section(section.h ?? (section.traps == nil ? "" : "易错点")) {
                    if let p = section.p { Text(p).textSelection(.enabled) }
                    if let code = section.code {
                        Text(section.exampleDescription).font(.caption).foregroundStyle(.secondary)
                        Text(code).font(.system(.body, design: .monospaced)).textSelection(.enabled)
                        if section.canRun { NavigationLink("运行示例") { PlaygroundView(model: model, initial: code) }.accessibilityIdentifier("run-example-" + (section.dialect ?? "SQLite")) }
                        Button(copiedExample == code ? "已复制示例" : "复制示例") { copy(code) }.accessibilityIdentifier("copy-example-" + (section.dialect ?? "SQLite"))
                    }
                    if let note = section.note { Text(note).foregroundStyle(.secondary) }
                    if let traps = section.traps { ForEach(traps, id: \.self) { trap in Label(trap, systemImage: "exclamationmark.triangle").textSelection(.enabled) } }
                }
            }
            Section("业务应用") { Text(lesson.biz); Text(lesson.key) }
            Section("配套练习") { ForEach(lesson.qs.compactMap { model.catalog.question($0) }) { q in NavigationLink(q.title) { PracticeQuestionView(model: model, question: q) } } }
            Button(model.state["lessons"][lesson.id] == .null ? "标记本课已阅读" : "本课已阅读") { model.finishLesson(lesson) }.buttonStyle(.borderedProminent).accessibilityIdentifier("lesson-read")
        }.navigationTitle(lesson.title).toolbar { ToolbarItem(placement: .primaryAction) { FavoriteButton(model: model, id: lesson.id) }; ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        .onAppear { model.changeSession { $0["lastLearning"] = .object(["type": .string("lesson"), "id": .string(lesson.id)]) } }
    }
    private func copy(_ code: String) {
        #if canImport(UIKit)
        UIPasteboard.general.string = code
        #elseif canImport(AppKit)
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(code, forType: .string)
        #endif
        copiedExample = code
    }
}
struct LessonRow: View {
    let model: LabModel
    let lesson: Lesson
    var body: some View {
        HStack {
            Button { model.lessonRoute = lesson } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(lesson.title).foregroundStyle(.primary)
                    Text("W\(lesson.w) · \(lesson.min) 分钟 · " + (model.state["lessons"][lesson.id] == .null ? "未读完" : "已阅读")).font(.caption).foregroundStyle(.secondary)
                    Text("配套练习独立通过 \(lesson.qs.filter { Learning.independent(model.state, $0) }.count) / \(lesson.qs.count)").font(.caption).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, alignment: .leading)
            }.buttonStyle(.borderless).accessibilityLabel(lesson.title).accessibilityValue(model.state["lessons"][lesson.id] == .null ? "未读完" : "已阅读")
            FavoriteButton(model: model, id: lesson.id)
        }
    }
}
struct QuestionView: View {
    let model: LabModel
    let question: Question
    var onContinue: ((Question) -> Void)? = nil
    @State private var sql = ""
    @State private var note = ""
    @State private var result: SQLResult?
    @State private var verdict: String?
    @State private var caseVerdicts: [CaseVerdict] = []
    @State private var running = false
    @State private var answer = false
    @State private var editor = SQLEditorController()
    @State private var focusedMode = false
    @State private var schemaExpanded = false
    @State private var difference: SQLDifference?
    @State private var failedSample: String?
    @State private var hintLevel = 0
    @State private var passed = false
    @State private var initialAttempts = 0
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        ScrollViewReader { proxy in
          List {
            if !focusedMode {
            Section { Text(question.text); Text("练习方言：SQLite · 用表：" + question.tables.joined(separator: "、")).font(.caption).foregroundStyle(.secondary); if model.completionStatus(question.id) != .unfinished { CompletionLabel(status: model.completionStatus(question.id)) } }
            if question.dataset != nil { PracticeBriefSection(question: question) }
            }
            Section("你的 SQL") {
                HStack {
                    Button("本题数据") { editor.dismissKeyboard(); focusedMode = false; schemaExpanded = true; proxy.scrollTo("question-data", anchor: .top) }.accessibilityIdentifier("show-question-data")
                    Spacer()
                    if result != nil { Button("查看结果") { editor.dismissKeyboard(); focusedMode = false; proxy.scrollTo("question-feedback", anchor: .top) } }
                }.font(.caption)
                SQLCodeEditor(text: $sql, controller: editor, enabled: !running).frame(height: focusedMode ? 380 : 220)
                SQLInputTools(editor: editor).disabled(running)
            }.id("question-editor")
            if !focusedMode {
            Section("本题数据") {
                DisclosureGroup("字段、样例与关联关系", isExpanded: $schemaExpanded) {
                    InlineSchemaView(model: model, tables: question.tables, training: question.dataset != nil, insert: { field in
                        if !editor.insert(field) { sql = editor.inserting(field, into: sql) }
                        proxy.scrollTo("question-editor", anchor: .top)
                    })
                }
            }.id("question-data")
            Section("判题与查询结果") {
                if let verdict, difference == nil { Text(verdict).font(.headline).accessibilityIdentifier("verdict") }
                if let difference { DifferenceFeedback(difference: difference, sample: failedSample) }
                ForEach(caseVerdicts, id: \.name) { item in Label(item.name + (item.passed ? "：通过" : "：未通过"), systemImage: item.passed ? "checkmark.circle" : "xmark.circle").font(.caption) }
                if let result { SQLTable(result: result) }
                Text("已尝试 \(Int(model.state["attempts"][question.id].number ?? 0)) 次" + (model.session["viewed"][question.id].bool == true ? " · 本轮已查看参考答案" : "")).font(.caption).foregroundStyle(.secondary)
            }.id("question-feedback")
            if passed {
                CompletionActions(model: model, question: question, attempts: max(0, Int(model.state["attempts"][question.id].number ?? 0) - initialAttempts), onContinue: { next in
                    editor.dismissKeyboard(); onContinue?(next)
                }, onEnd: { editor.dismissKeyboard(); model.endLearning(); dismiss() })
            }
            Section("独立训练") {
                Button("独立重做") {
                    do { try model.restartIndependently(question.id); answer = false; sql = ""; result = nil; verdict = nil; caseVerdicts = []; difference = nil; hintLevel = 0; passed = false; proxy.scrollTo("question-editor", anchor: .top) }
                    catch { model.error = error.localizedDescription }
                }.disabled(running).accessibilityIdentifier("independent-redo")
                if model.session["independent"][question.id].bool == true { Text("独立重做中：已清空草稿并收起答案、历史和笔记。再次查看参考答案将按辅助完成记录。").font(.caption).foregroundStyle(.secondary) }
            }
            if question.kind == "project", model.session["independent"][question.id].bool != true { ProjectReportSection(question: question, sql: sql, note: $note, result: result, cases: caseVerdicts) }
            Section {
                if hintLevel > 0 { Text("提示 1 · " + (difference?.hint ?? "先明确每行代表什么，再列出筛选、分组和排序要求。")).font(.callout) }
                if hintLevel > 1 { Text("提示 2 · " + question.hint).font(.callout) }
                Button(hintLevel == 0 ? "提示 1：检查方向" : hintLevel == 1 ? "提示 2：本题思路" : "已展开全部提示") { hintLevel += 1 }.disabled(hintLevel >= 2).accessibilityIdentifier("next-hint")
                DisclosureGroup("参考答案与解析", isExpanded: Binding(get: { answer }, set: { expanded in
                    do { if expanded { try model.viewAnswer(question.id) }; answer = expanded }
                    catch { model.error = error.localizedDescription }
                })) { Text(question.answer).font(.system(.body, design: .monospaced)).textSelection(.enabled); Text(model.catalog.explanations[question.id] ?? "比较筛选条件、分组粒度与排序要求，再尝试独立重写。") }.disabled(running)
                if let mysql = question.mysql { DisclosureGroup("MySQL 8 对照（阅读）") { Text(question.dialectNote ?? ""); Text(mysql).font(.system(.caption, design: .monospaced)).textSelection(.enabled) }.disabled(!answer) }
                NavigationLink("查看表结构") { SchemaView(model: model, training: question.dataset != nil) }
                if question.parentID == nil && question.dataset == nil { NavigationLink("同知识点：条件变化与综合迁移") { PracticeLibraryView(model: model, parentID: question.id) } }
            }
            if model.session["independent"][question.id].bool != true {
                Section("运行历史") {
                    ForEach((model.state["history"].array ?? []).filter { $0["q"].string == question.id }, id: \.canonical) { item in
                        Button {
                            do { if item["used"].number != 0 { try model.viewAnswer(question.id) }; sql = item["s"].string ?? "" }
                            catch { model.error = error.localizedDescription }
                        } label: {
                            VStack(alignment: .leading) {
                                Text(historyLabel(item)).font(.caption.bold())
                                Text(item["s"].string ?? "").font(.system(.caption, design: .monospaced)).lineLimit(3)
                            }
                        }.disabled(running)
                    }
                }
                Section("我的笔记") { TextEditor(text: $note).frame(minHeight: 90).accessibilityIdentifier("note-editor") }
            }
            }
          }.navigationTitle(question.title).scrollDismissesKeyboard(.interactively)
          .safeAreaInset(edge: .bottom) {
              HStack(spacing: 12) {
                  Button { focusedMode.toggle() } label: { Text(focusedMode ? "返回题目" : "专注编辑").frame(minHeight: 44) }.buttonStyle(.bordered).accessibilityIdentifier("sql-focus")
                  Button { editor.dismissKeyboard(); focusedMode = false; Task { await run() } } label: { Text(running ? "正在判定…" : "运行并判定").frame(maxWidth: .infinity, minHeight: 44) }
                      .disabled(running || sql.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).buttonStyle(.borderedProminent).accessibilityIdentifier("run-sql")
              }.padding(12).background(.bar)
          }
          .onChange(of: verdict) { if verdict != nil { proxy.scrollTo("question-feedback", anchor: .top) } }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) { FavoriteButton(model: model, id: question.id) }
            ToolbarItem(placement: .confirmationAction) { Button("完成") { editor.dismissKeyboard(); dismiss() } }
        }
        .onAppear { initialAttempts = Int(model.state["attempts"][question.id].number ?? 0); sql = model.session["codes"][question.id].string ?? question.starter ?? ""; note = model.state["notes"][question.id].string ?? "" }
        .onChange(of: sql) { model.saveDraft(question.id, sql); result = nil; caseVerdicts = []; verdict = nil; difference = nil; failedSample = nil; passed = false }
        .onChange(of: note) { model.change { $0["notes"][question.id] = .string(note) } }
    }
    private func historyLabel(_ item: JSONValue) -> String {
        if item["ok"].number == 1 { return item["used"].number == 1 ? "辅助完成" : item["used"].number == 0 ? "独立通过" : "通过（旧记录）" }
        switch item["kind"].string { case "syntax": return "语法错误"; case "query": return "查询错误"; case "limit": return "超出查询限制"; default: return "结果未通过" }
    }
    private func run() async {
        guard !running else { return }
        running = true; result = nil; verdict = nil; caseVerdicts = []; defer { running = false }
        do {
            let value = try await model.submit(question, sql: sql)
            result = value.result
            caseVerdicts = value.cases
            difference = value.cases.first(where: { !$0.passed })?.difference ?? value.result.difference(from: value.reference, orderedBy: question.orderCols)
            failedSample = value.cases.first(where: { !$0.passed })?.name
            passed = value.passed
            verdict = value.passed ? (model.completionStatus(question.id) == .assisted ? "辅助完成：请关闭答案后独立重做。" : model.completionStatus(question.id) == .mastered ? "稳定掌握：已在不同日期独立通过至少 3 次。" : "通过！") : "结果还不一致，请检查条件、行数与排序。"
        } catch let error as SQLLearningError {
            verdict = (error.kind == "syntax" ? "语法错误：" : "查询未通过：") + error.localizedDescription + " 已记入作答次数、错题本和运行历史。"
        } catch { verdict = "本次未完成，未计入作答：" + error.localizedDescription }
    }
}
struct PlaygroundView: View {
    let model: LabModel
    var initial: String? = nil
    @State private var sql = ""
    @State private var result: SQLResult?
    @State private var message: String?
    @State private var running = false
    @State private var editor = SQLEditorController()
    var body: some View {
        List {
            Text("自由练习使用独立的内存数据库，退出应用后重置，不影响题库判分。").font(.caption).foregroundStyle(.secondary)
            SQLCodeEditor(text: $sql, controller: editor, enabled: !running).frame(height: 260)
            SQLInputTools(editor: editor).disabled(running)
            Button("运行 SQL") { editor.dismissKeyboard(); Task { running = true; defer { running = false }; do { result = try await model.engine.practice(sql); message = "运行完成" } catch { message = error.localizedDescription } } }.disabled(running)
            Button("重置练习库") { Task { await model.engine.resetPractice(); result = nil; message = "练习库已重置" } }.disabled(running)
            if let message { Text(message) }; if let result { SQLTable(result: result) }
        }.navigationTitle("自由练习").onAppear { sql = initial ?? model.draft("play") }.onChange(of: sql) { model.saveDraft("play", sql) }
    }
}
struct SchemaView: View {
    let model: LabModel
    var training = false
    var body: some View {
        List {
            if training {
                Section("业务粒度与关联") {
                    Text("电商：用户 → 订单 → 明细 → 商品。按 ID 区分同名用户；订单数按订单 ID 去重。")
                    Text("行为：events 每行一条日志；同日登录先去重；漏斗按同用户、同会话和时间顺序。")
                    Text("营销：campaigns 一活动、leads 一线索、ad_spend 一活动一天。多张一对多表先聚合。")
                    Text("履约：inventory 主键 (sku,warehouse)，shipments 每行一次发货；连接库存必须匹配两列。")
                }
            }
            InlineSchemaView(model: model, tables: training ? ["users", "products", "orders", "order_items", "events", "campaigns", "leads", "ad_spend", "inventory", "shipments"] : ["users", "products", "orders", "order_items"], training: training)
        }.navigationTitle("表结构")
    }
}
