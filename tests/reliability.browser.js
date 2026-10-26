// 交给 playwright-cli run-code 执行此函数；只在独立浏览器会话中运行。
// 需先将源码目录通过 localhost HTTP 服务打开。同步全部使用拦截的虚拟服务。
async (page) => {
  const checks = [], errors = [], consoleMessages = [];
  const origin = new URL(page.url()).origin;
  const context = page.context();
  page.setDefaultTimeout(8000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => {
    if (['warning', 'error'].includes(message.type())) consoleMessages.push(message.type() + ': ' + message.text());
  });
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const equal = (a, b, message) => assert(JSON.stringify(a) === JSON.stringify(b), message);
  const ready = async p => p.waitForFunction(() => document.querySelector('#st-engine-text')?.textContent === '练习库就绪');
  const stored = async p => p.evaluate(() => JSON.parse(localStorage.getItem('sqltrain_state') || '{"v":1,"done":{}}'));
  const session = async p => p.evaluate(() => JSON.parse(localStorage.getItem('sqltrain_session')));
  const clean = async p => {
    await p.addInitScript(key => {
      if(!sessionStorage.getItem(key)) {
        for(const k of Object.keys(localStorage)) if(k.startsWith('sqltrain_')) localStorage.removeItem(k);
        sessionStorage.setItem(key,'1');
      }
    }, 'reliability-clean-'+Date.now());
    await p.reload(); await ready(p);
  };
  const practice = async p => { await p.locator('#tab-train').click(); await p.locator('#st-train-seg [data-sub="practice"]').click(); };
  const openQ = async (p, id) => { await practice(p); await p.locator('#panel-practice [data-act="open-q"][data-qid="' + id + '"]').first().click(); };
  const answer = async (p, id) => p.evaluate(id => window.__SQLTRAIN__.QUESTIONS.find(q => q.id === id).answer, id);
  const run = async (p, sql) => { await p.locator('#st-code').fill(sql); await p.locator('#panel-practice [data-act="run"]').click(); };
  const backups = async p => { await p.locator('#tab-me').click(); await p.locator('#panel-me summary').filter({hasText: '备份与迁移'}).first().click(); };
  const importCode = async (p, value, mode = 'replace') => { await p.locator('#st-import-code').fill(value); await p.locator('[data-act="import-' + mode + '"]').click(); };
  const check = async (name, work) => { await work(); checks.push(name); };
  try {
    await ready(page); await clean(page);
    await check('42 道标准答案与危险语句隔离', async () => {
      const result = await page.evaluate(() => {
        const api = window.__SQLTRAIN__, q = api.QUESTIONS[0];
        const rejected = ['DROP TABLE products', 'DELETE FROM products', 'PRAGMA query_only=OFF',
          'SELECT 1; DROP TABLE products', 'WITH x AS (SELECT 1) DELETE FROM products',
          'SELECT 1; SELECT 2'].map(sql => { try { api.gradeAnswer(q, sql); return false; } catch(e) { return true; } });
        return {all: api.QUESTIONS.every(q => api.gradeAnswer(q, q.answer).passed), rejected,
          tie: api.gradeAnswer(api.QUESTIONS.find(q => q.id === 'q8'), 'SELECT city, COUNT(*) AS n FROM users GROUP BY city ORDER BY n DESC, city DESC').passed};
      });
      assert(result.all && result.rejected.every(Boolean) && result.tie, '参考答案、并列顺序或危险 SQL 校验失败');
    });
    await check('普通练习拒绝错误排序，正确排序更新进度和复习安排', async () => {
      await openQ(page, 'q1');
      await run(page, 'SELECT product_name, price FROM products ORDER BY price ASC');
      assert((await page.locator('#st-verdict').innerText()).includes('排序不符合'), '逆序未被拒绝');
      let s = await stored(page); assert(s.wrong.q1 === 1 && !s.done.q1 && s.attempts.q1 === 1, '错误结果未保存');
      await run(page, await answer(page, 'q1'));
      s = await stored(page); assert(s.done.q1 && !s.wrong.q1 && s.attempts.q1 === 2 && s.sr.q1.rep === 1, '正确结果未保存');
    });
    await check('草稿、空草稿、笔记、题号和看过答案状态刷新恢复', async () => {
      await page.locator('#st-note').fill('排序要写 DESC');
      await page.locator('[data-act="show-answer"]').click();
      await page.locator('#st-code').fill('-- 未完成的草稿\nSELECT product_name');
      await page.reload(); await ready(page);
      equal(await page.locator('#st-code').inputValue(), '-- 未完成的草稿\nSELECT product_name', '草稿丢失');
      equal(await page.locator('#st-note').inputValue(), '排序要写 DESC', '即时笔记丢失');
      const ss = await session(page); assert(ss.currentQid === 'q1' && ss.topTab === 'train' && ss.viewed.q1, '页面或看答案记录丢失');
      await page.locator('#st-code').fill(''); await page.locator('#st-note').fill('');
      await page.reload(); await ready(page);
      equal(await page.locator('#st-code').inputValue(), '', '空草稿被默认内容覆盖');
      assert(!(await stored(page)).notes.q1, '清空笔记没有保存');
    });
    await check('学习子页与课程位置刷新恢复', async () => {
      await page.locator('#st-train-seg [data-sub="learn"]').click();
      await page.locator('[data-act="learn-view"][data-view="plan"]').click();
      await page.reload(); await ready(page);
      assert(await page.locator('[data-act="learn-view"][data-view="plan"]').evaluate(el => el.classList.contains('btn-primary')), '学习计划子页丢失');
      await page.locator('[data-act="learn-view"][data-view="course"]').click();
      await page.locator('#panel-learn [data-act="open-lesson"]').nth(1).click();
      const lid = (await session(page)).currentLid;
      await page.reload(); await ready(page);
      equal((await session(page)).currentLid, lid, '课程位置丢失');
    });
    await check('自由练习 DROP 与判题、数据表隔离，练习库可重置', async () => {
      await practice(page);
      await page.locator('#st-train-seg [data-sub="tpl"]').click();
      await page.locator('#panel-tpl [data-act="tpl-load"]').first().click();
      await page.locator('#st-code').fill('DROP TABLE products;'); await page.locator('[data-act="run-play"]').click();
      await page.locator('#st-code').fill('SELECT COUNT(*) FROM products'); await page.locator('[data-act="run-play"]').click();
      assert((await page.locator('#st-result').innerText()).includes('no such table'), '自由库未执行 DROP');
      const q1ok = await page.evaluate(() => window.__SQLTRAIN__.gradeAnswer(window.__SQLTRAIN__.QUESTIONS[0], window.__SQLTRAIN__.QUESTIONS[0].answer).passed);
      assert(q1ok, '自由 SQL 污染了判题库');
      await page.locator('[data-act="reset-db"]').click(); await page.locator('[data-act="run-play"]').click();
      assert(!(await page.locator('#st-result').innerText()).includes('SQL 错误'), '自由练习库无法重置');
      await page.locator('#st-train-seg [data-sub="schema"]').click();
      assert((await page.locator('#panel-schema').innerText()).includes('products'), '结构数据受到污染');
    });
    await check('无效进度码及文件不污染原数据', async () => {
      await backups(page); const before = await stored(page);
      await importCode(page, '{"v":1,"done":[],"wrong":{"q1":99}}');
      equal(await stored(page), before, '无效进度码改变原数据');
      await page.locator('#st-import-file').evaluate(el => {el.click=function(){};});
      await page.locator('[data-act="import-file"]').click();
      await page.locator('#st-import-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"v":1,"done":{},"days":"bad"}')});
      await page.waitForFunction(() => document.querySelector('#st-backup-status').textContent.includes('无法识别的备份文件'));
      equal(await stored(page), before, '无效文件改变原数据');
    });
    await check('旧版 JSON/base64 导入、旧快照回滚、应急撤销及清空恢复', async () => {
      const old = {v:1,done:{q2:{ts:10,used:0}},notes:{q2:'旧版备份笔记'},savedAt:20};
      const encoded = await page.evaluate(o => btoa(unescape(encodeURIComponent(JSON.stringify(o)))), old);
      await importCode(page, encoded, 'merge'); assert((await stored(page)).notes.q2 === old.notes.q2, 'base64 合并失败');
      const before = await stored(page);
      await importCode(page, JSON.stringify(old)); assert((await stored(page)).done.q2 && !(await stored(page)).done.q1, '旧 JSON 恢复失败');
      await page.locator('[data-act="backup-undo"]').click();
      equal((await stored(page)).done, before.done, '应急恢复未还原原进度');
      await page.evaluate(o => localStorage.setItem('sqltrain_snap',JSON.stringify({d:'2026-10-20',t:20,s:JSON.stringify(o)})), old);
      await page.locator('[data-act="snap-restore"]').click();
      assert((await stored(page)).done.q2 && !(await stored(page)).done.q1, '较旧快照无法回滚');
      await page.locator('[data-act="backup-undo"]').click();
      assert((await stored(page)).done.q1, '回滚后应急撤销失败');
      await page.locator('#panel-me summary').filter({hasText:'清空全部进度'}).click();
      await page.locator('[data-act="reset1"]').click(); await page.locator('#st-reset-confirm [data-act="reset1"]').click();
      equal((await stored(page)).done, {}, '清空没有执行');
      await page.locator('#panel-me summary').filter({hasText:'备份与迁移'}).first().click();
      await page.locator('[data-act="backup-undo"]').click();
      assert((await stored(page)).done.q1, '清空后的应急恢复失败');
    });
    await check('存储空间不足时恢复不半替换', async () => {
      const before = await stored(page);
      await page.evaluate(() => { window.testSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(k,v) {if(k === 'sqltrain_state') throw new DOMException('full','QuotaExceededError'); return window.testSetItem.call(this,k,v);}; });
      await importCode(page, '{"v":1,"done":{},"notes":{"q3":"不应导入"}}');
      equal(await stored(page), before, '写入失败改变了原存储');
      assert((await page.locator('#st-backup-status').innerText()).includes('原进度未改变'), '缺少失败提示');
      await page.evaluate(() => {Storage.prototype.setItem=window.testSetItem;delete window.testSetItem;});
      await page.reload(); await ready(page);
      equal((await stored(page)).done, before.done, '写入失败刷新后进度变化');
    });
    await check('周测试卷、答案、题号及原截止时间刷新恢复，结果不重复判卷', async () => {
      await page.locator('#tab-exam').click(); await page.locator('[data-act="test-start"]').click();
      const first = await session(page);
      const sql = await answer(page, first.test.qids[0]); await page.locator('#st-test-code').fill(sql);
      await page.locator('[data-act="test-next"]').click(); await page.locator('#st-test-code').fill('-- 第二题未完成');
      await page.reload(); await ready(page);
      const resumed = await session(page);
      equal(resumed.test.qids, first.test.qids, '周测重新抽题');
      assert(resumed.test.endAt === first.test.endAt && resumed.test.idx === 1 && resumed.codes['test_'+first.test.qids[0]] === sql, '时间、题号或答案未恢复');
      equal(await page.locator('#st-test-code').inputValue(),'-- 第二题未完成','当前答案未恢复');
      await page.locator('[data-act="test-finish"]').click();
      const result = (await stored(page)).lastTest, wrong = (await stored(page)).wrong;
      assert(result.results.find(r=>r.qid===first.test.qids[0]).ok, '保存的周测答案未参与判卷');
      await page.reload(); await ready(page);
      assert((await page.locator('#panel-test').innerText()).includes('本次成绩'), '刷新后成绩丢失');
      equal((await stored(page)).wrong, wrong, '已交卷试卷重复判卷');
      await page.locator('[data-act="test-home"]').click(); await page.locator('[data-act="test-start"]').click();
      const next = await session(page); assert(next.test.id !== first.test.id, '试卷 ID 未更新');
      assert(!Object.keys(next.codes).some(k => next.test.qids.some(id => k === 'test_'+id) && next.codes[k]), '新试卷沿用了旧答案');
    });
    await check('关闭期间超时自动交卷，错误排序拒绝且重复刷新不加错题', async () => {
      const expired = await session(page);
      expired.test={id:'timeout-test-0001',qids:['q1','q2'],idx:0,endAt:Date.now()-1000,remain:1,finished:false};
      expired.codes.test_q1='SELECT product_name, price FROM products ORDER BY price ASC';
      expired.codes.test_q2=await answer(page,'q2');
      await page.addInitScript(s => {
        if(!sessionStorage.getItem('reliability-expired-seeded')) {
          localStorage.setItem('sqltrain_session',JSON.stringify(s));
          sessionStorage.setItem('reliability-expired-seeded','1');
        }
      }, expired);
      await page.reload(); await ready(page);
      const result = (await stored(page)).lastTest;
      assert(result.id === expired.test.id && !result.results[0].ok && result.results[1].ok, '超时未自动判卷或排序规则不一致');
      const wrong = (await stored(page)).wrong;
      await page.reload(); await ready(page);
      equal((await stored(page)).wrong,wrong,'超时试卷重复判卷');
      assert(!(await session(page)).test,'超时试卷未清理');
    });
    await check('390px 与 1440px 主要页面可用，离线重开仍能恢复和判题', async () => {
      for(const width of [390,1440]) {
        await page.setViewportSize({width,height:900});
        for(const id of ['dash','train','exam','me']) {
          await page.locator('#tab-'+id).click();
          assert(await page.locator('#panel-'+id).isVisible(),width+'px 页面未显示：'+id);
        }
      }
      await page.evaluate(async () => {await navigator.serviceWorker.ready;});
      await page.reload(); await ready(page);
      await context.setOffline(true);
      await page.reload(); await ready(page);
      assert(await page.evaluate(() => window.__SQLTRAIN__.gradeAnswer(window.__SQLTRAIN__.QUESTIONS[0], window.__SQLTRAIN__.QUESTIONS[0].answer).passed), '离线无法判题');
      await context.setOffline(false);
    });
    assert(!errors.length, '浏览器运行错误：'+errors.join('; '));
    assert(!consoleMessages.length, '浏览器控制台错误或警告：'+consoleMessages.join('; '));
    return {ok:true, checks, errors, consoleMessages};
  } catch(e) {
    await context.setOffline(false);
    return {ok:false, checks, failure:e.message, errors, consoleMessages, url:page.url()};
  }
}
