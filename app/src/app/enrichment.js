import { QUESTIONS } from '../content/catalog.js';
import { PRACTICE_QUESTIONS } from '../content/enrichment.js';
import { TRAINING_DATASETS, TRAINING_CASES } from '../content/enrichment-data.js';
import { createEnrichmentJudge } from '../engine/enrichment.js';
import { loadSqlEngine } from '../engine/runtime.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const label = question => ({ debug: 'SQL 纠错', complete: '补全语句', choice: '选择辨析', predict: '结果预测', project: '综合项目' })[question.kind] || (question.topic ? '专题训练' : question.level === 2 ? '条件变化' : '综合迁移');
const choiceQuestion = question => ['choice', 'predict'].includes(question.kind);

export function startEnrichment({ getState, updateState, getSession, updateSession }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'training-dialog';
  dialog.setAttribute('aria-labelledby', 'training-title');
  document.body.append(dialog);
  let selected = null;
  let parentID = null;
  let kind = '全部';
  let week = '0';
  let dataset = '全部';
  let result = null;
  let judgePromise;
  let running = false;
  const engine = () => judgePromise ||= loadSqlEngine().then(createEnrichmentJudge).catch(error => { judgePromise = null; throw error; });
  const saveSession = changes => {
    if (!updateSession(changes)) throw new Error('草稿未能保存，请先导出学习备份。');
  };
  const currentSQL = question => getSession().codes[question.id] ?? question.starter ?? '';
  const completed = question => getState().done[question.id] ? getState().done[question.id].used ? '辅助完成' : '独立完成' : '未完成';
  function heading(title) {
    return '<header class="training-heading"><div><p>SQL Lab · 分层训练</p><h1 id="training-title">' + escape(title) + '</h1></div><button type="button" class="btn" data-training="close" aria-label="关闭拓展训练">关闭</button></header>';
  }
  function library() {
    selected = null;
    const available = PRACTICE_QUESTIONS.filter(question => (!parentID || question.parentID === parentID) &&
      (kind === '全部' || label(question) === kind) && (week === '0' || question.w === Number(week)) &&
      (dataset === '全部' || question.dataset === dataset));
    const filters = ['全部','条件变化','综合迁移','专题训练','SQL 纠错','补全语句','选择辨析','结果预测','综合项目'];
    const options = (values, current) => values.map(([value, name]) => '<option value="' + escape(value) + '"' + (value === current ? ' selected' : '') + '>' + escape(name) + '</option>').join('');
    dialog.innerHTML = heading(parentID ? '同知识点三层训练' : '变式与专题训练') + '<div class="training-content">' +
      '<p>42 道基础核心 → 84 道条件变化与综合迁移。另有 8 道独立专题、16 道多题型训练和 1 个综合项目。</p>' +
      '<p class="training-muted">核心题与拓展分别记录。SQL 同时检查业务、边界、空集三组样本，面试表达使用人工自查标准。</p>' +
      (parentID ? '<p><b>基础核心：</b>' + escape(QUESTIONS.find(question => question.id === parentID)?.title) + '。基础题保留原入口；完成后在这里继续改变条件和业务场景。</p>' : '') +
      (getSession().lastPractice ? '<button type="button" class="btn" data-training="open" data-id="' + escape(getSession().lastPractice) + '">继续上次拓展</button>' : '') +
      '<div class="training-filters"><label>训练类型<select data-training-filter="kind">' + options(filters.map(item => [item,item]), kind) + '</select></label>' +
      '<label>学习周次<select data-training-filter="week">' + options([['0','全部八周'], ...Array.from({ length: 8 }, (_, index) => [String(index+1),'第 '+(index+1)+' 周'])], week) + '</select></label>' +
      '<label>业务场景<select data-training-filter="dataset">' + options([['全部','全部场景'], ...TRAINING_DATASETS.map(item => [item.id,item.name])], dataset) + '</select></label></div>' +
      '<p role="status">' + available.length + ' 项训练 · ' + available.filter(question => getState().done[question.id]?.used === 0).length + ' 项独立完成</p>' +
      '<div class="training-list">' + available.map(question => '<button type="button" data-training="open" data-id="' + question.id + '"><span><b>' + escape(question.title) + '</b><small>W' + question.w + ' · ' + label(question) + ' · ' + escape(TRAINING_DATASETS.find(item => item.id === question.dataset).name) + '</small></span><span>' + completed(question) + ' ›</span></button>').join('') + '</div></div>';
    dialog.scrollTop = 0;
  }
  function openQuestion(id) {
    const question = PRACTICE_QUESTIONS.find(item => item.id === id);
    if (!question) return;
    saveSession({ lastPractice: id });
    selected = question; result = null;
    const choices = choiceQuestion(question);
    const current = currentSQL(question);
    const analyzed = getState().notes[id] || '';
    const datasetInfo = TRAINING_DATASETS.find(item => item.id === question.dataset);
    dialog.innerHTML = heading(question.title) + '<div class="training-content">' +
      '<button type="button" class="btn" data-training="back">返回训练目录</button>' +
      '<p class="training-muted">W' + question.w + ' · ' + label(question) + ' · ' + escape(datasetInfo.name) + ' · <span id="training-completion">' + completed(question) + '</span></p>' +
      '<p class="training-prompt">' + escape(question.text) + '</p>' +
      '<details class="training-schema"><summary>业务口径、表结构与数据样例</summary><p>' + escape(datasetInfo.description) + '</p><p>' + TRAINING_CASES.map(item => escape(item.name + '：' + item.detail)).join('<br>') + '</p><div id="training-schema-content">正在读取表结构…</div></details>' +
      (choices ? (question.starter ? '<pre>' + escape(question.starter) + '</pre>' : '') + '<fieldset><legend>选择答案</legend>' + question.choices.map(option => '<label class="training-choice"><input type="radio" name="training-choice" value="' + option.id + '"' + (current === option.id ? ' checked' : '') + '>' + escape(option.text) + '</label>').join('') + '</fieldset>' :
        '<p class="training-muted">先解释口径和思路，再写 SQL，运行后解释结果。练习引擎：SQLite。</p><label for="training-sql">你的 SQL</label><textarea id="training-sql" spellcheck="false" maxlength="100000">' + escape(current) + '</textarea>') +
      '<div class="training-actions"><button type="button" class="btn btn-primary" data-training="run">' + (choices ? '提交选择' : '运行并判定') + '</button><button type="button" class="btn" data-training="redo">独立重做</button></div><div id="training-verdict" role="status" aria-live="polite"></div><div id="training-result"></div>' +
      '<details><summary>提示</summary><p>' + escape(question.hint) + '</p></details>' +
      '<details id="training-answer"><summary>参考答案与解析</summary>' + (choices ? '<p>正确选项：' + question.correctOption + '</p>' : '<h3>SQLite · 可运行参考</h3><pre>' + escape(question.answer) + '</pre><h3>MySQL 8 · 阅读对照</h3><pre>' + escape(question.mysql) + '</pre><p>' + escape(question.dialectNote) + '</p>') + '<p>' + escape(question.explanation) + '</p></details>' +
      (!choices ? '<section><h2>' + (question.kind === 'project' ? '面试表达与分析作品' : '口径、思路与结果解释') + '</h2><p class="training-muted">分两部分记录：取数口径与思路；结果数值、业务结论与适用限制。内容随进度备份。</p><label for="training-note">分析记录</label><textarea id="training-note" maxlength="10000">' + escape(analyzed) + '</textarea>' + (question.rubric ? '<ul>' + question.rubric.map(item => '<li>' + escape(item) + '</li>').join('') + '</ul><button class="btn" type="button" data-training="export">导出分析作品 Markdown</button><p class="training-muted">业务表达采用自查标准；SQL 判分不自动评价分析结论。</p>' : '') + '</section>' : '') + '</div>';
    dialog.scrollTop = 0;
    dialog.querySelector('#training-answer').addEventListener('toggle', () => {
      if (dialog.querySelector('#training-answer')?.open) {
        try { saveSession({ viewed: { [id]: true } }); } catch (error) { feedback(error.message); }
      }
    });
    engine().then(judge => {
      if (selected?.id !== id) return;
      const target = dialog.querySelector('#training-schema-content');
      target.innerHTML = question.tables.map(table => {
        const schema = judge.query("SELECT sql FROM sqlite_master WHERE name='" + table + "'").rows[0]?.[0] || '';
        return '<h3>' + escape(table) + '</h3><pre>' + escape(schema) + '</pre>' + tableMarkup(judge.query('SELECT * FROM ' + table + ' LIMIT 6'));
      }).join('');
    }).catch(error => { if (selected?.id === id) feedback('样本读取未完成：' + error.message); });
  }
  function tableMarkup(value) {
    if (!value) return '';
    return '<div class="training-table"><table><tbody>' + value.rows.slice(0,100).map(row => '<tr>' + row.map(cell => '<td>' + escape(cell === null ? 'NULL' : cell) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div><p class="training-muted">' + value.rows.length + ' 行 × ' + value.cols + ' 列' + (value.rows.length > 100 ? '（显示前 100 行）' : '') + '</p>';
  }
  function feedback(message) { dialog.querySelector('#training-verdict').textContent = message; }
  function record(question, sql, passed, errorKind) {
    const used = getSession().viewed[question.id] === true;
    if (!updateState(state => {
      const now = Date.now();
      const today = new Date().toLocaleDateString('sv-SE');
      state.attempts[question.id] = (state.attempts[question.id] || 0) + 1;
      if (passed) { state.done[question.id] = { ts: now, used: used ? 1 : 0 }; if (!used) delete state.wrong[question.id]; }
      else state.wrong[question.id] = (state.wrong[question.id] || 0) + 1;
      if (!state.days.includes(today)) state.days.push(today);
      const previous = state.sr[question.id] || {};
      const repetition = !passed || used ? 0 : previous.last === today ? Math.max(1, previous.rep || 0) : (previous.rep || 0) + 1;
      const interval = repetition < 2 ? 1 : previous.last === today ? Math.max(1, previous.iv || 1) : repetition === 2 ? 3 : Math.min(60, Math.round((previous.iv || 1) * (previous.ef || 2.5)));
      const due = new Date(); due.setDate(due.getDate() + interval);
      state.sr[question.id] = { due: due.toLocaleDateString('sv-SE'), iv: interval, rep: repetition, ef: previous.ef || 2.5, lapse: (previous.lapse || 0) + (passed ? 0 : 1), last: today };
      const kind = errorKind || (passed ? 'passed' : 'result');
      state.history = [{ q: question.id, s: sql, ok: passed ? 1 : 0, t: now, kind, used: used ? 1 : 0 }, ...(state.history || [])].slice(0,12);
      state.evidence ||= {}; state.evidence[crypto.randomUUID()] = { qid: question.id, ok: passed, used, t: now, kind };
    })) throw new Error('学习记录未能保存，请导出备份后重试。');
    dialog.querySelector('#training-completion').textContent = completed(question);
  }
  async function run() {
    if (!selected || running) return;
    const question = selected;
    const sql = choiceQuestion(question) ? dialog.querySelector('input[name="training-choice"]:checked')?.value : dialog.querySelector('#training-sql').value;
    if (!sql?.trim()) { feedback('请先完成作答。'); return; }
    const button = dialog.querySelector('[data-training="run"]');
    running = true; button.disabled = true; result = null;
    dialog.querySelector('#training-result').replaceChildren();
    try {
      saveSession({ codes: { [question.id]: sql } });
      feedback('正在判定…');
      if (choiceQuestion(question)) {
        const passed = sql === question.correctOption;
        record(question, '选项：' + sql, passed);
        feedback(passed ? '通过！请用自己的话解释原因。' : '未通过，请重新比较口径。已保存作答记录。');
      } else {
        const judge = await engine();
        try { result = judge.grade(question, sql); }
        catch (error) { if (!error.systemFailure) record(question, sql, false, /syntax|near |incomplete|unrecognized/i.test(error.message) ? 'syntax' : 'query'); throw error; }
        record(question, sql, result.passed);
        feedback((result.passed ? '通过！' : '结果未通过。') + ' ' + result.cases.map(item => item.name + (item.passed ? '：通过' : '：未通过')).join(' · '));
        dialog.querySelector('#training-result').innerHTML = '<h3>业务样本 · 你的结果</h3>' + tableMarkup(result.mine);
      }
    } catch (error) {
      result = null;
      feedback('本次未完成：' + error.message);
    } finally { running = false; button.disabled = false; }
  }
  function exportProject() {
    if (!result || !getState().notes[selected.id]?.trim()) { feedback('请先运行 SQL，并写出口径、思路和结果解释。'); return; }
    const report = '# SQL Lab · ' + selected.title + '\n\n' + selected.text + '\n\n## 分析与表达\n\n' + getState().notes[selected.id] + '\n\n## SQLite SQL\n\n```sql\n' + currentSQL(selected) + '\n```\n\n## 业务样本结果\n\n' + JSON.stringify(result.mine.rows, null, 2) + '\n\n## 样本判分\n\n' + result.cases.map(item => item.name + (item.passed ? '：通过' : '：未通过')).join('\n') + '\n\n## 人工自查标准\n\n' + selected.rubric.join('\n\n') + '\n\n表达与业务结论未自动评分。\n';
    const url = URL.createObjectURL(new Blob([report], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'SQLLab-营销投入复盘.md'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    feedback('分析作品已开始下载。');
  }
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-training-open],[data-training-parent]');
    if (!trigger) return;
    parentID = trigger.dataset.trainingParent || null; kind = '全部'; week = '0'; dataset = '全部'; library();
    dialog.showModal();
  });
  dialog.addEventListener('click', event => {
    const action = event.target.closest('[data-training]');
    if (!action || running) return;
    try {
      if (action.dataset.training === 'close') dialog.close();
      if (action.dataset.training === 'back') library();
      if (action.dataset.training === 'open') openQuestion(action.dataset.id);
      if (action.dataset.training === 'run') run();
      if (action.dataset.training === 'export') exportProject();
      if (action.dataset.training === 'redo') {
        saveSession({ codes: { [selected.id]: '' }, viewed: { [selected.id]: false } });
        openQuestion(selected.id);
        feedback('已清空本轮作答并关闭答案。再次查看答案会记录为辅助完成。');
      }
    } catch (error) { if (selected) feedback(error.message); }
  });
  dialog.addEventListener('change', event => {
    const filter = event.target.dataset.trainingFilter;
    if (filter) { if (filter === 'kind') kind = event.target.value; if (filter === 'week') week = event.target.value; if (filter === 'dataset') dataset = event.target.value; library(); }
    if (selected && event.target.name === 'training-choice') { try { saveSession({ codes: { [selected.id]: event.target.value } }); } catch (error) { feedback(error.message); } }
  });
  dialog.addEventListener('input', event => {
    if (!selected) return;
    try {
      if (event.target.id === 'training-sql') { saveSession({ codes: { [selected.id]: event.target.value } }); result = null; dialog.querySelector('#training-result').replaceChildren(); feedback('草稿已更改，请重新运行并判定。'); }
      if (event.target.id === 'training-note' && !updateState(state => { state.notes[selected.id] = event.target.value; })) throw new Error('分析记录未能保存。');
    } catch (error) { feedback(error.message); }
  });
  dialog.addEventListener('cancel', event => { if (running) event.preventDefault(); });
  return { open(id) { parentID = null; openQuestion(id); if (!dialog.open) dialog.showModal(); } };
}
