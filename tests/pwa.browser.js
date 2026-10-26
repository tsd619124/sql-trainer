async page => {
  const checks = [];
  const errors = [];
  const consoleMessages = [];
  let activeCheck = '';
  const phase = '__SQLTRAIN_PWA_PHASE__';
  const installation = new Set(['项目子路径下身份、图标和安装引导一致', '页面构建已独立核验，重复检查不依赖 updatefound']);
  const failures = new Set(['发布信息异常不误报最新，不打断当前学习', '只换 HTML 未更新 SW 时不误报已准备完成', '新版缺资源时保留旧离线包和其他应用缓存']);
  const context = page.context();
  const base = new URL(page.url());
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const ready = async target => target.waitForFunction(() => window.__SQLTRAIN__ && document.querySelector('#st-engine-text').textContent === '练习库就绪', null, {timeout: 15000});
  const check = async (name, work) => {
    if (phase !== (installation.has(name) ? 'install' : failures.has(name) ? 'failures' : 'update')) return;
    activeCheck = name; await work(); checks.push(name);
  };
  const stage = async name => {
    const response = await page.request.get(new URL('/__fixture?stage=' + name, base).href);
    assert(response.ok(), '测试发布阶段切换失败');
  };
  const me = async () => {
    await page.locator('#tab-me').click();
    const about = page.locator('details').filter({has: page.locator('#st-upd-status')}).first();
    if (!await about.evaluate(element => element.open)) await about.locator(':scope>summary').click();
  };
  const update = async () => {
    await page.locator('[data-act="check-update"]').last().click();
    await page.waitForFunction(() => !document.querySelector('[data-act="check-update"]').disabled, null, {timeout: 25000});
    return page.locator('#st-upd-status').innerText();
  };
  const offlineReady = async () => page.waitForFunction(() => document.querySelector('#st-pwa-offline')?.textContent.includes('此版本已可离线使用'));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) consoleMessages.push(message.text()); });
  let peer;
  try {
    assert(['install', 'failures', 'update'].includes(phase), '请通过 tests/run-browser.py 运行隔离的 PWA 回归');
    await ready(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    await me();
    await offlineReady();
    await page.evaluate(async () => {
      await (await caches.open('unrelated-app-v1')).put('/other-app/', new Response('keep'));
      await (await caches.open('sql-trainer-v1:' + location.origin + '/other-scope/')).put('/other-scope/index.html', new Response('keep'));
    });
    await check('项目子路径下身份、图标和安装引导一致', async () => {
      const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute('href');
      assert(new URL(manifestUrl).pathname === '/sql-trainer/manifest.webmanifest', 'manifest 子路径错误');
      const manifest = await (await page.request.get(manifestUrl)).json();
      assert(manifest.id === '/sql-trainer/' && manifest.short_name === 'SQL Lab', '安装身份不一致');
      assert(new URL(manifest.start_url, manifestUrl).pathname === '/sql-trainer/', '启动路径错误');
      for (const icon of manifest.icons) assert((await page.request.get(new URL(icon.src, manifestUrl).href)).ok(), '图标不可访问');
      assert((await page.locator('#st-remind-status').innerText()).includes('关闭应用后不会后台'), '开启提醒前未说明限制');
      const installDetails = page.locator('details').filter({has: page.locator('#st-pwa-guide')}).first();
      await installDetails.locator(':scope>summary').click();
      await page.evaluate(() => {
        const event = new Event('beforeinstallprompt', {cancelable: true});
        event.prompt = () => Promise.resolve();
        event.userChoice = Promise.resolve({outcome: 'dismissed'});
        dispatchEvent(event);
      });
      assert(await page.locator('#st-pwa-install').isVisible(), '安装事件未提供入口');
      await page.locator('#st-pwa-install').click();
      assert(!await page.locator('#st-pwa-install').isVisible(), '已消费安装事件未清理');
      assert(!(await page.locator('#st-pwa-guide').innerText()).includes('已从主屏'), '取消安装被误报为已安装');
    });
    await check('页面构建已独立核验，重复检查不依赖 updatefound', async () => {
      for (let attempt = 0; attempt < 2; attempt++) assert((await update()).includes('已核验为最新版 v2.8.9'), '未核实页面版本');
    });
    await check('发布信息异常不误报最新，不打断当前学习', async () => {
      for (const fixture of ['invalid', 'mismatch', 'tampered']) {
        await stage(fixture);
        assert((await update()).includes('检查未完成'), fixture + ' 发布信息误报成功');
        assert(!await page.locator('#st-update-apply').isVisible(), '失败时提供了更新按钮');
      }
      await stage('old');
    });
    await check('只换 HTML 未更新 SW 时不误报已准备完成', async () => {
      await stage('html-only');
      assert((await update()).includes('离线包尚未准备完成'), '没有新版 SW 时错误确认最新');
      assert(!await page.locator('#st-update-apply').isVisible(), '离线包未齐仍可切换');
      assert(await page.locator('meta[name="sqltrain-version"]').getAttribute('content') === '2.8.9', '检查时自动刷新了页面');
    });
    await check('新版缺资源时保留旧离线包和其他应用缓存', async () => {
      await stage('broken');
      assert((await update()).includes('离线包尚未准备完成'), '不完整发布被接管');
      const keys = await page.evaluate(() => caches.keys());
      assert(keys.some(key => key.startsWith('sql-trainer-v21:') && key.endsWith('/sql-trainer/')), '旧离线包被删除');
      assert(keys.includes('unrelated-app-v1'), '删除了其他应用缓存');
      await stage('old');
    });
    await check('更新等待用户操作，保存练习、笔记与周测后切换', async () => {
      await page.locator('#tab-dash').click();
      await page.locator('.st-qtarget[data-qid="q2"]').click();
      await page.locator('#st-code').fill('-- 更新前草稿\nSELECT product_name FROM products');
      await page.locator('#st-note').fill('更新前保留的笔记');
      await page.locator('#tab-exam').click();
      await page.locator('[data-act="test-start"]').click();
      await page.locator('#st-test-code').fill('-- 周测更新前\nSELECT 1');
      const before = await page.evaluate(() => JSON.parse(localStorage.getItem('sqltrain_session')));
      peer = await context.newPage();
      await peer.goto(base.href); await ready(peer);
      await stage('current');
      await me();
      assert((await update()).includes('已准备好'), '完整新版没有准备完成');
      assert(await page.locator('meta[name="sqltrain-version"]').getAttribute('content') === '2.8.9', '后台下载自动刷新了页面');
      await page.evaluate(() => {
        window.__pwaSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key === 'sqltrain_session') throw new DOMException('fixture quota', 'QuotaExceededError');
          return window.__pwaSetItem.call(this, key, value);
        };
      });
      await page.locator('#st-update-apply').click();
      assert((await page.locator('#st-upd-status').innerText()).includes('本地保存失败'), '保存失败仍然切换了页面');
      assert(await page.locator('meta[name="sqltrain-version"]').getAttribute('content') === '2.8.9', '保存失败后页面仍被刷新');
      await page.evaluate(() => { Storage.prototype.setItem = window.__pwaSetItem; delete window.__pwaSetItem; });
      await page.locator('#st-update-apply').click();
      await page.waitForFunction(() => document.querySelector('meta[name="sqltrain-version"]').content === '2.9.0');
      await ready(page);
      const after = await page.evaluate(() => ({session: JSON.parse(localStorage.getItem('sqltrain_session')), state: JSON.parse(localStorage.getItem('sqltrain_state'))}));
      assert(after.session.codes.q2.includes('更新前草稿'), '练习草稿丢失');
      assert(after.state.notes.q2 === '更新前保留的笔记', '笔记丢失');
      assert(after.session.test.id === before.test.id && after.session.test.endAt === before.test.endAt, '周测或截止时间重置');
      assert(after.session.codes['test_' + before.test.qids[0]].includes('周测更新前'), '周测草稿丢失');
      assert(await peer.locator('meta[name="sqltrain-version"]').getAttribute('content') === '2.8.9', '其他标签页被强制刷新');
      await peer.close(); peer = null;
      const keys = await page.evaluate(() => caches.keys());
      assert(keys.includes('unrelated-app-v1') && keys.some(key => key.endsWith('/other-scope/')), '新版清理影响了其他缓存');
      await me(); await offlineReady();
      await page.setViewportSize({width: 390, height: 844});
      await page.locator('details').filter({has: page.locator('#st-pwa-guide')}).first().locator(':scope>summary').click();
      await page.screenshot({path: 'output/playwright/batch3-install-update.png', fullPage: true});
    });
    await check('离线多次重开与查询参数、index.html 入口均可续考判题', async () => {
      await context.setOffline(true);
      for (const entry of ['', '?source=home', 'index.html?source=bookmark']) {
        await page.goto(new URL(entry || './', base).href); await ready(page);
        await me();
        assert((await update()).includes('当前离线'), '离线检查误报已是最新');
        const state = await page.evaluate(() => JSON.parse(localStorage.getItem('sqltrain_session')));
        assert(state.test && state.codes.q2.includes('更新前草稿'), '离线恢复丢失会话');
      }
      const passed = await page.evaluate(() => window.__SQLTRAIN__.gradeAnswer(window.__SQLTRAIN__.QUESTIONS[0], window.__SQLTRAIN__.QUESTIONS[0].answer).passed);
      assert(passed, '离线 SQL 判题不可用');
      await context.setOffline(false);
    });
    await check('HTTP 失败回退有效离线页，不污染缓存', async () => {
      await stage('http-error');
      await page.goto(base.href); await ready(page);
      assert(await page.locator('meta[name="sqltrain-version"]').getAttribute('content') === '2.9.0', '503 页面覆盖了应用');
      await stage('current');
      await page.goto(new URL('missing.html', base).href);
      assert(!(await page.content()).includes('sqltrain-version'), '未知资源被错误返回应用 HTML');
      await page.goto(base.href); await ready(page);
    });
    await check('iPhone 安装说明与已安装状态分别呈现', async () => {
      try {
        for (const installed of [false, true]) {
          await page.evaluate(installed => {
            Object.defineProperty(navigator, 'userAgent', {value: 'iPhone Safari', configurable: true});
            Object.defineProperty(navigator, 'standalone', {value: installed, configurable: true});
          }, installed);
          await page.locator('#tab-dash').click(); await me();
          const guide = await page.locator('#st-pwa-guide').textContent();
          assert(guide.includes(installed ? '已从主屏' : '分享'), 'iPhone 安装状态或引导错误');
        }
      } finally {
        await page.evaluate(() => { delete navigator.userAgent; delete navigator.standalone; });
      }
    });
    await check('单 HTML 文件断网直开仍可学习和判题', async () => {
      const isolated = await context.browser().newContext();
      try {
        await isolated.setOffline(true);
        const target = await isolated.newPage();
        target.on('pageerror', error => errors.push(error.message));
        await target.goto('__SQLTRAIN_FILE_URL__'); await ready(target);
        await target.locator('#tab-me').click();
        assert((await target.locator('#st-pwa-guide').textContent()).includes('本地文件'), '文件模式提示错误');
        assert(await target.locator('link[rel="manifest"]').count() === 0, '本地文件尝试加载远端安装资源');
        const passed = await target.evaluate(() => window.__SQLTRAIN__.gradeAnswer(window.__SQLTRAIN__.QUESTIONS[0], window.__SQLTRAIN__.QUESTIONS[0].answer).passed);
        assert(passed, '单文件离线判题失败');
      } finally { await isolated.close(); }
    });
    assert(errors.length === 0, '浏览器脚本异常：' + errors.join('; '));
    const unexpectedConsole = consoleMessages.filter(message => !/Failed to load resource:.*(404|503|ERR_INTERNET_DISCONNECTED)/.test(message));
    assert(unexpectedConsole.length === 0, '非预期控制台消息：' + unexpectedConsole.join('; '));
    return {ok: true, checks, errors, expectedHttpErrors: consoleMessages.length};
  } catch (error) {
    return {ok: false, checks, activeCheck, failure: error.message, errors};
  } finally {
    if (context.browser()?.isConnected()) {
      await context.setOffline(false);
      if (peer) await peer.close();
    }
  }
}
