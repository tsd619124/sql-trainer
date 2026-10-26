const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const [modulePath, scriptPath, url] = process.argv.slice(2);
const {chromium} = require(modulePath);
const root = path.resolve(__dirname, '..');

(async () => {
  let browser;
  let result;
  const lifecycle = [];
  try {
    const source = fs.readFileSync(scriptPath, 'utf8').replace("'__SQLTRAIN_FILE_URL__'", JSON.stringify(require('node:url').pathToFileURL(path.join(root, 'index.html')).href));
    const phases = [];
    const pwa = path.basename(scriptPath) === 'pwa.browser.js';
    for (const phase of pwa ? ['install', 'failures', 'update'] : ['full']) {
      lifecycle.length = 0;
      browser = await chromium.launch({channel: 'chrome', headless: true});
      browser.on('disconnected', () => lifecycle.push('browser disconnected'));
      try {
        const context = await browser.newContext();
        const page = await context.newPage();
        page.on('crash', () => lifecycle.push('page crashed'));
        page.on('close', () => lifecycle.push('page closed'));
        page.setDefaultTimeout(10000);
        if (pwa) await page.request.get(new URL('/__fixture?stage=old', url).href);
        await page.goto(url);
        const run = vm.runInThisContext('(' + source.replace("'__SQLTRAIN_PWA_PHASE__'", JSON.stringify(phase)) + ')', {filename: scriptPath});
        const outcome = await run(page);
        if (!outcome.ok) outcome.lifecycle = [...lifecycle];
        phases.push(outcome);
      } finally {
        await browser.close();
        browser = null;
      }
      if (!phases.at(-1).ok) break;
    }
    result = phases.length === 1 ? phases[0] : {
      ok: phases.every(part => part.ok), checks: phases.flatMap(part => part.checks),
      errors: phases.flatMap(part => part.errors || []),
      expectedHttpErrors: phases.reduce((total, part) => total + (part.expectedHttpErrors || 0), 0),
      failure: phases.find(part => !part.ok)?.failure,
      activeCheck: phases.find(part => !part.ok)?.activeCheck,
      lifecycle: phases.find(part => !part.ok)?.lifecycle,
    };
  } catch (error) {
    result = {ok: false, checks: [], failure: error.message};
  } finally {
    if (result && !result.ok && !result.lifecycle) result.lifecycle = [...lifecycle];
    if (browser) await browser.close();
  }
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
})();
