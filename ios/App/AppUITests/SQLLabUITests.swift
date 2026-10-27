import XCTest

@MainActor final class SQLLabUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "com.fengguanjia.sqllab")
    override func setUpWithError() throws { continueAfterFailure = false; executionTimeAllowance = 300 }
    private func launch() {
        app.launch()
        if app.buttons["完成"].waitForExistence(timeout: 3) { app.buttons["完成"].firstMatch.tap() }
        XCTAssertTrue(app.buttons["今天"].waitForExistence(timeout: 30), app.debugDescription)
    }
    private func snapshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    private func reveal(_ element: XCUIElement, upward: Bool = true) {
        for _ in 0..<12 {
            if element.exists && element.isHittable { return }
            if upward { app.swipeUp() } else { app.swipeDown() }
        }
        XCTAssertTrue(element.exists && element.isHittable, app.debugDescription)
    }
    private func search(_ title: String) {
        app.buttons["训练"].tap()
        let search = app.textFields["catalog-search"]
        XCTAssertTrue(search.waitForExistence(timeout: 10)); search.tap()
        search.typeKey("a", modifierFlags: .command); search.typeText(title)
    }
    func testRound3PracticeCasesAndSchema() {
        launch()
        app.buttons["训练"].tap()
        let library = app.buttons["practice-library"]
        reveal(library); library.tap()
        let query = app.textFields["practice-search"]
        XCTAssertTrue(query.waitForExistence(timeout: 10)); query.tap(); query.typeText("百元以上")
        let question = app.buttons["practice-q1-v2"]
        XCTAssertTrue(question.waitForExistence(timeout: 10)); question.tap()
        let editor = app.textViews["sql-editor"]
        let scrollStart = app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.65))
        scrollStart.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.25)))
        reveal(editor); editor.tap()
        let keyboard = app.buttons["sql-dismiss-keyboard"]
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10))
        editor.typeKey("a", modifierFlags: .command)
        editor.typeText("SELECT product_id,product_name,price FROM products WHERE price>=100 ORDER BY price,product_id;")
        keyboard.tap()
        let run = app.buttons["运行并判定"]; reveal(run); run.tap()
        let verdict = app.staticTexts["verdict"]
        XCTAssertTrue(verdict.waitForExistence(timeout: 15)); XCTAssertTrue(verdict.label.contains("通过"), app.debugDescription)
        let empty = app.staticTexts["空集样本：通过"]; reveal(empty)
        XCTAssertTrue(empty.exists, app.debugDescription)
        snapshot("第三轮-变式三组数据判分")
    }
    func testRound3ChoiceAndIndependentRedo() {
        launch()
        app.buttons["训练"].tap()
        let library = app.buttons["practice-library"]; reveal(library); library.tap()
        let query = app.textFields["practice-search"]
        XCTAssertTrue(query.waitForExistence(timeout: 10)); query.tap(); query.typeText("空值与计数")
        let question = app.buttons["practice-choice-count"]
        XCTAssertTrue(question.waitForExistence(timeout: 10)); question.tap()
        app.buttons["choice-1"].tap(); app.buttons["submit-choice"].tap()
        XCTAssertTrue(app.staticTexts["choice-verdict"].label.contains("未通过"))
        app.buttons["choice-2"].tap(); app.buttons["submit-choice"].tap()
        XCTAssertTrue(app.staticTexts["choice-verdict"].label.contains("通过"))
        let redo = app.buttons["独立重做"]; reveal(redo); redo.tap()
        XCTAssertFalse(app.buttons["submit-choice"].isEnabled)
        snapshot("第三轮-选择辨析与重做")
    }
    func testLaunchAndNavigation() {
        launch()
        XCTAssertEqual(app.webViews.count, 0, "原生页面不能依赖 WebView")
        snapshot("原生首页")
        app.buttons["我的"].tap()
        XCTAssertTrue(app.buttons["backup-settings"].waitForExistence(timeout: 10))
        snapshot("原生个人页")
        app.buttons["测验"].tap()
        XCTAssertTrue(app.buttons["开始周测"].waitForExistence(timeout: 10))
        app.buttons["训练"].tap()
        XCTAssertTrue(app.textFields["catalog-search"].waitForExistence(timeout: 10))
        app.buttons["今天"].tap()
    }
    func testSQLDraftGradingAndRelaunch() throws {
        #if !targetEnvironment(simulator)
        throw XCTSkip("写入训练记录的验收仅在模拟器执行")
        #endif
        launch(); app.buttons["训练"].tap()
        let search = app.textFields["catalog-search"]; search.tap(); search.typeText("价格排序的商品清单")
        let question = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'question-' ")).firstMatch
        XCTAssertTrue(question.waitForExistence(timeout: 10)); question.tap()
        let redo = app.buttons["independent-redo"]; reveal(redo); redo.tap()
        let editor = app.textViews["sql-editor"]; XCTAssertTrue(editor.waitForExistence(timeout: 10)); editor.tap()
        editor.typeKey("a", modifierFlags: .command)
        let sql = "SELECT product_name, price FROM products ORDER BY price DESC;"
        editor.typeText(sql)
        app.buttons["运行并判定"].tap()
        XCTAssertTrue(app.staticTexts["通过！"].waitForExistence(timeout: 15), app.debugDescription)
        snapshot("原生 SQL 判分")
        app.terminate(); app.launch()
        XCTAssertTrue(editor.waitForExistence(timeout: 20)); XCTAssertEqual(editor.value as? String, sql)
        XCTAssertTrue(app.staticTexts["独立完成"].exists)
        snapshot("原生重开恢复")
        app.buttons["完成"].tap()
    }
    func testLessonTrapsAndReadOnlyHiveExample() throws {
        #if !targetEnvironment(simulator)
        throw XCTSkip("课程交互验收仅在模拟器执行")
        #endif
        launch(); search("数仓扫盲")
        app.buttons["数仓扫盲：看得懂事实表与维度表"].tap()
        let hive = app.staticTexts["Hive · 阅读示例（不在本机执行）"]
        reveal(hive)
        XCTAssertFalse(app.buttons["run-example-Hive"].exists)
        let copy = app.buttons["copy-example-Hive"]; reveal(copy); copy.tap()
        XCTAssertTrue(app.buttons["已复制示例"].exists)
        snapshot("Hive 阅读与复制")
        let trap = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "事实表记录")).firstMatch
        reveal(trap)
        XCTAssertTrue(app.staticTexts["易错点"].exists)
        snapshot("课程易错点")
        app.buttons["完成"].tap()
    }
    func testAssistedCompletionSyntaxErrorAndIndependentRedo() throws {
        #if !targetEnvironment(simulator)
        throw XCTSkip("写入训练记录的验收仅在模拟器执行")
        #endif
        launch(); search("价格排序的商品清单")
        app.buttons["question-q1"].tap()
        let editor = app.textViews["sql-editor"]
        let firstRedo = app.buttons["independent-redo"]; reveal(firstRedo); firstRedo.tap(); reveal(editor, upward: false)
        editor.tap(); editor.typeText("SELEC 1;")
        app.buttons["运行并判定"].tap()
        let syntax = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "语法错误：")).firstMatch
        XCTAssertTrue(syntax.waitForExistence(timeout: 15), app.debugDescription)
        snapshot("语法错误计入学习记录")
        let answer = app.buttons["参考答案与解析"]; reveal(answer); answer.tap()
        reveal(editor, upward: false); editor.tap(); editor.typeKey("a", modifierFlags: .command)
        let sql = "SELECT product_name, price FROM products ORDER BY price DESC;"
        editor.typeText(sql)
        app.buttons["运行并判定"].tap()
        XCTAssertTrue(app.staticTexts["辅助完成：请关闭答案后独立重做。"].waitForExistence(timeout: 15), app.debugDescription)
        snapshot("辅助完成")
        let redo = app.buttons["independent-redo"]; reveal(redo); redo.tap()
        XCTAssertEqual(editor.value as? String, "")
        editor.tap(); editor.typeText(sql)
        app.buttons["运行并判定"].tap()
        XCTAssertTrue(app.staticTexts["通过！"].waitForExistence(timeout: 15), app.debugDescription)
        app.terminate(); app.launch()
        XCTAssertTrue(editor.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["独立完成"].exists)
        XCTAssertEqual(editor.value as? String, sql)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "独立重做中：")).firstMatch.exists)
        snapshot("独立完成并重开恢复")
        app.buttons["完成"].tap()
    }
    func testProductDailyReadingAndDiagnosticPathPersist() throws {
        #if !targetEnvironment(simulator)
        throw XCTSkip("产品流程使用隔离模拟器")
        #endif
        launch(); app.buttons["今天"].tap()
        let next = app.buttons["daily-next"]; reveal(next); next.tap()
        let read = app.buttons["lesson-read"]; reveal(read); read.tap()
        XCTAssertTrue(app.buttons["本课已阅读"].exists)
        snapshot("今日课程已阅读与练习分离")
        app.buttons["完成"].tap()
        let path = app.buttons["learning-path"]; reveal(path); path.tap()
        app.buttons["diagnostic-start"].tap()
        for _ in 0..<4 { let skip = app.buttons["diagnostic-skip"]; reveal(skip); skip.tap() }
        XCTAssertTrue(app.staticTexts["diagnostic-result"].waitForExistence(timeout: 10))
        let save = app.buttons["path-save"]; reveal(save); save.tap()
        XCTAssertTrue(app.staticTexts["path-status"].waitForExistence(timeout: 10))
        snapshot("诊断结果与路径保存")
        app.terminate(); launch()
        app.buttons["今天"].tap(); reveal(path); path.tap()
        XCTAssertTrue(app.staticTexts["diagnostic-result"].exists)
        snapshot("诊断与路径重开恢复")
    }
    func testProductExamReviewOffersIndependentRetry() throws {
        #if !targetEnvironment(simulator)
        throw XCTSkip("周测写入仅在隔离模拟器执行")
        #endif
        launch(); app.buttons["测验"].tap(); app.buttons["开始周测"].tap()
        let submit = app.buttons["交卷"]; reveal(submit); submit.tap()
        let confirmation = app.sheets.buttons["交卷"]
        XCTAssertTrue(confirmation.waitForExistence(timeout: 10), app.debugDescription); confirmation.tap()
        XCTAssertTrue(app.buttons["开始周测"].waitForExistence(timeout: 15), app.debugDescription)
        let history = app.buttons["exam-history"]; XCTAssertTrue(history.waitForExistence(timeout: 15)); reveal(history); history.tap()
        let record = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "exam-record-")).firstMatch
        XCTAssertTrue(record.waitForExistence(timeout: 10)); record.tap()
        XCTAssertTrue(app.staticTexts["知识点失分"].waitForExistence(timeout: 10))
        let retry = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "exam-retry-")).firstMatch
        reveal(retry); snapshot("周测分值与错误复盘"); retry.tap()
        XCTAssertTrue(app.textViews["sql-editor"].waitForExistence(timeout: 10)); XCTAssertEqual(app.textViews["sql-editor"].value as? String, "")
        snapshot("周测独立复练")
    }
    func testProductDataCenterAndStoredReminderTime() throws {
        #if !targetEnvironment(simulator)
        throw XCTSkip("提醒偏好使用隔离模拟器")
        #endif
        app.terminate(); app.launchArguments = ["-native-reminder-hour", "9", "-native-reminder-minute", "37"]
        defer { app.launchArguments = [] }
        launch(); app.buttons["我的"].tap()
        let center = app.buttons["data-center"]; reveal(center); center.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "暂无记录")).firstMatch.waitForExistence(timeout: 10), app.debugDescription)
        let create = app.buttons["create-recovery"]; reveal(create); create.tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "restore-")).firstMatch.waitForExistence(timeout: 10))
        snapshot("数据中心与本机恢复点")
        app.navigationBars.buttons.firstMatch.tap()
        let reminderSettings = app.buttons["reminder-settings"]; reveal(reminderSettings); reminderSettings.tap()
        let reminder = app.staticTexts["reminder-status"]; reveal(reminder)
        XCTAssertTrue(reminder.label.contains("09:37"), reminder.label)
        snapshot("提醒回读已保存时间")
        app.terminate(); launch(); app.buttons["我的"].tap(); reveal(reminderSettings); reminderSettings.tap(); reveal(reminder)
        XCTAssertTrue(reminder.label.contains("09:37"), reminder.label)
    }
    func testRound4EditorSchemaFeedbackAndCompletion() throws {
        #if !targetEnvironment(simulator)
        throw XCTSkip("界面写入验收使用隔离模拟器")
        #endif
        launch(); search("价格排序的商品清单"); app.buttons["question-q1"].tap()
        let editor = app.textViews["sql-editor"]; XCTAssertTrue(editor.waitForExistence(timeout: 10))
        editor.tap(); editor.typeKey("a", modifierFlags: .command); editor.typeText(XCUIKeyboardKey.delete.rawValue)
        app.buttons["sql-dismiss-keyboard"].tap()
        app.buttons["show-question-data"].tap()
        let table = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "products ·")).firstMatch; reveal(table); table.tap()
        snapshot("第四轮-展开本题数据表")
        let price = app.buttons["insert-column-products-price"]; XCTAssertTrue(price.waitForExistence(timeout: 10), app.debugDescription); reveal(price); price.tap()
        reveal(editor, upward: false)
        XCTAssertEqual(editor.value as? String, "price")
        editor.tap(); editor.typeText("x")
        let editedText = editor.value as? String
        XCTAssertNotEqual(editedText, "price")
        app.buttons["撤销"].tap(); XCTAssertEqual(editor.value as? String, "price")
        app.buttons["重做"].tap(); XCTAssertEqual(editor.value as? String, editedText)
        snapshot("第四轮-本题字段与光标插入")
        app.buttons["sql-dismiss-keyboard"].tap(); reveal(editor, upward: false); editor.tap(); editor.typeKey("a", modifierFlags: .command)
        editor.typeText("SELECT product_name, price FROM products ORDER BY price ASC;")
        app.buttons["sql-dismiss-keyboard"].tap(); app.buttons["run-sql"].tap()
        XCTAssertTrue(app.staticTexts["feedback-kind"].waitForExistence(timeout: 15)); XCTAssertTrue(app.staticTexts["feedback-kind"].label.contains("排序不一致"))
        snapshot("第四轮-排序差异与对齐结果")
        reveal(editor, upward: false); editor.tap(); editor.typeKey("a", modifierFlags: .command)
        editor.typeText("SELECT product_name, price FROM products WHERE price > 999999;")
        app.buttons["sql-dismiss-keyboard"].tap(); app.buttons["run-sql"].tap()
        XCTAssertTrue(app.staticTexts["feedback-kind"].waitForExistence(timeout: 15)); XCTAssertTrue(app.staticTexts["feedback-kind"].label.contains("缺少记录"))
        let examples = app.buttons["difference-examples"]; reveal(examples); examples.tap(); snapshot("第四轮-缺行差异示例")
        reveal(editor, upward: false); editor.tap(); editor.typeKey("a", modifierFlags: .command)
        editor.typeText("SELECT product_name, price FROM products ORDER BY price DESC;")
        app.buttons["sql-dismiss-keyboard"].tap(); app.buttons["run-sql"].tap()
        let summary = app.staticTexts["session-summary"]; reveal(summary); XCTAssertTrue(summary.exists)
        snapshot("第四轮-通过后学习小结")
        let next = app.buttons["next-question"]; reveal(next); next.tap()
        XCTAssertTrue(app.textViews["sql-editor"].waitForExistence(timeout: 10)); XCTAssertFalse(app.staticTexts["session-summary"].exists)
        XCTAssertTrue(app.navigationBars["上海用户名单"].waitForExistence(timeout: 10))
    }
    func testRound4FavoritesFocusAndDraftRecovery() throws {
        #if !targetEnvironment(simulator)
        throw XCTSkip("收藏与草稿使用隔离模拟器")
        #endif
        launch(); search("价格排序的商品清单")
        let favorite = app.buttons["favorite-q1"]; XCTAssertTrue(favorite.waitForExistence(timeout: 10))
        if favorite.value as? String != "已收藏" { favorite.tap() }
        let category = app.segmentedControls["catalog-category"]; reveal(category, upward: false); category.buttons["收藏"].tap()
        XCTAssertTrue(app.buttons["question-q1"].exists); app.buttons["question-q1"].tap()
        let editor = app.textViews["sql-editor"]; editor.tap(); editor.typeKey("a", modifierFlags: .command); editor.typeText("SELECT (1 + 2) AS value;")
        app.buttons["sql-dismiss-keyboard"].tap(); app.buttons["sql-focus"].tap()
        XCTAssertTrue(app.buttons["返回题目"].exists); snapshot("第四轮-专注编辑")
        app.terminate(); app.launch()
        XCTAssertTrue(editor.waitForExistence(timeout: 20)); XCTAssertEqual(editor.value as? String, "SELECT (1 + 2) AS value;")
        XCTAssertEqual(app.buttons["favorite-q1"].value as? String, "已收藏")
        snapshot("第四轮-草稿与收藏重开恢复")
        app.buttons["完成"].tap(); app.buttons["今天"].tap(); snapshot("第四轮-首页任务层次")
        app.buttons["我的"].tap(); snapshot("第四轮-设置分组")
    }
    func testRound4GuideSectionsTablesAndResourceLinks() {
        launch(); app.buttons["训练"].tap()
        let cheat = app.buttons["语法速查"]; reveal(cheat); cheat.tap()
        let dates = app.buttons["guide-jump-section-3"]; XCTAssertTrue(dates.waitForExistence(timeout: 10)); dates.tap()
        let dateExample = app.staticTexts["用途: 今天"]
        XCTAssertTrue(dateExample.waitForExistence(timeout: 10) && dateExample.isHittable, app.debugDescription)
        snapshot("第四轮-方言对照表")
        app.navigationBars.buttons.firstMatch.tap()
        let plan = app.buttons["八周学习计划"]; reveal(plan); plan.tap()
        let weeks = app.buttons["guide-jump-section-2"]; XCTAssertTrue(weeks.waitForExistence(timeout: 10)); weeks.tap()
        let firstWeek = app.staticTexts["周: W1"]
        XCTAssertTrue(firstWeek.waitForExistence(timeout: 10) && firstWeek.isHittable, app.debugDescription); snapshot("第四轮-分节学习计划")
        let resources = app.buttons["guide-jump-section-5"]; reveal(resources, upward: false); resources.tap()
        XCTAssertTrue(app.links["SQLBolt"].exists || app.buttons["SQLBolt"].exists)
        snapshot("第四轮-可点击学习资源")
    }
}
