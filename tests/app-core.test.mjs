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

test('完整保留 3.0 的题库、课程、解析、模板与学习路径', () => {
  for (const name of ['QUESTIONS', 'LESSONS', 'WEEKS', 'TEMPLATES', 'EXPLAINS']) {
    assert.deepEqual(plain(catalog[name]), plain(legacy[name]), name);
  }
  assert.equal(catalog.QUESTIONS.length, 42);
  assert.equal(catalog.LESSONS.length, 28);
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
