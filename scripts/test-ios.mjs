import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const { values } = parseArgs({ options: { simulator: { type: 'string' }, device: { type: 'string' } } });
if (Boolean(values.simulator) === Boolean(values.device)) {
  throw new Error('请指定一个目标：npm run ios:test -- --simulator <UDID> 或 --device <UDID>');
}

const root = fileURLToPath(new URL('..', import.meta.url));
const target = values.simulator ? 'simulator' : 'device';
const identifier = values.simulator || values.device;
const directory = resolve(root, 'output/release');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const resultBundle = resolve(directory, `ios-${target}-${stamp}.xcresult`);
const logPath = resolve(directory, `ios-${target}-${stamp}.log`);
const reportPath = resolve(directory, `ios-${target}-run.json`);
const expectedTests = target === 'simulator'
  ? [...(await readFile(resolve(root, 'ios/App/AppUITests/SQLLabUITests.swift'), 'utf8')).matchAll(/\bfunc test\w+\(/g)].length
  : 1;
const environment = { ...process.env };
if (!environment.DEVELOPER_DIR && spawnSync('xcodebuild', ['-version'], { encoding: 'utf8' }).status !== 0) {
  environment.DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';
}
const report = {
  ok: false,
  checkedAt: new Date().toISOString(),
  coverage: target === 'simulator' ? 'simulator-ui-training' : 'device-ui-navigation',
  target: identifier,
  resultBundle,
  logPath,
  expectedTests,
  limitations: [
    '未覆盖 VoiceOver、通知触发、备份文件往返和真实云同步',
    ...(target === 'device' ? ['真机自动验收不写入训练记录；SQL 判分和草稿重开测试仅在模拟器运行'] : []),
  ],
};

await mkdir(directory, { recursive: true });
try {
  console.log(`正在执行 ${target === 'simulator' ? '模拟器训练流程' : '真机页面导航'}验收，日志：${logPath}`);
  const args = [
    '-project', 'ios/App/App.xcodeproj', '-scheme', 'App', '-configuration', 'Debug',
    '-destination', `id=${identifier}`, '-derivedDataPath', `output/ios-${target}`,
    '-resultBundlePath', resultBundle, '-parallel-testing-enabled', 'NO',
    '-collect-test-diagnostics', 'never', '-test-timeouts-enabled', 'YES',
    '-default-test-execution-time-allowance', '300', '-maximum-test-execution-time-allowance', '300',
    '-allowProvisioningUpdates',
    ...(target === 'simulator' ? ['CODE_SIGN_IDENTITY=-'] : ['-only-testing:AppUITests/SQLLabUITests/testLaunchAndNavigation']),
    'test',
  ];
  const log = await open(logPath, 'w');
  let result;
  try {
    result = spawnSync('xcodebuild', args, { cwd: root, env: environment, stdio: ['ignore', log.fd, log.fd], timeout: (expectedTests * 5 + 5) * 60 * 1000 });
  } finally {
    await log.close();
  }
  if (result.error) throw result.error;
  report.exitCode = result.status;
  const summary = spawnSync('xcrun', ['xcresulttool', 'get', 'test-results', 'summary', '--path', resultBundle], { cwd: root, env: environment, encoding: 'utf8' });
  if (summary.status !== 0) throw new Error('无法读取 XCTest 验收结果');
  report.tests = JSON.parse(summary.stdout);
  const attachments = resolve(directory, `ios-${target}-${stamp}-attachments`);
  const exported = spawnSync('xcrun', ['xcresulttool', 'export', 'attachments', '--path', resultBundle, '--output-path', attachments], { cwd: root, env: environment, encoding: 'utf8' });
  if (exported.status !== 0) throw new Error('无法导出 iOS 验收截图');
  report.attachments = attachments;
  if (result.status !== 0 || report.tests.failedTests !== 0 || report.tests.skippedTests !== 0 || report.tests.passedTests !== expectedTests) {
    throw new Error(`XCTest 未完成要求的验收用例，见 ${logPath}`);
  }
  report.ok = true;
} catch (error) {
  report.failure = error.message;
  process.exitCode = 1;
} finally {
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, coverage: report.coverage, passed: report.tests?.passedTests, skipped: report.tests?.skippedTests, failure: report.failure, reportPath }, null, 2));
}
