"""复用已有 Playwright 引擎驱动隔离的 Chrome，不访问真实同步账号。"""
import json
from pathlib import Path
import subprocess
import sys
import contextlib
sys.dont_write_bytecode = True
from pwa_server import fixture_server

test_dir = Path(__file__).resolve().parent
url = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8644/'
modules = sorted((Path.home() / '.npm/_npx').glob('*/node_modules/playwright-core/package.json'), key=lambda file: file.stat().st_mtime, reverse=True)
if not modules:
    raise RuntimeError('没有找到已有 Playwright CLI 的浏览器引擎，请先配置 Playwright CLI 与 Chrome。')
module_path = modules[0].parent


for name in (sys.argv[2:] or ['reliability.browser.js', 'sync.browser.js', 'mobile.browser.js', 'pwa.browser.js', 'pwa-legacy.browser.js']):
    server = fixture_server('legacy' if name == 'pwa-legacy.browser.js' else 'old') if name in ('pwa.browser.js', 'pwa-legacy.browser.js') else contextlib.nullcontext(url)
    with server as browser_url:
        (test_dir.parent / 'output/playwright').mkdir(parents=True, exist_ok=True)
        execution = subprocess.run(['node', str(test_dir / 'browser-driver.cjs'), str(module_path), str(test_dir / name), browser_url], cwd=test_dir.parent, text=True, capture_output=True, timeout=180)
        result = json.loads(execution.stdout)
        print(name + ': ' + json.dumps(result, ensure_ascii=False), flush=True)
        if execution.returncode or not result.get('ok'):
            raise RuntimeError(result.get('failure', execution.stderr or name + ' 执行失败'))
