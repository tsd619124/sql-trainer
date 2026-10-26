# SQL Lab iOS

版本 4.0.0，原生构建号 9，Bundle ID 为 `com.fengguanjia.sqllab`。本工程使用 Capacitor 8 与 Swift Package Manager，实际学习界面和训练核心来自同仓库的 Web App。目标运行环境为 iOS 15 及以上；实际系统兼容性仍需真机验收。

## 准备与运行

需要 Node.js 24、完整 Xcode 和对应的 iOS SDK。仅有 Apple Command Line Tools 可以运行部分静态检查，不能编译或启动 iOS 应用。

在仓库根目录运行：

```sh
npm ci
npm run ios:sync
npm run ios:open
```

Xcode 中选择 `App` scheme 和一个 iPhone 模拟器，点击 Run。首次打开需要解析锁定版本的 Capacitor Swift Package。

连接真实 iPhone 时，在 App target 的 Signing & Capabilities 中选择自己的 Development Team，保留或按自己的发布标识调整 Bundle ID，并按设备要求启用开发者模式。仓库没有设置开发者账号、签名证书或 provisioning profile。

## 原生功能

- `SQLLabNativePlugin.swift` 提供本机学习文件、Keychain 同步配置、系统学习提醒、备份分享、触感与前后台事件。
- `SQLLabViewController.swift` 注册插件；SceneDelegate 和 storyboard 均指向该入口。
- 学习文件位于应用私有 Application Support，采用原子替换；卸载应用前仍应导出备份。
- 提醒预排未来 30 天；每次打开自动补齐。权限被拒绝时在系统设置中调整；不需要推送服务器。
- 学习内容和 SQL 引擎随安装包提供，iOS 不注册 Web Service Worker，也不从远程地址加载应用代码。

## 迁入旧进度

在旧版 SQL Lab 或 Web App 的「我的 → 备份与迁移」导出 JSON，进入 iOS 客户端同一位置导入。原 v1 备份格式兼容。Web 与 iOS 的存储空间独立，不会自动读取浏览器中的学习记录。

Gist / LeanCloud 需要在客户端重新填写自己的同步配置。学习备份不携带令牌或密码；已经配置好的端到端加密同步使用相同同步码。

## 验证与交付状态

```sh
npm test
npm run test:app
npm run ios:sync
npm run ios:check
```

`ios:check` 校验 Swift 语法、项目与 plist、原生入口，以及 iOS 内嵌资源是否与 Web 清单一致。完整 Xcode 可用时会进一步执行不签名的模拟器构建。默认开发工具路径只有 Command Line Tools 时，脚本会尝试本机 `/Applications/Xcode.app`，不修改全局设置。报告写入 `output/release/ios-acceptance.json`；没有完整 SDK 时明确标记 `nativeBuild: false`。

当前已使用 Xcode 27.1 完成模拟器目标的真实原生编译，生成 `output/ios-derived/Build/Products/Debug-iphonesimulator/App.app`。本机尚无已安装的模拟器运行时，因此未启动运行；未生成已签名 IPA、未运行真实 iPhone，也未上传 App Store / TestFlight。该 `.app` 是模拟器构建，不能直接安装到 iPhone。

真机验收需要覆盖：首次打开、离线重开、答题判分、后台恢复草稿和周测、备份文件导入导出、通知授权及应用关闭后的提醒、软键盘安全区、深浅色和 VoiceOver。
