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
| 原生 iOS | 5.1.0（11） | 正在完成最终模拟器复验、Release 归档与设备升级。 |
| 源码 main | 包含原生迁移及前四轮改动 | 最终验证后统一提交、推送。 |

Web 地址：<https://tsd619124.github.io/sql-trainer/>。Pages 发布分支为 `codex/web-release`，发布提交为 `d7aca153b35bc0079467aff56301d1170ae78ef9`。

## 合并验证

| 检查 | 结果 | 证据（相对仓库根目录） |
| --- | --- | --- |
| JavaScript 可靠性与模块测试 | 55/55 通过。 | `output/combined-release-20261028/web-tests.log` |
| Swift 核心与集成测试 | 最后原生修订后 41/41 通过。 | `output/combined-release-20261028/native-tests-final.log` |
| Web 浏览器 | 6 组通过，含 147 项布局检查、备份、模拟同步、离线、更新及拓展训练。 | `output/combined-release-20261028/browser-final.log` |
| 线上浏览器 | 可靠性与拓展训练两组通过；使用隔离浏览器数据。 | `output/combined-release-20261028/online-browser.log` |
| 线上资源 | 版本、11 项资源 SHA-256 与字节数、Service Worker 均与正式构建一致。 | `output/combined-release-20261028/online-resources.json` |
| iOS 页面流程 | 最终复验进行中。 | `output/combined-release-20261028/ios-ui-final-run.log` |
| 最终签名包与设备 | 最终归档、导出、安装与启动待核验。 | `output/combined-release-20261028/` |

发布前检查修复了首页任务依赖场景激活时机、部分启动不生成计划的问题：进入首页时立即准备今日任务，仍保留前台恢复与跨日检查。另统一 Web 页头、发布清单、离线缓存和更新测试夹具的版本；发布脚本增加页头版本校验。旧 UI 用例适配第四轮结果区位置、系统确认面板与组合读屏文本，保留原有业务断言。

首次合并 UI 运行发现问题并被中止，记录在 `output/combined-release-20261028/ios-ui-preflight.json`；该运行不能作为全套通过证据。原 iOS 27.0 隔离模拟器随后遇到启动服务故障，最终复验使用独立的 SQLLab-5.1-Release / iPhone Duo / iOS 27.1。其他项目的运行设备未作重启或关闭。

原生资源指纹：`bb29fdbf29ac589e040771688daf371dc2f6b3f8728107f0d9bb1cc30e151471`。版本说明更新会改变来源指纹；内容数量与稳定 ID 保持上述范围。

## 交付边界

本次沿用开发签名分发，未上传 TestFlight / App Store。当前开发描述文件于北京时间 2026-11-03 12:36:47 到期；届时需重新签名安装。旧 5.0 安装包保留在 `output/ios-native-release/`。

本次未验证真实账号的双设备云同步往返、通知实际触发或 VoiceOver。模拟云服务、浏览器与模拟器结果不能代替这些验收；更早轮次的真机记录不计为本次新版本通过。
