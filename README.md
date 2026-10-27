# SQL Lab · 原生 iOS 与 Web 学习应用

iOS 当前版本为 **5.1.0（11）原生架构**：SwiftUI + Swift 领域逻辑 + 系统 SQLite，基于现有 native-app 骨架继续完成。配套 Web 为 4.1.0。保留 42 道核心题、28 节课程和 9 个模板，新增 109 项拓展训练。

前四轮的合并发布状态、安装包和验证记录见 [合并发布记录](native-app/RELEASE-5.1.0.md)。

当前源码与验收边界以[原生说明](native-app/README.md)、[iOS 运行说明](ios/README.md)和[架构文档](docs/architecture.md)为准。下方 4.0 真机记录属于历史验证，不适用于新原生版。

第一轮学习质量修复与独立验收见 [native-app/QUALITY-ROUND1.md](native-app/QUALITY-ROUND1.md)，涵盖课程易错点、自然日移动平均、示例执行边界、独立重做和学习错误记录。

第三轮内容丰富度迭代见 [native-app/QUALITY-ROUND3.md](native-app/QUALITY-ROUND3.md)：保留 42 道核心题，新增 84 道分层变式、8 道独立专题、16 道多题型训练和 1 个综合项目。Web 与原生在「训练 → 变式与专题训练」进入，SQL 使用业务、边界、空集三组数据；拓展完成不增加核心题通过数。

## 5.0 原生迁移历史记录

13 项原生测试与 2 项模拟器端到端测试通过，42 题结果与 Web 基准一致。5.0.0（10）开发签名包已生成于 output/ios-native-release/export/App.ipa，签名校验通过，已在 iPhone 17 Pro Max 安装启动；旧数据迁移比对一致，完整真机交互验收仍待完成。汇总见 output/release/native-migration.json。

## 运行 Web App

需要 Node.js 24 或更高版本。

```sh
npm ci
npm run dev
```

开发服务器打印本次使用的地址。正式构建与本地预览：

```sh
npm run build
npm run preview
```

构建输出为 `dist/`，其中包含独立的 JS、CSS、SQL.js、WASM、图标、manifest、SHA-256 资源清单和 Service Worker。所有训练资源均由本站提供，离线运行不依赖 CDN。

## 运行原生 iOS

需要完整 Xcode 和 iOS SDK。在仓库根目录执行：

```sh
npm run ios:sync
npm run ios:open
```

在 Xcode 选择 App scheme 和 iPhone 模拟器运行。工程已配置本机验证使用的 Development Team `WKLUN9KP86`；更换账号时，在 Signing & Capabilities 和 `ios/ExportOptions.plist` 中调整 Team。证书、私钥和 provisioning profile 由本机 Xcode 管理。

开发签名归档与 IPA 导出：

```sh
npm run ios:archive
```

产物为 `output/ios-native-release/SQLLab.xcarchive` 和 `output/ios-native-release/export/App.ipa`，仅用于开发设备安装。

iOS 通过 SwiftUI 原生界面运行，首次启动自动读取并保留旧 learning.json；学习数据进入 native-learning.json，认证配置仍在 Keychain。原生提醒由系统调度，云同步为手动触发。

## 迁移已有进度

- 同域名、同部署目录升级 Web 时，继续读取原有 `sqltrain_*` 数据，保留草稿、课程位置和周测原截止时间。
- 换站点、从本地 HTML 迁到站点、从 Web 迁入 iOS 时，先在旧入口导出 JSON，再在新版「我的 → 备份与迁移」导入。
- 两端均配置相同 Gist / LeanCloud 和同步码后，可沿用已有加密同步；学习备份不携带认证配置。
- 导入、清空和快照恢复保留原有校验、应急备份和删除修订语义。

## 验收（下列 4.0 数据为迁移前历史记录）

浏览器回归需要 Python 3 和本机 Chrome；Playwright 引擎由项目依赖提供。

```sh
npm test
npm run build
npm run test:app
npm run ios:sync
npm run ios:check
```

结果写入 `output/release/app-acceptance.json` 和 `output/release/ios-acceptance.json`。覆盖内容保留、旧备份兼容、排序判分、数据库隔离、存储失败重试、草稿与周测恢复、模拟云同步、手机布局、子路径离线及多文件更新；iOS 的界面与原生接口衔接另做模拟桥接验证。

2026-10-27 已完成模拟器编译、安装和运行，iOS 27.1 模拟器的两项 XCTest 通过：四个主页面导航，以及输入 SQL、真实引擎判分、后台退出后重开保留草稿与通过记录。使用 `npm run ios:test -- --simulator <UDID>` 复验，报告为 `output/release/ios-simulator-run.json`，截图保存在该报告引用的附件目录。

已生成通过签名校验的 Release 开发 IPA，并将导出包安装、启动到 iPhone 17 Pro Max（iOS 27.2）。当前 provisioning profile 于北京时间 **2026-11-03 12:36:47** 到期，届时需要重新签名安装。真机 XCTest 在无线和 USB 连接下均在测试驱动连接阶段失败（runner code 74）；真机页面触控、SQL 判分及完整功能验收仍待完成，失败证据记录在 `output/release/ios-device-run.json`。尚未上传 App Store / TestFlight。

## 部署 Web

正式站点：<https://tsd619124.github.io/sql-trainer/>。源码保留在 `main`，GitHub Pages 从 `codex/web-release` 分支根目录发布完整构建。该分支只包含经过校验的正式资源和 `.nojekyll`。

已配置本仓库的 Git 与 GitHub CLI 认证时，执行 `npm run publish:web`。此命令先运行模块测试和正式构建，再校验清单内全部 SHA-256，将发布包推送至发布分支，并确认 Pages 来源。发布提交保留历史，可回退；命令不自动提交或推送源码改动。

将 `dist/` 整体部署到 HTTPS 站点，支持根目录和 `/sql-trainer/` 子目录。保持同源、同目录可沿用旧用户的本地进度。每次发布完整构建，不能只替换 HTML；`index.html`、`sw.js`、`release.json` 应重新校验，带哈希文件名的资源可长期缓存。

Service Worker 校验清单中的全部资源后才建立离线包。检查更新独立联网核对构建与页面哈希，新版由用户保存后切换，保留其他已打开标签页。iOS 安装包使用同步后的本地资源，不注册 Web Service Worker。

发布后应核对线上 `release.json` 的版本及全部资源哈希，并验证实际站点的判题、进度恢复、离线重开和旧版本更新。已安装旧版的用户可在「我的 → 关于与版本更新」检查更新，再选择「保存并更新」。

Web 发布不包含 iOS 商店分发；iOS 开发安装包的完整真机验收和商店分发另行完成。本版面向个人学习，保留自配云同步，没有新增账号服务器或题库管理后台。

## 3.0 兼容入口

根目录 `index.html`、`sw.js`、`release.json` 与原 `deploy.sh` 保留为 3.0 单文件兼容版，旧发布脚本仅面向该版本。新版源码入口是 `app/`，部署入口是 `dist/`，不要用旧发布脚本发布 4.0。

原可靠性、手机与应用导航测试继续用于新版回归；旧版 PWA 发布夹具仍服务于 3.0。新版多文件发布与 iOS 桥接用例位于 `tests/web-app.browser.js`。
