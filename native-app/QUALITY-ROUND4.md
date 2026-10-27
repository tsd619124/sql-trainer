# 第四轮：原生界面与高频操作

实施日期：2026-10-27；验证完成于 2026-10-28。接续第三轮的 SQL Lab 5.0 原生工程，源码位于 `/Users/fengguanjia/sql-trainer/native-app`。当前聊天的 Documents 目录继续保留兼容 HTML 与设计稿。

## 本轮实现

| 页面或环节 | 实际行为 |
| --- | --- |
| 首页 | 优先呈现继续学习、今日下一项和到期复习。任务清单、记录规则与八周路径按需展开；复习先显示三题，可进入全部列表。 |
| 课程与题库 | 用课程、题库、收藏切换减少连续排列；核心与拓展库均可按知识点、阶段难度、完成状态和收藏筛选。搜索覆盖题干、提示、知识点及个人笔记，多词同时匹配。课程还检索目标、正文、示例和关联练习笔记。 |
| SQL 编辑 | iOS 使用系统 UITextView，提供 SQL 关键字、字符串、注释和数字高亮、换行缩进、括号与引号配对、匹配括号标记、常用符号、撤销重做及专注编辑。保留系统文本选择和本机草稿保存；自由练习、诊断和周测共用输入组件。 |
| 本题数据 | 不离开题目即可展开相关表的字段、真实声明类型、示例值、最多五行样例与关联说明；点按字段插入 SQL 光标位置。完整表结构入口沿用相同组件。 |
| 查询结果 | 表头与数据使用一致列宽，数字右对齐；NULL、数字与日期有不同文字颜色和读屏标签。宽表在局部横向滚动，空结果保留列名，最多显示 200 行；复制导出全部查询行，单元格内制表符、引号和换行正确转义。 |
| 判题反馈 | 区分列数、缺行、多行、值和排序差异；显示实际与预期行列数、检查方向和按需展开的差异示例。重复行按次数比较，数值和字符串复用现有判分归一化；排序并列规则保持一致。拓展题说明具体失败样本，示例来自该样本。另提供两级思路提示。 |
| 计划与速查 | 从现有来源导出结构化分节、原始表格单元格和资源 URL；增加可跳转目录、可折叠正文、方言对照表及系统链接。保留原文与检查清单，不在手机端用分隔符重新拆分 SQL 运算符。 |
| 完成一道题后 | 显示本题本次作答次数、完成层次和下次复习日；可进入下一题、同类变式、继续到期复习或结束本次学习。切题重建编辑状态，结束清除续学入口并保留草稿。客观题使用相同后续操作。 |
| 我的 | 关键学习统计保留首层，阅读与掌握明细、成就按需展开；备份、提醒进入各自设置页，数据与同步中心继续独立可达。 |

## 数据和适用范围

- 保留四个主导航、42 道核心题、109 项拓展、28 课、9 个模板及现有稳定 ID。不调整题目、答案、成绩规则和同步协议。
- 收藏属于本机会话，重开应用保留；不进入进度 JSON 备份或跨设备同步。替换进度仍沿用原有清空本机会话与恢复点规则。
- 阶段难度为现有知识路径的归类：W1–2 基础、W3–5 进阶、W6–8 综合，并非重新测定每题难度。
- 差异示例按需显示，每类最多三行；它提供结果对照，不自动展开 SQL 参考答案。查看 SQL 答案仍计为辅助作答。
- 语法高亮与编辑辅助主要交付 iOS；macOS Swift Package 测试保留普通 TextEditor 回退，不能用 macOS 编译代替 iOS 交互验收。

## 验证

- Swift 原生测试：41/41 通过，含本轮新增 8 项：差异分类、重复行与示例上限、真实表字段与查询边界、组合搜索、收藏恢复、SQL 词法与 Unicode、结构化文档与链接、复制转义及训练接续。日志为 [native-tests-final.log](../output/round4/native-tests-final.log)。
- iOS 模拟器 App 与 UI 测试目标编译通过。新增三条界面流程分别通过，具体范围见下表。它们来自两个结果包，不表示整套既有 UI 测试已通过。
- 内容导出一致性检查通过，保留 42 道核心题、109 项拓展、28 课、9 个模板。来源指纹为 `a9358efcb1bf38afaed9ed311222c8709299083ff22db2f4677adfc9216300bc`；最终 App 包内 12 个资源文件与源码逐字节一致。
- 使用隔离模拟器 SQLLab-Interface-Round4（`096801CB-5D96-4B51-A9FA-DD775290744D`），机型 iPhone 18 Pro / iOS 27.0。构建目录为 `output/ios-round4/`，未操作其他产品的模拟器和个人学习存档。

| 新增界面用例 | 已验证行为 | 结果与证据 |
| --- | --- | --- |
| `testRound4EditorSchemaFeedbackAndCompletion` | 展开题内字段，离屏插入字段，撤销与重做，排序差异，缺行示例，正确答案后的学习小结，以及进入下一题“上海用户名单”。 | 通过；[interface-final-ui.log](../output/round4/interface-final-ui.log)，[结果包](../output/round4/interface-final-ui.xcresult)。 |
| `testRound4FavoritesFocusAndDraftRecovery` | 收藏筛选、专注编辑、终止并重开 App 后恢复 SQL 草稿与收藏，以及首页和设置页导航。 | 通过；与上一项使用同一结果包。 |
| `testRound4GuideSectionsTablesAndResourceLinks` | 从目录直接定位并展开日期函数和八周计划，核对表格首行在屏幕内，进入资源节并找到 SQLBolt 链接。 | 修复后通过；[guide-final-ui.log](../output/round4/guide-final-ui.log)，[结果包](../output/round4/guide-final-ui.xcresult)。未通过点击链接访问外部网站。 |

`interface-final-ui.xcresult` 中前两项通过，目录用例失败。该失败揭示目录项与正文共用了滚动标识；修复正文锚点后，使用 `guide-final-ui.xcresult` 单独复验通过。此前的初次组合回归还通过了四导航和选择题独立重做两项，另一项在连接阶段取消；日志与中间结果保留于 `output/round4/`，不计作整套通过。连接曾卡住，仅重启了本轮隔离模拟器。

## 截图核对

已导出并查看以下模拟器截图。它们是本轮运行结果，不是设计示意图。

| 页面或环节 | 截图 |
| --- | --- |
| 首页与设置 | [首页任务层次](../output/round4/interface-final-attachments/3540C00C-77A6-4568-9DFE-6B5730185228.png)、[设置分组](../output/round4/interface-final-attachments/36B0D33E-8D8D-4B80-B4C5-928AAEBAD51E.png) |
| SQL 编辑 | [高亮与专注编辑](../output/round4/interface-final-attachments/9F6ED2C9-BA1B-49B0-95B8-A3FDADCE2E4B.png)、[草稿与收藏重开恢复](../output/round4/interface-final-attachments/93BE9DBE-D02C-447D-A00E-12E26DBDE6CA.png) |
| 题内数据与反馈 | [字段与类型](../output/round4/interface-final-attachments/4957AF64-D822-475A-BB2F-2202114C83E4.png)、[排序差异与对齐结果](../output/round4/interface-final-attachments/D424DC85-E813-4DF0-BED6-2AA24842B423.png)、[缺行示例](../output/round4/interface-final-attachments/053BB146-0906-4DAC-B011-3528C35590B2.png) |
| 答题接续 | [学习小结与后续操作](../output/round4/interface-final-attachments/9CF14815-E83A-40F9-AEA7-5FDFE002DCDB.png) |
| 计划与速查 | [日期函数表](../output/round4/guide-accepted/2D069BB2-4855-44B0-9129-945FE466E8D9.png)、[八周计划](../output/round4/guide-accepted/91FFEAF5-5FA6-47AF-B542-70335976B1DD.png)、[资源链接](../output/round4/guide-accepted/4B516462-636A-4BAD-AB13-9250606B34F6.png) |

本轮未提交、推送、部署、更新真机安装包或执行真实云服务、通知触发、VoiceOver 验收。更早轮次的设备记录不作为本轮通过证据。
