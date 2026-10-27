import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { QUESTIONS } from '../app/src/content/catalog.js';
import { PRACTICE_QUESTIONS } from '../app/src/content/enrichment.js';
import { buildEnrichmentDatabase, TRAINING_CASES } from '../app/src/content/enrichment-data.js';
import { createEnrichmentJudge } from '../app/src/engine/enrichment.js';
import { normalizeState, mergeStates } from '../app/src/domain/progress.js';

const module = { exports: {} };
vm.runInNewContext(readFileSync(new URL('../app/public/vendor/sql-wasm.js', import.meta.url), 'utf8'), {
  module, exports: module.exports, require: createRequire(import.meta.url), process, console, Buffer,
  TextDecoder, TextEncoder, setTimeout, clearTimeout, __dirname: new URL('../app/public/vendor', import.meta.url).pathname,
});
const runtime = await module.exports({ wasmBinary: readFileSync(new URL('../app/public/vendor/sql-wasm.wasm', import.meta.url)) });
const engine = createEnrichmentJudge(runtime);
const judge = { ...engine, query: (...args) => JSON.parse(JSON.stringify(engine.query(...args))) };
const question = id => PRACTICE_QUESTIONS.find(item => item.id === id);

test('42 核心题各有两层独立变式，SQL 占主要比例且专题与业务表完整', () => {
  assert.equal(PRACTICE_QUESTIONS.length, 109);
  assert.equal(new Set(PRACTICE_QUESTIONS.map(item => item.id)).size, 109);
  for (const core of QUESTIONS) assert.deepEqual(PRACTICE_QUESTIONS.filter(item => item.parentID === core.id).map(item => item.level), [2, 3], core.id);
  assert.equal(PRACTICE_QUESTIONS.filter(item => !['choice', 'predict'].includes(item.kind)).length, 101);
  for (const topic of ['连续登录', '中位数', '自连接', '有序漏斗']) assert.equal(PRACTICE_QUESTIONS.filter(item => item.topic === topic).length, 2);
  for (const item of PRACTICE_QUESTIONS) {
    assert.ok(item.mysql && item.dialectNote && item.explanation, item.id);
    if (item.choices) assert.equal(item.choices.filter(choice => choice.id === item.correctOption).length, 1, item.id);
  }
});

test('109 个参考查询分别在业务、边界和空集上通过，零行保留列数', () => {
  for (const item of PRACTICE_QUESTIONS) {
    const result = judge.grade(item, item.answer);
    assert.equal(result.passed, true, item.id + JSON.stringify(result.cases.map(entry => [entry.name, entry.passed])));
    assert.equal(result.cases.length, 3);
  }
  const empty = judge.query('SELECT user_id,name FROM users', 'empty');
  assert.deepEqual(empty, { cols: 2, rows: [] });
  assert.equal(judge.grade(question('q2-v2'), 'SELECT user_id FROM users WHERE 0').passed, false);
  assert.throws(() => judge.grade({ ...question('q2-v2'), answer: 'SELECT * FROM absent_reference_table' }, 'SELECT 1'), error => error.systemFailure === true);
});

test('专题结果由独立预期核对，拒绝重复日志、乱序漏斗与跨月错误', () => {
  const rows = id => judge.query(question(id).answer, 'edge').rows;
  assert.deepEqual(rows('topic-streak-1'), [[1,'2026-08-31','2026-09-02',3],[5,'2026-09-30','2026-10-03',4]]);
  assert.deepEqual(rows('topic-funnel-1'), [[5,2,2]]);
  assert.deepEqual(judge.query(question('topic-funnel-1').answer, 'standard').rows, [[4,1,1]]);
  assert.deepEqual(rows('topic-self-2'), [[1,2,'数码',100],[1,7,'数码',100],[2,7,'数码',100]]);
  assert.deepEqual(rows('topic-median-1'), [[100]]);
  assert.deepEqual(judge.query(question('topic-median-1').answer, 'empty').rows, [[null]]);
  const noDedup = question('topic-streak-1').answer.replace('SELECT DISTINCT user_id', 'SELECT user_id');
  assert.equal(judge.grade(question('topic-streak-1'), noDedup).passed, false);
  const unordered = "SELECT COUNT(DISTINCT CASE WHEN event_name='view' THEN user_id END),COUNT(DISTINCT CASE WHEN event_name='cart' THEN user_id END),COUNT(DISTINCT CASE WHEN event_name='pay' THEN user_id END) FROM events;";
  assert.equal(judge.grade(question('topic-funnel-1'), unordered).passed, false);
});

test('边界组拒绝标准数据上碰巧正确的错误答案和硬编码结果', () => {
  const sameName = 'SELECT u.user_id,u.name,COUNT(o.order_id) AS cnt FROM users u LEFT JOIN orders o ON o.user_id=u.user_id AND o.status=\'已完成\' GROUP BY u.name;';
  const item = question('q15-v2');
  const grade = judge.grade(item, sameName);
  assert.equal(grade.cases[0].passed, true);
  assert.equal(grade.cases[1].passed, false);
  const rows = judge.query(question('topic-funnel-1').answer).rows[0];
  assert.equal(judge.grade(question('topic-funnel-1'), 'SELECT ' + rows.join(',')).passed, false);
  for (const item of PRACTICE_QUESTIONS.filter(entry => entry.kind === 'debug')) assert.equal(judge.grade(item, item.starter).passed, false, item.id);
  const combined = judge.query(question('project-marketing').answer, 'standard').rows;
  assert.deepEqual(combined[0], [1,'秋季搜索','搜索',3,2,400,250,66.67,125]);
  assert.deepEqual(combined[3], [4,'未投放','搜索',0,0,0,0,null,null]);
});

test('中位数奇偶、并列和零花费分母使用独立计算验证', () => {
  for (const testCase of TRAINING_CASES) {
    const database = buildEnrichmentDatabase(runtime, testCase.id);
    try {
      const values = database.exec('SELECT price FROM products WHERE price IS NOT NULL ORDER BY price')[0]?.values.map(row => row[0]) || [];
      const middle = values.length ? (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2 : null;
      assert.deepEqual(judge.query(question('topic-median-1').answer, testCase.id).rows, [[middle]], testCase.id);
    } finally { database.close(); }
  }
  const wrongJoin = question('q13-v3').answer.replace(' AND i.warehouse=s.warehouse', '');
  assert.equal(judge.grade(question('q13-v3'), wrongJoin).passed, false);
  assert.deepEqual(judge.query(question('complete-ratio').answer, 'empty').rows, [[null]]);
  assert.equal(judge.query(question('q35-v3').answer, 'edge').rows.every(row => row[1] === 0 && row[2] === null), true);
});

test('拓展独立证据、草稿关联和项目笔记可备份合并，不改写核心记录', () => {
  const expanded = normalizeState({ v: 1, done: { 'q1-v2': { ts: 5, used: 0 } },
    notes: { 'project-marketing': '口径与思路\n按活动聚合\n结果解释\n收入不是增量归因' },
    evidence: { 'variant-event-1': { qid: 'q1-v2', ok: true, used: false, t: 5, kind: 'passed' } } });
  assert.ok(expanded);
  const original = normalizeState({ v: 1, done: { q1: { ts: 1, used: 0 } } });
  const merged = mergeStates(expanded, original);
  assert.ok(merged.done.q1 && merged.done['q1-v2']);
  assert.equal(merged.evidence['variant-event-1'].qid, 'q1-v2');
  assert.match(merged.notes['project-marketing'], /结果解释/);
});
