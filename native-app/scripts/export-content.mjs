import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { QUESTIONS, LESSONS, WEEKS, TEMPLATES, EXPLAINS } from '../../app/src/content/catalog.js';
import { buildDatabase } from '../../app/src/engine/dataset.js';
import { PRACTICE_QUESTIONS } from '../../app/src/content/enrichment.js';
import { buildEnrichmentDatabase, TRAINING_CASES, TRAINING_DATASETS } from '../../app/src/content/enrichment-data.js';
import { normalizeState, stampProgress, mergeStates } from '../../app/src/domain/progress.js';

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.dirname(directory);
const vendor = path.join(root, 'app/public/vendor');
const module = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(vendor, 'sql-wasm.js'), 'utf8'), {
  module, exports: module.exports, require: createRequire(import.meta.url), process, console,
  Buffer, TextEncoder, TextDecoder, setTimeout, clearTimeout, __dirname: vendor
});
const runtime = await module.exports({ wasmBinary: fs.readFileSync(path.join(vendor, 'sql-wasm.wasm')) });
const database = buildDatabase(runtime);
const sourceFiles = ['content/catalog.js', 'content/enrichment.js', 'content/variants.js', 'content/enrichment-data.js', 'engine/dataset.js', 'engine/enrichment.js', 'engine/judge.js', 'domain/grading.js', 'domain/progress.js', 'app/workspace.js', 'app/enrichment.js'];
const sourceSHA256 = crypto.createHash('sha256').update(sourceFiles.map(file => fs.readFileSync(path.join(root, 'app/src', file))).join('\n')).digest('hex');
const sourceVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const catalog = { schemaVersion: 1, sourceVersion, sourceSHA256, weeks: WEEKS, questions: QUESTIONS, practice: PRACTICE_QUESTIONS, lessons: LESSONS.map(lesson => ({ ...lesson, qs: lesson.qs || [] })), templates: TEMPLATES, explanations: EXPLAINS };
const golden = QUESTIONS.map(question => ({ id: question.id, ...database.exec(question.answer)[0] }));
const old = { v: 1, done: { q1: { ts: 1, used: 0 } }, wrong: { q2: 1 }, notes: { q1: '旧笔记' }, days: ['2026-10-25'], savedAt: 1 };
const normalized = normalizeState(old);
const changed = JSON.parse(JSON.stringify(normalized));
delete changed.wrong.q2;
changed.notes.q1 = '跨端笔记';
stampProgress(changed, normalized, 'native-fixture');
for (const records of Object.values(changed._sync.records)) for (const revision of Object.values(records)) if (revision.d === 'native-fixture') revision.t = 100;
changed.savedAt = 100;
const fixtures = { old, normalized, changed, merged: mergeStates(changed, normalized) };
const productLeft = normalizeState({
  v: 1, done: {}, savedAt: 100,
  learningProfile: { level: 'some', goal: 'job', minutes: 30, startWeek: 3, skipKnown: true, updatedAt: 100 },
  evidence: { 'product-event-1': { qid: 'q13', ok: false, used: false, kind: 'syntax', t: 100 } },
  tests: { 'product-exam-1': { id: 'product-exam-1', startedAt: 1, endedAt: 100, elapsed: 0.099, week: 3,
    results: [{ qid: 'q13', ok: false, kind: 'syntax', sql: 'SELEC 1' }] } }
});
const productRight = normalizeState({ v: 1, done: {}, savedAt: 200,
  evidence: { 'product-event-2': { qid: 'q13', ok: true, used: false, kind: 'passed', t: 200 } } });
const productFixtures = { left: productLeft, right: productRight, merged: mergeStates(productLeft, productRight) };
const code = 'native-fixture-code';
const iv = Buffer.from('00112233445566778899aabb', 'hex');
const key = crypto.pbkdf2Sync(code, 'sqltrain-sync-v1', 100000, 32, 'sha256');
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const encrypted = Buffer.concat([cipher.update(JSON.stringify(normalized), 'utf8'), cipher.final(), cipher.getAuthTag()]);
const encryptionFixture = { code, plaintext: normalized, payload: JSON.stringify({ enc: 'AES-GCM', v: 1, iv: iv.toString('base64'), data: encrypted.toString('base64') }) };
const workspace = fs.readFileSync(path.join(root, 'app/src/app/workspace.js'), 'utf8');
const guideSource = workspace.slice(workspace.indexOf('function pchk('), workspace.indexOf('  /* ---------- 事件 ---------- */'));
const panel = { innerHTML: '' };
const context = { document: { getElementById: () => panel }, state: { plan: {} }, esc: text => String(text), refreshIcons() {}, window: { scrollTo() {} } };
vm.runInNewContext(guideSource + ';renderPlanPage();', context);
const plainText = html => html.replace(/<\/(?:h[1-6]|p|div|tr|summary)>/g, '\n').replace(/<\/(?:td|th)>/g, ' | ').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').split('\n').map(line => line.trim()).filter(Boolean).join('\n\n');
const plan = plainText(panel.innerHTML);
const planHTML = panel.innerHTML;
vm.runInNewContext('renderCheatPage();', context);
function guideSections(html) {
  html = html.replace(/<summary\b[^>]*>([\s\S]*?)<\/summary>/g, '<h3>$1</h3>');
  const headings = [...html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/g)];
  const sections = [];
  if (headings[0]?.index > 0 && plainText(html.slice(0, headings[0].index))) sections.push({ title: '导读', body: html.slice(0, headings[0].index) });
  for (const [index, heading] of headings.entries()) sections.push({ title: plainText(heading[1]), body: html.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? html.length) });
  return sections.map((section, index) => ({
    id: 'section-' + index,
    title: section.title,
    text: plainText(section.body.replace(/<table\b[^>]*>[\s\S]*?<\/table>/g, '')),
    tables: [...section.body.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)].map((table, position) => ({
      id: 'table-' + position,
      rows: [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(row => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map(cell => plainText(cell[1])))
    })),
    links: [...section.body.matchAll(/<a\b[^>]*href="(https:\/\/[^"<>]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(link => ({ url: link[1], title: plainText(link[2]).replace(/\s*↗$/, '') }))
  }));
}
const guides = { plan, cheat: plainText(panel.innerHTML), checks: [...workspace.matchAll(/pchk\('([^']+)','([^']+)'\)/g)].map(match => ({ id: match[1], title: match[2] })), sections: { plan: guideSections(planHTML), cheat: guideSections(panel.innerHTML) } };
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const resources = path.join(directory, 'Sources/SQLLabCore/Resources');
const files = new Map([
  ['catalog.json', json(catalog)], ['training.sqlite', Buffer.from(database.export())],
  ['reference-results.json', json(golden)], ['compatibility.json', json(fixtures)], ['product-compatibility.json', json(productFixtures)], ['encryption-fixture.json', json(encryptionFixture)], ['guides.json', json(guides)]
]);
const practiceResults = [];
for (const testCase of TRAINING_CASES) {
  const sample = buildEnrichmentDatabase(runtime, testCase.id);
  try {
    practiceResults.push({ id: testCase.id, name: testCase.name, results: PRACTICE_QUESTIONS.map(question => {
      const statement = sample.prepare(question.answer);
      try {
        const columns = statement.getColumnNames(), values = [];
        while (statement.step()) values.push(statement.get());
        return { id: question.id, columns, values };
      } finally { statement.free(); }
    }) });
    files.set('training-' + testCase.id + '.sqlite', Buffer.from(sample.export()));
  } finally { sample.close(); }
}
files.set('practice-results.json', json(practiceResults));
files.set('training-datasets.json', json(TRAINING_DATASETS));
for (const [name, data] of files) {
  const target = path.join(resources, name);
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(target) || !fs.readFileSync(target).equals(data)) throw new Error(`原生资源与当前来源不一致：${name}`);
  } else {
    fs.mkdirSync(resources, { recursive: true });
    fs.writeFileSync(target, data);
  }
}
database.close();
console.log(JSON.stringify({ questions: QUESTIONS.length, practice: PRACTICE_QUESTIONS.length, cases: TRAINING_CASES.length, lessons: LESSONS.length, templates: TEMPLATES.length, sourceSHA256, status: process.argv.includes('--check') ? '一致' : '已导出' }));
