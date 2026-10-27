import SwiftUI
import SQLLabCore

enum LibraryDifficulty: String, CaseIterable, Identifiable {
    case all = "全部难度", foundation = "基础", intermediate = "进阶", advanced = "综合"
    var id: String { rawValue }
    static func stage(_ week: Int) -> Self { week <= 2 ? .foundation : week <= 5 ? .intermediate : .advanced }
}

enum LibraryStatus: String, CaseIterable, Identifiable {
    case all = "全部状态", unfinished = "未完成", completed = "已完成", independent = "独立通过"
    var id: String { rawValue }
}

struct CatalogQuery {
    var search = ""
    var week = 0
    var difficulty = LibraryDifficulty.all
    var status = LibraryStatus.all
    var favoritesOnly = false

    @MainActor func matches(_ question: Question, model: LabModel) -> Bool {
        let text = [question.title, question.text, question.hint, question.topic ?? "", question.trainingLabel,
                    model.catalog.weeks.first { $0.w == question.w }?.name ?? "", model.state["notes"][question.id].string ?? ""].joined(separator: " ")
        return accepts(week: question.w, completed: model.state["done"][question.id] != .null, independent: Learning.independent(model.state, question.id), favorite: model.isFavorite(question.id), text: text)
    }

    @MainActor func matches(_ lesson: Lesson, model: LabModel) -> Bool {
        let notes = lesson.qs.compactMap { model.state["notes"][$0].string }.joined(separator: " ")
        let text = ([lesson.title, lesson.goal, lesson.key, lesson.biz, notes] + lesson.secs.flatMap { [$0.h ?? "", $0.p ?? "", $0.code ?? ""] }).joined(separator: " ")
        return accepts(week: lesson.w, completed: model.state["lessons"][lesson.id] != .null, independent: !lesson.qs.isEmpty && lesson.qs.allSatisfy { Learning.independent(model.state, $0) }, favorite: model.isFavorite(lesson.id), text: text)
    }

    private func accepts(week stage: Int, completed: Bool, independent: Bool, favorite: Bool, text: String) -> Bool {
        let terms = search.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        return (week == 0 || week == stage) && (difficulty == .all || difficulty == .stage(stage)) &&
            (!favoritesOnly || favorite) && terms.allSatisfy { text.localizedCaseInsensitiveContains($0) } &&
            (status == .all || status == .unfinished && !completed || status == .completed && completed || status == .independent && independent)
    }
}

struct LibraryFilters: View {
    let model: LabModel
    @Binding var query: CatalogQuery
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack { weekMenu; difficultyMenu; statusMenu }
            VStack(alignment: .leading) { weekMenu; difficultyMenu; statusMenu }
        }
        Toggle("只看收藏", isOn: $query.favoritesOnly).accessibilityIdentifier("favorites-only")
    }
    private var weekMenu: some View {
        Picker("知识点", selection: $query.week) { Text("全部知识点").tag(0); ForEach(model.catalog.weeks) { Text("W\($0.w) " + $0.name).tag($0.w) } }
            .accessibilityIdentifier("filter-topic")
    }
    private var difficultyMenu: some View {
        Picker("难度", selection: $query.difficulty) { ForEach(LibraryDifficulty.allCases) { Text($0.rawValue).tag($0) } }.accessibilityIdentifier("filter-difficulty")
    }
    private var statusMenu: some View {
        Picker("状态", selection: $query.status) { ForEach(LibraryStatus.allCases) { Text($0.rawValue).tag($0) } }.accessibilityIdentifier("filter-status")
    }
}

struct FavoriteButton: View {
    let model: LabModel
    let id: String
    var body: some View {
        Button { model.toggleFavorite(id) } label: { Image(systemName: model.isFavorite(id) ? "bookmark.fill" : "bookmark").frame(minWidth: 44, minHeight: 44) }
            .buttonStyle(.borderless).accessibilityLabel(model.isFavorite(id) ? "取消收藏" : "收藏")
            .accessibilityValue(model.isFavorite(id) ? "已收藏" : "未收藏").accessibilityIdentifier("favorite-" + id)
    }
}

extension LabModel {
    func isFavorite(_ id: String) -> Bool { session["favorites"][id].bool == true }
    func toggleFavorite(_ id: String) {
        changeSession { session in
            var favorites = session["favorites"].object ?? [:]
            if favorites[id]?.bool == true { favorites.removeValue(forKey: id) } else { favorites[id] = .bool(true) }
            session["favorites"] = .object(favorites)
        }
    }
    func nextQuestion(after question: Question) -> Question? {
        if let position = catalog.questions.firstIndex(where: { $0.id == question.id }) { return catalog.questions.dropFirst(position + 1).first }
        let related = catalog.allQuestions.filter { $0.id != question.id && $0.w == question.w && $0.parentID == question.parentID && !Learning.independent(state, $0.id) }
        return related.first
    }
    func endLearning() { changeSession { $0["lastLearning"] = .null }; route = nil; lessonRoute = nil }
}

struct CompletionActions: View {
    let model: LabModel
    let question: Question
    let attempts: Int
    let onContinue: (Question) -> Void
    let onEnd: () -> Void
    var body: some View {
        Section("本次学习小结") {
            Label(model.completionStatus(question.id).rawValue + " · 本题作答 \(attempts) 次", systemImage: "checkmark.circle.fill").foregroundStyle(.green).accessibilityIdentifier("session-summary")
            if let due = model.state["sr"][question.id]["due"].string { Text("下次复习：" + due).font(.caption).foregroundStyle(.secondary) }
            if let next = model.nextQuestion(after: question) { Button("下一题 · " + next.title) { onContinue(next) }.accessibilityIdentifier("next-question") }
            if let variant = (model.catalog.practice ?? []).first(where: { $0.parentID == (question.parentID ?? question.id) && $0.id != question.id }) {
                Button("同类变式 · " + variant.title) { onContinue(variant) }.accessibilityIdentifier("similar-question")
            }
            if let review = model.due.first(where: { $0.id != question.id }) {
                Button("继续复习 · " + review.title) { do { try model.restartIndependently(review.id); onContinue(review) } catch { model.error = error.localizedDescription } }.accessibilityIdentifier("continue-review")
            } else { Text("当前没有其他到期复习").font(.caption).foregroundStyle(.secondary) }
            Button("结束本次学习", action: onEnd).accessibilityIdentifier("end-session")
        }
    }
}
