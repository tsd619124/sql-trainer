import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage } from '../app/src/services/storage.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test('Web 存储直接兼容现有键与浏览器跨页修改', async () => {
  const webStorage = memoryStorage({ sqltrain_state: 'legacy-progress' });
  const storage = await createStorage({ webStorage });
  assert.equal(storage.getItem('sqltrain_state'), 'legacy-progress');
  webStorage.setItem('sqltrain_state', 'changed-in-another-tab');
  assert.equal(storage.getItem('sqltrain_state'), 'changed-in-another-tab');
  storage.setItem('sqltrain_session', 'draft');
  await storage.flush();
  assert.equal(webStorage.getItem('sqltrain_session'), 'draft');
});

test('iOS 采用本机文件数据并把旧 WebView 配置迁入系统存储', async () => {
  const batches = [];
  const webStorage = memoryStorage({ sqltrain_state: 'stale-cache', sqltrain_sync: 'synthetic-config' });
  const native = { loadStore: async () => ({ values: { sqltrain_state: 'native-progress' }, initialized: false }), saveStore: async values => batches.push(values) };
  const storage = await createStorage({ webStorage, native });
  assert.equal(storage.getItem('sqltrain_state'), 'native-progress');
  assert.equal(batches[0].sqltrain_sync, 'synthetic-config');
  assert.equal(webStorage.getItem('sqltrain_sync'), null);
  storage.setItem('sqltrain_sync', 'synthetic-new-config');
  storage.setItem('sqltrain_session', 'draft');
  await storage.flush();
  assert.equal(batches.at(-1).sqltrain_sync, 'synthetic-new-config');
  assert.equal(batches.at(-1).sqltrain_session, 'draft');
  assert.equal(webStorage.getItem('sqltrain_sync'), null);
});

test('iOS 写入失败可重试，较新的草稿优先，不丢失删除操作', async () => {
  const batches = [];
  let fail = false;
  const native = {
    loadStore: async () => ({ values: {}, initialized: false }),
    async saveStore(values) {
      if (fail) throw new Error('模拟磁盘不可写');
      batches.push(values);
    },
  };
  const storage = await createStorage({ webStorage: memoryStorage(), native });
  fail = true;
  storage.setItem('sqltrain_session', 'draft-one');
  await assert.rejects(storage.flush(), /不可写/);
  storage.setItem('sqltrain_session', 'draft-two');
  storage.removeItem('sqltrain_font');
  fail = false;
  await storage.flush();
  assert.equal(batches.at(-1).sqltrain_session, 'draft-two');
  assert.equal(batches.at(-1).sqltrain_font, null);
  assert.equal(storage.getItem('sqltrain_session'), 'draft-two');
});

test('本机文件读取失败时阻止启动，避免把空数据覆盖回去', async () => {
  let written = false;
  const native = { loadStore: async () => { throw new Error('读取失败'); }, saveStore: async () => { written = true; } };
  await assert.rejects(createStorage({ webStorage: memoryStorage(), native }), /读取失败/);
  assert.equal(written, false);
});

test('原生存储已初始化时，已删除的设置不会被旧 WebView 缓存复活', async () => {
  const webStorage = memoryStorage({ sqltrain_font: 'xxl', sqltrain_sync: 'synthetic-old-config' });
  const native = { loadStore: async () => ({ values: {}, initialized: true }), saveStore: async () => {} };
  const storage = await createStorage({ webStorage, native });
  assert.equal(storage.getItem('sqltrain_font'), null);
  assert.equal(storage.getItem('sqltrain_sync'), null);
});
