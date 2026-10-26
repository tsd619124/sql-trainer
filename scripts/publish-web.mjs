import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = resolve(root, 'dist');
const repository = 'tsd619124/sql-trainer';
const branch = 'codex/web-release';
const mode = process.argv[2] || '--check';

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || command + ' 执行失败').trim());
  return result.stdout.trim();
}

if (!['--check', '--publish'].includes(mode)) throw new Error('用法：node scripts/publish-web.mjs [--check|--publish]');
const remote = execute('git', ['remote', 'get-url', 'origin']);
if (!['https://github.com/' + repository + '.git', 'git@github.com:' + repository + '.git'].includes(remote)) throw new Error('origin 与 SQL Lab 发布仓库不一致');
const release = JSON.parse(await readFile(resolve(directory, 'release.json'), 'utf8'));
const metadata = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
if (release.app !== 'sql-trainer' || release.version !== metadata.version || !Array.isArray(release.assets) || !release.assets.length) throw new Error('正式构建版本无效，请先执行 npm run build');
const files = [...release.assets.map(asset => asset.path), 'release.json', 'sw.js'];
if (new Set(files).size !== files.length) throw new Error('发布清单存在重复资源');
for (const asset of release.assets) {
  const path = resolve(directory, asset.path);
  if (!path.startsWith(directory + sep)) throw new Error('发布资源超出构建目录');
  const content = await readFile(path);
  if (content.length !== asset.bytes || createHash('sha256').update(content).digest('hex') !== asset.sha256) throw new Error('发布资源校验失败：' + asset.path);
}
const worker = await readFile(resolve(directory, 'sw.js'), 'utf8');
if (!worker.includes(JSON.stringify(release.build)) || !worker.includes(JSON.stringify(release.cache))) throw new Error('离线服务与发布版本不一致');
console.log('已校验 SQL Lab ' + release.version + '（' + release.build + '）及 ' + release.assets.length + ' 项资源');

if (mode === '--publish') {
  const site = JSON.parse(execute('gh', ['api', 'repos/' + repository + '/pages']));
  if (site.html_url !== 'https://tsd619124.github.io/sql-trainer/') throw new Error('GitHub Pages 地址与当前应用不一致');
  const temporary = await mkdtemp(join(tmpdir(), 'sql-lab-publish-'));
  try {
    const gitDirectory = execute('git', ['rev-parse', '--absolute-git-dir']);
    const options = { cwd: directory, env: { ...process.env, GIT_DIR: gitDirectory, GIT_WORK_TREE: directory, GIT_INDEX_FILE: join(temporary, 'index') } };
    execute('git', ['read-tree', '--empty'], options);
    execute('git', ['add', '--', ...files], options);
    const empty = execute('git', ['hash-object', '-w', '--stdin'], { ...options, input: '' });
    execute('git', ['update-index', '--add', '--cacheinfo', '100644,' + empty + ',.nojekyll'], options);
    const tree = execute('git', ['write-tree'], options);
    const existing = execute('git', ['ls-remote', '--heads', 'origin', 'refs/heads/' + branch]);
    let previous;
    if (existing) {
      execute('git', ['fetch', '--no-tags', 'origin', branch]);
      previous = execute('git', ['rev-parse', 'FETCH_HEAD']);
    }
    let revision = previous;
    if (!previous || execute('git', ['rev-parse', previous + '^{tree}']) !== tree) {
      revision = execute('git', ['commit-tree', tree, ...(previous ? ['-p', previous] : []), '-m', '发布 SQL Lab Web ' + release.version + '（' + release.build + '）']);
      execute('git', ['push', 'origin', revision + ':refs/heads/' + branch]);
    }
    if (site.build_type !== 'legacy' || site.source?.branch !== branch || site.source?.path !== '/') {
      execute('gh', ['api', '--method', 'PUT', 'repos/' + repository + '/pages', '--input', '-'], { input: JSON.stringify({ build_type: 'legacy', source: { branch, path: '/' } }) });
      execute('gh', ['api', '--method', 'POST', 'repos/' + repository + '/pages/builds']);
    }
    console.log(JSON.stringify({ url: site.html_url, branch, revision, version: release.version, build: release.build }));
    console.log('已提交完整发布包；需等待 Pages 部署完成后验收线上版本。');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
