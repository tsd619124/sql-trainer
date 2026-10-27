# SQL Lab 前四轮合并发布

日期：2026-10-28。源码仓库：`/Users/fengguanjia/sql-trainer`。

发布前现场核对：线上 Web 为 4.0.0（20261026.9），已连接 iPhone 安装的是原生 5.0.0（10）。第一至第四轮均为本地迭代，本次统一交付。

## 范围

| 轮次 | 纳入内容 | 实施记录 |
| --- | --- | --- |
| 第一轮 | 课程易错点、自然日移动平均、阅读示例边界、独立重做、学习错误记录。 | [QUALITY-ROUND1.md](QUALITY-ROUND1.md) |
| 第二轮 | 今日任务、诊断与学习路径、周测复盘、能力档案、恢复点、同步状态、提醒时间回读。 | [QUALITY-ROUND2.md](QUALITY-ROUND2.md) |
| 第三轮 | 109 项变式、专题、多题型训练与分析项目；业务、边界、空集三组 SQL 判分。 | [QUALITY-ROUND3.md](QUALITY-ROUND3.md) |
| 第四轮 | 原生首页与目录、高亮编辑与专注模式、题内数据、对齐表格、差异反馈、结构化计划速查、答题接续。 | [QUALITY-ROUND4.md](QUALITY-ROUND4.md) |

原生为完整四轮实现；Web 同步发布共享课程、判分、拓展训练和备份协议，不包含第四轮原生编辑器与界面。两端保留 42 道核心题、109 项拓展、28 节课、9 个模板和稳定内容 ID。

## 发布状态

| 目标 | 版本 | 状态 |
| --- | --- | --- |
| Web | 4.1.0，构建 20261028.1，缓存 sql-trainer-v29 | 已部署；11 项资源、Service Worker 与本地构建一致，线上训练回归通过。 |
| 原生 iOS | 5.1.0（11） | 开发签名版已交付；12 项界面流程逐项验收，已覆盖安装并启动于 iPhone，进度与草稿核对保留。 |
| 源码 main | 包含原生迁移及前四轮改动 | 四轮源码已在提交 `8ed43a2` 推送；最终交付记录与输入用例修订随本记录提交。 |

Web 地址：<https://tsd619124.github.io/sql-trainer/>。Pages 发布分支为 `codex/web-release`，发布提交为 `d7aca153b35bc0079467aff56301d1170ae78ef9`。

## 合并验证

| 检查 | 结果 | 证据（相对仓库根目录） |
| --- | --- | --- |
| JavaScript 可靠性与模块测试 | 55/55 通过。 | `output/combined-release-20261028/web-tests.log` |
| Swift 核心与集成测试 | 最后原生修订后 41/41 通过。 | `output/combined-release-20261028/native-tests-final.log` |
| Web 浏览器 | 6 组通过，含 147 项布局检查、备份、模拟同步、离线、更新及拓展训练。 | `output/combined-release-20261028/browser-final.log` |
| 线上浏览器 | 可靠性与拓展训练两组通过；使用隔离浏览器数据。 | `output/combined-release-20261028/online-browser.log` |
| 线上资源 | 版本、11 项资源 SHA-256 与字节数、Service Worker 均与正式构建一致。 | `output/combined-release-20261028/online-resources.json` |
| iOS 页面流程 | 12 项均有通过记录：全套运行通过 11 项，修订后的输入用例定向复验通过 1 项；来自两个结果包。 | `output/combined-release-20261028/ios-ui-final.json` |
| 最终签名包 | Release 归档、导出及 codesign 严格校验通过；12 项资源逐字节一致，包内无 Web 运行文件。 | `output/combined-release-20261028/package-verification-final.json` |
| iPhone 升级 | iPhone 17 Pro Max / iOS 27.2 已安装 5.1.0（11）并启动，已查看真实设备截图；旧进度逐字段一致，旧会话和 SQL 草稿完整保留，仅新增今日计划。 | `output/combined-release-20261028/device-upgrade-final.json` |

发布前检查修复了首页任务依赖场景激活时机、部分启动不生成计划的问题：进入首页时立即准备今日任务，仍保留前台恢复与跨日检查。另统一 Web 页头、发布清单、离线缓存和更新测试夹具的版本；发布脚本增加页头版本校验。旧 UI 用例适配第四轮结果区位置、系统确认面板与组合读屏文本，保留原有业务断言。

最终常规 iPhone 全套执行 12 项，11 项通过、1 项失败、0 项跳过，记录在 `ios-ui-standard-preflight.json`。唯一失败的拓展 SQL 用例在输入框尚未完整可见时打字，未保持键盘焦点；修订测试使其先滚动至可见区域并等待键盘工具栏，再输入同一 SQL。该用例在 `ios-ui-input-final.xcresult` 中单独复验 1/1 通过，业务、边界、空集三组判分断言保留。12 项覆盖来自全套与定向复验，不能表述为单次全套 12/12；归档后的产品代码未再修改。

首次合并 UI 运行发现问题并被中止，记录在 `output/combined-release-20261028/ios-ui-preflight.json`；该运行不能作为全套通过证据。资源压力解除后，独立的 iPhone Duo / iOS 27.1 运行仍有导航定位失败，该次已取消并保留于 `ios-ui-foldable-preflight.json`，不作为通过证据。最终复验改用独立的 SQLLab-5.1-StandardRelease / iPhone 18 Pro / iOS 27.0。按用户要求，后续升级以常规 iPhone 为目标，不安排折叠屏适配。其他项目的运行设备未作重启或关闭。

原生资源指纹：`bb29fdbf29ac589e040771688daf371dc2f6b3f8728107f0d9bb1cc30e151471`。版本说明更新会改变来源指纹；内容数量与稳定 ID 保持上述范围。

## 安装包与设备证据

- 最终开发 IPA：[App.ipa](../output/ios-native-5.1.0-11-final/export/App.ipa)，763246 字节，SHA-256 为 `3ab4326a66522182d773e2c7980c30c15a0b222dab493df0841809252f71b15f`。
- Release 归档：[SQLLab.xcarchive](../output/ios-native-5.1.0-11-final/SQLLab.xcarchive)。Team 为 `WKLUN9KP86`，描述文件包含已连接 iPhone。
- 本次覆盖安装使用最终 IPA 解压出的 App.app，未卸载旧应用。安装前重新读取最新存档，启动后核对 `state` 完全一致，`session` 原有字段全部保留，新增 `dailyPlan`。
- [设备安装结果](../output/combined-release-20261028/device-install-final.json)、[安装版本](../output/combined-release-20261028/device-app-final.json)、[启动结果](../output/combined-release-20261028/device-launch-final.json)、[真实设备截图](../output/combined-release-20261028/device-final-screen.png)。截图为深色模式「我的」页面，保留 1 道独立完成记录。
- 已查看本次模拟器的[首页任务](../output/release/ios-simulator-2026-10-27T17-14-38-259Z-attachments/8D66BA55-B112-450B-A865-5CB70545B1FF.png)、[排序反馈与表格](../output/release/ios-simulator-2026-10-27T17-14-38-259Z-attachments/65A2850D-200D-4D0C-B799-18767D87B860.png)及[拓展 SQL 三组判分](../output/combined-release-20261028/ios-ui-input-final-attachments/3B424A12-72B3-440D-A936-43569CE65AB6.png)截图。
- `output/ios-native-5.1.0-11-release/` 为启动时机修复前的预检包，未用于本次设备升级；其 `package-verification.json` 不作为最终交付证据。

## 交付边界

本次沿用开发签名分发，未上传 TestFlight / App Store。当前开发描述文件于北京时间 2026-11-03 12:36:47 到期；届时需重新签名安装。旧 5.0 安装包保留在 `output/ios-native-release/`。

本次真机验证范围为覆盖安装、已装版本、启动、可见界面及原有进度与草稿保持，未执行完整真机触控流程、真实账号的双设备云同步往返、通知实际触发或 VoiceOver。模拟云服务、浏览器与模拟器结果不能代替这些验收；更早轮次的真机记录不计为本次新版本通过。
