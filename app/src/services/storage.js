export const STORAGE_KEYS = Object.freeze([
  'sqltrain_state', 'sqltrain_session', 'sqltrain_device', 'sqltrain_mode',
  'sqltrain_font', 'sqltrain_remind', 'sqltrain_snap', 'sqltrain_sync',
  'sqltrain_state_before_import', 'sqltrain_session_before_import',
]);

const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export async function createStorage({ webStorage, native }) {
  if (!native) {
    return {
      getItem: key => webStorage.getItem(key),
      setItem: (key, value) => webStorage.setItem(key, String(value)),
      removeItem: key => webStorage.removeItem(key),
      flush: async () => {},
    };
  }

  const { values: loaded, initialized } = await native.loadStore();
  const values = new Map();
  const pending = new Map();
  let scheduled = null;
  let writing = Promise.resolve();
  let failure = null;

  for (const key of STORAGE_KEYS) {
    const value = owns(loaded, key) ? loaded[key] : (initialized ? null : webStorage.getItem(key));
    if (typeof value === 'string') {
      values.set(key, value);
      if (!owns(loaded, key)) pending.set(key, value);
      if (key !== 'sqltrain_sync') webStorage.setItem(key, value);
    }
  }

  function queueWrite() {
    if (scheduled !== null) return;
    scheduled = setTimeout(() => {
      scheduled = null;
      flush().catch(error => {
        globalThis.dispatchEvent?.(new CustomEvent('sql-lab:storage-error', { detail: error.message }));
      });
    }, 80);
  }

  function flush() {
    if (scheduled !== null) clearTimeout(scheduled);
    scheduled = null;
    writing = writing.catch(() => {}).then(async () => {
      if (!pending.size) {
        if (failure) throw failure;
        return;
      }
      const batch = Object.fromEntries(pending);
      pending.clear();
      try {
        await native.saveStore(batch);
        failure = null;
        if (owns(batch, 'sqltrain_sync')) webStorage.removeItem('sqltrain_sync');
      } catch (error) {
        for (const [key, value] of Object.entries(batch)) {
          if (!pending.has(key)) pending.set(key, value);
        }
        failure = error;
        throw error;
      }
    });
    return writing;
  }

  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      if (!STORAGE_KEYS.includes(key)) throw new Error('无法保存未知的学习数据');
      const text = String(value);
      if (key !== 'sqltrain_sync') webStorage.setItem(key, text);
      values.set(key, text);
      pending.set(key, text);
      queueWrite();
    },
    removeItem(key) {
      if (!STORAGE_KEYS.includes(key)) throw new Error('无法移除未知的学习数据');
      webStorage.removeItem(key);
      values.delete(key);
      pending.set(key, null);
      queueWrite();
    },
    flush,
  };
  await flush();
  return storage;
}
