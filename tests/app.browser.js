async page => {
  const checks = [], errors = [], warnings = [];
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) warnings.push(message.text());
  });
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const check = async (name, work) => { await work(); checks.push(name); };
  const ready = async () => page.waitForFunction(() => document.querySelector('#st-engine-text').textContent === '练习库就绪');
  const session = async () => page.evaluate(() => JSON.parse(localStorage.getItem('sqltrain_session')));
  const activePage = async name => page.waitForFunction(name => document.querySelector('#sqltrain-root').dataset.page === name, name);
  try {
    await ready();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await check('任务式首页优先展示续学，完整题库按需展开', async () => {
      assert(await page.getByRole('heading', { name: '今天也练一点 SQL' }).isVisible(), '首页标题不可见');
      assert(await page.locator('.st-week-day').count() === 7, '本周打卡日期不完整');
      assert(await page.locator('.st-path-stop').count() === 8, '学习路径不完整');
      assert(!await page.locator('.st-path-details').evaluate(element => element.open), '题目目录默认未收起');
      await page.locator('.st-path-details>summary').click();
      assert(await page.locator('.st-qtarget:visible').count() === 42, '展开后不能访问全部题目');
      await page.locator('.st-path-details>summary').click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: 'output/playwright/app-mobile-home.png', fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1024 });
      await page.screenshot({ path: 'output/playwright/app-desktop-home.png', fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
    });
    await check('搜索入口、页内返回和浏览器前进保留 SQL 草稿与笔记', async () => {
      await page.locator('[data-act="app-search"]').click();
      await page.locator('#cmdk-input').fill('上海用户名单');
      await page.locator('#cmdk-list .cmdk-item').first().click();
      await activePage('train');
      assert((await session()).currentQid === 'q2', '搜索未打开目标题目');
      await page.locator('#st-code').fill('-- 应用返回后继续\nSELECT user_name FROM users');
      assert(!await page.locator('.st-note-panel').evaluate(element => element.open), '空笔记没有折叠');
      await page.locator('.st-note-panel>summary').click();
      await page.locator('#st-note').fill('记得先筛选城市，再决定输出列');
      await page.locator('#st-app-back').click();
      await activePage('dash');
      assert(await page.locator('.st-session-card').getAttribute('aria-label') === '继续上次学习', '首页未切换为续学任务');
      await page.goForward();
      await activePage('train');
      assert((await page.locator('#st-code').inputValue()).includes('应用返回后继续'), '返回和前进丢失草稿');
      assert(await page.locator('#st-note').inputValue() === '记得先筛选城市，再决定输出列', '返回丢失笔记');
    });
    await check('专注练习收起导航与目录，退出和 Escape 保留编辑内容', async () => {
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 960 });
        const draft = await page.locator('#st-code').inputValue();
        await page.locator('#st-app-focus').click();
        assert(await page.locator('#sqltrain-root').evaluate(element => element.classList.contains('st-focused')), '未进入专注模式');
        assert(!await page.locator('#st-train-seg').isVisible(), '专注模式仍显示子导航');
        assert(!await page.locator('.st-sidebar').isVisible(), '专注模式仍显示侧栏');
        assert(!await page.locator('.st-catalog').isVisible(), '专注模式仍显示目录');
        if (width === 390) assert(!await page.locator('body>.nav').isVisible(), '专注模式仍显示手机底栏');
        await page.locator('#st-code').fill(draft + '\n-- 专注编辑');
        await page.keyboard.press('Escape');
        assert(await page.locator('#st-app-focus').getAttribute('aria-pressed') === 'false', 'Escape 未退出专注模式');
        assert((await page.locator('#st-code').inputValue()).endsWith('-- 专注编辑'), '退出专注丢失编辑内容');
      }
      await page.screenshot({ path: 'output/playwright/app-desktop-practice.png', fullPage: true });
    });
    await check('一级页面恢复滚动位置，刷新后恢复当前题目与草稿', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('#tab-dash').click();
      await page.evaluate(() => window.scrollTo(0, 250));
      const position = await page.evaluate(() => scrollY);
      assert(position > 100, '滚动测试没有实际滚动');
      await page.locator('#tab-me').click();
      await page.evaluate(() => window.scrollTo(0, 180));
      const profilePosition = await page.evaluate(() => scrollY);
      await page.goBack(); await activePage('dash');
      await page.waitForFunction(position => Math.abs(scrollY - position) < 2, position);
      await page.goForward(); await activePage('me');
      await page.waitForFunction(position => Math.abs(scrollY - position) < 2, profilePosition);
      await page.locator('#tab-dash').click();
      await page.waitForFunction(position => Math.abs(scrollY - position) < 2, position);
      await page.getByRole('button', { name: '继续学习', exact: true }).click();
      await page.reload(); await ready();
      assert((await session()).currentQid === 'q2', '刷新后题目位置错误');
      assert((await page.locator('#st-code').inputValue()).includes('专注编辑'), '刷新后草稿丢失');
      await page.screenshot({ path: 'output/playwright/app-mobile-practice.png', fullPage: true });
    });
    await check('深色首页和手机应用导航可用', async () => {
      await page.locator('#tab-me').click();
      await page.locator('[data-mo="dark"]').click();
      await page.locator('#tab-dash').click();
      await page.evaluate(() => window.scrollTo(0, 0));
      assert(await page.locator('#tab-dash').getAttribute('aria-selected') === 'true', '手机导航选中状态错误');
      assert(await page.locator('.st-session-card').evaluate(element => getComputedStyle(element).backgroundColor === 'rgb(18, 34, 61)'), '深色任务卡颜色错误');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '深色首页横向溢出');
      await page.screenshot({ path: 'output/playwright/app-mobile-dark.png', fullPage: true });
      await page.locator('#tab-me').click();
      await page.locator('[data-mo="light"]').click();
    });
    assert(!errors.length && !warnings.length, errors.concat(warnings).join(' | '));
    return { ok: true, checks, errors, warnings };
  } catch (error) {
    return { ok: false, checks, errors, warnings, failure: error.stack || String(error) };
  }
}
