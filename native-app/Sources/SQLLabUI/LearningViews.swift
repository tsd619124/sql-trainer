import SwiftUI
import SQLLabCore

struct DailyTasksSection: View {
    let model: LabModel
    @State private var short = false
    var body: some View {
        Section("今日学习任务") {
            if let plan = model.dailyPlan {
                let tasks = plan.selected(short: short)
                let finished = tasks.filter { plan.completed($0, state: model.state) }.count
                Picker("训练时长", selection: $short) { Text("短时训练").tag(true); Text("完整训练").tag(false) }.pickerStyle(.segmented).accessibilityIdentifier("daily-mode")
                Text("W\(plan.week) · 学 \(tasks.filter { $0.kind == .lesson }.count) 课 · 练 \(tasks.filter { $0.kind == .practice }.count) 题 · 复习 \(tasks.filter { $0.kind == .review }.count) 题").font(.headline)
                Text("预计 \(tasks.reduce(0) { $0 + $1.minutes }) 分钟 · 已完成 \(finished) / \(tasks.count)").font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("daily-progress")
                if !tasks.isEmpty { ProgressView(value: Double(finished), total: Double(tasks.count)) }
                if let next = tasks.first(where: { !plan.completed($0, state: model.state) }) {
                    Button("开始下一项：" + title(next)) { model.openTask(next) }.buttonStyle(.borderedProminent).accessibilityIdentifier("daily-next")
                } else {
                    Text(tasks.isEmpty ? "当前路径已没有待完成任务。可进入测验检验能力，或等到下次复习。" : "本次任务已完成。可以结束训练，或切换完整训练继续。").foregroundStyle(.secondary).accessibilityIdentifier("daily-finished")
                }
                DisclosureGroup("任务清单 · \(finished) / \(tasks.count) 已完成") {
                    ForEach(tasks) { task in
                        Button { model.openTask(task) } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(title(task)).foregroundStyle(.primary)
                                    Text(task.reason + " · \(task.minutes) 分钟").font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: plan.completed(task, state: model.state) ? "checkmark.circle.fill" : "circle").foregroundStyle(plan.completed(task, state: model.state) ? Color.green : Color.secondary)
                            }
                        }.accessibilityIdentifier("daily-" + task.id)
                    }
                }
                if model.due.count > tasks.filter({ $0.kind == .review }).count { Text("还有 \(model.due.count - tasks.filter { $0.kind == .review }.count) 道到期题，可在测验页继续复习。").font(.caption).foregroundStyle(.secondary) }
                DisclosureGroup("任务与掌握如何记录") {
                    Text("课程读完计为已阅读；练习与复习需要本次独立答对，辅助完成不计入今日任务。").font(.caption).foregroundStyle(.secondary)
                    Text(goalHint).font(.caption).foregroundStyle(.secondary)
                }
            }
            NavigationLink("入门诊断与学习路径") { LearningPathView(model: model) }.accessibilityIdentifier("learning-path")
        }
    }
    private func title(_ task: DailyTask) -> String {
        if task.kind == .lesson { return "学一课 · " + (model.catalog.lesson(task.target)?.title ?? "课程") }
        return (task.kind == .review ? "独立复习 · " : "动手练习 · ") + (model.catalog.question(task.target)?.title ?? "题目")
    }
    private var goalHint: String {
        switch model.state["learningProfile"]["goal"].string {
        case "analysis": return "分析目标：完成 SQL 后，试着说明指标口径和结果含义。"
        case "foundation": return "基础目标：先读懂课程，再关闭答案独立写出查询。"
        default: return "求职目标：先口述解题思路，再独立手写 SQL；每周做一次限时周测。"
        }
    }
}

struct LearningPathView: View {
    let model: LabModel
    @State private var level = "beginner"
    @State private var goal = "job"
    @State private var minutes = 30
    @State private var startWeek = 1
    @State private var skipKnown = false
    @State private var diagnosing = false
    @State private var results: [JSONValue] = []
    @State private var sql = ""
    @State private var running = false
    @State private var status: String?
    @State private var editor = SQLEditorController()
    var body: some View {
        Form {
            Section("学习偏好") {
                Picker("当前基础", selection: $level) { Text("从零开始").tag("beginner"); Text("学过基础 SQL").tag("some"); Text("有项目经验").tag("confident") }
                Button("采用自评起点：W\(level == "beginner" ? 1 : level == "some" ? 2 : 3)") { startWeek = level == "beginner" ? 1 : level == "some" ? 2 : 3 }
                Picker("学习目标", selection: $goal) { Text("求职面试").tag("job"); Text("业务数据分析").tag("analysis"); Text("补齐 SQL 基础").tag("foundation") }
                Picker("每日可用时间", selection: $minutes) { ForEach([15, 30, 60], id: \.self) { Text("\($0) 分钟").tag($0) } }
            }
            Section("4 题入门诊断") {
                Text("依次检查取数、聚合、JOIN 与窗口函数。诊断只用于建议起点，不计为课程已读或题目已掌握。").font(.caption).foregroundStyle(.secondary)
                if diagnosing, results.count < Learning.diagnosticIDs.count, let question = model.catalog.question(Learning.diagnosticIDs[results.count]) {
                    Text("第 \(results.count + 1) / 4 题 · " + question.title).font(.headline)
                    Text(question.text)
                    SQLCodeEditor(text: $sql, controller: editor, enabled: !running, identifier: "diagnostic-editor").frame(height: 200)
                    SQLInputTools(editor: editor).disabled(running)
                    Button(running ? "正在检查…" : "提交诊断题") { Task { await grade(question) } }.disabled(running || sql.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    Button("暂不会，下一题") { append(question, passed: false, kind: "unanswered") }.disabled(running).accessibilityIdentifier("diagnostic-skip")
                } else {
                    Button(results.isEmpty ? "开始入门诊断" : "重新诊断") { results = []; diagnosing = true; sql = ""; status = nil }.accessibilityIdentifier("diagnostic-start")
                }
                if results.count == 4 {
                    Text("诊断通过 \(results.filter { $0["ok"].bool == true }.count) / 4 · 建议从 W\(Learning.recommendedWeek(results, catalog: model.catalog)) 开始").accessibilityIdentifier("diagnostic-result")
                    ForEach(Learning.diagnosticIDs, id: \.self) { id in
                        if let row = results.first(where: { $0["qid"].string == id }) { Text((model.catalog.question(id)?.title ?? id) + "：" + Learning.reason(row["kind"].string)).font(.caption) }
                    }
                    Text("抽样通过不能证明整周已掌握，仍可选择较早起点补练。").font(.caption).foregroundStyle(.secondary)
                }
            }
            Section("训练起点") {
                Picker("开始阶段", selection: $startWeek) { ForEach(model.catalog.weeks) { Text("W\($0.w) " + $0.name).tag($0.w) } }.accessibilityIdentifier("path-start-week")
                Toggle("跳过已独立完成题目对应的课程", isOn: $skipKnown)
                Text("跳过只影响任务推荐，不会补写已读或掌握记录；到期复习始终保留。").font(.caption).foregroundStyle(.secondary)
                Button("保存学习路径") { save() }.disabled(diagnosing || running).accessibilityIdentifier("path-save")
                if let status { Text(status).font(.caption).accessibilityIdentifier("path-status") }
            }
        }.navigationTitle("诊断与路径")
        .task {
            let profile = model.state["learningProfile"]
            level = profile["level"].string ?? "beginner"; goal = profile["goal"].string ?? "job"; minutes = Int(profile["minutes"].number ?? 30)
            startWeek = Int(profile["startWeek"].number ?? 1); skipKnown = profile["skipKnown"].bool ?? false; results = profile["diagnostic"].array ?? []
        }
    }
    private func grade(_ question: Question) async {
        running = true; defer { running = false }
        do { let verdict = try await model.engine.grade(question, sql: sql); append(question, passed: verdict.passed, kind: verdict.passed ? "passed" : "result") }
        catch let error as SQLLearningError { append(question, passed: false, kind: error.kind) }
        catch { model.error = "诊断未完成，可保留作答后重试：" + error.localizedDescription }
    }
    private func append(_ question: Question, passed: Bool, kind: String) {
        results.append(.object(["qid": .string(question.id), "ok": .bool(passed), "kind": .string(kind)])); sql = ""
        if results.count == 4 { diagnosing = false; startWeek = Learning.recommendedWeek(results, catalog: model.catalog) }
    }
    private func save() {
        var profile: JSONValue = .object(["level": .string(level), "goal": .string(goal), "minutes": .number(Double(minutes)), "startWeek": .number(Double(startWeek)), "skipKnown": .bool(skipKnown), "updatedAt": .number(Date().timeIntervalSince1970 * 1000)])
        if results.count == 4 { profile["diagnostic"] = .array(results) }
        do { try model.saveLearningProfile(profile); status = "已保存，今日任务已按新的路径更新。" } catch { model.error = error.localizedDescription }
    }
}

struct SkillSummary: Identifiable {
    let skill: LearningSkill
    let questions: [Question]
    let evidence: [JSONValue]
    let completed: Int
    var id: String { skill.id }
    var independentAttempts: [JSONValue] { evidence.filter { $0["used"].bool == false } }
    var passed: Int { independentAttempts.filter { $0["ok"].bool == true }.count }
    var repeated: [Question] { questions.filter { question in evidence.filter { $0["qid"].string == question.id && $0["ok"].bool == false }.count >= 2 } }
    var rate: String { independentAttempts.isEmpty ? "暂无本轮独立作答证据" : "\(Int((Double(passed) / Double(independentAttempts.count) * 100).rounded()))% · \(passed) / \(independentAttempts.count) 次" }
}

extension LabModel {
    var skillSummaries: [SkillSummary] {
        LearningSkill.all.map { skill in
            let questions = catalog.allQuestions.filter { skill.weeks.contains($0.w) }, ids = Set(questions.map(\.id))
            return SkillSummary(skill: skill, questions: questions, evidence: (state["evidence"].object ?? [:]).values.filter { ids.contains($0["qid"].string ?? "") }, completed: questions.filter { Learning.independent(state, $0.id) }.count)
        }
    }
}

struct AbilityProfileView: View {
    let model: LabModel
    var body: some View {
        List {
            Section {
                Text("独立通过率按本轮开始记录的独立作答次数计算，查看答案后的作答不进入分母。旧版仅有通过记录时展示覆盖数，不推算历史通过率。").font(.caption).foregroundStyle(.secondary)
                Text("重复错误指同一道题累计失败至少 2 次；后续答对仍保留这段学习证据。").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(model.skillSummaries) { summary in
                Section(summary.skill.name) {
                    LabeledContent("独立通过率", value: summary.rate)
                    LabeledContent("已独立完成", value: "\(summary.completed) / \(summary.questions.count) 题")
                    LabeledContent("出现重复错误", value: "\(summary.repeated.count) 题")
                    ForEach(summary.repeated) { question in
                        Button("针对重练：" + question.title) { do { try model.restartIndependently(question.id); model.open(question) } catch { model.error = error.localizedDescription } }
                    }
                    DisclosureGroup("查看该能力的题目与错误分布") {
                        ForEach(["syntax", "result", "query", "limit", "unanswered"], id: \.self) { kind in
                            let count = summary.evidence.filter { $0["kind"].string == kind }.count
                            if count > 0 { Text(Learning.reason(kind) + " · \(count) 次").font(.caption) }
                        }
                        ForEach(summary.questions) { QuestionRow(model: model, question: $0) }
                    }
                }
            }
        }.navigationTitle("学习能力档案")
    }
}

struct ExamHistoryView: View {
    let model: LabModel
    var body: some View {
        List {
            if model.examHistory.isEmpty { Text("完成一次周测后，在这里查看成绩、用时和复练建议。").foregroundStyle(.secondary) }
            ForEach(model.examHistory, id: \.canonical) { record in
                NavigationLink { ExamReviewView(model: model, record: record) } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(Date(timeIntervalSince1970: (record["endedAt"].number ?? 0) / 1000).formatted(date: .abbreviated, time: .shortened))
                        Text("\(score(record, catalog: model.catalog)) · " + duration(record)).font(.caption).foregroundStyle(.secondary)
                    }
                }.accessibilityIdentifier("exam-record-" + (record["id"].string ?? ""))
            }
        }.navigationTitle("周测历史与复盘")
    }
}

private func score(_ record: JSONValue, catalog: Catalog) -> String {
    let rows = record["results"].array ?? []
    let total = rows.reduce(0) { $0 + (catalog.question($1["qid"].string ?? "")?.pts ?? 0) }
    let passed = rows.filter { $0["ok"].bool == true }.reduce(0) { $0 + (catalog.question($1["qid"].string ?? "")?.pts ?? 0) }
    return "\(passed) / \(total) 分 · \(rows.filter { $0["ok"].bool == true }.count) / \(rows.count) 题通过"
}
private func duration(_ record: JSONValue) -> String {
    guard let elapsed = record["elapsed"].number else { return "旧记录未保存用时" }
    let seconds = Int(elapsed); return "用时 \(seconds / 60)分\(seconds % 60)秒"
}

struct ExamReviewView: View {
    let model: LabModel
    let record: JSONValue
    var body: some View {
        List {
            Section("本次成绩") { Text(score(record, catalog: model.catalog)).font(.headline); Text(duration(record)); Text("按题目分值统计，不把题目数量当作分数。").font(.caption).foregroundStyle(.secondary) }
            Section("知识点失分") {
                ForEach(LearningSkill.all) { skill in
                    let missed = (record["results"].array ?? []).filter { row in row["ok"].bool == false && model.catalog.question(row["qid"].string ?? "").map { skill.weeks.contains($0.w) } == true }
                    if !missed.isEmpty { LabeledContent(skill.name, value: "失 \(missed.reduce(0) { $0 + (model.catalog.question($1["qid"].string ?? "")?.pts ?? 0) }) 分") }
                }
                if (record["results"].array ?? []).allSatisfy({ $0["ok"].bool == true }) { Text("本次全部通过，后续按复习日期再次独立完成。") }
            }
            ForEach(record["results"].array ?? [], id: \.canonical) { row in
                if let question = model.catalog.question(row["qid"].string ?? "") {
                    Section(question.title) {
                        Text(row["ok"].bool == true ? "独立通过" : Learning.reason(row["kind"].string)).foregroundStyle(row["ok"].bool == true ? Color.green : Color.orange)
                        if let sql = row["sql"].string, !sql.isEmpty { DisclosureGroup("本次作答") { Text(sql).font(.system(.caption, design: .monospaced)).textSelection(.enabled) } }
                        Button("独立复练：" + question.title) { do { try model.restartIndependently(question.id); model.open(question) } catch { model.error = error.localizedDescription } }.accessibilityIdentifier("exam-retry-" + question.id)
                    }
                }
            }
        }.navigationTitle("周测复盘")
    }
}
