const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name));
const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const html = read('index.html').toString();
const worker = read('sw.js').toString();
const version = html.match(/var APP_VERSION='([^']+)'/)[1];
const build = html.match(/APP_BUILD='([^']+)'/)[1];
const cache = worker.match(/const CACHE = '([^']+)'/)[1];
const assets = ['index.html', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/app.svg'];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function icon(size) {
  const segments = [[192,176,112,256],[112,256,192,336],[320,176,400,256],[400,256,320,336],[288,144,224,368]];
  const pixels = Buffer.alloc((size * 3 + 1) * size);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const horizontal = (column + 0.5) * 512 / size;
      const vertical = (row + 0.5) * 512 / size;
      const distance = Math.min(...segments.map(([left, top, right, bottom]) => {
        const width = right - left;
        const height = bottom - top;
        const ratio = Math.max(0, Math.min(1, ((horizontal - left) * width + (vertical - top) * height) / (width * width + height * height)));
        return Math.hypot(horizontal - left - ratio * width, vertical - top - ratio * height);
      }));
      const alpha = Math.max(0, Math.min(1, (12 - distance) * size / 512 + 0.5));
      const offset = row * (size * 3 + 1) + 1 + column * 3;
      pixels[offset] = Math.round(255 * alpha);
      pixels[offset + 1] = Math.round(122 + 133 * alpha);
      pixels[offset + 2] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

if (process.argv.includes('--icons')) {
  for (const size of [180, 192, 512]) fs.writeFileSync(path.join(root, 'icons/icon-' + size + '.png'), icon(size));
}

const release = {app: 'sql-trainer', version, build, cache, assets: assets.map(name => ({path: name, sha256: hash(read(name)), bytes: read(name).length}))};
if (process.argv.includes('--write')) fs.writeFileSync(path.join(root, 'release.json'), JSON.stringify(release, null, 2) + '\n');
assert.deepEqual(JSON.parse(read('release.json')), release, '发布校验值已过期：确认版本和构建号后运行 node scripts/release.cjs --write');
assert.equal(html.match(/<meta name="sqltrain-version" content="([^"]+)">/)[1], version);
assert.equal(html.match(/<meta name="sqltrain-build" content="([^"]+)">/)[1], build);
assert.equal(worker.match(/const VERSION = '([^']+)'/)[1], version);
assert.equal(worker.match(/const BUILD = '([^']+)'/)[1], build);
assert.deepEqual(JSON.parse(worker.match(/const ASSETS = (\[[^;]+\]);/)[1].replaceAll("'", '"')), assets);
assert.ok(new RegExp("\\['" + version.replaceAll('.', '\\.') + "','2026-\\d{2}-\\d{2}'").test(html), '缺少当前版本更新说明');
const manifest = JSON.parse(read('manifest.webmanifest'));
assert.equal(manifest.id, '/sql-trainer/');
assert.equal(manifest.start_url, './');
assert.equal(manifest.scope, './');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.short_name, 'SQL Lab');
for (const size of [180, 192, 512]) {
  const png = read('icons/icon-' + size + '.png');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png.readUInt32BE(20), size);
}
for (const item of manifest.icons) assert.ok(assets.includes(item.src.replace(/^\.\//, '')));
let scripts = 0;
let library;
for (const tag of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  const source = tag[1].match(/\bsrc="([^"]+)"/);
  if (source) {
    assert.ok(source[1].startsWith('data:text/javascript;base64,'), '单文件脚本不得依赖外部网络');
    const context = vm.createContext({});
    vm.runInContext(Buffer.from(source[1].split(',')[1], 'base64').toString(), context);
    library = context.lucide;
  } else {
    new vm.Script(tag[2]);
    scripts++;
  }
}
for (const match of html.matchAll(/data-lucide="([a-z][a-z0-9-]*)"/g)) {
  const name = match[1].replace(/(^|-)([a-z0-9])/g, (whole, separator, letter) => letter.toUpperCase());
  assert.ok(library.icons[name], '缺少图标：' + match[1]);
}
new vm.Script(worker);
assert.ok(read('index.html').length < 1500000, '单文件体积超过发布预算');
console.log(JSON.stringify({ok: true, version, build, cache, assets: assets.length, scripts, icons: Object.keys(library.icons).length, htmlBytes: read('index.html').length}));
