import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const report = { ok: false, nativeBuild: false, architecture: 'SwiftUI + Swift + system SQLite', checkedAt: new Date().toISOString(), checks: [], limitations: ['此命令不验证签名、设备运行、云端服务或通知触发'] };
function run(name, command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
  report.checks.push({ name, ok: result.status === 0, output: (result.stdout + result.stderr).slice(-3000) });
  if (result.status !== 0) throw new Error(name + '未通过');
}
try {
  run('内置课程与 Web 来源一致', 'node', ['native-app/scripts/export-content.mjs', '--check']);
  run('原生核心与迁移测试', 'swift', ['test', '--package-path', 'native-app']);
  run('项目配置', 'plutil', ['-lint', 'ios/App/App.xcodeproj/project.pbxproj', 'ios/App/App/Info.plist']);
  const project = await readFile(resolve(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
  const scene = await readFile(resolve(root, 'ios/App/App/SceneDelegate.swift'), 'utf8');
  if (!scene.includes('UIHostingController(rootView: SQLLabRootView())') || !project.includes('../../native-app') || /CapApp-SPM in Frameworks|public in Resources|SQLLabNativePlugin.swift in Sources/.test(project)) throw new Error('iOS 入口仍包含 Web 容器依赖');
  report.checks.push({ name: '原生入口，无 WebView / Capacitor 运行依赖', ok: true });
  run('iOS 模拟器构建', 'xcodebuild', ['-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', 'output/ios-native-check', 'CODE_SIGNING_ALLOWED=NO', 'build']);
  report.nativeBuild = true; report.ok = true;
} catch (error) { report.failure = error.message; process.exitCode = 1; }
await mkdir(resolve(root, 'output/release'), { recursive: true });
await writeFile(resolve(root, 'output/release/ios-native-acceptance.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
