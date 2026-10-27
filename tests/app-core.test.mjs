import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as catalog from '../app/src/content/catalog.js';
import { buildDatabase } from '../app/src/engine/dataset.js';
import { createJudge } from '../app/src/engine/judge.js';
import { normalizeState, mergeStates, stampProgress } from '../app/src/domain/progress.js';

const legacyHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const legacy = vm.createContext({});
vm.runInContext(legacyHtml.match(/\/\*__CORE_START__\*\/([\s\S]*?)\/\*__CORE_END__\*\//)[1], legacy);
const plain = value => JSON.parse(JSON.stringify(value));

test('质量修订保留原题、课程和模板标识，其余内容保持兼容', () => {
  for (const name of ['QUESTIONS', 'LESSONS', 'WEEKS', 'TEMPLATES', 'EXPLAINS']) {
    const current = plain(catalog[name]);
    const original = plain(legacy[name]);
    if (name === 'EXPLAINS') current.q33 = original.q33;
    else {
      const corrections = {
        QUESTIONS: { q33: ['text', 'hint', 'answer', 'orderCols'] },
        LESSONS: { w3l4: ['secs'], w6l2: ['secs', 'biz', 'key'] },
        TEMPLATES: { '7日移动平均': ['code'] },
      }[name] || {};
      for (const item of current) {
        const identifier = item.id || item.name;
        const previous = original.find(entry => (entry.id || entry.name) === identifier);
        for (const field of corrections[identifier] || []) {
          if (Object.hasOwn(previous, field)) item[field] = previous[field];
          else delete item[field];
        }
      }
    }
    assert.deepEqual(current, original, name);
  }
  assert.equal(catalog.QUESTIONS.length, 42);
  assert.equal(catalog.LESSONS.length, 28);
});

test('新版学习证据经过 Web 备份与合并仍保留', () => {
  const progress = normalizeState({ v: 1, done: { q1: { ts: 1, used: 1 } },
    sr: { q1: { due: '2026-10-28', iv: 1, rep: 0, ef: 2.5, lapse: 0, last: '2026-10-27' } },
    history: [{ q: 'q1', s: 'SELEC 1', ok: 0, t: 1, kind: 'syntax', used: 1 }] });
  assert.equal(progress.sr.q1.last, '2026-10-27');
  assert.deepEqual(progress.history[0], { q: 'q1', s: 'SELEC 1', ok: 0, t: 1, kind: 'syntax', used: 1 });
  assert.deepEqual(mergeStates(progress, normalizeState({ v: 1, done: {} })).history, progress.history);
  assert.equal(normalizeState({ ...progress, history: [{ ...progress.history[0], kind: 'unknown' }] }), null);
  assert.equal(normalizeState({ ...progress, sr: { q1: { ...progress.sr.q1, last: '2026-02-30' } } }), null);
});

test('模块化进度服务兼容旧备份和删除修订', () => {
  const old = { v: 1, done: { q1: { ts: 1, used: 0 } }, wrong: { q2: 1 }, notes: { q1: '旧笔记' }, days: ['2026-10-25'], savedAt: 1 };
  const normalized = normalizeState(old);
  assert.deepEqual(plain(normalized), plain(legacy.normalizeState(old)));
  const changed = plain(normalized);
  delete changed.wrong.q2;
  stampProgress(changed, normalized, 'device-app');
  assert.equal(mergeStates(changed, normalized).wrong.q2, undefined);
  assert.equal(normalizeState({ ...old, days: 'invalid' }), null);
});

test('模块化 SQLite 引擎运行全部标准答案并隔离判题数据库', async () => {
  const module = { exports: {} };
  const context = { module, exports: module.exports, require: createRequire(import.meta.url), process, console, Buffer, TextDecoder, TextEncoder, setTimeout, clearTimeout, __dirname: new URL('../app/public/vendor', import.meta.url).pathname };
  vm.runInNewContext(readFileSync(new URL('../app/public/vendor/sql-wasm.js', import.meta.url), 'utf8'), context);
  const runtime = await module.exports({ wasmBinary: readFileSync(new URL('../app/public/vendor/sql-wasm.wasm', import.meta.url)) });
  const database = buildDatabase(runtime);
  const seed = database.export();
  const judge = createJudge(runtime, seed);
  for (const question of catalog.QUESTIONS) assert.equal(judge.grade(question, question.answer).passed, true, question.id);
  const movingAverage = catalog.QUESTIONS.find(question => question.id === 'q33');
  const actual = database.exec(movingAverage.answer)[0].values;
  const daily = new Map(database.exec("SELECT order_date, COUNT(*) FROM orders WHERE status='已完成' GROUP BY order_date ORDER BY order_date")[0].values);
  const dates = [...daily.keys()];
  const counts = [];
  const expected = [];
  for (let date = new Date(dates[0] + 'T00:00:00Z'); date.toISOString().slice(0, 10) <= dates.at(-1); date.setUTCDate(date.getUTCDate() + 1)) {
    const day = date.toISOString().slice(0, 10);
    const count = daily.get(day) || 0;
    counts.push(count);
    const window = counts.slice(-7);
    expected.push([day, count, Math.round(window.reduce((sum, value) => sum + value, 0) / window.length * 100) / 100]);
  }
  assert.deepEqual(plain(actual), expected);
  assert.ok(expected.some(row => row[1] === 0));
  assert.equal(judge.grade(movingAverage, "WITH d AS (SELECT order_date, COUNT(*) AS cnt FROM orders WHERE status='已完成' GROUP BY order_date) SELECT order_date, cnt, ROUND(AVG(cnt) OVER (ORDER BY order_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW),2) AS ma7 FROM d").passed, false);
  assert.equal(judge.grade(movingAverage, movingAverage.answer.replace('COUNT(o.order_id)', 'COUNT(*)')).passed, false);
  assert.equal(judge.grade(movingAverage, movingAverage.answer.replace('FROM daily ORDER BY order_date;', 'FROM daily ORDER BY order_date DESC;')).passed, false);
  const first = catalog.QUESTIONS[0];
  assert.equal(judge.grade(first, first.answer.replace('DESC', 'ASC')).passed, false);
  assert.throws(() => judge.query('DELETE FROM products'), /只接受查询/);
  assert.throws(() => judge.query('SELECT 1; SELECT 2;'), /一条查询/);
  assert.throws(() => judge.query('PRAGMA query_only=OFF; DELETE FROM products'), /只接受查询/);
  assert.equal(judge.grade(first, first.answer).passed, true);
  const second = buildDatabase(runtime);
  assert.deepEqual(plain(database.exec('SELECT * FROM orders')), plain(second.exec('SELECT * FROM orders')));
  database.close();
  second.close();
});
