let enginePromise;

export function loadSqlEngine() {
  if (!enginePromise) {
    enginePromise = Promise.resolve().then(() => {
      if (typeof globalThis.initSqlJs !== 'function') throw new Error('SQL 引擎文件未能加载');
      const wasm = new URL(import.meta.env.BASE_URL + 'vendor/sql-wasm.wasm', document.baseURI).href;
      return globalThis.initSqlJs({ locateFile: () => wasm });
    }).catch(error => {
      enginePromise = undefined;
      throw error;
    });
  }
  return enginePromise;
}
