async (page) => {
  const checks = [], errors = [], warnings = [], layouts = [];
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) warnings.push(message.text());
  });
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const check = async (name, work) => { await work(); checks.push(name); };
  const ready = async () => page.waitForFunction(() => window.__SQLTRAIN__ && document.querySelector('#st-engine-text').textContent === '练习库就绪');
  const session = async () => page.evaluate(() => JSON.parse(localStorage.getItem('sqltrain_session')));
  const tab = async name => {
    const button = page.locator('#tab-' + name);
    if (await button.getAttribute('aria-selected') !== 'true') await button.click();
  };
  const sub = async name => {
    await tab('train');
    await page.locator('#st-train-seg [data-sub="' + name + '"]').click();
  };
  const question = async id => {
    await tab('dash');
    if (!await page.locator('.st-path-details').evaluate(element => element.open)) await page.locator('.st-path-details>summary').click();
    await page.locator('.st-qtarget[data-qid="' + id + '"]').click();
  };
  const noOverflow = async label => {
    const size = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      outside: Array.from(document.querySelectorAll('#sqltrain-root *')).filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width && rect.right > innerWidth + 1 && !element.closest('.st-table-scroll,pre,.st-sql-tools,.st-qlist');
      }).slice(0, 4).map(element => element.className || element.tagName),
    }));
    assert(size.width <= size.viewport + 1, label + ' 撑宽页面：' + JSON.stringify(size));
    layouts.push(label);
  };
  const font = async value => {
    await tab('me');
    await page.locator('[data-act="font-set"][data-fz="' + value + '"]').click();
  };
  try {
    await ready();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) if (key.startsWith('sqltrain_')) localStorage.removeItem(key);
    });
    await page.reload(); await ready();
    await check('新用户首页推荐优先，课程与练习入口可见', async () => {
      assert(await page.locator('.st-session-card').isVisible(), '缺少今日推荐');
      assert(await page.locator('.st-session-card [data-act="open-q"]').isVisible(), '缺少开始练习');
      assert(!await page.locator('.st-path-details').evaluate(element => element.open), '完整题目列表没有按需收起');
      await noOverflow('390px 首页');
      await page.screenshot({ path: 'output/playwright/batch2-mobile-home.png', fullPage: true });
    });
    await check('继续上次练习、草稿和首页优先顺序刷新保留', async () => {
      await question('q2');
      await page.locator('#st-code').fill('-- 手机续写\nSELECT product_name FROM products');
      await tab('dash'); await page.reload(); await ready();
      assert(await page.locator('.st-session-card').getAttribute('aria-label') === '继续上次学习', '主要学习入口没有恢复上次内容');
      await page.getByRole('button', { name: '继续学习', exact: true }).click();
      assert((await session()).currentQid === 'q2', '续学题号错误');
      assert((await page.locator('#st-code').inputValue()).includes('手机续写'), '续学草稿丢失');
      assert(await page.locator('.st-catalog').evaluate(element => !element.open), '手机题目目录未折叠');
      assert(await page.locator('#st-qpanel h3').evaluate(element => element === document.activeElement), '选题后焦点没有进入题目');
    });
    await check('手机课程正文优先，课程续学与旧会话兼容', async () => {
      await sub('learn');
      await page.locator('#panel-learn .st-catalog>summary').click();
      await page.locator('#panel-learn [data-act="open-lesson"]').nth(1).click();
      const previous = (await session()).currentLid;
      assert(await page.locator('#panel-learn .st-catalog').evaluate(element => !element.open), '选择微课后目录未折叠');
      const position = await page.locator('#st-lpanel h2').boundingBox();
      assert(position.y >= 0 && position.y < 844, '微课正文没有直接呈现');
      await tab('dash');
      await page.getByRole('button', { name: '继续学习', exact: true }).click();
      assert((await session()).currentLid === previous, '课程续学位置错误');
      await page.evaluate(() => {
        const value = JSON.parse(localStorage.getItem('sqltrain_session'));
        delete value.lastLearning; localStorage.setItem('sqltrain_session', JSON.stringify(value));
      });
      await page.reload(); await ready(); await tab('dash');
      await page.getByRole('button', { name: '继续学习', exact: true }).click();
      assert((await session()).currentLid === previous, '旧会话未兼容');
    });
    await check('快捷键按光标插入、替换选区、括号定位并自动保存', async () => {
      await question('q1');
      const editor = page.locator('#st-code');
      await editor.fill('FROM products');
      await editor.evaluate(element => element.setSelectionRange(0, 0));
      await page.locator('.st-sql-tools button').filter({ hasText: /^SELECT$/ }).click();
      assert(await editor.inputValue() === 'SELECT FROM products', '关键字没有按光标插入');
      await editor.fill('SELECT bad FROM products');
      await editor.evaluate(element => element.setSelectionRange(7, 10));
      await page.locator('.st-sql-tools button').filter({ hasText: /^\*$/ }).click();
      assert(await editor.inputValue() === 'SELECT * FROM products', '选区没有替换');
      await page.locator('.st-sql-tools button').filter({ hasText: /^\( \)$/ }).click();
      const caret = await editor.evaluate(element => ({ value: element.value, start: element.selectionStart, focused: document.activeElement === element }));
      assert(caret.value.slice(caret.start - 1, caret.start + 1) === '()' && caret.focused, '括号或输入焦点错误');
      assert((await session()).codes.q1 === caret.value, '快捷输入没有自动保存');
      await page.locator('.st-editor-schema>summary').click();
      assert((await page.locator('.st-editor-schema').innerText()).includes('product_name'), '编辑器旁缺少本题表结构');
      await page.screenshot({ path: 'output/playwright/batch2-mobile-editor.png', fullPage: true });
    });
    await check('失败定位差异，键盘可完成选题、输入、判题和下一题', async () => {
      await page.locator('#st-code').fill('SELECT product_name, price FROM products LIMIT 1');
      await page.locator('[data-act="run"]').click();
      assert((await page.locator('.st-difference').innerText()).includes('缺失记录'), '没有显示缺失记录');
      await page.locator('#st-code').fill('SELECT product_name, price FROM products ORDER BY price ASC');
      await page.keyboard.press('Control+Enter');
      assert((await page.locator('#st-verdict').innerText()).includes('排序不符合'), '排序差异说明丢失');
      await tab('dash');
      await page.locator('.st-path-details>summary').click();
      await page.locator('.st-qtarget[data-qid="q1"]').focus(); await page.keyboard.press('Enter');
      const answer = await page.evaluate(() => window.__SQLTRAIN__.QUESTIONS[0].answer);
      await page.locator('#st-code').focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText(answer);
      await page.keyboard.press('Control+Enter');
      assert((await page.locator('#st-verdict').innerText()).includes('通过！'), '键盘判题未通过');
      assert(await page.locator('#st-verdict').getAttribute('role') === 'status', '成功反馈没有读屏状态语义');
      assert(await page.locator('#st-verdict').evaluate(element => element === document.activeElement), '判题后焦点未进入结果');
      await page.keyboard.press('Tab');
      assert(await page.evaluate(() => document.activeElement.getAttribute('data-act') === 'open-q'), '结果后的下一步无法通过 Tab 到达');
      await page.keyboard.press('Enter');
      assert((await session()).currentQid !== 'q1', '键盘下一题没有生效');
    });
    await check('进行中的周测从首页续考，截止时间保持', async () => {
      await tab('exam'); await page.locator('[data-act="test-start"]').click();
      await page.locator('#st-test-code').fill('SELECT 1');
      const before = (await session()).test;
      await tab('dash'); await page.reload(); await ready();
      await page.getByRole('button', { name: '继续周测', exact: true }).click();
      assert((await session()).test.endAt === before.endAt, '续考改变截止时间');
      assert(await page.locator('#st-test-code').inputValue() === 'SELECT 1', '周测草稿丢失');
      assert(await page.locator('#panel-test .st-editor-schema').count() === 0, '闭卷周测不应提供表结构提示');
    });
    await check('四种宽度与四档字号均不撑宽主要页面', async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const failures = [];
      const inspect = async label => { try { await noOverflow(label); } catch (error) { failures.push(error.message); } };
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const size of ['m', 'l', 'xl', 'xxl']) {
          await font(size);
          await inspect(width + 'px ' + size + ' 我的');
          await tab('dash'); await inspect(width + 'px ' + size + ' 总览');
          for (const name of ['learn', 'practice', 'review', 'tpl', 'schema']) {
            await sub(name); await inspect(width + 'px ' + size + ' ' + name);
          }
          await tab('exam'); await inspect(width + 'px ' + size + ' 周测');
          await page.locator('#st-exam-seg [data-sub="wrong"]').click();
          await inspect(width + 'px ' + size + ' 错题本');
        }
      }
      assert(!failures.length, failures.join(' | '));
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    });
    await check('200% 字号真实放大、刷新保留，表格可键盘局部滚动', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await font('xxl'); await sub('schema'); await page.reload(); await ready();
      const metrics = await page.locator('#sqltrain-root').evaluate(element => ({ font: parseFloat(getComputedStyle(element).fontSize), zoom: getComputedStyle(document.documentElement).zoom }));
      assert(metrics.font >= 32 && Number(metrics.zoom) === 1, '未实现正文 200% 放大或仍使用整页 zoom：' + JSON.stringify(metrics));
      const headerFont = await page.locator('#panel-schema th').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
      assert(headerFont >= 28, '表头没有随文字字号放大');
      const region = page.locator('#panel-schema .st-table-scroll').first();
      assert(await region.evaluate(element => element.scrollWidth > element.clientWidth), '表格没有局部滚动区域');
      await region.focus(); await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('#panel-schema .st-table-scroll').scrollLeft > 0);
      await noOverflow('390px 200% 表格键盘滚动');
      await page.screenshot({ path: 'output/playwright/batch2-large-schema.png', fullPage: true });
    });
    await check('手机和平板高频点击目标独立且至少 44px', async () => {
      await font('m');
      for (const width of [390, 768]) {
        await page.setViewportSize({ width, height: 900 }); await tab('dash');
        if (!await page.locator('.st-path-details').evaluate(element => element.open)) await page.locator('.st-path-details>summary').click();
        const targets = await page.locator('.st-qtarget').evaluateAll(elements => elements.map(element => {
          const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }));
        assert(targets.length === 42 && targets.every(rect => rect.width >= 44 && rect.height >= 44), '题目点击区未达标');
        for (let index = 0; index < targets.length; index++) {
          for (let other = index + 1; other < targets.length; other++) {
            const first = targets[index], second = targets[other];
            assert(!(first.x < second.x + second.width && first.x + first.width > second.x && first.y < second.y + second.height && first.y + first.height > second.y), '相邻题目点击区域重叠');
          }
        }
        await question('q1');
        const small = await page.locator('#panel-practice button:visible').evaluateAll(elements => elements.filter(element => {
          const rect = element.getBoundingClientRect(); return rect.width < 43.9 || rect.height < 43.9;
        }).map(element => element.textContent));
        assert(!small.length, '练习控件点击区偏小：' + small.join('、'));
      }
    });
    await check('子页状态可读、方向键切换，备份和同步字段具备标签', async () => {
      await sub('learn');
      await page.locator('#st-train-seg [data-sub="learn"]').focus();
      await page.keyboard.press('ArrowRight');
      const selected = page.locator('#st-train-seg [aria-pressed="true"]');
      assert(await selected.count() === 1 && await selected.getAttribute('data-sub') === 'practice', '分段状态或方向键错误');
      assert(await selected.getAttribute('aria-controls') === 'panel-practice', '分段指向错误面板');
      await tab('me');
      for (const title of ['备份与迁移', '云同步']) await page.locator('#panel-me .st-mrow>summary').filter({ hasText: title }).click();
      for (const id of ['st-import-code', 'st-sync-token', 'st-sync-gistid', 'st-sync-base', 'st-sync-id', 'st-sync-key', 'st-sync-code']) {
        assert(await page.locator('label[for="' + id + '"]').count() === 1, id + ' 缺少明确标签');
      }
      await noOverflow('768px 展开的数据管理');
    });
    await check('命令面板具有对话框语义、焦点约束、退出恢复与无结果反馈', async () => {
      await tab('dash'); await page.locator('#tab-dash').focus();
      await page.keyboard.press('Control+k');
      assert(await page.getByRole('dialog', { name: '搜索并跳转' }).isVisible(), '命令面板缺少对话框语义');
      assert(await page.locator('#cmdk-input').evaluate(element => element === document.activeElement), '打开搜索未聚焦输入');
      for (let index = 0; index < 14; index++) {
        await page.keyboard.press('Tab');
        assert(await page.evaluate(() => !!document.activeElement.closest('#cmdk')), 'Tab 离开模态框');
      }
      await page.keyboard.press('Escape');
      assert(await page.locator('#tab-dash').evaluate(element => element === document.activeElement), '退出后焦点未恢复');
      await page.keyboard.press('Control+k'); await page.locator('#cmdk-input').fill('不存在的内容 xyz');
      assert((await page.locator('#cmdk-count').innerText()).includes('没有匹配'), '无结果缺少可读反馈');
      await page.locator('#cmdk-input').fill('微课');
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
      assert(await page.locator('#st-lpanel h2').isVisible(), '搜索结果无法键盘打开');
    });
    await check('减少动画覆盖底栏，模拟键盘收起底栏且不误判页面缩放', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await question('q1');
      const motion = await page.locator('#st-tabpill').evaluate(element => ({ animation: getComputedStyle(element).animationName, transition: getComputedStyle(element).transitionDuration }));
      assert(motion.animation === 'none' && /^0s(?:, 0s)*$/.test(motion.transition), '底栏仍有动画');
      const keyboard = await page.locator('#st-code').evaluate(element => {
        element.focus();
        const viewport = window.visualViewport;
        const height = Object.getOwnPropertyDescriptor(viewport, 'height');
        const scale = Object.getOwnPropertyDescriptor(viewport, 'scale');
        try {
          Object.defineProperty(viewport, 'height', { configurable: true, value: innerHeight - 320 });
          Object.defineProperty(viewport, 'scale', { configurable: true, value: 1 });
          viewport.dispatchEvent(new Event('resize'));
          const hidden = getComputedStyle(document.querySelector('body>.nav')).visibility === 'hidden';
          Object.defineProperty(viewport, 'scale', { configurable: true, value: 2 });
          viewport.dispatchEvent(new Event('resize'));
          return { hidden, pinch: document.documentElement.classList.contains('st-keyboard') };
        } finally {
          if (height) Object.defineProperty(viewport, 'height', height); else delete viewport.height;
          if (scale) Object.defineProperty(viewport, 'scale', scale); else delete viewport.scale;
          viewport.dispatchEvent(new Event('resize'));
        }
      });
      assert(keyboard.hidden && !keyboard.pinch, '键盘避让或缩放识别错误');
    });
    await check('深浅色内容面稳定，宽屏导航仍可使用', async () => {
      await tab('me'); await page.locator('[data-mo="dark"]').click();
      await question('q1');
      const dark = await page.locator('#st-qpanel').evaluate(element => getComputedStyle(element).backgroundColor);
      assert(/^rgb\(/.test(dark), '深色正文仍为透明玻璃');
      await tab('me'); await page.locator('[data-mo="light"]').click();
      await page.setViewportSize({ width: 1440, height: 1000 }); await tab('dash');
      assert(await page.locator('#tab-dash').evaluate(element => !!element.closest('.st-sidebar')), '宽屏导航未回到侧栏');
      assert(await page.locator('#st-breadcrumb-current').textContent() === '今天', '宽屏应用标题与页面不一致');
      await page.screenshot({ path: 'output/playwright/batch2-desktop-home.png', fullPage: true });
    });
    assert(!errors.length && !warnings.length, '浏览器异常：' + errors.concat(warnings).join(' | '));
    return { ok: true, checks, layoutChecks: layouts.length, errors, warnings };
  } catch (error) {
    return { ok: false, checks, layoutChecks: layouts.length, failure: error.stack || String(error), errors, warnings };
  }
}
