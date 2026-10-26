import contextlib
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import threading
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
ASSETS = json.loads((ROOT / 'release.json').read_text())['assets']


def snapshot(version, build, cache):
    files = {entry['path']: (ROOT / entry['path']).read_bytes() for entry in ASSETS}
    html = files['index.html'].decode()
    html = re.sub(r'^(<meta name="sqltrain-version" content=")[^"]+', lambda match: match[1] + version, html, flags=re.MULTILINE)
    html = re.sub(r'^(<meta name="sqltrain-build" content=")[^"]+', lambda match: match[1] + build, html, flags=re.MULTILINE)
    html = re.sub(r"var APP_VERSION='[^']+',APP_BUILD='[^']+'", "var APP_VERSION='" + version + "',APP_BUILD='" + build + "'", html)
    files['index.html'] = html.encode()
    worker = (ROOT / 'sw.js').read_text()
    for name, value in [('VERSION', version), ('BUILD', build), ('CACHE', cache)]:
        worker = re.sub(r"const " + name + r" = '[^']+'", "const " + name + " = '" + value + "'", worker)
    files['sw.js'] = worker.encode()
    files['release.json'] = json.dumps({
        'app': 'sql-trainer', 'version': version, 'build': build, 'cache': cache,
        'assets': [{'path': name, 'sha256': hashlib.sha256(content).hexdigest(), 'bytes': len(content)}
                   for name, content in files.items() if name != 'sw.js'],
    }).encode()
    return files


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/__fixture':
            stage = parse_qs(url.query).get('stage', ['old'])[0]
            if stage not in ('old', 'current', 'invalid', 'html-only', 'broken', 'http-error', 'legacy', 'mismatch', 'tampered'):
                self.send_error(400)
                return
            self.server.stage = stage
            self.reply(200, 'application/json', json.dumps({'stage': stage}).encode())
            return
        name = url.path.removeprefix('/sql-trainer/').removeprefix('/root-app/') or 'index.html'
        stage = self.server.stage
        if stage == 'http-error':
            self.reply(503, 'text/plain', b'fixture unavailable')
            return
        if stage == 'invalid' and name == 'release.json':
            self.reply(200, 'application/json', b'{"app":"wrong-app"}')
            return
        if stage == 'broken' and name == 'icons/icon-512.png':
            self.reply(503, 'text/plain', b'fixture incomplete')
            return
        files = self.server.old if stage in ('old', 'invalid', 'legacy') else self.server.current
        if stage == 'legacy' and name == 'sw.js':
            self.reply(200, 'application/javascript', self.server.legacy)
            return
        if stage == 'html-only' and name == 'sw.js':
            files = self.server.old
        content = files.get(name)
        if stage == 'mismatch' and name == 'index.html':
            content = self.server.old[name]
        if stage == 'tampered' and name == 'index.html':
            content += b'\n'
        if content is None:
            self.reply(404, 'text/plain', b'not found')
            return
        content_type = 'image/png' if name.endswith('.png') else {
            'index.html': 'text/html; charset=utf-8', 'sw.js': 'application/javascript',
            'release.json': 'application/json', 'manifest.webmanifest': 'application/manifest+json',
            'icons/app.svg': 'image/svg+xml',
        }.get(name, 'text/plain')
        self.reply(200, content_type, content)

    def reply(self, status, content_type, content):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(content)


@contextlib.contextmanager
def fixture_server(initial_stage='old'):
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.old = snapshot('2.8.9', '20261026.2', 'sql-trainer-v21')
    server.legacy = b"""const CACHE='sql-trainer-v21';
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['./'])).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>caches.match('./')))});
"""
    release = json.loads((ROOT / 'release.json').read_text())
    server.current = snapshot(release['version'], release['build'], release['cache'])
    server.stage = initial_stage
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield 'http://127.0.0.1:' + str(server.server_port) + '/sql-trainer/'
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
