# SQL Lab 原生 iOS

版本 5.1.0（11），Bundle ID com.fengguanjia.sqllab，最低 iOS 17。沿用既有 Xcode 工程、图标、启动画面、签名配置和 XCTest target，学习界面与业务改为本地 Swift Package。

2026-10-28 前四轮合并发布状态、版本化安装包和本次验证见 [合并发布记录](../native-app/RELEASE-5.1.0.md)。

## 开发运行

    npm run ios:sync
    npm run ios:open

以上命令在仓库根目录执行。ios:sync 现在导出原生课程资源，不再执行 Capacitor 同步。在 Xcode 选择 App scheme 和 iPhone 模拟器运行。工程只引用 ../../native-app，无远程 Swift 包依赖。

    npm run native:test
    npm run ios:check
    npm run ios:test -- --simulator <UDID>

ios:check 校验内容来源、核心测试、无 Web 容器依赖及 iOS 模拟器编译，输出 output/release/ios-native-acceptance.json。ios:test 运行原生导航、SQL 判分和重开保留草稿测试。

## 开发签名包

    npm run ios:archive

产物位于 output/ios-native-release/SQLLab.xcarchive 和 output/ios-native-release/export/App.ipa。使用既有开发签名配置，证书由 Xcode 管理。此命令不安装到手机、不上传 TestFlight 或 App Store；开发包仍受设备授权和签名有效期约束。

## 数据与兼容

同 Bundle ID 升级安装时，原生存储层从旧 SQLLab/learning.json 自动迁移进度及会话到 native-learning.json，旧文件完整保留。不能通过先卸载旧 App 的方式迁移，否则应用私有数据会被系统删除。Web 用户在「我的 → 备份与迁移」导入 JSON；跨端支持手动 Gist/LeanCloud 同步，凭证在 Keychain。

迁移实现和功能差异见 [原生说明](../native-app/README.md)。原桥接 Swift 文件、CapApp-SPM 和 Main.storyboard 仅作兼容源码保留，当前 App 不编译或加载它们。

## 旧版验收

2026-10-27 的 4.0.0（9）开发签名包曾在 iPhone 安装启动，真机 XCTest 报 runner code 74。这是旧 Web 容器版本记录，不能证明 5.0 原生版已完成真机验收。新结果以本次原生测试报告为准。

## 本次迁移验证（2026-10-27）

原生测试 13/13、模拟器 XCTest 2/2 通过；全部 42 题与 Web 结果基准一致。模拟器构建和 Release 归档成功，开发 IPA 已导出并通过 codesign 校验。包内无 HTML、JS、WASM 或 Capacitor 运行文件。5.0 已覆盖安装并启动于 iPhone 17 Pro Max（iOS 27.2），旧数据迁移比对一致；真机 XCTest 仍在连接阶段报 code 74，完整交互验收待完成。未发布 TestFlight/App Store。

汇总报告：output/release/native-migration.json（相对仓库根目录）。开发包：output/ios-native-release/export/App.ipa。

真机证据：output/device-native-acceptance/验收说明.md（相对仓库根目录）。

真机补充：用户完成 q1 判分并确认通过；设备进度、运行历史及重启后截图核对成功，草稿和进度重开保持一致。2026-10-27 补充完成备份合并往返的数据核对；通知到达、声音、点击打开 App 及 VoiceOver 基础流程由用户实测确认。Gist 原生同步曾报 TLS 安全连接失败，用户随后重试确认“已同步，云端与本机进度已合并”；同步后设备进度与会话保持一致，测试提醒已由用户确认关闭，VoiceOver 关闭状态已复核。本轮四项基础用例通过；双端云同步往返尚未验收，读屏动态判分未取得独立运行记录。证据层级和范围见 `output/device-feature-acceptance/20261027-1443/验收记录.md`，不能据此宣称全量云同步或无障碍验收通过。
