import datetime
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
REPORT = ROOT / 'output/release/acceptance.json'
report = {
    'ok': False, 'checked_at': datetime.datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(),
    'local_only': True, 'checks': [],
    'limitations': ['未部署或推送', 'iPhone 主屏安装、系统键盘和 VoiceOver 仍需真机验收', '同步使用虚拟服务，未访问真实云账号'],
}
environment = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')


def run(name, command):
    print(name + '…', flush=True)
    result = subprocess.run(command, cwd=ROOT, env=environment, text=True, capture_output=True)
    report['checks'].append({'name': name, 'ok': result.returncode == 0, 'output': result.stdout + result.stderr})
    print(result.stdout, end='', flush=True)
    if result.returncode:
        print(result.stderr, file=sys.stderr, flush=True)
        raise RuntimeError(name + '未通过')
    return result.stdout


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


try:
    report['release'] = json.loads(run('版本、资源与单文件校验', ['node', 'scripts/release.cjs']).strip())
    run('判题与进度可靠性', ['node', '--test', 'tests/reliability.test.cjs'])
    if '--static' not in sys.argv:
        with ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT))) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                output = run('学习、同步、手机与 PWA 浏览器回归', ['python3', 'tests/run-browser.py', 'http://127.0.0.1:' + str(server.server_port) + '/'])
                report['browser'] = {line.split(': ', 1)[0]: json.loads(line.split(': ', 1)[1])
                                     for line in output.splitlines() if '.browser.js: ' in line}
            finally:
                server.shutdown()
                thread.join()
    run('验收后资源一致性', ['node', 'scripts/release.cjs'])
    report['ok'] = True
    report['coverage'] = 'static' if '--static' in sys.argv else 'full'
except Exception as error:
    report['failure'] = str(error)
finally:
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(('验收通过：' if report['ok'] else '验收失败：') + str(REPORT), flush=True)
if not report['ok']:
    sys.exit(1)
