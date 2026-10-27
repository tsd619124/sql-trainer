import SwiftUI
import Combine
import SQLLabCore
import UniformTypeIdentifiers
import UserNotifications

struct ExamView: View {
    let model: LabModel
    @State private var week = 0
    @State private var clock = Date()
    @State private var submit = false
    @State private var editor = SQLEditorController()
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    var body: some View {
        List {
            if model.examActive {
                let ids = model.exam["qids"].array?.compactMap(\.string) ?? []
                let index = Int(model.exam["idx"].number ?? 0)
                let remaining = max(0, Int(((model.exam["endAt"].number ?? 0) / 1000 - clock.timeIntervalSince1970).rounded(.up)))
                Section("周测进行中") {
                    Text("剩余 \(remaining / 60):\(String(format: "%02d", remaining % 60))").font(.title2.monospacedDigit())
                    Text("第 \(index + 1) / \(ids.count) 题 · 截止时间在退出应用后继续计算").font(.caption)
                    if ids.indices.contains(index), let q = model.catalog.question(ids[index]) {
                        Text(q.text)
                        SQLCodeEditor(text: Binding(get: { model.draft("test_" + q.id) }, set: { model.saveDraft("test_" + q.id, $0) }), controller: editor, enabled: !model.busy && remaining > 0, identifier: "exam-editor").frame(height: 230)
                        SQLInputTools(editor: editor).disabled(model.busy || remaining == 0)
                        HStack {
                            Button("上一题") { model.changeSession { $0["test"]["idx"] = .number(Double(index - 1)) } }.disabled(index == 0)
                            Spacer()
                            Button("下一题") { model.changeSession { $0["test"]["idx"] = .number(Double(index + 1)) } }.disabled(index + 1 == ids.count)
                        }.buttonStyle(.bordered).disabled(model.busy)
                    }
                    Button(model.busy ? "正在交卷…" : "交卷") { submit = true }.disabled(model.busy)
                }
            } else {
                Section("45 分钟 · 最多 5 题") {
                    Picker("训练范围", selection: $week) { Text("全部混合").tag(0); ForEach(model.catalog.weeks) { Text("W\($0.w) " + $0.name).tag($0.w) } }
                    Button("开始周测") { model.startExam(week: week) }.buttonStyle(.borderedProminent)
                }
                if let results = model.state["lastTest"]["results"].array {
                    Section("上次周测 · \(results.filter { $0["ok"].bool == true }.count) / \(results.count)") {
                        ForEach(results.compactMap { row -> ExamRow? in guard let q = model.catalog.question(row["qid"].string ?? "") else { return nil }; return ExamRow(question: q, passed: row["ok"].bool ?? false) }) { row in
                            Button { model.open(row.question) } label: { Label(row.question.title, systemImage: row.passed ? "checkmark.circle" : "xmark.circle").foregroundStyle(row.passed ? .green : .orange) }
                        }
                    }
                }
            }
            Section { NavigationLink("周测历史与复盘（\(model.examHistory.count) 次）") { ExamHistoryView(model: model) }.accessibilityIdentifier("exam-history") }
            Section("错题本 · \(model.wrong.count) 题") {
                if model.wrong.isEmpty { Text("暂无错题").foregroundStyle(.secondary) }
                ForEach(model.wrong) { QuestionRow(model: model, question: $0) }
            }
            Section("到期复习") { ForEach(model.due) { QuestionRow(model: model, question: $0) } }
        }.navigationTitle("测验")
        .confirmationDialog("确认交卷？未作答题目计为未通过。", isPresented: $submit) { Button("交卷") { Task { await model.finishExam() } } }
        .onReceive(timer) { now in clock = now; if model.examActive, (model.exam["endAt"].number ?? 0) <= now.timeIntervalSince1970 * 1000 { Task { await model.finishExam() } } }
    }
}
private struct ExamRow: Identifiable { let question: Question; let passed: Bool; var id: String { question.id } }

struct BackupDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}
struct ProfileView: View {
    let model: LabModel
    @AppStorage("native-appearance") private var appearance = "system"
    @State private var details = false
    @State private var achievements = false
    var body: some View {
        Form {
            Section("学习档案") {
                LabeledContent("已通过", value: "\(model.completed) / 42 题")
                LabeledContent("独立完成", value: "\(model.independentCompleted) 题")
                LabeledContent("连续学习", value: "\(model.streak) 天")
                DisclosureGroup("阅读、复习与掌握明细", isExpanded: $details) {
                LabeledContent("辅助完成", value: "\(model.completed - model.independentCompleted) 题")
                LabeledContent("其中复习通过", value: "\(model.reviewPassed) 题")
                LabeledContent("其中稳定掌握", value: "\(model.mastered) 题")
                Text("稳定掌握需要在至少 3 个不同日期独立通过；同日重复运行不累计。").font(.caption).foregroundStyle(.secondary)
                LabeledContent("已阅读课程", value: "\(model.state["lessons"].object?.count ?? 0) / 28 节")
                Text("读完课程不代表掌握；独立完成与复习通过按 SQL 作答证据统计。").font(.caption).foregroundStyle(.secondary)
                LabeledContent("累计学习", value: "\(model.state["days"].array?.count ?? 0) 天")
                }
                NavigationLink("学习能力档案") { AbilityProfileView(model: model) }.accessibilityIdentifier("ability-profile")
                NavigationLink("入门诊断与学习路径") { LearningPathView(model: model) }
            }
            Section("数据与跨设备") {
                NavigationLink("数据与同步状态中心") { DataCenterView(model: model) }.accessibilityIdentifier("data-center")
                NavigationLink("备份与迁移") { Form { BackupControls(model: model) }.navigationTitle("备份与迁移") }.accessibilityIdentifier("backup-settings")
                NavigationLink("云同步") { SyncView(model: model) }
            }
            Section("偏好设置") {
                NavigationLink("学习提醒") { Form { ReminderSettings() }.navigationTitle("学习提醒") }.accessibilityIdentifier("reminder-settings")
                Picker("外观", selection: $appearance) { Text("跟随系统").tag("system"); Text("浅色").tag("light"); Text("深色").tag("dark") }
            }
            Section("成就") {
                DisclosureGroup("查看学习成就", isExpanded: $achievements) { ForEach(["first", "d3", "d7", "l5", "t10", "w1", "half", "all"], id: \.self) { id in Label(achievement(id), systemImage: model.state["mil"][id] == .null ? "circle" : "checkmark.seal.fill") } }
            }
            Section("SQL Lab 原生版") {
                Text("SwiftUI · 系统 SQLite · 离线课程").font(.caption)
                Text("课程来源 \(model.catalog.sourceVersion) · 42 道题 · 28 节微课").font(.caption)
                Text("支持旧版备份与手动云同步；认证信息保存在钥匙串中，不会导出。").font(.caption).foregroundStyle(.secondary)
            }
        }.navigationTitle("我的")
    }
    func achievement(_ id: String) -> String { ["first": "通过第一题", "d3": "连续 3 天", "d7": "连续 7 天", "t10": "通过 10 题", "w1": "完成首周训练", "l5": "完成 5 节课", "half": "完成一半题库", "all": "完成全部题库"][id] ?? id }
}
