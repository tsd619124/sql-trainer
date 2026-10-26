async page => {
  const checks = [];
  const errors = [];
  const base = page.url();
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const ready = async () => page.waitForFunction(() => window.__SQLTRAIN__ && document.querySelector('#st-engine-text').textContent === '练习库就绪', null, {timeout: 15000});
  page.on('pageerror', error => errors.push(error.message));
  try {
    await ready();
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, {timeout: 15000});
    await page.waitForFunction(async () => (await caches.keys()).includes('sql-trainer-v21'), null, {timeout: 15000});
    await page.locator('.st-qtarget[data-qid="q1"]').click();
    await page.locator('#st-code').fill('-- 旧版升级保留');
    await page.locator('#tab-me').click();
    await page.locator('details').filter({has: page.locator('#st-upd-status')}).first().locator(':scope>summary').click();
    assert((await page.locator('#st-pwa-offline').textContent()).includes('尚未确认'), '旧 SW 未回答状态时错误确认离线准备完成');
    await page.request.get(new URL('/__fixture?stage=current', base).href);
    await page.locator('[data-act="check-update"]').last().click();
    await page.waitForFunction(() => !document.querySelector('[data-act="check-update"]').disabled, null, {timeout: 25000});
    assert((await page.locator('#st-upd-status').innerText()).includes('已准备好'), '旧 SW 未能准备新版');
    await page.locator('#st-update-apply').click();
    await page.waitForFunction(() => document.querySelector('meta[name="sqltrain-version"]').content === '2.9.0');
    await ready();
    assert(await page.evaluate(() => JSON.parse(localStorage.getItem('sqltrain_session')).codes.q1 === '-- 旧版升级保留'), '旧版升级草稿丢失');
    assert(!(await page.evaluate(() => caches.keys())).includes('sql-trainer-v21'), '旧版根缓存未清理');
    assert(errors.length === 0, '旧版升级存在脚本异常');
    checks.push('旧版只缓存根页面的 SW 可直接升级、保留草稿并清理旧缓存');
    return {ok: true, checks, errors};
  } catch (error) {
    return {ok: false, checks, failure: error.message, errors};
  }
}
