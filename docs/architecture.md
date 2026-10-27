# SQL Lab 架构

iOS 5.0 原生架构建立在现有 native-app Swift Package 上，Web 4.0 源码仍在 app/。

| 层 | iOS 实现 | 职责 |
| --- | --- | --- |
| 启动 | SceneDelegate + UIHostingController | 加载 SwiftUI 根页面 |
| 界面 | SQLLabUI | 今天、训练、测验、我的；原生导航、文本编辑、系统文件选择 |
| 应用状态 | LabModel / Observation | 训练闭环、草稿、周测、复习与成就 |
| 领域 | SQLLabCore | 结果判分、v1 进度规范化、记录修订与合并 |
| 引擎 | SQLExecutor actor + sqlite3 | 只读判题库、独立内存练习库、超时与资源限制 |
| 持久化 | ProgressStore | 原子写入、旧文件迁移、备份和恢复 |
| 同步 | CloudSync / SyncCipher / Keychain | 原生 URLSession、兼容 Web 加密、手动同步 |
| 内容 | 资源 JSON + training.sqlite | 从同仓库 Web 来源导出，运行时完全离线 |

原 iOS Capacitor 插件、WebView 控制器、Main storyboard 和 public 网页资源不参与当前构建；Xcode 只依赖本地 SQLLabUI Package 产品。资源导出脚本仍使用 Web 引擎生成确定性的种子数据库和判分基准，这属于构建期工具。

学习进度和本机会话共同写入 Application Support/SQLLab/native-learning.json。原 learning.json 保留不覆盖。跨端进度备份仍用旧 v1 结构，凭证放在 Keychain，草稿与周测试卷不进入云同步。业务修改先落盘再公布状态；坏数据和失败写入明确报错。

详细运行方法、功能覆盖、兼容规则和验收边界见 [原生说明](../native-app/README.md)。Web 的 Vite、Service Worker、发布分支与离线机制不受本次 iOS 迁移影响。
