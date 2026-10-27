import './styles/foundation.css';
import './styles/mobile.css';
import './styles/workspace.css';
import './styles/native.css';
import './styles/enrichment.css';
import { createStorage } from './services/storage.js';
import { createPlatform } from './platform/device.js';
import { startWorkspace } from './app/workspace.js';

async function boot() {
  const platform = createPlatform();
  document.documentElement.dataset.platform = platform.isNative ? 'ios' : 'web';
  const storage = await createStorage({ webStorage: localStorage, native: platform.isNative ? platform : null });
  await platform.refreshPermission();
  startWorkspace({ storage, platform });
  globalThis.__SQLTRAIN_PWA__?.start();
}

boot().catch(() => {
  const status = document.getElementById('app-startup-status');
  status.hidden = false;
  status.replaceChildren();
  const message = document.createElement('p');
  message.textContent = '暂时无法读取学习数据。原数据已保留，请重新打开应用。';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = '重新打开';
  retry.addEventListener('click', () => location.reload());
  status.append(message, retry);
});
