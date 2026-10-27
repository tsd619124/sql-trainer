import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeState, mergeStates, stampProgress, rebaseProgress } from '../app/src/domain/progress.js';

const fixture = JSON.parse(readFileSync(new URL('../native-app/Sources/SQLLabCore/Resources/product-compatibility.json', import.meta.url), 'utf8'));

test('原生路径、周测历史和独立作答证据经过 Web 往返不丢失', () => {
  assert.deepEqual(normalizeState(fixture.left), fixture.left);
  assert.deepEqual(mergeStates(fixture.left, fixture.right), fixture.merged);
  assert.deepEqual(mergeStates(fixture.right, fixture.left), fixture.merged);
  assert.deepEqual(mergeStates(fixture.merged, fixture.left), fixture.merged);
  assert.equal(Object.keys(fixture.merged.evidence).length, 2);
});

test('产品数据损坏时拒绝导入，不把错误载荷变成空进度', () => {
  const invalid = mutate => { const value = structuredClone(fixture.left); mutate(value); assert.equal(normalizeState(value), null); };
  invalid(value => { value.learningProfile.startWeek = 9; });
  invalid(value => { value.evidence['product-event-1'].qid = 'unknown'; });
  invalid(value => { value.evidence['product-event-1'].ok = true; });
  invalid(value => { value.tests['product-exam-1'].elapsed = 2701; });
  invalid(value => { value.tests['product-exam-1'].results[0].kind = 'unknown'; });
  invalid(value => { Object.defineProperty(value.evidence, '__proto__', { value: value.evidence['product-event-1'], enumerable: true }); });
});

test('恢复和删除修订覆盖产品记录，旧端数据不会使其复活', () => {
  const next = structuredClone(fixture.left);
  delete next.evidence['product-event-1'];
  stampProgress(next, fixture.left, 'product-delete');
  assert.equal(mergeStates(next, fixture.left).evidence['product-event-1'], undefined);
  const reset = rebaseProgress({ v: 1, done: {} }, fixture.left, 'product-reset');
  const merged = mergeStates(reset, fixture.left);
  assert.equal(merged.evidence['product-event-1'], undefined);
  assert.equal(merged.learningProfile, undefined);
});
