import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('.', import.meta.url));
const version = '4.0.0';
const build = '20261026.9';
const cache = 'sql-trainer-v28';

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => entry.isDirectory()
    ? listFiles(resolve(directory, entry.name))
    : resolve(directory, entry.name)));
  return files.flat();
}

function releaseBundle() {
  return {
    name: 'sql-lab-release',
    apply: 'build',
    async closeBundle() {
      const output = resolve(project, 'dist');
      const paths = (await listFiles(output)).filter(path => !['release.json', 'sw.js'].includes(relative(output, path))).sort();
      const assets = await Promise.all(paths.map(async path => {
        const buffer = await readFile(path);
        return { path: relative(output, path).split('\\').join('/'), sha256: createHash('sha256').update(buffer).digest('hex'), bytes: buffer.length };
      }));
      const release = { app: 'sql-trainer', version, build, cache, assets };
      const worker = (await readFile(resolve(project, 'app/service-worker.js'), 'utf8'))
        .replace('__CACHE__', JSON.stringify(cache))
        .replace('__VERSION__', JSON.stringify(version))
        .replace('__BUILD__', JSON.stringify(build))
        .replace('__ASSETS__', JSON.stringify(assets.map(asset => asset.path)));
      await writeFile(resolve(output, 'release.json'), JSON.stringify(release, null, 2) + '\n');
      await writeFile(resolve(output, 'sw.js'), worker);
    },
  };
}

export default defineConfig({
  root: resolve(project, 'app'),
  base: process.env.SQL_LAB_BASE || './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_BUILD__: JSON.stringify(build),
  },
  plugins: [releaseBundle(), {
    name: 'sql-lab-development',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace("connect-src 'self'", "connect-src 'self' ws: wss:");
    },
  }],
  build: {
    outDir: resolve(project, 'dist'),
    emptyOutDir: true,
    target: 'safari15',
    sourcemap: false,
  },
});
