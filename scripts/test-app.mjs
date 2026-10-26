import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = resolve(root, 'dist');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml' };
const release = JSON.parse(await readFile(resolve(directory, 'release.json'), 'utf8'));
const currentFiles = new Map(await Promise.all([...release.assets.map(asset => asset.path), 'release.json', 'sw.js'].map(async path => [path, await readFile(resolve(directory, path))])));
const nextFiles = new Map([...currentFiles].map(([path, content]) => [path, /\.(?:html|js)$/.test(path)
  ? Buffer.from(content.toString().replaceAll('20261026.9', '20261026.10').replaceAll('sql-trainer-v28', 'sql-trainer-v29')) : content]));
const nextRelease = { ...release, build: '20261026.10', cache: 'sql-trainer-v29', assets: release.assets.map(asset => {
  const content = nextFiles.get(asset.path);
  return { ...asset, sha256: createHash('sha256').update(content).digest('hex'), bytes: content.length };
}) };
nextFiles.set('release.json', Buffer.from(JSON.stringify(nextRelease)));
let stage = 'current';
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === '/__fixture') {
    const requested = url.searchParams.get('stage');
    if (['current', 'next', 'broken'].includes(requested)) stage = requested;
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ stage }));
    return;
  }
  const relative = pathname === '/' || pathname === '/sql-trainer/' ? 'index.html' : pathname.replace(/^\/sql-trainer\//, '/').slice(1);
  const path = resolve(directory, relative);
  if (!path.startsWith(directory + sep)) { response.writeHead(403).end(); return; }
  try {
    if (stage === 'broken' && relative === 'vendor/sql-wasm.wasm') { response.writeHead(503).end(); return; }
    const content = (stage === 'current' ? currentFiles : nextFiles).get(relative) || await readFile(path);
    response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(content);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port + '/';
const suites = process.argv.slice(2);
const selected = suites.length ? suites : ['reliability.browser.js', 'sync.browser.js', 'mobile.browser.js', 'app.browser.js', 'web-app.browser.js'];
const result = await new Promise(resolve => {
  const child = spawn('python3', ['tests/run-browser.py', url, ...selected], { cwd: root });
  let output = '';
  child.stdout.on('data', data => { output += data; process.stdout.write(data); });
  child.stderr.on('data', data => process.stderr.write(data));
  child.on('error', error => resolve({ code: 1, output, error: error.message }));
  child.on('close', code => resolve({ code, output }));
});
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
await mkdir(resolve(root, 'output/release'), { recursive: true });
await writeFile(resolve(root, 'output/release/app-acceptance.json'), JSON.stringify({ ok: result.code === 0, checkedAt: new Date().toISOString(), suites: selected, ...result }, null, 2) + '\n');
process.exitCode = result.code;
