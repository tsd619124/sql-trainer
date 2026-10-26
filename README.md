# SQL Lab · Web 与 iOS 学习应用

当前工程版 **4.0.0**，Web 构建 **20261026.9**，iOS 构建号 **9**。基于 3.0.0 和前四批迭代迁移，保留 42 道 SQL 题、28 节微课、八周路径、周测、错题本、间隔复习、笔记、草稿、成就、备份与可选加密云同步。

新版采用独立内容、领域逻辑、SQL 引擎、存储、同步、设备能力和界面模块。Web 与 iOS 共用训练核心；iOS 使用 Capacitor 和 Swift 接入系统提醒、文件分享、触感与本机存储。设计和源码职责见 [应用架构](docs/architecture.md)，原生运行说明见 [iOS 文档](ios/README.md)。

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

## 运行 iOS

需要完整 Xcode 和 iOS SDK。在仓库根目录执行：

```sh
npm run ios:sync
npm run ios:open
```

在 Xcode 选择 App scheme 和 iPhone 模拟器运行。真实 iPhone 安装需要在 Signing & Capabilities 中选择自己的 Development Team；本工程没有设置开发者账号或签名证书。

iOS 常规学习数据写入应用私有文件，同步配置单独保存在 Keychain。学习提醒由系统预排未来 30 天，应用关闭后也可触发；每次打开、修改时间和当日完成训练后重新安排。Web 提醒仍仅在应用打开期间生效。

## 迁移已有进度

- 同域名、同部署目录升级 Web 时，继续读取原有 `sqltrain_*` 数据，保留草稿、课程位置和周测原截止时间。
- 换站点、从本地 HTML 迁到站点、从 Web 迁入 iOS 时，先在旧入口导出 JSON，再在新版「我的 → 备份与迁移」导入。
- 两端均配置相同 Gist / LeanCloud 和同步码后，可沿用已有加密同步；学习备份不携带认证配置。
- 导入、清空和快照恢复保留原有校验、应急备份和删除修订语义。

## 验收

浏览器回归需要 Python 3 和本机 Chrome；Playwright 引擎由项目依赖提供。

```sh
npm test
npm run build
npm run test:app
npm run ios:sync
npm run ios:check
```

结果写入 `output/release/app-acceptance.json` 和 `output/release/ios-acceptance.json`。覆盖内容保留、旧备份兼容、排序判分、数据库隔离、存储失败重试、草稿与周测恢复、模拟云同步、手机布局、子路径离线及多文件更新；iOS 的界面与原生接口衔接另做模拟桥接验证。

已完成真实 iOS 模拟器目标编译，产物为 `output/ios-derived/Build/Products/Debug-iphonesimulator/App.app`。本机没有已安装的模拟器运行时，尚未启动 iOS App；未签名、未真机验收或上架。模拟桥接和编译通过均不替代真实设备验收。

## 部署 Web

正式站点：<https://tsd619124.github.io/sql-trainer/>。源码保留在 `main`，GitHub Pages 从 `codex/web-release` 分支根目录发布完整构建。该分支只包含经过校验的正式资源和 `.nojekyll`。

已配置本仓库的 Git 与 GitHub CLI 认证时，执行 `npm run publish:web`。此命令先运行模块测试和正式构建，再校验清单内全部 SHA-256，将发布包推送至发布分支，并确认 Pages 来源。发布提交保留历史，可回退；命令不自动提交或推送源码改动。

将 `dist/` 整体部署到 HTTPS 站点，支持根目录和 `/sql-trainer/` 子目录。保持同源、同目录可沿用旧用户的本地进度。每次发布完整构建，不能只替换 HTML；`index.html`、`sw.js`、`release.json` 应重新校验，带哈希文件名的资源可长期缓存。

Service Worker 校验清单中的全部资源后才建立离线包。检查更新独立联网核对构建与页面哈希，新版由用户保存后切换，保留其他已打开标签页。iOS 安装包使用同步后的本地资源，不注册 Web Service Worker。

发布后应核对线上 `release.json` 的版本及全部资源哈希，并验证实际站点的判题、进度恢复、离线重开和旧版本更新。已安装旧版的用户可在「我的 → 关于与版本更新」检查更新，再选择「保存并更新」。

Web 发布不包含 iOS 商店分发；iOS 仍需签名和真实设备验收。本版面向个人学习，保留自配云同步，没有新增账号服务器或题库管理后台。

## 3.0 兼容入口

根目录 `index.html`、`sw.js`、`release.json` 与原 `deploy.sh` 保留为 3.0 单文件兼容版，旧发布脚本仅面向该版本。新版源码入口是 `app/`，部署入口是 `dist/`，不要用旧发布脚本发布 4.0。

原可靠性、手机与应用导航测试继续用于新版回归；旧版 PWA 发布夹具仍服务于 3.0。新版多文件发布与 iOS 桥接用例位于 `tests/web-app.browser.js`。
