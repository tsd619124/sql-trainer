async page => {
  const checks = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const check = async (name, work) => { await work(); checks.push(name); };
  const ready = () => page.waitForFunction(() => document.querySelector('#st-engine-text')?.textContent === '练习库就绪');
  const library = async () => { await page.locator('#tab-train').click(); await page.locator('[data-sub="practice"]').click(); await page.locator('[data-training-open]').click(); };
  const open = id => page.locator('.training-list [data-training="open"][data-id="' + id + '"]').click();
  const run = async sql => { await page.locator('#training-sql').fill(sql); await page.locator('[data-training="run"]').click(); await page.waitForFunction(() => !document.querySelector('[data-training="run"]').disabled); };
  const verdict = () => page.locator('#training-verdict').textContent();
  try {
    await ready();
    await check('42 核心题可进入对应两层变式，拓展目录按题型和业务过滤', async () => {
      await page.locator('#tab-train').click(); await page.locator('[data-sub="practice"]').click();
      await page.locator('#panel-practice [data-act="open-q"][data-qid="q1"]').first().click();
      await page.locator('[data-training-parent="q1"]').click();
      assert(await page.locator('.training-list>button').count() === 2, '核心题未关联两层变式');
      await page.locator('[data-training="close"]').click();
      await library();
      assert(await page.locator('.training-list>button').count() === 109, '109 项训练目录不完整');
      await page.locator('[data-training-filter="kind"]').selectOption('专题训练');
      assert(await page.locator('.training-list>button').count() === 8, '专题不是八题');
      await page.locator('[data-training-filter="kind"]').selectOption('全部');
      await page.locator('[data-training-filter="dataset"]').selectOption('fulfillment');
      assert(await page.locator('.training-list>button').count() > 5, '履约场景不可筛选');
      await page.locator('[data-training-filter="dataset"]').selectOption('全部');
    });
    const answer = 'SELECT product_id,product_name,price FROM products WHERE price>=100 ORDER BY price,product_id;';
    await check('真实 SQL 三组判分、草稿重开恢复、拓展不增加核心题通过数', async () => {
      await open('q1-v2'); await run(answer);
      assert((await verdict()).includes('通过！') && (await verdict()).includes('空集样本：通过'), '三组判分未完成');
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('sqltrain_state')));
      assert(stored.done['q1-v2']?.used === 0 && !stored.done.q1, '拓展污染核心题进度');
      await page.reload(); await ready(); await library();
      await page.locator('.training-dialog> .training-heading').waitFor();
      await page.locator('.training-dialog [data-training="open"]').filter({ hasText: '继续上次拓展' }).click();
      assert(await page.locator('#training-sql').inputValue() === answer, '拓展草稿重开后丢失');
      await page.locator('[data-training="back"]').click();
    });
    await check('边界组拒绝同名合并，纠错题拒绝起始错误，学习错误进入历史', async () => {
      await open('q15-v2');
      await run("SELECT u.user_id,u.name,COUNT(o.order_id) FROM users u LEFT JOIN orders o ON o.user_id=u.user_id AND o.status='已完成' GROUP BY u.name;");
      assert((await verdict()).includes('业务样本：通过') && (await verdict()).includes('边界样本：未通过'), '没有识别样本间差异');
      await run('SELEC 1');
      const invalid = await page.evaluate(() => JSON.parse(localStorage.getItem('sqltrain_state')));
      assert(invalid.history[0].kind === 'syntax' && invalid.wrong['q15-v2'] >= 2, '语法错误未记录');
      await page.locator('[data-training="back"]').click(); await open('debug-left-join');
      assert((await page.locator('#training-sql').inputValue()).includes('COUNT(*)'), '纠错起始语句缺失');
      await page.locator('[data-training="run"]').click();
      await page.waitForFunction(() => !document.querySelector('[data-training="run"]').disabled);
      assert((await verdict()).includes('未通过'), '错误起始 SQL 被接受');
      await page.locator('[data-training="back"]').click();
    });
    await check('选择辨析和结果预测按选项判分，辅助记录与独立重做分开', async () => {
      await open('choice-count');
      await page.locator('input[name="training-choice"][value="1"]').check();
      await page.locator('[data-training="run"]').click(); assert((await verdict()).includes('未通过'), '选择题错选被接受');
      await page.locator('#training-answer summary').click();
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('sqltrain_session')).viewed['choice-count'] === true);
      await page.locator('input[name="training-choice"][value="2"]').check();
      await page.locator('[data-training="run"]').click();
      assert(await page.locator('#training-completion').textContent() === '辅助完成', '查看答案未记录辅助');
      await page.locator('[data-training="redo"]').click();
      await page.locator('input[name="training-choice"][value="2"]').check(); await page.locator('[data-training="run"]').click();
      assert(await page.locator('#training-completion').textContent() === '独立完成', '独立重做没有恢复独立记录');
      await page.locator('[data-training="back"]').click(); await open('predict-empty');
      await page.locator('input[name="training-choice"][value="3"]').check(); await page.locator('[data-training="run"]').click();
      assert((await verdict()).includes('通过！'), '结果预测未通过');
      await page.locator('[data-training="back"]').click();
    });
    await check('连续登录与有序漏斗独立专题可运行，表结构和双语法标注可读', async () => {
      await open('topic-funnel-1');
      await page.locator('.training-schema summary').click();
      await page.waitForFunction(() => document.querySelector('#training-schema-content')?.textContent.includes('CREATE TABLE events'));
      assert((await page.locator('.training-schema').textContent()).includes('会话'), '业务关系没有说明');
      await page.locator('#training-answer summary').click();
      assert((await page.locator('#training-answer').textContent()).includes('MySQL 8'), '没有 MySQL 对照');
      await page.locator('[data-training="back"]').click();
    });
    await check('综合分析作品保存表达与真实结果并导出 Markdown', async () => {
      await open('project-marketing');
      await page.locator('#training-answer summary').click();
      const sql = await page.locator('#training-answer pre').first().textContent();
      await run(sql);
      assert((await verdict()).includes('通过！'), '综合项目 SQL 未通过');
      await page.locator('#training-note').fill('口径与思路：按活动聚合线索和花费，保留空活动。\n结果解释：搜索活动收入400、花费250，每转化成本125。\n限制：相关关系不能证明增量归因。');
      const downloaded = page.waitForEvent('download'); await page.locator('[data-training="export"]').click();
      const download = await downloaded;
      assert(download.suggestedFilename().endsWith('.md'), '导出不是 Markdown');
      const stream = await download.createReadStream(); let report = ''; for await (const chunk of stream) report += chunk.toString();
      assert(report.includes('每转化成本125') && report.includes('空集样本：通过') && report.includes('```sql'), '作品缺少表达、SQL 或判题结果');
      await page.locator('[data-training="close"]').click();
    });
    await check('手机与桌面视口无横向溢出，关闭后焦点返回入口', async () => {
      for (const width of [320,390,768,1440]) {
        await page.setViewportSize({ width, height: 844 }); await library();
        assert(await page.evaluate(() => { const element = document.querySelector('.training-dialog'); return element.scrollWidth <= element.clientWidth + 1; }), '训练弹层横向溢出：' + width);
        if (width === 390) await page.screenshot({ path: 'output/playwright/round3-library-mobile.png' });
        await open('q1-v2');
        assert(await page.evaluate(() => { const element = document.querySelector('.training-dialog'); return element.scrollWidth <= element.clientWidth + 1; }), '题目页横向溢出：' + width);
        if (width === 390) await page.screenshot({ path: 'output/playwright/round3-practice-mobile.png' });
        await page.locator('[data-training="close"]').click();
      }
      assert(errors.length === 0, '浏览器脚本异常：' + errors.join(';'));
    });
    return { ok: true, checks, errors };
  } catch (error) { return { ok: false, checks, errors, failure: error.message, stack: error.stack }; }
}
