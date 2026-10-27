# SQL Lab 原生架构

在已有 Swift Package 骨架上完成迁移。iOS 5.1.0（11），最低 iOS 17；Web 4.1 保持独立运行。

后续升级以常规 iPhone 为适配和验收目标，不安排折叠屏机型适配。

2026-10-28 前四轮合并发布状态、安装包和本次验证见 [RELEASE-5.1.0.md](RELEASE-5.1.0.md)。下方迁移时的 5.0 证据为历史记录。

2026-10-27 第一轮学习质量修复见 [QUALITY-ROUND1.md](QUALITY-ROUND1.md)：课程易错点、自然日移动平均、示例执行边界、独立重做与错误记录。该记录单独列出本轮验证范围，不沿用下方历史真机结果。

2026-10-27 第二轮产品完整性修复见 [QUALITY-ROUND2.md](QUALITY-ROUND2.md)：今日任务、阅读与掌握分层、入门诊断与路径、周测历史、能力档案、数据恢复与同步状态，以及提醒时间回显。新增学习记录需要另一端升级兼容实现，双端同步的模拟服务验证与真实账号验收分别记录。

2026-10-27 第三轮内容丰富度迭代见 [QUALITY-ROUND3.md](QUALITY-ROUND3.md)：42 道核心题各增加条件变化与综合迁移，另补齐连续登录、中位数、自连接、有序漏斗，以及选择辨析、结果预测、纠错、补全和可导出分析项目。新增 109 项训练通过同一内容导出进入原生资源，SQL 使用三组独立样本判分。

2026-10-27 第四轮原生界面优化见 [QUALITY-ROUND4.md](QUALITY-ROUND4.md)：首页任务层次、目录筛选与本机收藏、SQL 高亮与编辑辅助、本题字段与样例、对齐结果表格、分级差异反馈、结构化计划与速查，以及答题后训练接续。

## 模块

- SQLLabCore：课程数据、系统 SQLite 执行器、判分、v1 进度协议、原子文件存储、旧版数据迁移、AES-GCM 云同步。
- SQLLabUI：SwiftUI 四个主页面，课程、八周计划、语法速查、SQL 编辑与结果、表结构、模板、错题/复习、周测、档案、备份、提醒和同步设置。
- CSQLite：系统 sqlite3 模块映射，不安装第三方运行库。
- ios/App：既有 Xcode 工程承载原生入口，SceneDelegate → UIHostingController → SQLLabRootView。

App 构建不链接 Capacitor，不打包 HTML、JavaScript 或 WASM。原桥接源文件和 Web 工程仍保留在仓库作兼容参考，未参与原生 App 构建。

## 运行与验证

在仓库根目录：

    npm run native:resources
    npm run native:test
    npm run ios:open
    npm run ios:check
    npm run ios:test -- --simulator <UDID>
    npm run ios:archive

课程导出需要仓库已有 Node 依赖。导出脚本将 42 道核心题、109 项拓展、28 课、9 个模板、学习计划/速查和种子数据库固定进 Swift 资源；--check 核对当前 Web 源码及三组训练数据库和结果基准，不需要运行时执行 JavaScript。原生运行和编译不需要网络包依赖。

## 数据迁移与安全边界

首次启动读取 Application Support/SQLLab/learning.json 中既有的 sqltrain_state / sqltrain_session。原文件保留，验证成功后生成 native-learning.json。后续只读写原生文件。损坏数据阻止启动，不会自动清空。旧同步凭证通过相同 Keychain service/account 由运行中的 App 使用，不进入学习 JSON。

Web v1 JSON 和进度码兼容；备份只包含进度，草稿/周测会话留在本机。合并使用记录修订、删除标记及 reset 时钟。替换先留应急副本，撤销同时恢复草稿且生成新的修订时钟。每次文件提交成功后才更新内存。

SQL 在 actor 中串行运行。判题使用独立只读种子库，禁止外部文件访问、写入和多语句；自由练习使用独立内存库，每批 SQL 原子提交，失败回滚。查询有 2 秒、5000 行及 SQL 长度限制。

周测保留原截止时间，退出后继续计时；成绩保存与清除活动会话以同一次原子写入提交，以同一考试 ID 防重复交卷。自由练习数据库退出后重置，SQL 草稿继续保留。

云同步为用户手动触发，支持 Gist 与 LeanCloud；先读取并校验云端，再合并本地后加密上传。PBKDF2-SHA256 / AES-GCM 与 Web 兼容，配置保存在 Keychain；禁止跟随同步请求重定向。未增加后台自动同步或账号服务器。

## 验收边界

见 output/native-swift-test.log 和 iOS XCTest 结果。单元测试包含全部 42 题 Web 对照、只读隔离/批次回滚/超时、排序并列与重复行、旧数据迁移/备份/删除修订、周测恢复与幂等、跨语言加密及模拟云服务。

模拟器通过不代表物理 iPhone、VoiceOver、真实云服务和通知触发已验收。旧 4.0 IPA 的签名和设备验收不能用作当前 5.0 原生版证据。Web 的自动同步、每日快照、字号偏好未直接搬进原生设置：本版提供手动同步、导入前恢复副本及系统动态字体。

## 本次迁移验证（2026-10-27）

原生测试 13/13、模拟器 XCTest 2/2 通过；全部 42 题与 Web 结果基准一致。模拟器构建和 Release 归档成功，开发 IPA 已导出并通过 codesign 校验。包内无 HTML、JS、WASM 或 Capacitor 运行文件。5.0 已覆盖安装并启动于 iPhone 17 Pro Max（iOS 27.2），旧数据迁移比对一致；真机 XCTest 仍在连接阶段报 code 74，完整交互验收待完成。未发布 TestFlight/App Store。

汇总报告：output/release/native-migration.json（相对仓库根目录）。开发包：output/ios-native-release/export/App.ipa。

真机证据：output/device-native-acceptance/验收说明.md（相对仓库根目录）。

真机补充：用户完成 q1 判分并确认通过；设备进度、运行历史及重启后截图核对成功，草稿和进度重开保持一致。2026-10-27 补充完成备份合并往返的数据核对；通知到达、声音、点击打开 App 及 VoiceOver 基础流程由用户实测确认。Gist 原生同步曾报 TLS 安全连接失败，用户随后重试确认“已同步，云端与本机进度已合并”；同步后设备进度与会话保持一致，测试提醒已由用户确认关闭，VoiceOver 关闭状态已复核。本轮四项基础用例通过；双端云同步往返尚未验收，读屏动态判分未取得独立运行记录。证据层级和范围见 `output/device-feature-acceptance/20261027-1443/验收记录.md`，不能据此宣称全量云同步或无障碍验收通过。
