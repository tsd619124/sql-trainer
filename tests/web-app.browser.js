async page => {
  const checks = [], errors = [], warnings = [];
  const browser = page.context().browser();
  const contexts = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) warnings.push(message.text()); });
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const check = async (name, work) => { await work(); checks.push(name); };
  const ready = target => target.waitForFunction(() => document.querySelector('#st-engine-text')?.textContent === '练习库就绪');
  const root = new URL('./', page.url()).href;
  try {
    await ready(page);
    const currentRelease = await (await page.request.get(root + 'release.json')).json();
    await check('工程化 Web 入口、独立 SQL 引擎与完整资源清单', async () => {
      const html = await (await page.request.get(root + 'index.html')).text();
      assert(html.length < 15000 && !html.includes('base64,AGFzb'), '入口仍内嵌整个引擎');
      assert(html.includes('type="module"') && html.includes('assets/'), '没有使用工程构建入口');
      const release = await (await page.request.get(root + 'release.json')).json();
      assert(release.version === await page.locator('meta[name="sqltrain-version"]').getAttribute('content') && release.assets.some(asset => asset.path.endsWith('.wasm')), '发布清单版本不一致或缺少引擎');
      const manifest = await (await page.request.get(root + 'manifest.webmanifest')).json();
      assert(new URL(manifest.id, root).href === root, '应用身份与部署目录不一致');
      await page.waitForFunction(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration?.active) return false;
        const release = await (await fetch('release.json')).json();
        const cache = await caches.open(release.cache + ':' + registration.scope);
        return (await Promise.all(release.assets.map(asset => cache.match(new URL(asset.path, registration.scope))))).every(Boolean);
      });
    });
    await check('新版缺少 WASM 时停止切换，保留上一版完整离线包', async () => {
      const context = await browser.newContext(); contexts.push(context);
      const target = await context.newPage();
      const failures = [];
      target.on('pageerror', error => failures.push(error.message));
      await target.goto(root);
      await ready(target);
      await target.waitForFunction(() => !!navigator.serviceWorker.controller);
      await page.request.get(root + '__fixture?stage=broken');
      await target.locator('#tab-me').click();
      await target.locator('details.st-mrow').filter({ hasText: '关于与版本更新' }).locator('summary').first().click();
      await target.locator('.st-about-head [data-act="check-update"]').click();
      await target.waitForFunction(() => document.querySelector('#st-upd-status').textContent.includes('离线包尚未准备完成'), null, { timeout: 25000 });
      assert(await target.locator('#st-update-apply').isHidden(), '不完整的新包仍允许切换');
      await context.setOffline(true);
      await target.reload();
      await ready(target);
      assert(await target.locator('meta[name="sqltrain-build"]').getAttribute('content') === currentRelease.build, '异常更新损坏旧版离线副本');
      assert(!failures.length, failures.join('; '));
      await context.close();
      await page.request.get(root + '__fixture?stage=current');
    });
    await check('模块化 Web App 在子路径完整缓存并断网重开', async () => {
      const context = await browser.newContext(); contexts.push(context);
      const subpage = await context.newPage();
      const failures = [];
      subpage.on('pageerror', error => failures.push(error.message));
      await subpage.goto(root + 'sql-trainer/');
      await ready(subpage);
      await subpage.waitForFunction(() => !!navigator.serviceWorker.controller);
      await context.setOffline(true);
      await subpage.reload();
      await ready(subpage);
      const passed = await subpage.evaluate(() => {
        const app = window.__SQLTRAIN__;
        return app.QUESTIONS.every(question => app.gradeAnswer(question, question.answer).passed);
      });
      assert(passed, '子路径断网后无法判题');
      assert(!failures.length, failures.join('; '));
      await context.close();
    });
    await check('跨构建更新保存 SQL 草稿、笔记与周测截止时间', async () => {
      await page.locator('[data-act="app-search"]').click();
      await page.locator('#cmdk-input').fill('上海用户名单');
      await page.locator('#cmdk-list .cmdk-item').first().click();
      await page.locator('#st-code').fill('-- 模块化升级保留\nSELECT * FROM users;');
      await page.locator('.st-note-panel>summary').click();
      await page.locator('#st-note').fill('多文件应用更新后仍保留');
      await page.locator('#tab-exam').click();
      await page.locator('[data-act="test-start"]').click();
      await page.locator('#st-test-code').fill('SELECT 42;');
      const before = await page.evaluate(() => JSON.parse(localStorage.getItem('sqltrain_session')));
      await page.request.get(root + '__fixture?stage=next');
      await page.locator('#tab-me').click();
      await page.locator('details.st-mrow').filter({ hasText: '关于与版本更新' }).locator('summary').first().click();
      await page.locator('.st-about-head [data-act="check-update"]').click();
      await page.waitForFunction(() => !document.querySelector('#st-update-apply').hidden);
      await page.locator('#st-update-apply').click();
      await page.waitForURL(url => url.searchParams.get('sqltrain-build') === currentRelease.build + '.update-test');
      await ready(page);
      const after = await page.evaluate(() => JSON.parse(localStorage.getItem('sqltrain_session')));
      assert(after.codes.q2 === before.codes.q2 && after.codes['test_' + before.test.qids[0]] === 'SELECT 42;', '更新丢失 SQL 草稿');
      assert(after.test.endAt === before.test.endAt, '更新重新开始了考试计时');
      assert(await page.evaluate(() => JSON.parse(localStorage.getItem('sqltrain_state')).notes.q2 === '多文件应用更新后仍保留'), '更新丢失笔记');
      await page.context().setOffline(true);
      await page.reload();
      await ready(page);
      assert(await page.locator('meta[name="sqltrain-build"]').getAttribute('content') === currentRelease.build + '.update-test', '离线仍返回旧构建');
      await page.context().setOffline(false);
      await page.request.get(root + '__fixture?stage=current');
    });
    await check('iOS 原生接口模拟：持久化、分享、系统提醒、后台保存和重开', async () => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(context);
      await context.addInitScript(() => {
        window.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
        window.__nativeCalls = [];
        window.__nativeListeners = {};
        const methods = ['loadStore', 'saveStore', 'notificationStatus', 'requestReminderPermission', 'setReminder', 'shareBackup', 'haptic', 'removeListener'];
        window.Capacitor = {
          PluginHeaders: [{ name: 'SQLLabNative', methods: [...methods.map(name => ({ name, rtype: 'promise' })), { name: 'addListener', rtype: 'callback' }] }],
          nativeCallback(plugin, method, options, callback) {
            window.__nativeListeners[options.eventName] = callback;
            return Promise.resolve(options.eventName);
          },
          async nativePromise(plugin, method, options) {
            window.__nativeCalls.push({ method, options });
            if (method === 'loadStore') return { values: JSON.parse(sessionStorage.getItem('native-values') || '{}'), initialized: !!sessionStorage.getItem('native-values') };
            if (method === 'saveStore') {
              const values = JSON.parse(sessionStorage.getItem('native-values') || '{}');
              for (const [key, value] of Object.entries(options.values)) { if (value === null) delete values[key]; else values[key] = value; }
              sessionStorage.setItem('native-values', JSON.stringify(values));
            }
            if (method === 'notificationStatus') return { permission: sessionStorage.getItem('native-permission') || 'default' };
            if (method === 'requestReminderPermission') { sessionStorage.setItem('native-permission', 'granted'); return { permission: 'granted' }; }
            return {};
          },
        };
      });
      const native = await context.newPage();
      const failures = [];
      native.on('pageerror', error => failures.push(error.message));
      await native.goto(root);
      await ready(native);
      assert(await native.locator('html').getAttribute('data-platform') === 'ios', '未加载 iOS 平台适配');
      await native.locator('[data-act="app-search"]').click();
      await native.locator('#cmdk-input').fill('上海用户名单');
      await native.locator('#cmdk-list .cmdk-item').first().click();
      await native.locator('#st-code').fill('SELECT * FROM users; -- 原生后台保存');
      await native.evaluate(() => window.__nativeListeners.appStateChange({ isActive: false }));
      await native.waitForFunction(() => JSON.parse(JSON.parse(sessionStorage.getItem('native-values')).sqltrain_session).codes.q2.includes('原生后台保存'));
      await native.reload();
      await ready(native);
      assert((await native.locator('#st-code').inputValue()).includes('原生后台保存'), '原生重开丢失草稿');
      await native.locator('#tab-me').click();
      await native.locator('[data-act="remind-toggle"]').click();
      await native.waitForFunction(() => window.__nativeCalls.some(call => call.method === 'setReminder' && call.options.enabled));
      assert((await native.locator('#st-remind-status').textContent()).includes('应用关闭后'), '原生提醒仍显示浏览器限制');
      await native.locator('details.st-mrow').filter({ hasText: '备份与迁移' }).locator('summary').first().click();
      await native.locator('[data-act="export-progress"]').click();
      await native.waitForFunction(() => window.__nativeCalls.some(call => call.method === 'shareBackup'));
      const shared = await native.evaluate(() => window.__nativeCalls.find(call => call.method === 'shareBackup').options);
      assert(shared.filename.endsWith('.json') && JSON.parse(shared.content).v === 1, '原生备份协议错误');
      assert(!await native.evaluate(async () => !!await navigator.serviceWorker.getRegistration()), '原生客户端错误注册了 Web 离线服务');
      assert(!failures.length, failures.join('; '));
      await native.screenshot({ path: 'output/playwright/ios-bridge-preview.png', fullPage: true });
      await context.close();
    });
    assert(!errors.length, errors.join('; '));
    assert(!warnings.length, warnings.join('; '));
    return { ok: true, checks, errors, warnings, nativeCoverage: 'mocked-bridge' };
  } catch (error) {
    return { ok: false, checks, errors, warnings, failure: error.message };
  } finally {
    await page.context().setOffline(false);
    await page.request.get(root + '__fixture?stage=current').catch(() => {});
    for (const context of contexts) await context.close().catch(() => {});
  }
}
