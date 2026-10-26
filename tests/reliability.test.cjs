// 运行：node --test tests/reliability.test.cjs（不需要安装依赖）
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const core = html.match(/\/\*__CORE_START__\*\/([\s\S]*?)\/\*__CORE_END__\*\//)[1];
const app = vm.createContext({});
vm.runInContext(core, app);
vm.runInContext('var testNow=100; Date.now=function(){return testNow}', app);
const plain = value => JSON.parse(JSON.stringify(value));
const normalize = value => app.normalizeState(value);
const fresh = () => normalize({v: 1, done: {}});
const merge = (a, b) => app.mergeStates(a, b);
function edit(before, device, time, change) {
  app.testNow = time;
  const after = plain(before);
  change(after);
  app.stampProgress(after, before, device);
  after.savedAt = time;
  assert.ok(normalize(after), '修改后的进度仍应符合结构');
  return after;
}
const rows = values => ({cols: values[0]?.length || 2, rows: values});

test('排序题拒绝逆序，普通题保持无序比较', () => {
  const ref = rows([['A', 20], ['B', 10]]);
  const wrong = rows([['B', 10], ['A', 20]]);
  assert.equal(app.cmpRows(wrong, ref, [1]), false);
  assert.equal(app.cmpRows(wrong, ref), true);
});
test('并列行允许换序，重复行必须保留数量', () => {
  const ref = rows([['A', 20], ['B', 20], ['C', 10]]);
  assert.equal(app.cmpRows(rows([['B', 20], ['A', 20], ['C', 10]]), ref, [1]), true);
  assert.equal(app.cmpRows(rows([['A', 20], ['A', 20], ['C', 10]]), ref, [1]), false);
  assert.equal(app.cmpRows(rows([['C', 10], ['B', 20], ['A', 20]]), ref, [1]), false);
});
test('NULL、空串、零各自独立，支持多列排序键和空结果', () => {
  assert.equal(app.cmpRows(rows([[null, 0]]), rows([['', 0]])), false);
  assert.equal(app.cmpRows(rows([[0, null]]), rows([[null, 0]])), false);
  const ref = rows([[null, 2, 'a'], [null, 2, 'b'], ['x', 1, 'c']]);
  assert.equal(app.cmpRows(rows([[null, 2, 'b'], [null, 2, 'a'], ['x', 1, 'c']]), ref, [0, 1]), true);
  assert.equal(app.cmpRows({cols: 2, rows: []}, {cols: 2, rows: []}, [1]), true);
  assert.equal(app.cmpRows({cols: 1, rows: []}, {cols: 2, rows: []}), false);
});
test('仅对题目明确要求输出排序的题声明顺序，窗口内部排序不误判', () => {
  assert.deepEqual(plain(app.QUESTIONS.filter(q => q.orderCols).map(q => q.id)),
    ['q1', 'q2', 'q3', 'q8', 'q13', 'q15', 'q25', 'q39']);
  assert.equal(app.QUESTIONS.length, 42);
  assert.equal(app.LESSONS.length, 28);
});
test('有效旧版备份补齐默认字段且不改变原对象', () => {
  const old = {v: 1, done: {q1: {ts: 10, used: 0}}, wrong: {q2: 2}, notes: {q1: '旧笔记'}, days: ['2026-10-25'], savedAt: 100};
  const before = JSON.stringify(old), result = normalize(old);
  assert.ok(result);
  assert.deepEqual(plain(result.done), old.done);
  assert.equal(result.notes.q1, '旧笔记');
  assert.deepEqual(plain(result.attempts), {});
  assert.equal(JSON.stringify(old), before);
  assert.deepEqual(plain(normalize(plain(result))), plain(result));
});
const invalidCases = [
  ['版本', {v: 2}], ['完成映射数组', {done: []}], ['完成映射为空', {done: null}],
  ['完成记录类型', {done: {q1: 1}}], ['无效完成时间', {done: {q1: {ts: -1}}}],
  ['未知题目', {wrong: {q999: 1}}], ['错题类型', {wrong: {q1: '2'}}],
  ['尝试次数', {attempts: {q1: -1}}], ['笔记类型', {notes: {q1: {text: 'x'}}}],
  ['课程 ID', {lessons: {w99l1: 1}}], ['计划 ID', {plan: {unknown: 1}}],
  ['打卡字符串', {days: '2026-10-25'}], ['无效日期', {days: ['2026-02-30']}],
  ['日期格式', {days: ['2026-2-1']}], ['复习排程', {sr: {q1: {due: '2026-02-30', iv: 1, rep: 1, ef: 2.5}}}],
  ['历史类型', {history: {}}], ['存储时间', {savedAt: '100'}],
  ['修订类型', {_sync: {reset: {t: 0, d: ''}, records: {wrong: []}}}],
  ['未知修订 ID', {_sync: {reset: {t: 0, d: ''}, records: {wrong: {q999: {t: 1, d: 'a', deleted: 1}}}}}],
  ['无效考试结果', {lastTest: {id: 'bad'}}]
];
for (const [name, invalid] of invalidCases) test('拒绝无效备份：' + name, () => {
  const input = Object.assign({v: 1, done: {}}, invalid), before = JSON.stringify(input);
  assert.equal(normalize(input), null);
  assert.equal(JSON.stringify(input), before);
});
test('校验剥离备份里的未知顶层字段，不传递认证信息', () => {
  const result = normalize({v: 1, done: {}, token: 'synthetic-test-value', syncConfig: {key: 'synthetic'}});
  assert.ok(result);
  assert.equal('token' in result, false);
  assert.equal('syncConfig' in result, false);
});
test('拒绝原型键，非法 JSON 不产生副作用', () => {
  assert.throws(() => app.parseSafeJSON('{"v":1,"done":{},"__proto__":{"polluted":true}}'));
  assert.throws(() => app.parseSafeJSON('{"constructor":{}}'));
  assert.equal({}.polluted, undefined);
});
test('错题删除标记阻止旧设备与旧版备份复活记录', () => {
  const old = normalize({v: 1, done: {}, wrong: {q1: 2}, savedAt: 100});
  const removed = edit(old, 'device-a', 200, s => { delete s.wrong.q1; });
  assert.equal(merge(removed, old).wrong.q1, undefined);
  assert.equal(merge(old, removed).wrong.q1, undefined);
  assert.equal(merge(normalize(plain(removed)), old).wrong.q1, undefined);
});
test('新笔记替换旧笔记，清空笔记也是可同步的删除', () => {
  const old = normalize({v: 1, done: {}, notes: {q1: '旧'}, savedAt: 100});
  const newer = edit(old, 'device-b', 200, s => { s.notes.q1 = '新笔记'; });
  assert.equal(merge(old, newer).notes.q1, '新笔记');
  const removed = edit(newer, 'device-a', 300, s => { delete s.notes.q1; });
  assert.equal(merge(removed, newer).notes.q1, undefined);
});
test('仅尝试次数与复习安排变化也能合并和持久化', () => {
  const old = normalize({v: 1, done: {}, attempts: {q1: 1}, sr: {q1: {due: '2026-10-26', iv: 1, rep: 1, ef: 2.5}}, savedAt: 100});
  const newer = edit(old, 'device-b', 200, s => {
    s.attempts.q1 = 3;
    s.sr.q1 = {due: '2026-10-29', iv: 3, rep: 2, ef: 2.5, lapse: 0};
  });
  const reopened = normalize(plain(merge(old, newer)));
  assert.equal(reopened.attempts.q1, 3);
  assert.equal(reopened.sr.q1.due, '2026-10-29');
});
test('课程、计划取消完成与打卡合并保留正确语义', () => {
  const old = normalize({v: 1, done: {}, lessons: {w1l1: 1}, plan: {env_mysql: 1}, days: ['2026-10-25'], savedAt: 100});
  const newer = edit(old, 'device-b', 200, s => {
    delete s.lessons.w1l1; delete s.plan.env_mysql; s.days.push('2026-10-26');
  });
  const result = merge(old, newer);
  assert.equal(result.lessons.w1l1, undefined);
  assert.equal(result.plan.env_mysql, undefined);
  assert.deepEqual(plain(result.days), ['2026-10-25', '2026-10-26']);
});
test('清空屏障阻止旧进度重现，之后的新学习仍可同步', () => {
  const old = normalize({v: 1, done: {q1: {ts: 100, used: 0}}, wrong: {q2: 2}, notes: {q1: '旧'}, days: ['2026-10-25'], savedAt: 100});
  app.testNow = 200;
  const reset = app.rebaseProgress(fresh(), old, 'device-a');
  reset.savedAt = 200;
  const clean = merge(reset, old);
  assert.deepEqual(plain(clean.done), {});
  assert.deepEqual(plain(clean.wrong), {});
  assert.deepEqual(plain(clean.notes), {});
  assert.deepEqual(plain(clean.days), []);
  const learned = edit(clean, 'device-b', 300, s => { s.done.q2 = {ts: 300, used: 0}; });
  assert.ok(merge(reset, learned).done.q2);
  assert.equal(merge(learned, old).done.q1, undefined);
});
test('旧快照可以回滚，新修订阻止同步把误操作加回来', () => {
  const snapshot = normalize({v: 1, done: {q1: {ts: 100, used: 0}}, notes: {q1: '保留'}, savedAt: 100});
  const current = edit(snapshot, 'device-a', 200, s => { s.done.q2 = {ts: 200, used: 0}; s.notes.q1 = '误改'; });
  app.testNow = 300;
  const restored = app.rebaseProgress(snapshot, current, 'device-a');
  const result = merge(restored, current);
  assert.ok(result.done.q1);
  assert.equal(result.done.q2, undefined);
  assert.equal(result.notes.q1, '保留');
  assert.ok(normalize(plain(result)));
});
test('合并可交换、可重复、可结合，且不修改输入', () => {
  const base = fresh();
  const a = edit(base, 'device-a', 200, s => { s.notes.q1 = 'A'; });
  const b = edit(base, 'device-b', 200, s => { s.notes.q1 = 'B'; s.wrong.q2 = 1; });
  const c = edit(b, 'device-c', 300, s => { delete s.wrong.q2; s.days.push('2026-10-26'); });
  const before = JSON.stringify([a, b, c]);
  assert.deepEqual(plain(merge(a, b)), plain(merge(b, a)));
  const ab = merge(a, b);
  assert.deepEqual(plain(merge(ab, b)), plain(ab));
  assert.deepEqual(plain(merge(merge(a, b), c)), plain(merge(a, merge(b, c))));
  assert.equal(JSON.stringify([a, b, c]), before);
});
test('逻辑修订时钟超过已有修订，避免设备时钟落后覆盖新数据', () => {
  const state = edit(fresh(), 'device-a', 1000, s => { s.notes.q1 = 'A'; });
  const newer = edit(state, 'device-b', 100, s => { s.notes.q1 = 'B'; });
  assert.equal(merge(state, newer).notes.q1, 'B');
  assert.ok(newer._sync.records.notes.q1.t > state._sync.records.notes.q1.t);
});
test('无效远端不会污染本机，也不会被当成空进度合并', () => {
  const local = edit(fresh(), 'device-a', 100, s => { s.notes.q1 = '保留'; });
  const before = JSON.stringify(local);
  assert.throws(() => merge(local, {v: 1, done: {}, days: 'bad'}));
  assert.equal(JSON.stringify(local), before);
});

test('所有内联脚本保持可解析', () => {
  let count = 0;
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(m[1])) continue;
    new vm.Script(m[2], {filename: 'inline-' + (++count) + '.js'});
  }
  assert.equal(count, 7);
});
