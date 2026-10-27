import SwiftUI
import Observation
#if canImport(UIKit)
import UIKit
#endif

enum SQLSyntax {
    enum Kind { case keyword, string, comment, number }
    struct Token { let range: NSRange; let kind: Kind }
    private static let expression = try! NSRegularExpression(pattern: #"(--[^\n]*|/\*[\s\S]*?\*/)|('(?:''|[^'])*'|\"(?:\"\"|[^\"])*\")|\b(\d+(?:\.\d+)?)\b|\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|ON|AS|AND|OR|NOT|NULL|IS|IN|EXISTS|BETWEEN|LIKE|DISTINCT|GROUP|BY|HAVING|ORDER|ASC|DESC|LIMIT|OFFSET|WITH|RECURSIVE|UNION|ALL|CASE|WHEN|THEN|ELSE|END|OVER|PARTITION|ROWS|RANGE|PRECEDING|FOLLOWING|CURRENT|ROW|COUNT|SUM|AVG|MIN|MAX|ROUND|COALESCE|IFNULL|NULLIF|CAST|INTEGER|TEXT|REAL|ROW_NUMBER|RANK|DENSE_RANK|LAG|LEAD|DATE|STRFTIME)\b"#, options: [.caseInsensitive])
    static func tokens(in text: String) -> [Token] {
        expression.matches(in: text, range: NSRange(location: 0, length: (text as NSString).length)).map { match in
            Token(range: match.range, kind: match.range(at: 1).location != NSNotFound ? .comment : match.range(at: 2).location != NSNotFound ? .string : match.range(at: 3).location != NSNotFound ? .number : .keyword)
        }
    }
    static func indentation(in text: String, at location: Int) -> String {
        let source = text as NSString
        let prefix = source.substring(to: min(max(0, location), source.length))
        let line = prefix.components(separatedBy: "\n").last ?? ""
        return String(line.prefix(while: { $0 == " " || $0 == "\t" })) + (line.trimmingCharacters(in: .whitespaces).hasSuffix("(") ? "    " : "")
    }
    static func matchingBrackets(in text: String, selection: Int) -> [NSRange] {
        let source = text as NSString, length = source.length
        let pairs: [unichar: unichar] = [40: 41, 91: 93]
        let ignored = tokens(in: text).filter { $0.kind == .comment || $0.kind == .string }.map(\.range)
        let candidates = [selection - 1, selection].filter { $0 >= 0 && $0 < length }
        guard let origin = candidates.first(where: { pairs[source.character(at: $0)] != nil || pairs.values.contains(source.character(at: $0)) }), !ignored.contains(where: { NSLocationInRange(origin, $0) }) else { return [] }
        let character = source.character(at: origin), forward = pairs[character] != nil
        let opening = forward ? character : pairs.first(where: { $0.value == character })!.key
        let closing = pairs[opening]!
        var depth = 0, position = origin
        while position >= 0 && position < length {
            if !ignored.contains(where: { NSLocationInRange(position, $0) }) {
                let current = source.character(at: position)
                if current == (forward ? opening : closing) { depth += 1 }
                if current == (forward ? closing : opening) { depth -= 1 }
                if depth == 0 { return [NSRange(location: origin, length: 1), NSRange(location: position, length: 1)] }
            }
            position += forward ? 1 : -1
        }
        return []
    }
}

@MainActor @Observable final class SQLEditorController {
    var canUndo = false
    var canRedo = false
    @ObservationIgnored var selection = NSRange(location: 0, length: 0)
    @ObservationIgnored var insertAction: ((String) -> Bool)?
    @ObservationIgnored var undoAction: (() -> Void)?
    @ObservationIgnored var redoAction: (() -> Void)?
    @ObservationIgnored var dismissAction: (() -> Void)?
    @discardableResult func insert(_ text: String) -> Bool { insertAction?(text) ?? false }
    func inserting(_ snippet: String, into text: String) -> String {
        let source = text as NSString, location = min(selection.location, (text as NSString).length)
        let range = NSRange(location: location, length: min(selection.length, source.length - location))
        selection = NSRange(location: location + (snippet as NSString).length, length: 0)
        canUndo = false; canRedo = false
        return source.replacingCharacters(in: range, with: snippet)
    }
    func undo() { undoAction?() }
    func redo() { redoAction?() }
    func dismissKeyboard() { dismissAction?() }
}

struct SQLInputTools: View {
    let editor: SQLEditorController
    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                Button { editor.undo() } label: { Image(systemName: "arrow.uturn.backward").frame(minWidth: 44, minHeight: 44) }.disabled(!editor.canUndo).accessibilityLabel("撤销 SQL 编辑").accessibilityIdentifier("sql-undo")
                Button { editor.redo() } label: { Image(systemName: "arrow.uturn.forward").frame(minWidth: 44, minHeight: 44) }.disabled(!editor.canRedo).accessibilityLabel("重做 SQL 编辑").accessibilityIdentifier("sql-redo")
                ForEach(["SELECT ", "FROM ", "WHERE ", "    ", "()", "''", ", ", ";", "*", "=", ">=", "<=", "\n"], id: \.self) { token in
                    Button(token == "    " ? "缩进" : token == "\n" ? "换行" : token.trimmingCharacters(in: .whitespaces)) { editor.insert(token) }
                        .font(.system(.caption, design: .monospaced)).frame(minWidth: 44, minHeight: 44).accessibilityIdentifier("sql-token-" + (token == "    " ? "indent" : token.trimmingCharacters(in: .whitespacesAndNewlines)))
                }
            }.buttonStyle(.bordered)
        }.scrollIndicators(.hidden).accessibilityLabel("SQL 快捷输入")
    }
}

#if canImport(UIKit)
struct SQLCodeEditor: UIViewRepresentable {
    @Binding var text: String
    let controller: SQLEditorController
    var enabled = true
    var identifier = "sql-editor"

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.backgroundColor = .secondarySystemGroupedBackground
        view.font = .preferredMonospacedFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.autocorrectionType = .no; view.autocapitalizationType = .none; view.spellCheckingType = .no
        view.smartQuotesType = .no; view.smartDashesType = .no; view.smartInsertDeleteType = .no
        view.keyboardType = .asciiCapable
        view.textContainerInset = UIEdgeInsets(top: 12, left: 8, bottom: 12, right: 8)
        view.accessibilityLabel = "你的 SQL"
        view.accessibilityIdentifier = identifier
        view.text = text
        let location = min(controller.selection.location, (text as NSString).length)
        view.selectedRange = NSRange(location: location, length: min(controller.selection.length, (text as NSString).length - location))
        view.delegate = context.coordinator
        context.coordinator.attach(view)
        context.coordinator.highlight(view)
        return view
    }
    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.parent = self
        view.isEditable = enabled
        if view.text != text {
            let selection = controller.selection
            view.text = text
            view.selectedRange = NSRange(location: min(selection.location, (text as NSString).length), length: 0)
            view.undoManager?.removeAllActions()
        }
        context.coordinator.highlight(view)
    }
    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: SQLCodeEditor
        private weak var view: UITextView?
        private var inserting = false
        private var highlighting = false
        init(_ parent: SQLCodeEditor) { self.parent = parent }
        func attach(_ view: UITextView) {
            self.view = view
            parent.controller.insertAction = { [weak self] text in self?.insert(text) ?? false }
            parent.controller.undoAction = { [weak self] in self?.undo() }
            parent.controller.redoAction = { [weak self] in self?.redo() }
            parent.controller.dismissAction = { [weak view] in view?.resignFirstResponder() }
            let toolbar = UIToolbar(); toolbar.sizeToFit()
            let dismiss = UIBarButtonItem(title: "收起键盘", style: .plain, target: self, action: #selector(dismissKeyboard))
            dismiss.accessibilityIdentifier = "sql-dismiss-keyboard"
            toolbar.items = [UIBarButtonItem(title: "撤销", style: .plain, target: self, action: #selector(undo)), UIBarButtonItem(title: "重做", style: .plain, target: self, action: #selector(redo)), UIBarButtonItem(title: "缩进", style: .plain, target: self, action: #selector(indent)), .flexibleSpace(), dismiss]
            view.inputAccessoryView = toolbar
        }
        @discardableResult func insert(_ text: String) -> Bool {
            guard let view, view.isEditable, view.window != nil else { return false }
            view.becomeFirstResponder()
            inserting = true; view.insertText(text); inserting = false
            if ["()", "''"].contains(text) { view.selectedRange = NSRange(location: max(0, view.selectedRange.location - 1), length: 0) }
            textViewDidChange(view)
            return true
        }
        @objc func undo() { guard let view else { return }; view.undoManager?.undo(); textViewDidChange(view) }
        @objc func redo() { guard let view else { return }; view.undoManager?.redo(); textViewDidChange(view) }
        @objc private func indent() { insert("    ") }
        @objc private func dismissKeyboard() { view?.resignFirstResponder() }
        func textViewDidChange(_ view: UITextView) {
            guard view.markedTextRange == nil else { return }
            parent.controller.selection = view.selectedRange
            if parent.text != view.text { parent.text = view.text }
            parent.controller.canUndo = view.undoManager?.canUndo ?? false
            parent.controller.canRedo = view.undoManager?.canRedo ?? false
            highlight(view)
        }
        func textViewDidChangeSelection(_ view: UITextView) { parent.controller.selection = view.selectedRange; highlight(view) }
        func textView(_ view: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            guard !inserting, view.markedTextRange == nil else { return true }
            let source = view.text as NSString
            if text == "\n" {
                insert("\n" + SQLSyntax.indentation(in: view.text, at: range.location)); return false
            }
            let pairs = ["(": ")", "[": "]", "'": "'", "\"": "\""]
            if range.length == 0, [")", "]", "'", "\""].contains(text), range.location < source.length, source.substring(with: NSRange(location: range.location, length: 1)) == text {
                view.selectedRange = NSRange(location: range.location + 1, length: 0); return false
            }
            let inLiteral = SQLSyntax.tokens(in: view.text).contains { ($0.kind == .string || $0.kind == .comment) && range.location > $0.range.location && range.location < NSMaxRange($0.range) }
            if let closing = pairs[text], !inLiteral {
                let selected = source.substring(with: range)
                inserting = true; view.insertText(text + selected + closing); inserting = false
                view.selectedRange = NSRange(location: range.location + 1, length: (selected as NSString).length)
                textViewDidChange(view); return false
            }
            return true
        }
        func highlight(_ view: UITextView) {
            guard view.markedTextRange == nil, !highlighting else { return }
            highlighting = true; defer { highlighting = false }
            let selection = view.selectedRange, offset = view.contentOffset
            let font = UIFont.preferredMonospacedFont(forTextStyle: .body)
            let manager = view.undoManager
            manager?.disableUndoRegistration()
            view.textStorage.beginEditing()
            view.textStorage.setAttributes([.font: font, .foregroundColor: UIColor.label], range: NSRange(location: 0, length: view.textStorage.length))
            for token in SQLSyntax.tokens(in: view.text) {
                let color: UIColor
                switch token.kind { case .keyword: color = .systemIndigo; case .string: color = .systemGreen; case .comment: color = .secondaryLabel; case .number: color = .systemOrange }
                view.textStorage.addAttribute(.foregroundColor, value: color, range: token.range)
            }
            for range in SQLSyntax.matchingBrackets(in: view.text, selection: selection.location) { view.textStorage.addAttribute(.backgroundColor, value: UIColor.systemYellow.withAlphaComponent(0.3), range: range) }
            view.textStorage.endEditing()
            manager?.enableUndoRegistration()
            view.typingAttributes = [.font: font, .foregroundColor: UIColor.label]
            if view.selectedRange != selection { view.selectedRange = selection }
            if view.contentOffset != offset { view.setContentOffset(offset, animated: false) }
        }
    }
}

private extension UIFont {
    static func preferredMonospacedFont(forTextStyle style: UIFont.TextStyle) -> UIFont { UIFontMetrics(forTextStyle: style).scaledFont(for: .monospacedSystemFont(ofSize: 16, weight: .regular)) }
}
#else
struct SQLCodeEditor: View {
    @Binding var text: String
    let controller: SQLEditorController
    var enabled = true
    var identifier = "sql-editor"
    var body: some View {
        TextEditor(text: $text).font(.system(.body, design: .monospaced)).autocorrectionDisabled().disabled(!enabled).accessibilityIdentifier(identifier)
            .onAppear { controller.insertAction = { text += $0; return true } }
    }
}
#endif
