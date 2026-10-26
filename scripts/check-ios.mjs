import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const toolEnvironment = { ...process.env };
const defaultXcode = spawnSync('xcodebuild', ['-version'], { encoding: 'utf8', env: toolEnvironment });
if (defaultXcode.status !== 0 && !toolEnvironment.DEVELOPER_DIR) {
  const candidate = '/Applications/Xcode.app/Contents/Developer';
  const probe = spawnSync('xcodebuild', ['-version'], { encoding: 'utf8', env: { ...toolEnvironment, DEVELOPER_DIR: candidate } });
  if (probe.status === 0) toolEnvironment.DEVELOPER_DIR = candidate;
}
const report = { ok: false, nativeBuild: false, simulatorRun: false, deviceRun: false, signed: false, coverage: 'syntax-and-project', checkedAt: new Date().toISOString(), checks: [], limitations: [] };

function run(name, command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', env: toolEnvironment, maxBuffer: 20 * 1024 * 1024 });
  report.checks.push({ name, ok: result.status === 0, output: result.stdout + result.stderr });
  if (result.status !== 0) throw new Error(name + '未通过');
  return result.stdout;
}

try {
  run('Swift 语法', 'swiftc', ['-frontend', '-parse', 'ios/App/App/SQLLabNativePlugin.swift', 'ios/App/App/SQLLabViewController.swift', 'ios/App/App/AppDelegate.swift', 'ios/App/App/SceneDelegate.swift']);
  run('iOS 项目与配置', 'plutil', ['-lint', 'ios/App/App.xcodeproj/project.pbxproj', 'ios/App/App/Info.plist', 'ios/App/App/PrivacyInfo.xcprivacy']);
  const project = await readFile(resolve(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
  const scene = await readFile(resolve(root, 'ios/App/App/SceneDelegate.swift'), 'utf8');
  if (!scene.includes('rootViewController = SQLLabViewController()') || !project.includes('SQLLabNativePlugin.swift in Sources')) throw new Error('原生桥接未接入应用入口');
  const release = JSON.parse(await readFile(resolve(root, 'dist/release.json'), 'utf8'));
  for (const asset of release.assets) {
    const content = await readFile(resolve(root, 'ios/App/App/public', asset.path));
    if (createHash('sha256').update(content).digest('hex') !== asset.sha256) throw new Error('iOS 内容未与 Web 构建同步：' + asset.path);
  }
  report.checks.push({ name: '原生入口与 Web 资源同步', ok: true, assets: release.assets.length });
  const xcode = spawnSync('xcodebuild', ['-version'], { cwd: root, encoding: 'utf8', env: toolEnvironment });
  if (xcode.status === 0) {
    run('iOS 模拟器构建', 'xcodebuild', ['-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', 'output/ios-derived', 'CODE_SIGNING_ALLOWED=NO', 'build']);
    report.nativeBuild = true;
    report.coverage = 'simulator-build';
    report.limitations.push('完成模拟器目标编译，未运行模拟器或真机，未配置开发者签名或分发');
  } else {
    report.limitations.push('当前仅安装 Apple Command Line Tools，缺少完整 Xcode 与 iOS SDK，未执行 iOS 编译、模拟器或真机验收');
  }
  report.ok = true;
} catch (error) {
  report.failure = error.message;
} finally {
  await mkdir(resolve(root, 'output/release'), { recursive: true });
  await writeFile(resolve(root, 'output/release/ios-acceptance.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, checks: report.checks.map(check => ({ ...check, output: check.output?.slice(-1200) })) }, null, 2));
  if (!report.ok) process.exitCode = 1;
}
