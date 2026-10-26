import { QUESTIONS, LESSONS, WEEKS, TEMPLATES, EXPLAINS } from '../content/catalog.js';
import { buildDatabase, buildProductRows } from '../engine/dataset.js';
import { runQuery, resultRows, cmpRows } from '../domain/grading.js';
import { isRecord, hasOwn, cloneProgress, parseSafeJSON, validNumber, validCount, validDay, knownProgressId, emptyProgress, progressMap, setProgressMap, validProgressValue, normalizeTestResult, normalizeState, compareRevision, nextRevision, stampProgress, mergeStates, rebaseProgress } from '../domain/progress.js';
import { genSyncCode } from '../services/identity.js';
import { createSync } from '../services/sync.js';
import { createUpdates } from '../platform/updates.js';
import { loadSqlEngine } from '../engine/runtime.js';
import { createJudge } from '../engine/judge.js';

export function startWorkspace({ storage, platform }) {

  if(typeof document==='undefined')return;
  var root=document.getElementById('sqltrain-root');
  if(!root)return;
  var modeMql=window.matchMedia('(prefers-color-scheme: dark)');
  function loadMode(){try{var m=JSON.parse(storage.getItem('sqltrain_mode')||'"auto"');return ['auto','light','dark'].indexOf(m)>=0?m:'auto'}catch(e){return 'auto'}}
  function applyMode(){
    var m=loadMode();
    var eff=m==='auto'?(modeMql.matches?'dark':'light'):m;
    document.documentElement.dataset.mode=eff;
    document.documentElement.style.colorScheme=eff;
    document.querySelectorAll('meta[name="theme-color"]').forEach(function(m2){m2.removeAttribute('media');m2.setAttribute('content',eff==='dark'?'#000000':'#f3f5f9')});
    var seg=document.getElementById('st-mode-seg');
    if(seg)Array.prototype.forEach.call(seg.querySelectorAll('button[data-mo]'),function(b){var on=b.getAttribute('data-mo')===m;b.classList.toggle('btn-primary',on);b.setAttribute('aria-pressed',String(on))});
    updateTabInk();
    return eff;
  }
  modeMql.addEventListener('change',function(){if(loadMode()==='auto')applyMode()});
  applyMode();

  var CODE_DEFAULT='-- 在这里写你的 SQL\n-- Ctrl+Enter 或点"运行并判定"\n';
  var DEFAULT_STATE={v:1,done:{},wrong:{},notes:{},lessons:{},plan:{},days:[],savedAt:0};
  var state=normalizeState(DEFAULT_STATE),stateBase=cloneProgress(state);
  var codes={},viewed={},lastLearning=null;
  var currentQid=null,qfilter='all',db=null,engineMode='loading',test=null,testTimer=null,testResult=null;
  var sqlRuntime=null,databaseSeed=null,playDb=null,storageWarning=false,loadWarning='',judge=null;
  var deviceId='';
  try{deviceId=storage.getItem('sqltrain_device')||''}catch(e){}
  if(!/^[A-Za-z0-9_-]{8,100}$/.test(deviceId)){
    deviceId=genSyncCode();try{storage.setItem('sqltrain_device',deviceId)}catch(e){}
  }

  function todayStr(){var d=new Date();return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2)}
  function loadState(){
    var local=null,widget=null,raw=null;
    try{raw=storage.getItem('sqltrain_state');if(raw)local=normalizeState(parseSafeJSON(raw))}catch(e){}
    try{var ws=window.zcode&&window.zcode.widgetState;if(ws)widget=normalizeState(ws.privateContent)}catch(e){}
    if(local&&widget)state=mergeStates(local,widget);
    else if(local||widget)state=local||widget;
    else if(raw){
      try{var backup=storage.getItem('sqltrain_state_before_import');if(backup)state=normalizeState(parseSafeJSON(backup))||state}catch(e){}
      loadWarning='本地进度未通过校验，已保留原存储；请从备份恢复。';
    }
    stateBase=cloneProgress(state);
  }
  function storageFailed(){
    if(!storageWarning){storageWarning=true;stToast('本地保存失败，请先导出进度备份并释放浏览器存储空间。')}
  }
  function commitProgress(candidate,push){
    var clean=normalizeState(candidate);
    if(!clean){storageFailed();return false}
    try{storage.setItem('sqltrain_state',JSON.stringify(clean))}catch(e){storageFailed();return false}
    state=clean;stateBase=cloneProgress(clean);
    try{if(window.zcode&&window.zcode.setWidgetState){window.zcode.setWidgetState({privateContent:cloneProgress(clean)}).catch(function(){})}}catch(e){}
    if(push)scheduleSyncPush();
    return true;
  }
  function saveState(){
    var candidate=stampProgress(cloneProgress(state),stateBase,deviceId);
    candidate.savedAt=Date.now();
    if(!commitProgress(candidate,true))return false;
    checkMilestones();return true;
  }

  /* 草稿、页面位置与周测仅保存在本机，不混入跨设备的学习进度。 */
  function saveSession(){
    var session={v:1,codes:codes,viewed:viewed,currentQid:currentQid,qfilter:qfilter,
      topTab:topTab,trainSub:trainSub,examSub:examSub,learnView:learnView,currentLid:currentLid,
      test:test,testResult:testResult,lastLearning:lastLearning};
    try{storage.setItem('sqltrain_session',JSON.stringify(session));return true}catch(e){storageFailed();return false}
  }
  function loadSession(override){
    try{
      var raw=override||storage.getItem('sqltrain_session');if(!raw)return;
      var s=parseSafeJSON(raw);if(!isRecord(s)||s.v!==1)return;
      if(isRecord(s.codes))Object.keys(s.codes).forEach(function(id){
        var qid=id.indexOf('test_')===0?id.slice(5):id;
        if((qid==='play'||knownProgressId('done',qid))&&typeof s.codes[id]==='string'&&s.codes[id].length<=100000)codes[id]=s.codes[id];
      });
      if(isRecord(s.viewed))Object.keys(s.viewed).forEach(function(id){if(knownProgressId('done',id)&&s.viewed[id]===true)viewed[id]=true});
      if(s.currentQid==='play'||knownProgressId('done',s.currentQid))currentQid=s.currentQid;
      if(['all','wrong','review','1','2','3','4','5','6','7','8'].indexOf(s.qfilter)>=0)qfilter=s.qfilter;
      if(['dash','train','exam','me'].indexOf(s.topTab)>=0)topTab=s.topTab;
      if(['learn','practice','review','tpl','schema'].indexOf(s.trainSub)>=0)trainSub=s.trainSub;
      if(['test','wrong'].indexOf(s.examSub)>=0)examSub=s.examSub;
      if(['course','plan','cheat'].indexOf(s.learnView)>=0)learnView=s.learnView;
      if(LESSONS.some(function(l){return l.id===s.currentLid}))currentLid=s.currentLid;
      var last=s.lastLearning;
      if(isRecord(last)&&((last.type==='question'&&(last.id==='play'||knownProgressId('done',last.id)))
        ||(last.type==='lesson'&&LESSONS.some(function(lesson){return lesson.id===last.id}))))lastLearning={type:last.type,id:last.id};
      else if(trainSub==='learn'&&currentLid)lastLearning={type:'lesson',id:currentLid};
      else if(currentQid)lastLearning={type:'question',id:currentQid};
      var t=s.test;
      if(isRecord(t)&&Array.isArray(t.qids)&&t.qids.length>0&&t.qids.length<=5
        &&t.qids.every(function(id,i){return knownProgressId('done',id)&&t.qids.indexOf(id)===i})
        &&validCount(t.idx)&&t.idx<t.qids.length&&validNumber(t.endAt)&&t.endAt>0&&t.finished===false){
        if(typeof t.id==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(t.id)){
          test={id:t.id,qids:t.qids.slice(),idx:t.idx,endAt:t.endAt,remain:Math.max(0,Math.ceil((t.endAt-Date.now())/1000)),finished:false};
        }
      }
      if(test&&state.lastTest&&state.lastTest.id===test.id){testResult=cloneProgress(state.lastTest);test=null}
      if(!test&&!testResult)testResult=normalizeTestResult(s.testResult);
    }catch(e){loadWarning='上次的学习会话无法识别，已保留学习进度。'}
  }
  function clearSession(){
    if(testTimer){clearInterval(testTimer);testTimer=null}
    codes={};viewed={};test=null;testResult=null;currentQid=null;lastLearning=null;
    saveSession();
  }
  function markToday(){var t=todayStr();if(state.days.indexOf(t)<0){state.days.push(t);saveState();updateStreak();refreshNativeReminder()}}
  function streak(){
    if(!state.days.length)return 0;
    var set={};state.days.forEach(function(d){set[d]=1});
    var d=new Date(),n=0;
    function key(dt){return dt.getFullYear()+'-'+('0'+(dt.getMonth()+1)).slice(-2)+'-'+('0'+dt.getDate()).slice(-2)}
    if(!set[key(d)]){d.setDate(d.getDate()-1);if(!set[key(d)])return 0}
    while(set[key(d)]){n++;d.setDate(d.getDate()-1)}
    return n;
  }
  function bumpAttempts(qid){state.attempts=state.attempts||{};state.attempts[qid]=(state.attempts[qid]||0)+1}
  /* ---------- v2.6:间隔重复复习(简化 SM-2) ---------- */
  function dayKey(dt){return dt.getFullYear()+'-'+('0'+(dt.getMonth()+1)).slice(-2)+'-'+('0'+dt.getDate()).slice(-2)}
  function addDaysStr(n){var d=new Date();d.setDate(d.getDate()+n);return dayKey(d)}
  function srRec(qid){state.sr=state.sr||{};if(!state.sr[qid])state.sr[qid]={due:todayStr(),iv:0,rep:0,ef:2.5,lapse:0};return state.sr[qid]}
  /* quality:2=独立通过 1=看答案后通过 0=未通过;返回排程结果供界面提示 */
  function srGrade(qid,quality){
    var r=srRec(qid);
    if(quality===0){r.rep=0;r.lapse=(r.lapse||0)+1;r.iv=1;r.due=addDaysStr(1)}
    else if(quality===1){r.rep=Math.max(r.rep||0,1);r.iv=1;r.ef=Math.max(1.6,(r.ef||2.5)-0.05);r.due=addDaysStr(1)}
    else{r.rep=(r.rep||0)+1;r.iv=r.rep===1?1:(r.rep===2?3:Math.min(Math.round((r.iv||1)*(r.ef||2.5)),60));r.due=addDaysStr(r.iv)}
    return r;
  }
  function isDue(qid){var r=state.sr&&state.sr[qid];return !!r&&r.due<=todayStr()}
  function srDueList(){
    var out=[];
    for(var id in (state.sr||{})){if(isDue(id))out.push(id)}
    out.sort(function(a,b){var ra=state.sr[a],rb=state.sr[b];return ra.due<rb.due?-1:(ra.due>rb.due?1:0)});
    return out;
  }
  function dueLabel(due){
    var t=todayStr();
    if(due===t)return '今天到期';
    if(due<t)return '逾期 '+Math.max(1,Math.round((new Date(t)-new Date(due))/864e5))+' 天';
    var inN=Math.round((new Date(due)-new Date(t))/864e5);
    return inN===1?'明天':inN+' 天后';
  }

  function refreshIcons(){try{if(window.lucide&&window.lucide.createIcons)window.lucide.createIcons({attrs:{width:16,height:16}})}catch(e){}}
  /* 触感反馈:尽力而为,不支持的设备静默跳过 */
  function buzz(p){try{platform.haptic()}catch(e){}}
  function qById(id){if(id==='play')return null;for(var i=0;i<QUESTIONS.length;i++){if(QUESTIONS[i].id===id)return QUESTIONS[i]}return null}
  function nextQuestion(){
    var bw=null,bwW=9;
    QUESTIONS.forEach(function(q){if(state.wrong[q.id]&&!state.done[q.id]&&q.w<bwW){bwW=q.w;bw=q}});
    if(bw)return bw;
    for(var w=1;w<=8;w++){
      for(var i=0;i<QUESTIONS.length;i++){
        var q=QUESTIONS[i];
        if(q.w===w&&!state.done[q.id])return q;
      }
    }
    return null;
  }
  function weekProgress(w){
    var total=0,done=0;
    QUESTIONS.forEach(function(q){if(q.w===w){total++;if(state.done[q.id])done++}});
    return {total:total,done:done};
  }

  function initEngine(){
    loadSqlEngine()
      .then(function(SQL){
        sqlRuntime=SQL;db=buildDatabase(SQL);databaseSeed=db.export();judge=createJudge(SQL,databaseSeed);
        playDb=new SQL.Database(databaseSeed);db.exec('PRAGMA query_only=ON');engineMode='ok';
        renderAll();switchTab(topTab);startTestTimer();
      })
      .catch(function(){engineMode='self';renderAll();switchTab(topTab)});
  }
  function gradingQuery(sql){
    if(!judge)throw new Error('练习库还没准备好');
    return judge.query(sql);
  }
  function gradeAnswer(q,sql){
    if(!judge)throw new Error('练习库还没准备好');
    return judge.grade(q,sql);
  }
  function resetPlayDatabase(){
    if(!sqlRuntime||!databaseSeed){stToast('练习库还没准备好');return}
    if(playDb)playDb.close();
    playDb=new sqlRuntime.Database(databaseSeed);
    var out=document.getElementById('st-result');if(out)out.textContent='练习库已恢复为初始数据。';
  }

  function updateStreak(){
    var el=document.getElementById('st-streak');
    if(el)el.textContent='连续 '+streak()+' 天 · '+Object.keys(state.done).length+'/'+QUESTIONS.length+' 题';
    var b=document.getElementById('st-engine-text');
    if(b)b.textContent=engineMode==='ok'?'练习库就绪':(engineMode==='self'?'自评模式':'准备中…');
    document.getElementById('st-engine').setAttribute('data-mode',engineMode);
    var _ld=0;for(var _k in state.lessons){if(state.lessons[_k])_ld++}
    var percentage=Math.round((Object.keys(state.done).length+_ld)/(QUESTIONS.length+LESSONS.length)*100);
    document.getElementById('st-sidebar-progress').textContent=percentage+'%';
    document.getElementById('st-sidebar-fill').style.width=percentage+'%';
    document.getElementById('st-course-progress').setAttribute('aria-valuenow',percentage);
    var _cm=document.getElementById('st-course-meta');if(_cm)_cm.textContent=LESSONS.length+' 节微课 · '+QUESTIONS.length+' 道真题';
  }

  /* ---------- 备份与迁移 ---------- */
  function progressCode(){return btoa(unescape(encodeURIComponent(JSON.stringify(state))))}
  function parseBackup(raw){
    raw=String(raw||'').trim();if(!raw||raw.length>10000000)return null;
    var obj=null;
    try{obj=parseSafeJSON(raw)}catch(e){obj=null}
    if(!obj){try{obj=parseSafeJSON(decodeURIComponent(escape(atob(raw))))}catch(e){obj=null}}
    return normalizeState(obj);
  }
  function mergeBackup(o){
    return mergeStates(state,o);
  }
  function applyBackup(o,mode){
    var clean=normalizeState(o);
    if(!clean){backupStatus('备份校验失败，原进度未改变');return false}
    var candidate=mode==='merge'?mergeBackup(clean):rebaseProgress(clean,state,deviceId);
    candidate.savedAt=Date.now();
    try{
      storage.setItem('sqltrain_state_before_import',JSON.stringify(state));
      storage.setItem('sqltrain_session_before_import',storage.getItem('sqltrain_session')||'');
    }catch(e){backupStatus('无法保存应急备份，已取消恢复，原进度未改变');return false}
    if(!commitProgress(candidate,true)){backupStatus('本地存储写入失败，原进度未改变');return false}
    if(mode!=='merge')clearSession();
    updateStreak();renderDash();
    backupStatus(mode==='merge'?'已合并导入：按记录修订保留最新修改 · 原进度已留应急备份':'已恢复当前进度 · 原进度已留应急备份，可撤销');
    return true;
  }
  function markBackupTime(){state.lastBackup=Date.now();saveState();updateStreak()}
  function backupHint(){
    if(!state.days.length)return '还没有练习记录，随时可以做第一次备份';
    var t=state.lastBackup?new Date(state.lastBackup):null;
    var d=t?t.getFullYear()+'-'+('0'+(t.getMonth()+1)).slice(-2)+'-'+('0'+t.getDate()).slice(-2):'';
    var stale=!t||(Date.now()-state.lastBackup>7*86400000);
    return (d?'上次备份 '+d:'已练习 '+state.days.length+' 天，还没有备份过')+(stale?' · 建议备份一次':'');
  }
  function backupStatus(msg){var el=document.getElementById('st-backup-status');if(el)el.textContent=msg}
  async function doExport(){
    try{
      var filename='SQL训练进度备份-'+todayStr()+'.json';
      if(platform.isNative){
        await platform.shareBackup(filename,JSON.stringify(state));
        markBackupTime();
        try{await storage.flush();backupStatus('备份已交给系统分享菜单 · '+backupHint())}
        catch(error){backupStatus('备份已交给系统分享菜单；本机文件仍未能保存，请保留备份。')}
        return;
      }
      var blob=new Blob([JSON.stringify(state)],{type:'application/json'});
      var a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download=filename;
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(function(){try{URL.revokeObjectURL(a.href)}catch(e){}},3000);
      markBackupTime();backupStatus('备份文件已开始下载 · '+backupHint());
    }catch(e){backupStatus('导出失败：'+String(e.message||e))}
  }
  function doCopyCode(){
    var code=progressCode();markBackupTime();
    var okMsg='进度码已复制 · 在新浏览器打开本页面，粘贴到下方后点"合并导入" · '+backupHint();
    var fallback=function(){
      var ta=document.createElement('textarea');ta.value=code;ta.style.position='fixed';ta.style.opacity='0';
      document.body.appendChild(ta);ta.focus();ta.select();
      var done=false;try{done=document.execCommand('copy')}catch(e){}
      ta.remove();
      if(done){backupStatus(okMsg)}
      else{var imp=document.getElementById('st-import-code');if(imp){imp.value=code;imp.focus();imp.select()}backupStatus('剪贴板不可用：已把进度码填入下方文本框，请手动全选复制（Ctrl/Cmd+C）')}
    };
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(code).then(function(){backupStatus(okMsg)},fallback)}else fallback();
  }
  function doImportCode(mode){
    var ta=document.getElementById('st-import-code');
    var o=parseBackup(ta?ta.value:'');
    if(!o){backupStatus('无法识别的进度码或备份内容，请确认粘贴完整');return}
    applyBackup(o,mode);
  }
  function doImportFile(){
    var fi=document.getElementById('st-import-file');
    if(!fi)return;
    fi.onchange=function(){
      var f=fi.files&&fi.files[0];
      if(!f)return;
      var r=new FileReader();
      r.onload=function(){
        var o=parseBackup(String(r.result));
        if(!o){backupStatus('无法识别的备份文件');return}
        applyBackup(o,'replace');
      };
      r.readAsText(f);
      fi.value='';
    };
    fi.click();
  }

  /* ---------- 云同步（LeanCloud） ---------- */
  var {loadSyncCfg,saveSyncCfg,syncCfgReady,fmtClock,syncStatus,scheduleSyncPush,syncNow,doSyncSave}=createSync({storage:storage,getState:function(){return state},parseBackup:parseBackup,mergeBackup:mergeBackup,commitProgress:commitProgress,refreshProgressViews:refreshProgressViews});

  function focusContent(selector){
    var element=document.querySelector(selector);if(!element)return;
    element.setAttribute('tabindex','-1');
    try{element.focus({preventScroll:true})}catch(error){element.focus()}
    element.scrollIntoView({block:'nearest',behavior:'auto'});
  }
  function resumeLearning(){
    if(test){switchTab('test');focusContent('#panel-test h3')}
    else if(lastLearning&&lastLearning.type==='lesson')openLesson(lastLearning.id);
    else if(lastLearning)openQuestion(lastLearning.id);
  }
  function renderDash(){
    var panel=document.getElementById('panel-dash');
    var doneCount=Object.keys(state.done).length;
    var wrongCount=Object.keys(state.wrong).length;
    var next=nextQuestion();
    var nl=nextLesson();
    var learned=lessonProgress().done;
    var wsNow=weekStatsNow();var dset={};(state.days||[]).forEach(function(d){dset[d]=1});
    var now=new Date(),today=todayStr(),dayNames=['日','一','二','三','四','五','六'];
    var dateLabel=(now.getMonth()+1)+' 月 '+now.getDate()+' 日 · 星期'+dayNames[now.getDay()];
    var monday=new Date(now.getFullYear(),now.getMonth(),now.getDate()-(now.getDay()+6)%7);
    var weekDays='';
    for(var dayIndex=0;dayIndex<7;dayIndex++){
      var date=new Date(monday.getFullYear(),monday.getMonth(),monday.getDate()+dayIndex);
      var dateKey=date.getFullYear()+'-'+('0'+(date.getMonth()+1)).slice(-2)+'-'+('0'+date.getDate()).slice(-2);
      var active=!!dset[dateKey],isToday=dateKey===today;
      weekDays+='<div class="st-week-day'+(active?' is-active':'')+(isToday?' is-today':'')+'" role="listitem" aria-label="'+dateKey+(isToday?'，今天':'')+(active?'，已打卡':'，未打卡')+'"'+(isToday?' aria-current="date"':'')+'><span>'+dayNames[date.getDay()]+'</span><b aria-hidden="true">'+(active?'✓':date.getDate())+'</b></div>';
    }
    var heatCells='';
    for(var hi=55;hi>=0;hi--){var hdt=new Date(Date.now()-hi*864e5);var hk=hdt.getFullYear()+'-'+('0'+(hdt.getMonth()+1)).slice(-2)+'-'+('0'+hdt.getDate()).slice(-2);heatCells+='<i'+(dset[hk]?' class="on"':'')+' title="'+hk+'"></i>'}
    var dueN=srDueList().length;
    var primary={label:'今日推荐',title:next?next.title:'全部题目已通关',copy:next?next.text:'到限时周测里，用一场模拟检验所学。',action:next?'open-q':'app-go',id:next?next.id:'',button:next?'开始今日练习':'开始限时周测',meta:next?'第 '+next.w+' 周 · '+WEEKS[next.w-1].name:'八周训练已完成',foot:next?next.pts+' 分 · '+next.tables.length+' 张数据表':QUESTIONS.length+' 道题，已经走完一遍'};
    if(test){
      primary={label:'继续未完成的周测',title:'回到你的限时周测',copy:'已保存答题草稿，继续时仍沿用原来的截止时间。',action:'resume-learning',id:'',button:'继续周测',meta:'第 '+(test.idx+1)+' / '+test.qids.length+' 题',foot:'离开页面也会继续计时'};
    }else if(lastLearning){
      var lastLesson=lastLearning.type==='lesson'?lessonById(lastLearning.id):null;
      var lastQuestion=lastLearning.type==='question'?qById(lastLearning.id):null;
      if(lastLesson||lastQuestion||lastLearning.id==='play'){
        primary.label='继续上次学习';primary.action='resume-learning';primary.button='继续学习';
        primary.title=lastLesson?lastLesson.title:(lastQuestion?lastQuestion.title:'自由练习区');
        primary.copy=lastLesson?lastLesson.goal:(lastQuestion?lastQuestion.text:'回到独立练习库，继续试写你的 SQL。');
        primary.meta=lastLesson?'微课 · 约 '+lastLesson.min+' 分钟':(lastQuestion?'第 '+lastQuestion.w+' 周 · '+WEEKS[lastQuestion.w-1].name:'自由探索');
        primary.foot=lastLesson?'已保留上次学习位置':'草稿保存在这台设备';
      }
    }
    var markup='<div class="st-home-heading"><div><div class="st-home-date">'+dateLabel+'</div><h1>今天也练一点 SQL</h1></div><span class="st-home-saved"><i data-lucide="hard-drive" aria-hidden="true"></i>本机学习空间</span></div>';
    markup+='<div class="st-today-grid"><section class="st-session-card" aria-label="'+esc(primary.label)+'"><div class="st-session-top"><span class="st-session-label"><i data-lucide="play" aria-hidden="true"></i>'+esc(primary.label)+'</span><span class="st-session-meta">'+esc(primary.meta)+'</span></div>'
      +'<h2>'+esc(primary.title)+'</h2><p>'+esc(primary.copy)+'</p><div class="st-session-bottom"><button class="btn btn-primary" data-act="'+primary.action+'" data-qid="'+primary.id+'" data-page="test" type="button"><span class="st-btn-ic">'+esc(primary.button)+'<i data-lucide="arrow-up-right" aria-hidden="true"></i></span></button><span>'+esc(primary.foot)+'</span></div></section>';
    markup+='<section class="st-day-card" aria-label="本周学习记录"><div class="st-card-caption">本周学习<span>'+wsNow.d+' / 7 天已打卡</span></div><div class="st-week-days" role="list" aria-label="本周打卡">'+weekDays+'</div><div class="st-day-stats">'
      +'<div><strong>'+streak()+'<small>天</small></strong><span>连续学习</span></div><div><strong>'+doneCount+'<small>/ '+QUESTIONS.length+'</small></strong><span>通过题目</span></div><div><strong>'+learned+'<small>/ '+LESSONS.length+'</small></strong><span>学会微课</span></div></div></section></div>';
    markup+='<section class="st-home-shortcuts" aria-label="学习快捷入口">';
    if(nl){
      markup+='<button class="st-home-shortcut" data-act="open-lesson" data-lid="'+nl.id+'" type="button"><span class="st-shortcut-icon"><i data-lucide="book-open" aria-hidden="true"></i></span><span class="st-shortcut-copy"><strong>学一节微课</strong><small>'+esc(nl.title)+'</small></span><i class="st-shortcut-arrow" data-lucide="chevron-right" aria-hidden="true"></i></button>';
    }else{
      markup+='<button class="st-home-shortcut" data-act="app-go" data-page="learn" type="button"><span class="st-shortcut-icon"><i data-lucide="book-open" aria-hidden="true"></i></span><span class="st-shortcut-copy"><strong>回顾微课</strong><small>'+LESSONS.length+' 节微课，随时重温</small></span><i class="st-shortcut-arrow" data-lucide="chevron-right" aria-hidden="true"></i></button>';
    }
    markup+='<button class="st-home-shortcut" data-act="'+(dueN?'start-review':'app-go')+'" data-page="'+(wrongCount?'wrong':'review')+'" type="button"><span class="st-shortcut-icon"><i data-lucide="rotate-ccw" aria-hidden="true"></i></span><span class="st-shortcut-copy"><strong>'+(dueN?'今日复习':(wrongCount?'错题重写':'复习与巩固'))+'</strong><small>'+(dueN?dueN+' 题到期，先把学过的记牢':(wrongCount?wrongCount+' 道错题，重新试一遍':'查看你的复习安排'))+'</small></span><i class="st-shortcut-arrow" data-lucide="chevron-right" aria-hidden="true"></i></button>'
      +'<button class="st-home-shortcut" data-act="open-q" data-qid="play" type="button"><span class="st-shortcut-icon"><i data-lucide="code-xml" aria-hidden="true"></i></span><span class="st-shortcut-copy"><strong>自由练习</strong><small>在独立练习库里试写 SQL</small></span><i class="st-shortcut-arrow" data-lucide="chevron-right" aria-hidden="true"></i></button></section>';
    markup+='<section class="st-path-panel" aria-label="八周进度地图"><div class="st-section-heading"><div><h2>你的学习路径</h2><p>'+(next?'正在第 '+next.w+' 周 · '+WEEKS[next.w-1].name:'八周训练已通关')+'，按自己的节奏前进。</p></div><button class="st-text-button" data-act="app-plan" type="button">学习计划<i data-lucide="chevron-right" aria-hidden="true"></i></button></div><div class="st-path-track">';
    WEEKS.forEach(function(week){
      var progress=weekProgress(week.w),questions=QUESTIONS.filter(function(question){return question.w===week.w});
      var pending=questions.filter(function(question){return !state.done[question.id]})[0]||questions[0];
      var complete=progress.done===progress.total,current=next&&next.w===week.w;
      markup+='<button class="st-path-stop'+(current?' is-current':'')+(complete?' is-done':'')+'" data-act="open-q" data-qid="'+pending.id+'" type="button" aria-label="进入第'+week.w+'周 · '+esc(week.name)+'，已通过'+progress.done+'/'+progress.total+'题"'+(current?' aria-current="step"':'')+'><b aria-hidden="true">'+(complete?'✓':'W0'+week.w)+'</b><span>'+esc(week.name)+'</span></button>';
    });
    markup+='</div><details class="st-path-details"><summary>按周选择题目<span class="st-btn-ic">'+QUESTIONS.length+' 道题<i data-lucide="chevron-down" aria-hidden="true"></i></span></summary><div class="st-mosaic">';
    WEEKS.forEach(function(week){
      var progress=weekProgress(week.w);
      var lp=lessonProgress(week.w);
      var questions=QUESTIONS.filter(function(question){return question.w===week.w});
      var firstPending=questions.filter(function(question){return !state.done[question.id]})[0]||questions[0];
      var isCurrent=next&&next.w===week.w;
      var dots=questions.map(function(question,questionIndex){
        var status=state.done[question.id]?'is-done':(state.wrong[question.id]?'is-wrong':'');
        var label=question.title+(state.done[question.id]?' · 已通过':(state.wrong[question.id]?' · 错'+state.wrong[question.id]+'次待重写':' · 未开始'));
        return '<button class="st-qtarget '+status+'" type="button" data-act="open-q" data-qid="'+question.id+'" aria-label="'+label+'"><span aria-hidden="true">'+(questionIndex+1)+'</span></button>';
      }).join('');
      var statusLabel=progress.done===progress.total?'已完成':(isCurrent?'当前阶段':(progress.done?'进行中':'未开始'));
      markup+='<article class="st-week-card'+(isCurrent?' is-current':'')+'"><div class="st-week-top"><span class="st-week-number">WEEK 0'+week.w+'</span><span class="st-week-state">'+statusLabel+'</span></div>'
        +'<button class="st-week-open" data-act="open-q" data-qid="'+firstPending.id+'" type="button" aria-label="进入第'+week.w+'周 · '+week.name+'">'+week.name+'<i data-lucide="arrow-up-right" aria-hidden="true"></i></button>'
        +'<div class="st-week-bottom"><div class="st-dots" role="group" aria-label="第'+week.w+'周题目状态">'+dots+'</div><span>'+lp.done+'/'+lp.total+' 课 · '+progress.done+'/'+progress.total+' 题</span></div></article>';
    });
    markup+='</div></details></section><div class="st-home-footnote"><details class="st-guide"><summary>近八周打卡记录</summary><p>本周打卡 '+wsNow.d+' 天 · 本周完成 '+wsNow.q+' 题</p><div class="st-heat" aria-label="近八周打卡日历">'+heatCells+'</div></details><details class="st-guide"><summary>训练说明与判分规则</summary><p>训练库使用 SQLite 语法，日期函数与 MySQL 有差异，题目会给出提示。判分比较查询结果，列名不影响判定；要求排序的题会检查行序，并列行允许换序；数值保留两位小数。每天节奏：10 分钟重写昨日错题 → 40 分钟新题 → 10 分钟整理笔记。</p></details></div>';

    panel.innerHTML=markup;
    refreshIcons();
  }

  /* ---------- 练习 ---------- */
  function qStatus(q){
    if(state.done[q.id])return '<span class="st-pass">✓ 已通过</span>';
    if(state.wrong[q.id])return '<span class="st-fail">✗ 错'+state.wrong[q.id]+'次</span>';
    return '<span class="text-muted">未开始</span>';
  }
  function qBtn(q){
    var cls=state.done[q.id]?'is-done':(state.wrong[q.id]?'is-wrong':'');
    return '<button class="btn btn-sm'+(currentQid===q.id?' btn-primary':'')+'" data-act="open-q" data-qid="'+q.id+'" type="button"><span class="st-qbtn"><span class="st-dot '+cls+'"></span><span class="st-qtitle">'+q.title+'</span></span></button>';
  }
  function filteredQuestions(){
    if(qfilter==='review'){return QUESTIONS.filter(function(q){return isDue(q.id)})}
    if(qfilter==='wrong'){return QUESTIONS.filter(function(q){return state.wrong[q.id]})}
    if(qfilter==='all')return QUESTIONS;
    var w=parseInt(qfilter,10);
    return QUESTIONS.filter(function(q){return q.w===w});
  }
  function renderPractice(){
    var el=document.getElementById('panel-practice');
    var opts=['<option value="all"'+(qfilter==='all'?' selected':'')+'>全部题目</option>'];
    WEEKS.forEach(function(wk){opts.push('<option value="'+wk.w+'"'+(qfilter===String(wk.w)?' selected':'')+'>第'+wk.w+'周 · '+wk.name+'</option>')});
    opts.push('<option value="wrong"'+(qfilter==='wrong'?' selected':'')+'>只看错题</option>');
    var list='';
    if(qfilter==='review'){
      var dq=srDueList();
      list='<div class="st-weekhead"><span class="text-small" style="font-weight:500">今日复习</span><span class="text-small text-muted tabular-nums">'+dq.length+' 题到期</span></div>';
      dq.forEach(function(id){var q=qById(id);if(q)list+=qBtn(q)});
      if(!dq.length)list+='<div class="text-muted text-small" style="margin:4px 2px">复习清空了,明天再来。</div>';
    }else if(qfilter==='wrong'){
      var wq=QUESTIONS.filter(function(q){return state.wrong[q.id]});
      list='<div class="st-weekhead"><span class="text-small" style="font-weight:500">错题清单</span><span class="text-small text-muted tabular-nums">'+wq.length+' 题</span></div>';
      wq.forEach(function(q){list+=qBtn(q)});
      if(!wq.length)list+='<div class="text-muted text-small" style="margin:4px 2px">没有错题，好样的。</div>';
    }else if(qfilter==='all'){
      WEEKS.forEach(function(wk){
        var p=weekProgress(wk.w);
        list+='<div class="st-weekhead"><span class="text-small" style="font-weight:500">第'+wk.w+'周 · '+wk.name+'</span><span class="text-small text-muted tabular-nums">'+p.done+'/'+p.total+'</span></div>';
        QUESTIONS.forEach(function(q){if(q.w===wk.w)list+=qBtn(q)});
      });
    }else{
      var w=parseInt(qfilter,10),wp=weekProgress(w);
      list='<div class="st-weekhead"><span class="text-small" style="font-weight:500">第'+w+'周 · '+WEEKS[w-1].name+'</span><span class="text-small text-muted tabular-nums">'+wp.done+'/'+wp.total+'</span></div>';
      QUESTIONS.forEach(function(q){if(q.w===w)list+=qBtn(q)});
    }
    el.innerHTML='<div class="st-cols">'
      +'<details class="st-question-library st-catalog"'+(window.matchMedia('(min-width:961px)').matches?' open':'')+'><summary>题目目录 · 选择或切换题目</summary><div class="viz-controls"><div style="width:100%"><label class="form-label text-small" for="st-qfilter">练习范围</label>'
      +'<select id="st-qfilter" class="form-select form-select-sm">'+opts.join('')+'</select></div></div>'
      +'<div class="st-qlist">'+list+'</div></details>'
      +'<div id="st-qpanel"></div></div>';
    var sel=document.getElementById('st-qfilter');
    sel.onchange=function(){qfilter=sel.value;saveSession();renderPractice()};
    if(currentQid)renderQPanel(currentQid);
    else{
      var nx=nextQuestion();
      document.getElementById('st-qpanel').innerHTML='<div style="padding:6px 2px">'
        +'<h3 style="margin:2px 0 8px">今天练什么？</h3>'
        +'<div class="st-kpi text-small" style="margin-bottom:6px"><i data-lucide="sparkles" aria-hidden="true"></i>跟着"今日推荐"按周推进，一天 3–5 题新题</div>'
        +'<div class="st-kpi text-small" style="margin-bottom:6px"><i data-lucide="rotate-ccw" aria-hidden="true"></i>错题优先重写：先写思路，再写 SQL</div>'
        +'<div class="st-kpi text-small" style="margin-bottom:14px"><i data-lucide="timer" aria-hidden="true"></i>每周日来一次 45 分钟周测验收</div>'
        +(nx?'<button class="btn btn-primary" data-act="open-q" data-qid="'+nx.id+'" type="button"><span class="st-btn-ic"><i data-lucide="play" aria-hidden="true"></i>开始：'+nx.title+'</span></button>':'')
        +'</div>';
      refreshIcons();
    }
  }

  function renderQPanel(qid){
    var panel=document.getElementById('st-qpanel');
    if(!panel)return;
    if(qid==='play'){
      panel.innerHTML='<div class="viz-row" style="justify-content:space-between;margin-bottom:2px"><div class="st-kpi"><i data-lucide="flask-conical" aria-hidden="true"></i><h3 style="margin:0">自由练习区</h3></div><span class="viz-badge">不判分</span></div>'
        +'<p class="text-small text-muted">自由练习使用独立数据库，修改数据不影响题目判定。需要恢复初始数据时，点击「重置练习库」。</p>'
        +editorHtml('play',true)
        +'<button class="btn btn-sm" data-act="reset-db" type="button">重置练习库</button>'
        +'<div id="st-result" class="table-responsive" style="margin-top:8px" aria-live="polite"></div>';
      bindEditor('play');refreshIcons();return;
    }
    var q=qById(qid);if(!q){panel.innerHTML='';return}
    var rl=qLesson(qid);
    var wk=WEEKS[q.w-1];
    panel.innerHTML='<div class="st-problem"><div class="viz-row" style="justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">'
      +'<div class="viz-row" style="gap:6px;flex-wrap:wrap"><span class="viz-badge">W'+q.w+' · '+wk.name+'</span><span class="viz-badge">'+q.pts+' 分</span><span id="st-qstatus">'+qStatus(q)+'</span></div>'
      +'<div class="text-small text-muted st-kpi"><i data-lucide="table-2" aria-hidden="true"></i>'+q.tables.join('、')+'</div></div>'
      +'<h3 class="st-task-title">'+q.title+'</h3><p class="st-task-description">'+q.text+'</p>'
      +(rl?'<button class="st-related-lesson" data-act="open-lesson" data-lid="'+rl.id+'" type="button" aria-label="学习本题知识点：'+esc(rl.title)+'"><i data-lucide="book-open" aria-hidden="true"></i><span>配套微课 · '+esc(rl.title)+'</span><i data-lucide="chevron-right" aria-hidden="true"></i></button>':'')+'</div>'
      +'<div id="st-hint" hidden class="text-small st-kpi" style="color:var(--muted-foreground);margin-bottom:8px"><i data-lucide="lightbulb" aria-hidden="true"></i>提示：'+q.hint+'</div>'
      +editorHtml(qid,false)
      +'<div id="st-verdict" role="status" aria-live="polite" aria-atomic="true" style="margin-top:10px"></div>'
      +'<div id="st-result" class="table-responsive" style="margin-top:8px"></div>'
      +'<div id="st-answer" hidden style="margin-top:12px"><div class="text-small text-muted st-kpi"><i data-lucide="book-open" aria-hidden="true"></i>参考答案（看完请关掉重写）</div><div class="st-pre"><pre><code>'+q.answer.replace(/</g,'&lt;')+'</code></pre></div></div>'
      +'<div id="st-explain" hidden style="margin-top:12px"><div class="text-small text-muted st-kpi"><i data-lucide="route" aria-hidden="true"></i>思路拆解（看完请关掉重写）</div><div class="st-lp" style="white-space:pre-line;margin-bottom:0">'+esc(EXPLAINS[qid]||'这道题暂无拆解。')+'</div></div>'
      +'<details class="st-note-panel"'+(state.notes[qid]?' open':'')+'><summary><span><i data-lucide="pen-line" aria-hidden="true"></i>解题笔记</span><span>自动保存<i data-lucide="chevron-down" aria-hidden="true"></i></span></summary><label class="form-label text-small" for="st-note">记下这道题的卡点</label>'
      +'<textarea id="st-note" class="form-control" rows="2" placeholder="一句话记下这道题的卡点">'+esc(state.notes[qid]||'')+'</textarea>'
      +'</details>'
      +'<div id="st-att-line" data-qid="'+qid+'" class="text-small text-muted" style="margin-top:8px">本题已尝试 '+(state.attempts[qid]||0)+' 次'+(viewed[qid]?' · 已看过参考答案':'')+'</div>'
      +'<details class="st-hist" style="margin-top:6px"><summary>运行历史（最近 '+(state.history||[]).length+' 次）</summary><div class="st-hlist">'
      +((state.history||[]).map(function(h,hi){var qq=qById(h.q);return '<button class="btn btn-sm" data-act="hist-load" data-i="'+hi+'" type="button">'+(h.ok?'✓':'✗')+' '+esc(qq?qq.title:h.q)+' · '+fmtClock(h.t)+'</button>'}).join('')||'<span class="text-small text-muted">还没有运行记录</span>')
      +'</div></details>';
    bindEditor(qid);
    var note=document.getElementById('st-note');
    note.oninput=function(){
      var v=note.value.slice(0,300);
      if(v)state.notes[qid]=v;else delete state.notes[qid];
      saveState();
    };
    refreshIcons();
  }
  var SQL_TOKENS=[['SELECT','SELECT '],['FROM','FROM '],['WHERE','WHERE '],['JOIN','JOIN '],['GROUP BY','GROUP BY '],['ORDER BY','ORDER BY '],[',',', '],['( )','()'],["' '","''"],['=','= '],['*','*'],[';',';'],['换行','\n']];
  function sqlToolsHtml(editorId,qid,closedBook){
    var tools='<div class="st-sql-tools" role="group" aria-label="SQL 输入快捷键">';
    SQL_TOKENS.forEach(function(token,index){tools+='<button type="button" class="btn btn-sm" data-act="insert-sql" data-editor="'+editorId+'" data-token="'+index+'">'+esc(token[0])+'</button>'});
    tools+='</div>';
    if(!closedBook){
      var question=qById(qid),tables=question?question.tables:null;
      tools+='<details class="st-editor-schema"><summary>查看'+(question?'本题':'练习库')+'表结构</summary><div>';
      SCHEMA_META.forEach(function(meta){if(!tables||tables.indexOf(meta.t)>=0)tools+='<strong>'+meta.t+'</strong><p>'+esc(meta.d)+'</p>'});
      tools+='</div></details>';
    }
    return tools;
  }
  function insertSQL(button){
    var editor=document.getElementById(button.getAttribute('data-editor'));
    var token=SQL_TOKENS[parseInt(button.getAttribute('data-token'),10)];
    if(!editor||!token)return;
    var start=editor.selectionStart,end=editor.selectionEnd;
    editor.value=editor.value.slice(0,start)+token[1]+editor.value.slice(end);
    var caret=start+token[1].length;
    if(token[1]==='()'||token[1]==="''")caret--;
    try{editor.focus({preventScroll:true})}catch(error){editor.focus()}
    editor.setSelectionRange(caret,caret);
    editor.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function editorHtml(qid,isPlay){
    if(engineMode==='self'&&!isPlay){
      return '<div class="viz-controls"><label class="form-label text-small">自评模式：离线状态下无法自动判分。写下你的答案 → 对照参考解析 → 自己判分。</label>'
        +'<div class="viz-row">'
        +'<button class="btn btn-primary btn-sm" data-act="self-pass" data-qid="'+qid+'" type="button"><span class="st-btn-ic"><i data-lucide="circle-check" aria-hidden="true"></i>我做对了</span></button>'
        +'<button class="btn btn-sm" data-act="self-fail" data-qid="'+qid+'" type="button"><span class="st-btn-ic"><i data-lucide="circle-x" aria-hidden="true"></i>没做出来</span></button>'
        +'<button class="btn btn-ghost btn-sm" data-act="show-hint" data-qid="'+qid+'" type="button"><span class="st-btn-ic"><i data-lucide="lightbulb" aria-hidden="true"></i>看提示</span></button>'
        +'<button class="btn btn-ghost btn-sm" data-act="show-answer" data-qid="'+qid+'" type="button"><span class="st-btn-ic"><i data-lucide="book-open" aria-hidden="true"></i>查看答案</span></button>'
        +'<button class="btn btn-ghost btn-sm" data-act="show-explain" data-qid="'+qid+'" type="button"><span class="st-btn-ic"><i data-lucide="route" aria-hidden="true"></i>思路拆解</span></button>'
        +'</div></div>';
    }
    return '<div class="st-editor-controls"><div style="width:100%">'
      +'<div class="st-form-label">'
      +'<label class="form-label text-small" for="st-code" style="margin:0">你的 SQL</label>'
      +'<span class="st-editor-shortcut"><kbd>⌘ / Ctrl</kbd><span>+</span><kbd>Enter</kbd> 运行</span></div>'
      +'<div class="st-editor-header"><span><i data-lucide="file-code-2" aria-hidden="true"></i>query.sql</span><small>SQLite · SQL</small></div>'
      +'<textarea id="st-code" class="form-control st-code text-small" rows="10" spellcheck="false"></textarea>'
      +sqlToolsHtml('st-code',qid,false)
      +'<div class="st-editor-actions">'
      +(isPlay
        ?'<button class="btn btn-primary btn-sm" data-act="run-play" type="button"><span class="st-btn-ic"><i data-lucide="play" aria-hidden="true"></i>运行</span></button>'
        :'<button class="btn btn-primary btn-sm" data-act="run" data-qid="'+qid+'" type="button"><span class="st-btn-ic"><i data-lucide="play" aria-hidden="true"></i>运行并判定</span></button>')
      +'<button class="btn btn-sm" data-act="reset-code" data-qid="'+qid+'" type="button"><span class="st-btn-ic"><i data-lucide="eraser" aria-hidden="true"></i>清空重写</span></button>'
      +(isPlay?'':'<button class="btn btn-ghost btn-sm" data-act="show-hint" data-qid="'+qid+'" type="button"><span class="st-btn-ic"><i data-lucide="lightbulb" aria-hidden="true"></i>看提示</span></button><button class="btn btn-ghost btn-sm" data-act="show-answer" data-qid="'+qid+'" type="button"><span class="st-btn-ic"><i data-lucide="book-open" aria-hidden="true"></i>查看答案</span></button>'
        +'<button class="btn btn-ghost btn-sm" data-act="show-explain" data-qid="'+qid+'" type="button"><span class="st-btn-ic"><i data-lucide="route" aria-hidden="true"></i>思路拆解</span></button>')
      +'</div></div></div>';
  }
  function bindEditor(qid){
    var ta=document.getElementById('st-code');
    if(!ta)return;
    ta.value=hasOwn(codes,qid)?codes[qid]:CODE_DEFAULT;
    ta.oninput=function(){codes[qid]=ta.value;saveSession()};
    ta.onkeydown=function(e){if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();
      if(qid==='play'){doRunPlay();focusContent('#st-result')}else{doRun(qid);focusContent('#st-verdict')}}};
  }
  function getSQL(qid){var ta=document.getElementById('st-code');return ta?ta.value.trim():''}
  function rowsToTable(res,maxRows,label){
    if(!res||!res.length||!res[0].columns)return '<div class="text-muted text-small">（无结果集）</div>';
    var cols=res[0].columns,vals=res[0].values;
    var h='<div class="table-responsive st-table-scroll" tabindex="0" role="region" aria-label="'+esc(label||'查询结果，可横向滚动')+'"><table class="table table-sm"><thead><tr>'+cols.map(function(c){return '<th scope="col">'+esc(c)+'</th>'}).join('')+'</tr></thead><tbody>';
    var n=Math.min(vals.length,maxRows||20);
    for(var i=0;i<n;i++){
      h+='<tr>'+vals[i].map(function(v){return '<td>'+(v===null?'<span class="text-muted">NULL</span>':esc(v))+'</td>'}).join('')+'</tr>';
    }
    h+='</tbody></table></div>';
    if(vals.length>n)h+='<div class="text-small text-muted">共 '+vals.length+' 行，仅显示前 '+n+' 行。</div>';
    else h+='<div class="text-small text-muted">共 '+vals.length+' 行</div>';
    return h;
  }
  function doRunPlay(){
    var out=document.getElementById('st-result');
    if(!db){out.innerHTML='<div class="text-destructive" role="alert">练习库还没准备好，稍等一下再试。</div>';return}
    try{out.innerHTML=rowsToTable(runQuery(playDb,getSQL('play')),30)}
    catch(e){out.innerHTML='<div class="text-destructive" role="alert">SQL 错误：'+String(e.message||e).replace(/</g,'&lt;')+'</div>'}
  }
  function differenceHtml(mine,ref,question){
    if(mine.cols!==ref.cols)return '<div class="st-difference">先检查 SELECT：需要 '+ref.cols+' 列，你返回了 '+mine.cols+' 列。</div>';
    if(question.orderCols&&cmpRows(mine,ref)){
      return '<div class="st-difference">数据一致，排序不符合题目要求。先检查 ORDER BY 的列与 ASC / DESC 方向。</div>';
    }
    var missing=[],extra=[],used={};
    mine.rows.forEach(function(row){
      var match=-1;
      for(var rowIndex=0;rowIndex<ref.rows.length;rowIndex++){
        if(!used[rowIndex]&&cmpRows({cols:mine.cols,rows:[row]},{cols:ref.cols,rows:[ref.rows[rowIndex]]})){match=rowIndex;break}
      }
      if(match>=0)used[match]=true;else extra.push(row);
    });
    ref.rows.forEach(function(row,index){if(!used[index])missing.push(row)});
    var details='<div class="st-difference"><strong>先定位一处差异</strong><p>缺少 '+missing.length+' 行，多出 '+extra.length+' 行。检查筛选条件、连接重复、NULL 和数值精度。</p>';
    if(extra.length)details+='<p>你的第一条多余记录：<code>'+esc(JSON.stringify(extra[0]))+'</code></p>';
    if(missing.length)details+='<p>第一条缺失记录：<code>'+esc(JSON.stringify(missing[0]))+'</code></p>';
    return details+'</div>';
  }
  function doRun(qid){
    var q=qById(qid);if(!q||!db)return;
    var v=document.getElementById('st-verdict'),out=document.getElementById('st-result');
    var mine,ref,verdict,sqlTxt=getSQL(qid);
    codes[qid]=sqlTxt;saveSession();
    try{verdict=gradeAnswer(q,sqlTxt);mine=verdict.mine;ref=verdict.ref}
    catch(e){
      bumpAttempts(qid);pushHistory(qid,sqlTxt,0);
      state.wrong[qid]=Math.max(state.wrong[qid]||0,1);saveState();
      v.innerHTML='<div class="text-destructive st-kpi" role="alert"><i data-lucide="circle-x" aria-hidden="true"></i>SQL 有错误：'+String(e.message||e).replace(/</g,'&lt;')+'</div>';
      out.innerHTML='';renderQStatus(qid);refreshIcons();return;
    }
    if(!mine){bumpAttempts(qid);pushHistory(qid,sqlTxt,0);saveState();v.innerHTML='<div class="text-destructive" role="alert">查询没有返回结果集（检查是不是写了只含注释的语句）。</div>';out.innerHTML='';return}
    bumpAttempts(qid);
    var passed=verdict.passed;pushHistory(qid,sqlTxt,passed);
    if(passed){
      var assisted=viewed[qid]?'<span class="text-muted text-small">（看过答案，此题保留在错题本）</span>':'';
      state.done[qid]={ts:Date.now(),used:viewed[qid]?1:0};
      if(!viewed[qid])delete state.wrong[qid];
      var srR=srGrade(qid,viewed[qid]?1:2);
      saveState();markToday();buzz(12);
      var nx=nextQuestion();
      v.innerHTML='<div class="st-verdict-pass st-kpi"><i data-lucide="circle-check" aria-hidden="true"></i>通过！'+assisted+'</div>'
        +'<div class="text-small text-muted" style="margin-top:4px"><i data-lucide="calendar-check" aria-hidden="true"></i>已排入间隔复习 · '+dueLabel(srR.due)+'（'+srR.due+'）</div>'
        +(nx?'<div class="viz-row" style="margin-top:8px"><button class="btn btn-primary btn-sm" data-act="open-q" data-qid="'+nx.id+'" type="button"><span class="st-btn-ic"><i data-lucide="arrow-right" aria-hidden="true"></i>下一题：'+nx.title+'</span></button></div>'
            :'<div class="text-small text-muted" style="margin-top:8px">'+QUESTIONS.length+' 题全部通关！到「测验 · 限时周测」做一场全真模拟收尾。</div>')
        +'<div class="viz-row" style="margin-top:8px;gap:8px"><button class="btn btn-sm" data-act="start-review" type="button">'+(srDueList().length?'继续到期复习':'查看复习安排')+'</button><button class="btn btn-sm" data-act="end-session" type="button">结束本次学习</button></div>';
      out.innerHTML='';renderQStatus(qid);refreshIcons();
    }else{
      state.wrong[qid]=(state.wrong[qid]||0)+1;
      srGrade(qid,0);
      saveState();
      var msg='<div class="text-destructive st-kpi" role="alert"><i data-lucide="circle-x" aria-hidden="true"></i>结果不一致：你的查询返回 '+mine.rows.length+' 行 × '+mine.cols+' 列，标准答案是 '+ref.rows.length+' 行 × '+ref.cols+' 列。</div>';
      if(ref&&mine.cols===ref.cols&&mine.rows.length===ref.rows.length){msg+='<div class="text-small text-muted" style="margin-top:4px">'+(q.orderCols&&cmpRows(mine,ref)?'数据一致，但排序不符合题目要求，请检查 ORDER BY 的列与方向。':'行数列数都对上了，检查某一行的取值（大小写、NULL、精度）。')+'</div>'}
      if(ref)msg+=differenceHtml(mine,ref,q);
      if(state.attempts[qid]>=2&&ref){msg+='<div class="text-small text-muted" style="margin-top:6px">标准结果前3行：</div><div class="st-pre"><table class="table table-sm"><tbody>'+ref.rows.slice(0,3).map(function(r){return '<tr>'+r.map(function(c){return '<td>'+(c===null?'NULL':c)+'</td>'}).join('')+'</tr>'}).join('')+'</tbody></table></div><div class="text-small text-muted" style="margin-top:6px">还差一步就能自己写对——别急着看答案。</div>'}
      v.innerHTML=msg;out.innerHTML='';
      buzz([8,60,10]);
      renderQStatus(qid);refreshIcons();
    }
  }
  function renderQStatus(qid){
    updateStreak();
    var el=document.getElementById('st-qstatus');
    var q=qById(qid);
    if(el&&q)el.innerHTML=qStatus(q);
  }

  /* ---------- 周测 ---------- */
  function renderTest(){
    var el=document.getElementById('panel-test');
    if(test){renderTestRunning();return}
    if(testResult){renderTestSummary();return}
    var opts=WEEKS.slice(0,8).map(function(wk){return '<option value="'+wk.w+'">第'+wk.w+'周 · '+wk.name+'</option>'}).join('');
    el.innerHTML='<div class="st-kpi" style="margin-bottom:6px"><i data-lucide="timer" aria-hidden="true"></i><h3 style="margin:0">45 分钟限时周测</h3></div>'
      +'<p class="text-small text-muted">从所选范围随机抽 5 题闭卷考：无提示、无答案、全程计时，到点自动交卷，错题自动进错题本。建议每周日做一次，成绩 ≥4 题再进入下一周。</p>'
      +'<div class="viz-controls"><div><label class="form-label text-small" for="st-test-week">范围</label>'
      +'<select id="st-test-week" class="form-select form-select-sm">'+opts+'<option value="mix">全部混合（W1–W8）</option></select></div></div>'
      +'<div class="viz-row" style="margin-top:4px"><button class="btn btn-primary" data-act="test-start" type="button"><span class="st-btn-ic"><i data-lucide="play" aria-hidden="true"></i>开始周测</span></button></div>'
      +'<div id="st-test-result" style="margin-top:10px"></div>';
    refreshIcons();
  }
  function shuffle(arr){var a=arr.slice();for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=a[i];a[i]=a[j];a[j]=t}return a}
  function startTest(){
    if(!db){stToast('练习库准备好后才能开始周测');return}
    if(test){renderTestRunning();return}
    var sel=document.getElementById('st-test-week');
    var wv=sel?sel.value:'mix';
    var pool;
    if(wv==='mix')pool=QUESTIONS.slice();
    else pool=QUESTIONS.filter(function(q){return q.w===parseInt(wv,10)});
    var notDone=shuffle(pool.filter(function(q){return !state.done[q.id]}));
    var doneOnes=shuffle(pool.filter(function(q){return state.done[q.id]}));
    var picked=notDone.concat(doneOnes).slice(0,5);
    testResult=null;
    test={id:genSyncCode(),qids:picked.map(function(q){return q.id}),idx:0,endAt:Date.now()+45*60000,remain:45*60,finished:false};
    test.qids.forEach(function(id){delete codes['test_'+id]});
    saveSession();startTestTimer();
    renderTestRunning();
  }
  function refreshTestClock(){
    if(!test||test.finished)return;
    test.remain=Math.max(0,Math.ceil((test.endAt-Date.now())/1000));
    var t=document.getElementById('st-test-timer');
    if(t){t.textContent=fmtRemain(test.remain);t.classList.toggle('st-timer-warn',test.remain<=300)}
    if(test.remain<=0&&db)finishTest();
  }
  function startTestTimer(){
    if(testTimer){clearInterval(testTimer);testTimer=null}
    if(!test||!db)return;
    refreshTestClock();
    if(test)testTimer=setInterval(refreshTestClock,1000);
  }
  function fmtRemain(s){var m=Math.floor(s/60),ss=s%60;return m+':'+('0'+ss).slice(-2)}
  function renderTestRunning(){
    var el=document.getElementById('panel-test');
    var q=qById(test.qids[test.idx]);
    el.innerHTML='<div class="viz-row" style="justify-content:space-between;margin-bottom:4px">'
      +'<div class="st-kpi"><i data-lucide="timer" aria-hidden="true"></i><h3 style="margin:0">周测 · 第 '+(test.idx+1)+'/'+test.qids.length+' 题</h3></div>'
      +'<span class="viz-badge tabular-nums'+(test.remain<=300?' st-timer-warn':'')+'" id="st-test-timer">'+fmtRemain(test.remain)+'</span></div>'
      +'<div class="viz-row" style="gap:6px;margin:8px 0 4px"><span class="viz-badge">W'+q.w+'</span><span class="viz-badge">'+q.pts+' 分</span></div>'
      +'<p style="margin:6px 0 10px;font-weight:500">'+q.text+'</p>'
      +'<div class="viz-controls"><div style="width:100%"><label class="form-label text-small" for="st-test-code">你的 SQL（闭卷）</label>'
      +'<textarea id="st-test-code" class="form-control st-code text-small" rows="10" spellcheck="false"></textarea>'+sqlToolsHtml('st-test-code',q.id,true)+'</div></div>'
      +'<div class="viz-row" style="margin-top:8px">'
      +(test.idx>0?'<button class="btn btn-sm" data-act="test-prev" type="button"><span class="st-btn-ic"><i data-lucide="chevron-left" aria-hidden="true"></i>上一题</span></button>':'')
      +(test.idx<test.qids.length-1?'<button class="btn btn-primary btn-sm" data-act="test-next" type="button"><span class="st-btn-ic">下一题<i data-lucide="chevron-right" aria-hidden="true"></i></span></button>':'')
      +'<button class="btn btn-sm" data-act="test-finish" type="button"><span class="st-btn-ic"><i data-lucide="flag" aria-hidden="true"></i>交卷</span></button></div>'
      +'<div id="st-test-result" style="margin-top:10px"></div>';
    var ta=document.getElementById('st-test-code');
    var codeKey='test_'+test.qids[test.idx];
    ta.value=hasOwn(codes,codeKey)?codes[codeKey]:CODE_DEFAULT;
    ta.oninput=function(){if(test){codes[codeKey]=ta.value;saveSession()}};
    refreshIcons();
  }
  function finishTest(){
    if(!test||test.finished)return;
    if(!db){stToast('练习库准备中，答案已保留，稍后继续交卷');return}
    test.finished=true;
    if(testTimer){clearInterval(testTimer);testTimer=null}
    var before=cloneProgress(state),results=[];
    test.qids.forEach(function(qid){
      var q=qById(qid);
      var ok=false;
      if(db){
        try{ok=gradeAnswer(q,codes['test_'+qid]||'').passed}catch(e){ok=false}
      }
      if(ok){state.done[qid]={ts:Date.now(),used:0};delete state.wrong[qid];srGrade(qid,2)}
      else{state.wrong[qid]=(state.wrong[qid]||0)+1;srGrade(qid,0)}
      results.push({qid:qid,ok:ok});
    });
    var day=todayStr();if(state.days.indexOf(day)<0)state.days.push(day);
    state.lastTest={id:test.id,results:results,endedAt:Date.now()};
    if(!saveState()){state=before;test.finished=false;saveSession();return}
    testResult=cloneProgress(state.lastTest);test=null;saveSession();
    renderTestSummary();updateStreak();refreshIcons();
  }
  function renderTestSummary(){
    var passed=0,rows='';
    testResult.results.forEach(function(r){
      var q=qById(r.qid);if(r.ok)passed++;
      rows+='<div class="viz-row" style="justify-content:space-between;margin-bottom:6px"><span class="st-kpi"><i data-lucide="'+(r.ok?'circle-check':'circle-x')+'" aria-hidden="true" class="'+(r.ok?'st-pass':'st-fail')+'"></i>W'+q.w+' '+q.title+'</span><button class="btn btn-ghost btn-sm" data-act="open-q" data-qid="'+q.id+'" type="button">去复盘</button></div>';
    });
    var el=document.getElementById('panel-test');
    el.innerHTML='<div class="viz-grid" style="margin-bottom:14px">'
      +'<div class="card viz-stat"><div class="text-muted text-small">本次成绩</div><div class="viz-stat-value tabular-nums">'+passed+'<span class="text-muted text-small"> / '+testResult.results.length+'</span></div>'
      +(passed>=4?'<div class="st-kpi text-small st-pass"><i data-lucide="party-popper" aria-hidden="true"></i>很稳，可以进入下一周</div>':'<div class="st-kpi text-small text-muted"><i data-lucide="rotate-ccw" aria-hidden="true"></i>不到 4 题：错题重写两遍再往后走</div>')+'</div></div>'
      +'<hr>'+rows
      +'<div class="viz-row" style="margin-top:12px"><button class="btn btn-primary btn-sm" data-act="test-home" type="button"><span class="st-btn-ic"><i data-lucide="rotate-ccw" aria-hidden="true"></i>再测一次</span></button></div>';
    refreshIcons();
  }

  /* ---------- 间隔复习 ---------- */
  function renderReview(){
    var el=document.getElementById('panel-review');if(!el)return;
    var due=srDueList();
    var total=0;for(var id in (state.sr||{}))total++;
    var h='<div class="st-kpi" style="margin-bottom:6px"><i data-lucide="repeat" aria-hidden="true"></i><h3 style="margin:0">间隔复习</h3></div>'
      +'<p class="text-small text-muted" style="margin-bottom:14px">做过的题会按记忆曲线自动排程:1 天 → 3 天 → 按熟练度逐步拉长,最远 60 天。每天几分钟清一遍到期题,把「做过」变成「记得住」。</p>';
    if(!total){
      h+='<div class="text-muted text-small">还没有题进入复习循环。通过一道新题,它会自动排入明天的复习。</div>';
    }else if(!due.length){
      var upcoming=Object.keys(state.sr).sort(function(a,b){return state.sr[a].due<state.sr[b].due?-1:1}).slice(0,6);
      h+='<div class="st-rev-strip"><div class="st-rev-strip-t"><i data-lucide="circle-check" aria-hidden="true"></i><div>今天没有到期的复习<small>共 '+total+' 题在复习计划里。休息一下,明天继续。</small></div></div></div>'
        +'<div class="st-rev-list">'+upcoming.map(function(id){var q=qById(id);if(!q)return '';return '<div class="st-rev-item"><span class="text-small">'+esc(q.title)+'</span><span class="st-rev-due">'+dueLabel(state.sr[id].due)+'</span></div>'}).join('')+'</div>';
    }else{
      h+='<div class="st-rev-strip"><div class="st-rev-strip-t"><i data-lucide="bell-ring" aria-hidden="true"></i><div>今天有 '+due.length+' 题到期<small>清完这批,今天的复习就收工。</small></div></div>'
        +'<button class="btn btn-primary" data-act="start-review" type="button"><span class="st-btn-ic"><i data-lucide="play" aria-hidden="true"></i>开始复习</span></button></div>'
        +'<div class="st-rev-list">'+due.map(function(id){var q=qById(id);if(!q)return '';return '<div class="st-rev-item"><span class="text-small">'+esc(q.title)+'</span><span class="st-rev-due '+(state.sr[id].due<todayStr()?'is-over':'is-today')+'">'+dueLabel(state.sr[id].due)+'</span></div>'}).join('')+'</div>';
    }
    el.innerHTML=h;refreshIcons();
  }

  /* ---------- 错题本 ---------- */
  function renderWrong(){
    var el=document.getElementById('panel-wrong');
    var ids=Object.keys(state.wrong);
    var head='<div class="st-kpi" style="margin-bottom:8px"><i data-lucide="rotate-ccw" aria-hidden="true"></i><h3 style="margin:0">错题本（'+ids.length+'）</h3></div>';
    if(!ids.length){el.innerHTML=head+'<p class="text-muted text-small">空空如也——做错过的题会自动进这里，不看答案重写通过后会自动移出。</p>';refreshIcons();return}
    var rows=ids.sort(function(a,b){return state.wrong[b]-state.wrong[a]}).map(function(qid){
      var q=qById(qid);if(!q)return '';
      return '<div class="viz-row" style="justify-content:space-between;margin-bottom:8px"><span class="st-kpi"><span class="st-dot is-wrong"></span>W'+q.w+' '+q.title+'<span class="text-muted text-small">错'+state.wrong[qid]+'次</span></span>'
        +'<span class="viz-row" style="gap:6px"><button class="btn btn-primary btn-sm" data-act="open-q" data-qid="'+qid+'" type="button"><span class="st-btn-ic"><i data-lucide="pen-line" aria-hidden="true"></i>去重写</span></button>'
        +'<button class="btn btn-ghost btn-sm" data-act="wrong-del" data-qid="'+qid+'" type="button"><i data-lucide="x" aria-hidden="true"></i><span class="sr-only">移除</span></button></span></div>';
    }).join('');
    el.innerHTML=head+'<div class="viz-row" style="margin:10px 0 12px"><button class="btn btn-primary" data-act="wrong-practice" type="button"><span class="st-btn-ic"><i data-lucide="repeat" aria-hidden="true"></i>开始重练 · 只看错题</span></button></div><hr>'+rows;
    refreshIcons();
  }

  /* ---------- 模板库 ---------- */
  function renderTpl(){
    var el=document.getElementById('panel-tpl');
    el.innerHTML='<div class="st-kpi" style="margin-bottom:6px"><i data-lucide="layout-template" aria-hidden="true"></i><h3 style="margin:0">模板库</h3></div>'
      +'<p class="text-small text-muted" style="margin-bottom:12px">现场写 SQL 靠模板不靠灵感。这九个模式覆盖售前 demo 和笔试 90% 的场景，点"载入练习区"可直接运行改写。</p>'
      +TEMPLATES.map(function(t,i){
        return '<div style="margin-bottom:14px"><div class="viz-row" style="justify-content:space-between"><span style="font-weight:500">'+t.name+'</span>'
        +'<button class="btn btn-sm" data-act="tpl-load" data-i="'+i+'" type="button"><span class="st-btn-ic"><i data-lucide="arrow-down-to-line" aria-hidden="true"></i>载入练习区</span></button></div>'
        +'<div class="text-small text-muted" style="margin:2px 0 6px">'+t.biz+'</div>'
        +'<div class="st-pre"><pre><code>'+t.code.replace(/</g,'&lt;')+'</code></pre></div></div>';
      }).join('');
    refreshIcons();
  }

  /* ---------- 数据表 ---------- */
  var SCHEMA_META=[
    {t:'users',c:'用户表（30人）',d:'user_id 用户ID · name 姓名 · city 城市 · gender 性别 · age 年龄 · register_date 注册日期'},
    {t:'products',c:'商品表（20个）',d:'product_id 商品ID · product_name 商品名 · category 类目（数码/家居/服饰/食品/美妆） · price 原价 · discount_price 会员价（可为空）'},
    {t:'orders',c:'订单表（约220单，2026-08-01 至 2026-10-20）',d:'order_id 订单ID · user_id 用户ID · order_date 下单日期 · status 状态（已完成/已取消/已退款）'},
    {t:'order_items',c:'订单明细表（一单1–3条）',d:'item_id 明细ID · order_id 订单ID · product_id 商品ID · quantity 数量 · unit_price 成交单价'}
  ];
  function renderSchema(){
    var el=document.getElementById('panel-schema');
    var h='<div class="st-kpi" style="margin-bottom:6px"><i data-lucide="database" aria-hidden="true"></i><h3 style="margin:0">练习库数据表</h3></div>'
      +'<p class="text-small text-muted" style="margin-bottom:12px">关系：users 1—N orders 1—N order_items N—1 products。提醒：order_items 是一对多，连接后 COUNT 要去重。</p>';
    SCHEMA_META.forEach(function(m){
      var cnt='';
      if(db){try{cnt=' · '+runQuery(db,'SELECT COUNT(*) AS n FROM '+m.t)[0].values[0][0]+' 行'}catch(e){}}
      h+='<div style="margin-bottom:14px"><div class="st-kpi"><i data-lucide="table-2" aria-hidden="true"></i><strong>'+m.t+'</strong><span class="text-muted text-small">'+m.c+cnt+'</span></div>'
        +'<div class="text-small text-muted" style="margin:2px 0 6px">'+m.d+'</div>';
      if(db){
        try{h+=rowsToTable(runQuery(db,'SELECT * FROM '+m.t+' LIMIT 5'),5,m.t+' 数据预览，可横向滚动')}catch(e){}
      }
      h+='</div>';
    });
    el.innerHTML=h;
    refreshIcons();
  }

  var learnView='course',currentLid=null;
/* ---------- 学习中心 ---------- */
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')}
function lessonById(id){for(var i=0;i<LESSONS.length;i++){if(LESSONS[i].id===id)return LESSONS[i]}return null}
function lessonProgress(w){var t=0,d=0;LESSONS.forEach(function(l){if(!w||l.w===w){t++;if(state.lessons[l.id])d++}});return{total:t,done:d}}
function nextLesson(){for(var i=0;i<LESSONS.length;i++){if(!state.lessons[LESSONS[i].id])return LESSONS[i]}return null}
function qLesson(qid){for(var i=0;i<LESSONS.length;i++){if(LESSONS[i].qs&&LESSONS[i].qs.indexOf(qid)>=0)return LESSONS[i]}return null}
function lBtn(l){
  var cls=state.lessons[l.id]?'is-done':'';
  return '<button class="btn btn-sm'+(currentLid===l.id?' btn-primary':'')+'" data-act="open-lesson" data-lid="'+l.id+'" type="button"><span class="st-qbtn"><span class="st-dot '+cls+'"></span><span class="st-qtitle">'+esc(l.title)+'</span></span><span class="text-muted text-small tabular-nums">'+l.min+'′</span></button>';
}
function lessonResultHtml(l,s,i){
  var out='<div class="st-ex-out" id="st-lx-'+l.id+'-'+i+'">';
  if(!db)out+=engineMode==='self'?'<div class="text-muted text-small">自评模式：示例暂不能运行，讲解与语法不受影响。</div>':'<div class="text-muted text-small">练习库准备中，稍等片刻或点"再跑一遍"。</div>';
  else{
    try{out+=rowsToTable(runQuery(db,s.code),12)}
    catch(e){out+='<div class="text-destructive" role="alert">SQL 错误：'+esc(String(e.message||e))+'</div>'}
  }
  return out+'</div>';
}
function renderLearn(){
  var el=document.getElementById('panel-learn');
  if(!el)return;
  var views=[['course','课程'],['plan','学习计划'],['cheat','速查手册']];
  var sw=views.map(function(v){return '<button class="btn btn-sm'+(learnView===v[0]?' btn-primary':'')+'" aria-pressed="'+String(learnView===v[0])+'" data-act="learn-view" data-view="'+v[0]+'" type="button">'+v[1]+'</button>'}).join('');
  var list='';
  if(learnView==='course'){
    var lt=lessonProgress();
    list='<div class="st-weekhead"><span class="text-small" style="font-weight:500">八周微课 · 先学后练</span><span class="text-small text-muted tabular-nums">'+lt.done+'/'+lt.total+' 课</span></div>';
    WEEKS.forEach(function(wk){
      var lp=lessonProgress(wk.w);
      list+='<div class="st-weekhead"><span class="text-small" style="font-weight:500">第'+wk.w+'周 · '+wk.name+'</span><span class="text-small text-muted tabular-nums">'+lp.done+'/'+lp.total+' 课</span></div>';
      LESSONS.forEach(function(l){if(l.w===wk.w)list+=lBtn(l)});
    });
  }else if(learnView==='plan'){
    list='<div class="st-weekhead"><span class="text-small" style="font-weight:500">八周训练计划 · 售前转型专用</span></div><div class="text-muted text-small" style="margin:6px 9px 0">目标画像、每周里程碑、四条军规与资源清单，都在右侧这一页。</div>';
  }else{
    list='<div class="st-weekhead"><span class="text-small" style="font-weight:500">SQL 语法速查手册</span></div><div class="text-muted text-small" style="margin:6px 9px 0">函数对照、执行顺序与易错清单。写题卡壳时翻这里。</div>';
  }
  el.innerHTML='<div class="st-learn-switch" role="group" aria-label="学习内容切换">'+sw+'</div><div class="st-cols"><details class="st-question-library st-catalog"'+(window.matchMedia('(min-width:961px)').matches?' open':'')+'><summary>'+(learnView==='course'?'课程目录 · 按需切换微课':'学习导航')+'</summary><div class="st-qlist">'+list+'</div></details><div id="st-lpanel"></div></div>';
  if(learnView==='course')renderLesson();
  else if(learnView==='plan')renderPlanPage();
  else renderCheatPage();
}
function renderLesson(){
  var panel=document.getElementById('st-lpanel');
  if(!panel)return;
  var l=lessonById(currentLid)||LESSONS[0];
  currentLid=l.id;
  lastLearning={type:'lesson',id:l.id};
  var wk=WEEKS[l.w-1];
  var idx=LESSONS.indexOf(l);
  var prev=LESSONS[idx-1],nx=LESSONS[idx+1];
  var h='<div class="viz-row" style="justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">'
    +'<div class="viz-row" style="gap:6px;flex-wrap:wrap"><span class="viz-badge">W'+l.w+' · '+wk.name+'</span><span class="viz-badge">约 '+l.min+' 分钟</span>'+(state.lessons[l.id]?'<span class="st-pass">✓ 已学会</span>':'<span class="text-muted text-small">未标记学会</span>')+'</div>'
    +'<span class="text-small text-muted tabular-nums">微课 '+(idx+1)+' / '+LESSONS.length+'</span></div>'
    +'<h2 class="st-task-title">'+esc(l.title)+'</h2>'
    +'<div class="st-goal"><i data-lucide="target" aria-hidden="true"></i><span><strong>学完这课你能：</strong>'+esc(l.goal)+'</span></div>';
  l.secs.forEach(function(s,i){
    if(s.h)h+='<h3 class="st-lh">'+esc(s.h)+'</h3>';
    if(s.p)h+='<p class="st-lp">'+esc(s.p)+'</p>';
    if(s.code){
      if(s.run){
        h+='<div class="st-ex"><div class="st-ex-head"><span class="st-kpi"><i data-lucide="flask-conical" aria-hidden="true"></i>示例 · 已在你的练习库上运行</span><button class="btn btn-primary btn-sm" data-act="lesson-run" data-lid="'+l.id+'" data-idx="'+i+'" type="button"><span class="st-btn-ic"><i data-lucide="play" aria-hidden="true"></i>再跑一遍</span></button></div>'
          +'<div class="st-pre"><pre><code>'+esc(s.code)+'</code></pre></div>'
          +(s.note?'<div class="st-ex-note text-small text-muted">'+esc(s.note)+'</div>':'')
          +lessonResultHtml(l,s,i)+'</div>';
      }else{
        h+='<div class="st-pre"><pre><code>'+esc(s.code)+'</code></pre></div>'+(s.note?'<div class="st-ex-note text-small text-muted">'+esc(s.note)+'</div>':'');
      }
    }
    if(s.traps)h+='<div class="st-traps"><strong><i data-lucide="alert-triangle" aria-hidden="true"></i>易错点</strong><ul>'+s.traps.map(function(t){return '<li>'+esc(t)+'</li>'}).join('')+'</ul></div>';
  });
  if(l.biz)h+='<div class="st-biz"><strong><i data-lucide="briefcase" aria-hidden="true"></i>业务现场</strong><p>'+esc(l.biz)+'</p></div>';
  if(l.key)h+='<div class="st-key"><strong><i data-lucide="pin" aria-hidden="true"></i>一句话记住</strong><p>'+esc(l.key)+'</p></div>';
  if(l.qs&&l.qs.length){
    h+='<div class="st-lqhead"><i data-lucide="dumbbell" aria-hidden="true"></i>配套练习 · 学完立刻去练</div><div class="viz-row" style="gap:6px;flex-wrap:wrap">';
    l.qs.forEach(function(qid){
      var q=qById(qid);
      if(q)h+='<button class="btn btn-sm" data-act="open-q" data-qid="'+qid+'" type="button"><span class="st-qbtn"><span class="st-dot '+(state.done[qid]?'is-done':(state.wrong[qid]?'is-wrong':''))+'"></span><span class="st-qtitle">'+esc(q.title)+'</span></span><span class="text-muted text-small tabular-nums">'+q.pts+'分</span></button>';
    });
    h+='</div>';
  }
  h+='<div class="viz-row" style="margin-top:16px;flex-wrap:wrap;gap:8px">'
    +'<button class="btn '+(state.lessons[l.id]?'':'btn-primary')+'" data-act="lesson-done" data-lid="'+l.id+'" type="button"><span class="st-btn-ic"><i data-lucide="'+(state.lessons[l.id]?'rotate-ccw':'check')+'" aria-hidden="true"></i>'+(state.lessons[l.id]?'取消"已学会"':'标记为已学会')+'</span></button>'
    +(prev?'<button class="btn btn-sm" data-act="lesson-nav" data-lid="'+prev.id+'" type="button"><span class="st-btn-ic"><i data-lucide="chevron-left" aria-hidden="true"></i>上一课</span></button>':'')
    +(nx?'<button class="btn btn-sm" data-act="lesson-nav" data-lid="'+nx.id+'" type="button"><span class="st-btn-ic">下一课<i data-lucide="chevron-right" aria-hidden="true"></i></span></button>':'')
    +'</div>';
  panel.innerHTML=h;
  refreshIcons();
  window.scrollTo(0,0);
}
function doLessonRun(lid,idx){
  var l=lessonById(lid);
  if(!l)return;
  var s=l.secs[idx];
  var out=document.getElementById('st-lx-'+lid+'-'+idx);
  if(!s||!out)return;
  if(!db){out.innerHTML='<div class="text-destructive" role="alert">引擎未加载，无法运行。</div>';return}
  try{out.innerHTML=rowsToTable(runQuery(db,s.code),12)}
  catch(e){out.innerHTML='<div class="text-destructive" role="alert">SQL 错误：'+esc(String(e.message||e))+'</div>'}
}
function toggleLesson(lid){
  var l=lessonById(lid);
  if(!l)return;
  if(state.lessons[lid])delete state.lessons[lid];
  else{state.lessons[lid]=1;markToday()}
  saveState();renderLearn();
}
function openLesson(lid){
  var l=lessonById(lid);
  if(!l)return;
  currentLid=lid;learnView='course';
  switchTab('learn');
  focusContent('#st-lpanel .st-task-title');
}
function pchk(k,label){
  var on=!!state.plan[k];
  return '<button class="st-pchk'+(on?' is-on':'')+'" aria-pressed="'+String(on)+'" data-act="plan-check" data-k="'+k+'" type="button"><span class="st-pchk-box" aria-hidden="true">'+(on?'✓':'')+'</span><span>'+esc(label)+'</span></button>';
}
var PLAN_WEEKS=[
  ['取数基础','SELECT、WHERE、ORDER BY、LIMIT、DISTINCT、NULL 处理、字符串/日期函数','给一张表，能按任意条件取数排序'],
  ['聚合统计','COUNT/SUM/AVG、GROUP BY、HAVING、CASE WHEN','看到看板上的指标能反推出 SQL'],
  ['多表 JOIN','INNER/LEFT JOIN、三表连接、一对多导致重复计算的陷阱','三表连接不晕，知道什么时候要去重'],
  ['子查询与 CTE','WHERE/FROM 子查询、EXISTS、UNION、WITH','能把复杂需求拆成"先算什么再算什么"'],
  ['窗口函数（上）','ROW_NUMBER/RANK/DENSE_RANK、PARTITION BY、分组 TopN','独立写出 TopN——笔试区分度最大的考点'],
  ['窗口函数（下）','LAG/LEAD（同环比/留存）、SUM() OVER（累计）','独立写出"每日留存率/复购率"经典题'],
  ['业务综合','GMV 拆解、同比环比、留存漏斗、RFM 分层、行转列','牛客中等+较难真题刷 40 道'],
  ['模拟笔试','3 次 45 分钟限时模拟；了解 Hive/Spark SQL 与 MySQL 方言差异','4 题稳定完成 3 题以上']
];
function renderPlanPage(){
  var panel=document.getElementById('st-lpanel');
  if(!panel)return;
  var h='<h2 class="st-task-title">八周训练计划 · 售前转型专用</h2>'
    +'<div class="st-goal"><i data-lucide="target" aria-hidden="true"></i><span><strong>目标画像：</strong>你不是数据工程师，是售前。三个验收标准——① 笔试关：45 分钟限时写出"多表 JOIN + 分组聚合 + 窗口函数"的中等难度题；② 现场关：面试官/客户面前，给一个业务问题，能口述思路并当场写出来；③ 沟通关：看得懂数仓团队的表结构（事实表/维度表/分区），能和实施同事对接。</span></div>'
    +'<h3 class="st-lh">第 0 周：搭环境（半天搞定）</h3>'
    +'<div class="st-pchecks">'
    +pchk('env_mysql','装本地 MySQL 8（笔试主流方言，帆软报表也常接 MySQL）；不想装就用牛客自带的在线编辑器')
    +pchk('env_nowcoder','注册牛客网（SQL 题库免费、企业笔试真题多）+ LeetCode（数据库 50 题）')
    +pchk('env_sqlbolt','过一遍 SQLBolt（英文但简单，边学边练的交互入门）')
    +pchk('env_notebook','准备一本错题本（纸质或印象/飞书文档），本系统内置错题本也可以')
    +'</div>'
    +'<h3 class="st-lh">八周主计划（每天 45—60 分钟）</h3>'
    +'<div class="table-responsive"><table class="table table-sm"><thead><tr><th>周</th><th>主题</th><th>内容</th><th>验收里程碑</th></tr></thead><tbody>'
    +PLAN_WEEKS.map(function(r,i){return '<tr><td>W'+(i+1)+'</td><td>'+esc(r[0])+'</td><td>'+esc(r[1])+'</td><td>'+esc(r[2])+'</td></tr>'}).join('')
    +'</tbody></table></div>'
    +'<h3 class="st-lh">每日节奏（工作日 60 分钟）</h3>'
    +'<div class="st-psteps"><div><span>10′</span><div><strong>重写昨天的错题</strong><small>重写，不是重看</small></div></div><div><span>40′</span><div><strong>新题 3—5 道</strong><small>先自己写 15 分钟，卡住再看题解；看完关掉题解重写一遍，写不出 = 没会</small></div></div><div><span>10′</span><div><strong>错题本记一道</strong><small>只写一句话卡点</small></div></div></div>'
    +'<p class="st-lp"><strong>每周日</strong>：90 分钟周测 + 整理本周"模板库"（TopN / 留存 / 连续登录 / 行转列）——售前现场写 SQL 靠模板不靠灵感。也可以直接用"周测"页自助考试，成绩 ≥4 题（5 题制）再进入下一周。</p>'
    +'<h3 class="st-lh">防无效刷题的四条军规</h3>'
    +'<div class="st-rules"><div><span>1</span>每道题先用中文写思路（取哪张表 → 怎么关联 → 按什么分组 → 算什么），再翻译成 SQL</div><div><span>2</span>题解必须关掉重写，禁止"看懂了"自我安慰</div><div><span>3</span>每学一个语法，问自己：客户看板上哪个数字是这么算的？（SQL 直接服务你的 demo 能力）</div><div><span>4</span>八周只用 MySQL 一种方言，别东学西学</div></div>'
    +'<h3 class="st-lh">资源清单</h3>'
    +'<div class="st-res"><a href="https://www.nowcoder.com/" target="_blank" rel="noopener">牛客网 SQL 题库 ↗</a><span>主战场，企业笔试真题多</span></div>'
    +'<div class="st-res"><a href="https://leetcode.cn/problemset/database/" target="_blank" rel="noopener">LeetCode 数据库 50 题 ↗</a><span>窗口函数专题必刷</span></div>'
    +'<div class="st-res"><a href="https://sqlbolt.com/" target="_blank" rel="noopener">SQLBolt ↗</a><span>W1—W2 交互入门（SQLZOO 也可）</span></div>'
    +'<div class="st-res"><span>《SQL 必知必会》</span><span>超薄小书，W1—W2 配套读物</span></div>'
    +'<h3 class="st-lh">八周后验收</h3>'
    +'<div class="st-pchecks">'
    +pchk('acc_nowcoder','牛客中等题正确率 80%+')
    +pchk('acc_timed','限时模拟 4 题完成 3 题+')
    +pchk('acc_demo','能用 SQL 为自己的 BI demo 作品造数据、验数据（和作品集打通）')
    +'</div>'
    +'<div class="st-biz"><strong><i data-lucide="briefcase" aria-hidden="true"></i>周测陪练</strong><p>每周日用「测验 · 限时周测」自助一场：抽题 → 计时作答 → 交卷复盘，把新套路沉淀进模板库。</p></div>';
  panel.innerHTML=h;
  refreshIcons();
  window.scrollTo(0,0);
}
function tbl(heads,rows){
  return '<div class="table-responsive"><table class="table table-sm st-cheat-tbl"><thead><tr>'+heads.map(function(x){return '<th>'+esc(x)+'</th>'}).join('')+'</tr></thead><tbody>'
    +rows.map(function(r){return '<tr>'+r.map(function(c){return '<td>'+esc(c)+'</td>'}).join('')+'</tr>'}).join('')
    +'</tbody></table></div>';
}
function renderCheatPage(){
  var panel=document.getElementById('st-lpanel');
  if(!panel)return;
  var h='<h2 class="st-task-title">SQL 语法速查手册</h2>'
    +'<p class="text-small text-muted">训练库为 SQLite，笔试多为 MySQL，数仓是 Hive。语法骨架三家通用，差异集中在日期、拼接、NULL 兜底。</p>'
    +'<h3 class="st-lh">SQL 执行顺序（报错先想它）</h3>'
    +'<div class="st-order">FROM → JOIN → WHERE → GROUP BY → HAVING → SELECT（含别名）→ DISTINCT → ORDER BY → LIMIT</div>'
    +'<details open><summary>字符串函数</summary>'
    +tbl(['用途','SQLite','MySQL','Hive'],[
      ['长度','LENGTH(s)','CHAR_LENGTH(s)','length(s)'],
      ['截取','SUBSTR(s,a,b)','SUBSTRING(s,a,b)','substr(s,a,b)'],
      ['大小写','UPPER(s) / LOWER(s)','UPPER / LOWER','upper / lower'],
      ['拼接',"a || b",'CONCAT(a,b)','concat(a,b) / concat_ws(sep,…)'],
      ['替换','REPLACE(s,a,b)','REPLACE','replace'],
      ['去空格','TRIM(s)','TRIM','trim']
    ])+'</details>'
    +'<details open><summary>日期函数（最常见差异）</summary>'
    +tbl(['用途','SQLite','MySQL','Hive'],[
      ['今天',"date('now')",'CURDATE()','current_date()'],
      ['年-月',"strftime('%Y-%m',d)","DATE_FORMAT(d,'%Y-%m')","date_format(d,'yyyy-MM')"],
      ['取年/月',"strftime('%Y',d) / strftime('%m',d)",'YEAR(d) / MONTH(d)','year(d) / month(d)'],
      ['天数差','CAST(julianday(a)-julianday(b) AS INTEGER)','DATEDIFF(a,b)','datediff(a,b)'],
      ['日期加减',"date(d,'+7 day')","DATE_ADD(d,INTERVAL 7 DAY)",'date_add(d,7)'],
      ['日期转文本',"strftime('%m',d)","DATE_FORMAT(d,'%m')",'substr(d,6,2)']
    ])+'</details>'
    +'<details open><summary>NULL 处理</summary>'
    +tbl(['用途','SQLite','MySQL','Hive'],[
      ['取第一个非空','COALESCE(a,b,c)','COALESCE','COALESCE'],
      ['两参兜底','IFNULL(a,b)','IFNULL(a,b)','nvl(a,b)'],
      ['两者相等则 NULL','NULLIF(a,b)','NULLIF','NULLIF']
    ])+'</details>'
    +'<details open><summary>聚合与条件</summary>'
    +tbl(['类别','写法','备注'],[
      ['计数','COUNT(*) / COUNT(col) / COUNT(DISTINCT col)','行数 / 非空 / 去重——口径不同'],
      ['求和平均','SUM(x) / AVG(x)','自动忽略 NULL'],
      ['最值','MIN(x) / MAX(x)','—'],
      ['保留小数','ROUND(x,2)','报表金额标配'],
      ['条件打标',"CASE WHEN 条件 THEN a ELSE b END",'三家通用；MySQL/Hive 另有 IF(条件,a,b)'],
      ['条件计数','SUM(CASE WHEN 条件 THEN 1 ELSE 0 END)','高频写法，务必背熟']
    ])+'</details>'
    +'<details open><summary>窗口函数</summary>'
    +tbl(['函数','用途','备注'],[
      ['ROW_NUMBER()','组内唯一序号 1,2,3','TopN 首选'],
      ['RANK()','并列跳号 1,1,3','并列也算名次'],
      ['DENSE_RANK()','并列不跳号 1,1,2','密集排名'],
      ['LAG(x)/LEAD(x)','上/下一行的值','环比、间隔；首尾为 NULL'],
      ['SUM(x) OVER (ORDER BY d)','累计','累计 GMV 曲线'],
      ['AVG(x) OVER (… ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)','7 日移动平均','帧控制窗口大小'],
      ['通用语法','… OVER (PARTITION BY 分区 ORDER BY 排序)','结果筛选必须包一层']
    ])+'</details>'
    +'<details open><summary>售前业务黑话（听不懂就翻这里）</summary>'
    +tbl(['术语','是什么','怎么算 / 对应练习'],[
      ['GMV','一段时间内的成交总额（口径：通常只算已完成订单）','SUM(明细金额) · 见微课 W7/L1 与 q35'],
      ['客单价','平均每笔订单的金额（除以订单数，不是人数）','总金额 ÷ COUNT(DISTINCT 订单) · q39'],
      ['ARPU','平均每用户收入','总收入 ÷ 用户数'],
      ['SKU','一个商品（最小存货单位）','products 表一行就是一个 SKU'],
      ['动销率','有销量的商品占在售商品的比例','COUNT(DISTINCT 下过单的商品) ÷ 总商品数'],
      ['复购率','买过的人里买了 2 次及以上的占比','侧挂计数 + CASE WHEN · W6/L3 与 q32'],
      ['留存率','某段时间的新用户，之后还在购买/活跃的比例','条件计数 ÷ 人群 · W7/L3 与 q36'],
      ['转化率/漏斗','完成下一步的人数 ÷ 上一步人数','各步条件计数再相除 · W7/L3'],
      ['同比/环比','与去年同月 / 上一统计周期比','LAG 偏移 12 期 / 1 期 · W7/L2'],
      ['DAU/MAU','日活 / 月活用户数','COUNT(DISTINCT user_id) 按天 / 按月'],
      ['UV/PV','独立访客数 / 页面浏览量','UV=COUNT(DISTINCT 人)，PV=COUNT(*)'],
      ['LTV','用户生命周期价值（累计贡献）','按用户 SUM 金额的长期版'],
      ['ROI','投入产出比','收益 ÷ 投入'],
      ['T+1','数据第二天才出（数仓夜间跑批）','见数仓扫盲微课 W3/L4'],
      ['宽表','提前拼好维度的大表，看板直接读','见数仓扫盲微课 W3/L4']
    ])+'</details>'
    +'<details open><summary>易错清单（交卷前过一遍）</summary>'
    +'<div class="st-rules st-rules-tight">'
    +'<div><span>1</span>NULL：= NULL 永远不成立，用 IS NULL；NOT IN 遇 NULL 返回空集，改用 NOT EXISTS</div>'
    +'<div><span>2</span>一对多连接后数"人/单"要 COUNT(DISTINCT id)，否则数字变大</div>'
    +'<div><span>3</span>WHERE 里不能用聚合函数；分组后筛选用 HAVING</div>'
    +'<div><span>4</span>SELECT 里的非聚合列必须出现在 GROUP BY 里</div>'
    +'<div><span>5</span>窗口函数不能直接写进 WHERE，用子查询/CTE 包一层</div>'
    +'<div><span>6</span>LEFT JOIN 的右表过滤条件写进 ON，写进 WHERE 会悄悄变回 INNER JOIN</div>'
    +'<div><span>7</span>占比写 100.0*x/y 防整数除法得 0</div>'
    +'<div><span>8</span>ORDER BY 可以用 SELECT 别名；WHERE/GROUP BY/HAVING 不行（SQLite 的 GROUP BY/HAVING 例外，但别依赖）</div>'
    +'</div></details>';
  panel.innerHTML=h;
  refreshIcons();
  window.scrollTo(0,0);
}
  /* ---------- 事件 ---------- */
  function openQuestion(qid){
    if(qid!=='play'&&!qById(qid))return;
    currentQid=qid;
    lastLearning={type:'question',id:qid};
    if(qid!=='play'){
      var hit=false;
      if(qfilter==='review')hit=isDue(qid);
      else if(qfilter==='wrong')hit=!!state.wrong[qid];
      else if(qfilter==='all')hit=true;
      else hit=qById(qid)&&qById(qid).w===parseInt(qfilter,10);
      if(!hit)qfilter='all';
    }
    switchTab('practice');
    focusContent('#st-qpanel h3');
  }
  var topTab='dash',appRoute=null,appRouteIndex=0,appRestoring=false,appScroll={},appFocus=false;
  function appSnapshot(){
    return {topTab:topTab,trainSub:trainSub,examSub:examSub,currentQid:currentQid,currentLid:currentLid,learnView:learnView,qfilter:qfilter,scroll:0};
  }
  function appRouteKey(route){
    if(route.topTab==='train')return ['train',route.trainSub,route.trainSub==='practice'?route.currentQid:(route.trainSub==='learn'?route.learnView+'_'+route.currentLid:'')].join('/');
    return route.topTab+(route.topTab==='exam'?'/'+route.examSub:'');
  }
  function captureAppScroll(){
    if(!appRoute||appRestoring)return;
    appRoute.scroll=window.scrollY||0;appScroll[appRouteKey(appRoute)]=appRoute.scroll;
    try{history.replaceState({sqltrainApp:1,route:appRoute,index:appRouteIndex},'')}catch(error){}
  }
  function paintAppChrome(){
    var working=topTab==='train'&&trainSub==='practice'&&!!currentQid;
    var titles={dash:'今天',train:'训练',exam:'测验',me:'我的'};
    var subTitles={learn:'微课学习',practice:'SQL 练习',review:'复习与巩固',tpl:'SQL 模板',schema:'练习数据表',test:'限时周测',wrong:'错题本'};
    var title=topTab==='train'?subTitles[trainSub]:(topTab==='exam'?subTitles[examSub]:titles[topTab]);
    if(topTab==='train'&&trainSub==='learn'&&learnView!=='course')title=learnView==='plan'?'学习计划':'速查手册';
    document.getElementById('st-breadcrumb-current').textContent=title;
    document.getElementById('st-app-kicker').textContent='SQL Lab · '+(topTab==='dash'?'学习空间':titles[topTab]);
    document.getElementById('st-app-back').hidden=topTab==='dash';
    var focus=document.getElementById('st-app-focus');
    if(!working)appFocus=false;
    focus.hidden=!working;focus.setAttribute('aria-pressed',String(appFocus));
    focus.setAttribute('aria-label',appFocus?'退出专注练习':'进入专注练习');
    focus.querySelector('span').textContent=appFocus?'退出专注':'专注练习';
    root.dataset.page=topTab;root.dataset.view=topTab==='train'?trainSub:(topTab==='exam'?examSub:topTab);
    root.classList.toggle('st-focused',appFocus);document.body.classList.toggle('st-app-focused',appFocus);
  }
  function recordAppRoute(){
    paintAppChrome();
    if(appRestoring)return;
    var route=appSnapshot(),key=appRouteKey(route);
    if(appRoute&&key===appRouteKey(appRoute)){route.scroll=appRoute.scroll;appRoute=route;return}
    if(appRoute){
      appRouteIndex++;
      try{history.pushState({sqltrainApp:1,route:route,index:appRouteIndex},'')}catch(error){}
    }else{
      var existing=history.state;
      if(existing&&existing.sqltrainApp===1&&existing.route&&appRouteKey(existing.route)===key)appRouteIndex=existing.index||0;
      try{history.replaceState({sqltrainApp:1,route:route,index:appRouteIndex},'')}catch(error){}
    }
    appRoute=route;
  }
  function toggleAppFocus(){
    appFocus=!appFocus;paintAppChrome();
    var control=document.getElementById('st-app-focus');
    try{control.focus({preventScroll:true})}catch(error){control.focus()}
  }
  window.addEventListener('popstate',function(event){
    var entry=event.state,route=entry&&entry.sqltrainApp===1?entry.route:null;
    if(!route||['dash','train','exam','me'].indexOf(route.topTab)<0)return;
    if(appRoute)appScroll[appRouteKey(appRoute)]=window.scrollY||0;
    if(hasOwn(appScroll,appRouteKey(route)))route.scroll=appScroll[appRouteKey(route)];
    appRestoring=true;appRoute=route;appRouteIndex=entry.index||0;
    trainSub=['learn','practice','review','tpl','schema'].indexOf(route.trainSub)>=0?route.trainSub:'learn';
    examSub=['test','wrong'].indexOf(route.examSub)>=0?route.examSub:'test';
    currentQid=route.currentQid==='play'||qById(route.currentQid)?route.currentQid:null;
    if(lessonById(route.currentLid))currentLid=route.currentLid;
    learnView=['course','plan','cheat'].indexOf(route.learnView)>=0?route.learnView:'course';
    qfilter=['all','wrong','review','1','2','3','4','5','6','7','8'].indexOf(route.qfilter)>=0?route.qfilter:'all';
    switchTab(route.topTab);appRestoring=false;
    window.scrollTo(0,typeof route.scroll==='number'?route.scroll:0);tbGlass();
    try{document.getElementById('st-main-content').focus({preventScroll:true})}catch(error){}
  });
  try{history.scrollRestoration='manual'}catch(error){}
  function switchTab(name,slide){
    captureAppScroll();
    var sub=null;
    if(name==='learn'||name==='practice'||name==='review'||name==='tpl'||name==='schema'){sub=name;name='train'}
    else if(name==='test'||name==='wrong'){sub=name;name='exam'}
    var tabs=[['dash','panel-dash'],['train','panel-train'],['exam','panel-exam'],['me','panel-me']];
    root.classList.toggle('st-nobrand',name!=='dash');
    var pageTitle=document.getElementById('tab-'+name).textContent.trim();
    document.getElementById('st-breadcrumb-current').textContent=pageTitle;
    var _lt=document.getElementById('st-ltitle');if(_lt)_lt.textContent=pageTitle;
    var _tt=document.getElementById('st-tbtitle');if(_tt)_tt.textContent=pageTitle;
    tabs.forEach(function(p){
      var tab=document.getElementById('tab-'+p[0]),panel=document.getElementById(p[1]);
      var on=p[0]===name;
      if(tab){tab.classList.toggle('active',on);tab.setAttribute('aria-selected',on?'true':'false');tab.tabIndex=on?0:-1}
      if(panel){if(on)panel.removeAttribute('hidden');else panel.setAttribute('hidden','')}
    });
    topTab=name;
    if(slide){
      var pn=document.getElementById('panel-'+name);
      if(pn){pn.classList.remove('st-slide-l','st-slide-r');void pn.offsetWidth;pn.classList.add(slide==='l'?'st-slide-l':'st-slide-r');setTimeout(function(){pn.classList.remove('st-slide-l','st-slide-r')},420)}
    }
    if(name==='dash')renderDash();
    if(name==='train'){showSub('train',sub||trainSub);renderTrain()}
    if(name==='exam'){showSub('exam',sub||examSub);renderExam()}
    if(name==='me')renderMe();
    movePill();
    saveSession();
    recordAppRoute();
    if(!appRestoring)window.scrollTo(0,appScroll[appRouteKey(appSnapshot())]||0);
    tbGlass();
  }
  /* ---------- 合并子页(训练/测验) ---------- */
  var trainSub='learn',examSub='test';
  var TRAIN_PANELS={learn:'panel-learn',practice:'panel-practice',review:'panel-review',tpl:'panel-tpl',schema:'panel-schema'};
  function showSub(group,sub){
    if(group==='train')trainSub=sub;else examSub=sub;
    var seg=document.getElementById(group==='train'?'st-train-seg':'st-exam-seg');
    if(seg)Array.prototype.forEach.call(seg.querySelectorAll('button[data-sub]'),function(b){var name=b.getAttribute('data-sub'),on=name===sub;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));b.setAttribute('aria-controls',group==='train'?TRAIN_PANELS[name]:('panel-'+name))});
    if(group==='train'){
      for(var k in TRAIN_PANELS){document.getElementById(TRAIN_PANELS[k]).hidden=k!==sub}
    }else{
      document.getElementById('panel-test').hidden=sub!=='test';
      document.getElementById('panel-wrong').hidden=sub!=='wrong';
    }
    saveSession();
  }
  function renderTrain(){
    if(trainSub==='learn')renderLearn();
    else if(trainSub==='practice')renderPractice();
    else if(trainSub==='review')renderReview();
    else if(trainSub==='tpl')renderTpl();
    else renderSchema();
  }
  function renderExam(){if(examSub==='test')renderTest();else renderWrong()}

  /* ---------- 我的:档案 / 数据管理 / 关于与版本更新 ---------- */
  var APP_VERSION=__APP_VERSION__,APP_BUILD=__APP_BUILD__;
  var CHANGELOG=[
    ['4.0.0','2026-10-26',[
      'Web 与 iOS 共用模块化训练核心，题库、课程、判分、存储与更新独立维护',
      'iOS 集成系统学习提醒、文件分享、触感反馈与本机持久化，支持离线学习',
      '保留旧版进度、草稿、周测和备份格式，升级沿用已有学习记录']],
    ['3.0.0','2026-10-26',[
      '首页改为今日学习工作台：继续上次、当周打卡、微课与复习入口集中呈现，八周题目按需展开',
      '统一手机与桌面的应用导航，加入可点击的全局搜索、返回操作与页面滚动位置记忆',
      '新增专注练习模式，收起导航与目录；整理题面、SQL 编辑、运行操作和可折叠的解题笔记',
      '保留题库、判分、离线引擎及原有进度格式，兼容已有草稿、复习安排与备份']],
    ['2.9.0','2026-10-26',[
      '补齐 SQL Lab 应用身份、主屏图标、安装引导与离线状态，手机与桌面沿用同一入口',
      '检查更新独立核验线上构建和页面校验值；新版本准备好后由你决定何时保存草稿并更新',
      '离线包完整校验后才接管，断网或服务器异常继续使用已验证版本；保留其他应用的缓存',
      '精简内嵌图标到实际使用集合，保留单文件离线学习；发布前统一运行版本、资源与学习流程回归']],
    ['2.8.0','2026-10-26',[
      '手机学习体验：总览优先继续上次、到期复习和今日推荐；手机目录按需展开，直接呈现当前课程和题目',
      'SQL 编辑新增关键字与符号快捷条、本题表结构；判题失败提示缺失和多余记录，通过后可继续、复习或结束学习',
      '所有查询表格局部横向滚动；建立正文与辅助字号，提供 125%、150% 和 200% 文本放大并随字号重新布局',
      '题目按钮采用独立 44px 点击区；补齐分段状态、表单标签、可见焦点、判题播报和命令面板焦点管理',
      '正文使用稳定实色内容面，导航保留玻璃材质；减少动画覆盖浮动底栏，输入时避免导航遮挡']],
    ['2.7.0','2026-10-26',[
      '可靠性迭代：排序题检查行序，并列结果允许换序；普通练习与周测使用同一判题规则',
      'SQL 草稿、页面位置和周测自动保存；刷新续考沿用原截止时间，超时重开自动交卷',
      '导入前完整校验；快照支持回滚，新增恢复导入前进度；清空和覆盖操作保留应急备份',
      '同步改为记录修订与删除标记合并，笔记、错题移除、复习安排和尝试次数均可持久化',
      '判题使用独立只读数据快照；自由练习隔离运行并可一键重置数据库']],
    ['2.6.0','2026-10-25',[
      '间隔重复复习上线:通过/答错的题自动按记忆曲线排程(1 天 → 3 天 → 按熟练度拉长至 60 天),总览与「训练 · 复习」显示今日到期,从刷一遍变成记得住',
      '学习提醒:「我的 · 学习提醒」设定每日提醒时间,到点且当天未练习时发系统通知(需授权;应用打开期间有效)',
      '移动端 iOS 手感:各大页新增大标题,滚动时折叠进顶栏;左右滑动可在 总览/训练/测验/我的 间切换',
      '首屏骨架屏:打开即见版式骨架,渲染完成后无缝替换;「我的 · 外观」新增字号调节(标准/大/特大)',
      '键盘避让:弹出键盘时底部 Tab 栏自动上移,输入框聚焦自动滚入可视区;移动端输入统一 16px,聚焦不再自动放大',
      '触控目标达标:移动端按钮/下拉/题目行命中区提升到 44px 规格,分段切换与进围点补足命中区',
      '深色模式对比度清扫:统计数值、热图标题、面包屑、状态栏、表单标签等十余处灰字全部提到无障碍对比度',
      '细节修复:命令面板搜"微课"显示 undefined;云同步菜单重复文案;全通关提示硬编码题数;练习次数改为跨会话累计',
      '触感反馈:切页/判分/成就解锁在支持的设备上轻微震动(尽力而为)',
      '底部 Tab 栏更紧凑:整体高度收窄约 10px;点击不再出现描边,选中图标不再加粗发光,选中态仍由白色药丸表达']],
    ['2.5.3','2026-10-25',['暗色模式重做为纯黑(OLED)画布:背景纯黑、卡片微抬升、文字与边框换 iOS 中性灰,蓝色环境光与玻璃保持']],
    ['2.5.2','2026-10-25',['Tab 栏玻璃质感对齐参考稿:清透白玻璃、大图标深描边、白色云朵选中胶囊、更宽排布']],
    ['2.5.1','2026-10-25',['底栏玻璃质感重做:顶缘锐光/底部厚度暗影/内圈轮廓与双热斑光泽,玻璃有了厚度','点击交互:按压缩放回弹、选中光晕绽放、药丸移动弹性形变,激活图标加粗发光']],
    ['2.5.0','2026-10-25',['手动主题切换:「我的 · 外观」可选 跟随系统 / 浅色 / 深色,状态栏颜色同步跟随','命令面板:桌面按 Ctrl/⌘+K 搜索并直达任意页面、题目、微课与模板','清理约 55KB 未使用的可视化脚手架代码,加载更轻']],
    ['2.4.0','2026-10-25',['错题重练卷:错题本一键进入只看错题的练习模式','运行历史:每次执行的 SQL 与通过与否留档最近 12 次,可一键回填;题目页显示累计尝试次数','打卡热图:总览新增近 8 周打卡日历与本周摘要','里程碑成就:首题通过/连续打卡/首周通关等 8 枚成就,「我的」页点亮并轻提示','每日自动快照:每天首次打开自动留档,「备份与迁移」可一键恢复','今日推荐优先错题相关题目']],
    ['2.3.3','2026-10-25',['底部 Tab 栏质感重做:磨砂更醇更透亮,图标 22px / 字号 11px,选中胶囊更饱满,光感层次对齐参考稿','全面体检修复:桌面端导航断点迁移加固;周测计时器改墙钟基准,锁屏不再走慢;周测范围补齐第 8 周;笔记转义防破坏编辑器']],
    ['2.3.2','2026-10-25',['玻璃光感三处重做:光泽改为左上光源径向渐变(柔光自胶囊左上洒落、向右下淡出),顶缘高光加粗至 1.5px 并收窄柔边,选中药丸顶部高光提至 95% 白,「玻璃上叠玻璃」层次更实']],
    ['2.3.1','2026-10-25',['修复「测验」页空白:4 Tab 合并时面板嵌套错位,测验面板被包在隐藏的训练面板内','入场动画不再使用透明度(iOS 后台恢复时动画冻结曾导致内容停在透明态)','顶栏彻底移除磨砂:滚动后改为 iOS 导航栏式高不透明实底,不再出现雾面']],
    ['2.3.0','2026-10-25',['主题色全面重设计:从青绿切换到 Apple 系统蓝(iOS Light #007AFF / Dark #0A84FF),品牌图标改为蓝色渐变,环境光、选中态、语义色全部对齐 iOS 设计语言']],
    ['2.2.3','2026-10-25',['深色模式全面适配:示例代码块、查询结果表格、答案/判定/提示框、计时器、下拉框统一为与编辑器一致的深青材质,斑马行不再发白']],
    ['2.2.2','2026-10-25',['移除分页顶部面包屑导航条:非总览页顶部完全留白,滚动时仅浮出一层状态栏保护玻璃','底部 Tab 栏整体放大,图标与字号同步提升,触控更稳']],
    ['2.2.1','2026-10-25',['顶栏品牌区(SQL Lab)仅总览页显示,其他分页由面包屑工具条承担定位,更轻更聚焦','彻底去掉顶栏静止时的磨砂遮罩:磨砂改为滚动后阈值开启,兼容所有浏览器']],
    ['2.2.0','2026-10-25',['「我的」改为二级菜单：备份迁移、云同步、清空进度收进「数据与同步」菜单，档案指标压缩为一行速览','更新日志合并为「关于」内的单一折叠列表','修复顶部问候区遮罩：玻璃模糊随滚动从 0 连续增强，顶部完全无模糊','底部 Tab 栏透明度进一步降低','底部 Tab 栏改为居中紧凑胶囊,高度与留白收敛,更小巧精致','移除各分页顶部的大标题引导区:位置由 Tab 与面包屑表达,页内自带标题,信息层级更干净']],
    ['2.1.0','2026-10-25',['导航再收敛至 4 Tab：学习+练习+资料合并为「训练」（学习 / 练习 / 模板库 / 数据表子页），总览、测验、我的保持独立']],
    ['2.0.0','2026-10-25',['iOS 27 液态玻璃全面改版：材质更透明，顶栏玻璃随滚动连续渐显','导航收敛：周测+错题本合并为「测验」，模板库+数据表合并为「资料」，底部 5+1 Tab','新增「我的」：学习档案、备份迁移、云同步集中管理，附「关于 · 版本更新」日志']],
    ['1.3.0','2026-10-25',['新增 Service Worker：打开即最新版，离线也能打开，主屏图标无需重装']],
    ['1.2.0','2026-10-25',['iOS 安全区适配：状态栏/灵动岛/底部横条不再遮挡内容','外观跟随系统深浅色']],
    ['1.1.0','2026-10-25',['云同步新增 GitHub Gist 方案（LeanCloud 国际版已停止新注册）']],
    ['1.0.0','2026-10-25',['SQL 八周训练营上线：学习、练习、周测、错题本一体化，含云同步与进度备份']]
  ];
  /* ---------- v2.6:学习提醒(应用打开期间到点通知;iOS 彻底后台推送需服务端,后续跟进) ---------- */
  var REMIND_KEY='sqltrain_remind';
  function loadRemind(){
    try{var r=JSON.parse(storage.getItem(REMIND_KEY)||'{}');
      if(r&&typeof r==='object')return {on:!!r.on,time:/^\d{2}:\d{2}$/.test(r.time||'')?r.time:'20:30',last:r.last||''}}catch(e){}
    return {on:false,time:'20:30',last:''};
  }
  function saveRemind(r){try{storage.setItem(REMIND_KEY,JSON.stringify(r));refreshNativeReminder()}catch(e){}}
  function refreshNativeReminder(){
    if(!platform.isNative)return;
    platform.setReminder(loadRemind(),state.days||[]).catch(function(){remindStatus('系统提醒未能保存，请检查通知权限后重试。')});
  }
  function remindStatus(msg){var el=document.getElementById('st-remind-status');if(el)el.textContent=msg}
  function remindPerm(){return platform.isNative?platform.notificationPermission:(('Notification' in window&&'requestPermission' in Notification)?Notification.permission:'unsupported')}
  function askRemindPermission(){
    if(platform.isNative){
      platform.requestReminderPermission().then(function(permission){
        var setting=loadRemind();setting.on=permission==='granted';saveRemind(setting);
        renderMe();remindStatus(setting.on?'系统提醒已开启；应用关闭后也可收到通知。':'未取得通知权限，可在 iOS 设置中允许 SQL Lab 通知。');
      }).catch(function(){remindStatus('系统提醒设置失败，请稍后重试。')});
      return;
    }
    if(remindPerm()==='unsupported'){var r0=loadRemind();r0.on=false;saveRemind(r0);remindStatus('当前浏览器不支持通知。可以先用系统闹钟当替代,或换用支持的浏览器。');renderMe();return}
    Notification.requestPermission().then(function(p){
      var r=loadRemind();
      if(p==='granted'){r.on=true;saveRemind(r);remindStatus('提醒已开启:每天 '+r.time+' 提醒今日训练。');buzz(10)}
      else{r.on=false;saveRemind(r);remindStatus(p==='denied'?'通知权限被拒绝:在浏览器或系统设置里允许本站通知后,回来再开一次。':'未授权,提醒保持关闭。')}
      renderMe();
    }).catch(function(){remindStatus('暂时无法发起授权,请稍后再试。')});
  }
  function remindTimeChanged(v){
    var r=loadRemind();r.time=v;saveRemind(r);
    remindStatus('提醒时间已设为每天 '+v+'。');
    setTimeout(checkReminder,50);
  }
  function fireReminder(){
    var r=loadRemind();r.last=todayStr();saveRemind(r);
    var s=streak();
    var body=s>0?('已连续练习 '+s+' 天。今天留 45 分钟,做 1—2 道题保持手感。'):'今天留 45 分钟,把 SQL 练起来。';
    var opts={body:body,tag:'sqltrain-daily',renotify:true};
    try{
      if(navigator.serviceWorker){navigator.serviceWorker.ready.then(function(reg){
        if(reg.showNotification)reg.showNotification('SQL 训练时间到',opts);
        else if(remindPerm()==='granted')new Notification('SQL 训练时间到',opts);
      }).catch(function(){if(remindPerm()==='granted')new Notification('SQL 训练时间到',opts)})}
      else if(remindPerm()==='granted')new Notification('SQL 训练时间到',opts);
    }catch(e){}
    buzz(10);
  }
  function checkReminder(){
    if(platform.isNative)return;
    var r=loadRemind();if(!r.on)return;
    if(remindPerm()!=='granted')return;
    var now=new Date();
    var pp=(r.time||'20:30').split(':');
    var due=new Date(now.getFullYear(),now.getMonth(),now.getDate(),parseInt(pp[0],10),parseInt(pp[1],10));
    if(now>=due&&r.last!==todayStr()&&(state.days||[]).indexOf(todayStr())<0)fireReminder();
  }
  function saveBeforeUpdate(){
    var editor=document.getElementById('st-code'),exam=document.getElementById('st-test-code'),note=document.getElementById('st-note');
    if(editor&&currentQid)codes[currentQid]=editor.value;
    if(exam&&test)codes['test_'+test.qids[test.idx]]=exam.value;
    if(note&&currentQid){var value=note.value.slice(0,300);if(value)state.notes[currentQid]=value;else delete state.notes[currentQid]}
    return saveSession()&&saveState();
  }
  var {pwa,pwaGuide,paintPwa,checkUpdate,applyUpdate,installPwa,startPwa}=createUpdates({root:root,version:APP_VERSION,build:APP_BUILD,saveBeforeUpdate:saveBeforeUpdate,storage:storage,platform:platform,toast:stToast});
  function renderMe(){
    var el=document.getElementById('panel-me');if(!el)return;
    var doneCount=Object.keys(state.done).length,wrongCount=Object.keys(state.wrong).length,_ld=0;
    for(var _k in state.lessons){if(state.lessons[_k])_ld++}
    var pct=Math.round((doneCount+_ld)/(QUESTIONS.length+LESSONS.length)*100);
    var markup='<div class="st-me-head"><span class="st-me-avatar"><i data-lucide="user" aria-hidden="true"></i></span><div style="min-width:0"><h2>我的学习档案</h2><p>进度保存在这台设备 · 备份与云同步在下方</p></div></div>'
      +'<section class="st-me-stats" aria-label="学习速览">'
      +'<div class="st-ms"><b class="num">'+streak()+'<span>天</span></b><span>连续练习</span></div>'
      +'<div class="st-ms"><b class="num">'+pct+'<span>%</span></b><span>总体进度</span></div>'
      +'<div class="st-ms"><b class="num">'+doneCount+'<span>/'+QUESTIONS.length+'</span></b><span>已完成</span></div>'
      +'<div class="st-ms"><b class="num">'+wrongCount+'<span>题</span></b><span>待重写</span></div></section>'
      +'<div class="st-menu-cap" style="margin-top:2px">成就</div><div class="st-mil">'+MILESTONES.map(function(m){return '<span class="'+(state.mil&&state.mil[m.id]?'on':'')+'">'+(state.mil&&state.mil[m.id]?'✓ ':'')+m.t+'</span>'}).join('')+'</div>'
      +'<div class="st-menu-cap">外观</div><div class="st-menu"><div class="st-mode-row" id="st-mode-seg">'
      +'<button type="button" class="btn btn-sm" data-act="mode-set" data-mo="auto">跟随系统</button>'
      +'<button type="button" class="btn btn-sm" data-act="mode-set" data-mo="light">浅色</button>'
      +'<button type="button" class="btn btn-sm" data-act="mode-set" data-mo="dark">深色</button>'
      +'</div>'
      +'<div class="st-mode-row" style="border-top:1px solid var(--border);gap:6px"><span class="form-label text-small" style="margin:0;align-self:center">字号</span>'
      +[['m','标准'],['l','大 125%'],['xl','特大 150%'],['xxl','200%']].map(function(f){var selected=(document.documentElement.dataset.font||'m')===f[0];return '<button type="button" class="btn btn-sm'+(selected?' btn-primary':'')+'" aria-pressed="'+String(selected)+'" data-act="font-set" data-fz="'+f[0]+'">'+f[1]+'</button>'}).join('')
      +'</div></div>'
  var rm=loadRemind(),rp=remindPerm();
  markup+='<div class="st-menu-cap">学习提醒</div><div class="st-menu">'
    +'<div class="st-mode-row" style="justify-content:space-between;align-items:center;flex-wrap:nowrap">'
    +'<span style="display:flex;align-items:center;gap:12px;min-width:0"><span class="st-mrow-ic"><i data-lucide="bell-ring" aria-hidden="true"></i></span><span style="min-width:0"><span style="font-weight:600;font-size:13px">每日提醒</span><span class="text-muted text-small" style="display:block;margin-top:2px">'+(rp==='unsupported'?'此浏览器不支持通知':'每天 '+rm.time+(rm.on?' · 已开启':' · 未开启'))+'</span></span></span>'
    +'<button type="button" class="btn btn-sm'+(rm.on?'':' btn-primary')+'" data-act="remind-toggle">'+(rm.on?'关闭':'开启')+'</button></div>'
    +'<div class="st-mode-row" style="border-top:1px solid var(--border);justify-content:space-between;align-items:center;flex-wrap:nowrap"><label class="form-label text-small" for="st-remind-time" style="margin:0">提醒时间</label>'
    +'<input type="time" id="st-remind-time" class="form-control" style="width:130px;min-height:40px" value="'+rm.time+'"></div>'
    +'</div>'
    +'<div id="st-remind-status" class="text-small text-muted" role="status" style="margin:-6px 4px 16px">'+(rp==='denied'?'通知权限被拒绝：在浏览器或系统设置里允许本站通知后，可回来重试。':(platform.isNative?'系统预排未来 30 天的学习提醒，关闭应用后也能收到；每次打开会补齐，今天已练习则跳过今天。':'提醒只在应用打开期间生效；到点且今天未练习才通知。关闭应用后不会后台定时提醒。'))+'</div>'
      +'<div class="st-menu-cap">安装与离线</div><div class="st-menu"><details class="st-mrow"><summary><span class="st-mrow-ic"><i data-lucide="download" aria-hidden="true"></i></span><span class="st-mrow-t">将 SQL Lab 随身带走</span><span class="st-chev"><i data-lucide="chevron-down" aria-hidden="true"></i></span></summary><div class="st-mrow-body">'
      +'<p id="st-pwa-guide" class="st-pwa-status">'+esc(pwaGuide())+'</p>'
      +'<div class="st-pwa-actions"><button class="btn btn-primary btn-sm" id="st-pwa-install" data-act="pwa-install" type="button" hidden>安装 SQL Lab</button><button class="btn btn-sm" data-act="check-update" type="button">检查离线准备</button></div>'
      +'<p id="st-pwa-offline" class="st-pwa-status" role="status" aria-live="polite">'+esc(pwa.offline)+'</p>'
      +'<p class="st-pwa-status text-muted">'+(platform.isNative?'学习进度保存于本机应用目录，同步配置保存在系统钥匙串。首次从 Web 迁入请导入旧版备份；跨设备可使用备份或已配置的云同步。':'浏览器与主屏应用的本地进度可能独立。安装前先备份，安装后固定使用同一入口；换设备可用备份或已配置的云同步。离线副本不代替学习进度备份。')+'</p></div></details></div>'
      +'<div class="st-menu-cap">数据与同步</div>'
      +'<div class="st-menu">'
    markup+='<details class="st-mrow"><summary><span class="st-mrow-ic"><i data-lucide="database-backup" aria-hidden="true"></i></span><span class="st-mrow-t">备份与迁移</span><span class="st-mrow-sub">导出 · 进度码 · 导入</span><span class="st-chev"><i data-lucide="chevron-down" aria-hidden="true"></i></span></summary><div class="st-mrow-body"><p>进度保存在此浏览器的本地存储里。换浏览器、换电脑或清理缓存前：点"导出备份文件"存一份 JSON，或点"复制进度码"把进度变成一段文本随身携带。在新设备打开本页面，把内容粘进下面的框，点"粘贴恢复"（覆盖）或"合并导入"（按每条记录的最新修改合并，保留删除操作）。每次导入前系统会自动把当前进度留一份应急备份，导错也不怕。</p>'
      +'<div class="viz-row" style="gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center">'
      +'<button class="btn btn-sm" data-act="snap-restore" type="button"><span class="st-btn-ic"><i data-lucide="history" aria-hidden="true"></i>恢复上次快照</span></button>'
      +'<button class="btn btn-sm" data-act="backup-undo" type="button">恢复导入或清空前进度</button>'
      +'<button class="btn btn-sm" data-act="export-progress" type="button"><span class="st-btn-ic"><i data-lucide="download" aria-hidden="true"></i>导出备份文件</span></button>'
      +'<button class="btn btn-sm" data-act="copy-progress" type="button"><span class="st-btn-ic"><i data-lucide="clipboard-copy" aria-hidden="true"></i>复制进度码</span></button>'
      +'<button class="btn btn-sm" data-act="import-file" type="button"><span class="st-btn-ic"><i data-lucide="upload" aria-hidden="true"></i>导入备份文件</span></button>'
      +'<span id="st-backup-status" class="text-small text-muted">'+backupHint()+'</span></div>'
      +'<label class="form-label" for="st-import-code" style="margin-top:12px">进度码或 JSON 备份内容</label><textarea id="st-import-code" class="form-control text-small" rows="2" placeholder="把进度码（一长串字母数字）或备份文件内容粘贴到这里"></textarea>'
      +'<div class="viz-row" style="gap:6px;margin-top:6px">'
      +'<button class="btn btn-primary btn-sm" data-act="import-replace" type="button"><span class="st-btn-ic"><i data-lucide="undo-2" aria-hidden="true"></i>粘贴恢复（覆盖当前）</span></button>'
      +'<button class="btn btn-sm" data-act="import-merge" type="button"><span class="st-btn-ic"><i data-lucide="git-merge" aria-hidden="true"></i>合并导入（两台都练过用这个）</span></button>'
      +'<input type="file" id="st-import-file" accept=".json,application/json" hidden></div></div></details>'
    var scfg=loadSyncCfg();
    markup+='<details class="st-mrow"><summary><span class="st-mrow-ic"><i data-lucide="cloud" aria-hidden="true"></i></span><span class="st-mrow-t">云同步</span><span class="st-mrow-sub">Gist / LeanCloud 自动同步</span><span class="st-chev"><i data-lucide="chevron-down" aria-hidden="true"></i></span></summary><div class="st-mrow-body">'
      +'<p><strong>推荐：GitHub Gist</strong>，无需新注册账号：github.com → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token，只勾选 <strong>gist</strong> 一个权限，把生成的令牌填到下面（Gist ID 留空，保存时自动创建私有 Gist）。绑定手机/新电脑：填同一个令牌、同一个 Gist ID（本机连上后会显示在下方输入框，复制过去）和同一个同步码。<strong>LeanCloud</strong> 供已注册用户使用（国际版已停止新注册）。开启端到端加密后，进度用同步码加密（AES-GCM），云端只存密文。保存后自动同步：练习完成自动推送、打开页面自动拉取合并；两端都有新进度时按记录合并，同一条记录保留最新修改，移除错题和清空笔记也会同步。清空或覆盖恢复会在下次同步时更新其他设备；操作前会保存可恢复的应急备份。</p>'
      +'<input type="radio" name="st-sync-prov" id="st-sync-prov-gist" data-prov="gist"'+(scfg.provider==='lc'?'':' checked')+'>'
      +'<label class="st-prov-lbl" for="st-sync-prov-gist">GitHub Gist（推荐）</label>'
      +'<input type="radio" name="st-sync-prov" id="st-sync-prov-lc" data-prov="lc"'+(scfg.provider==='lc'?' checked':'')+'>'
      +'<label class="st-prov-lbl" for="st-sync-prov-lc">LeanCloud</label>'
      +'<div class="st-sync-grid st-fg">'
      +'<div class="st-field"><label for="st-sync-token">GitHub 令牌（仅 gist 权限）</label><input id="st-sync-token" class="form-control" type="password" autocomplete="off" placeholder="GitHub personal access token" value="'+esc(scfg.token||'')+'"></div>'
      +'<div class="st-field"><label for="st-sync-gistid">Gist ID（留空自动创建）</label><input id="st-sync-gistid" class="form-control" placeholder="新设备填入同一个 Gist ID" value="'+esc(scfg.gistId||'')+'"></div>'
      +'</div>'
      +'<div class="st-sync-grid st-fl">'
      +'<div class="st-field"><label for="st-sync-base">LeanCloud REST API 域名</label><input id="st-sync-base" class="form-control" placeholder="https://xxxxxx.lcloud.cn" value="'+esc(scfg.base||'')+'"></div>'
      +'<div class="st-field"><label for="st-sync-id">LeanCloud AppID</label><input id="st-sync-id" class="form-control" placeholder="AppID" value="'+esc(scfg.appId||'')+'"></div>'
      +'<div class="st-field"><label for="st-sync-key">LeanCloud AppKey</label><input id="st-sync-key" class="form-control" type="password" autocomplete="off" placeholder="AppKey" value="'+esc(scfg.appKey||'')+'"></div>'
      +'</div>'
      +'<div class="viz-row" style="gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center">'
      +'<div class="st-field"><label for="st-sync-code">同步码（各设备保持一致）</label><input id="st-sync-code" class="form-control" placeholder="至少 8 位的同步码" value="'+esc(scfg.code||'')+'"></div>'
      +'<label class="st-sync-enc"><input type="checkbox" id="st-sync-enc"'+(scfg.enc===false?'':' checked')+'>端到端加密</label></div>'
      +'<div class="viz-row" style="gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center">'
      +'<button class="btn btn-primary btn-sm" data-act="sync-save" type="button"><span class="st-btn-ic"><i data-lucide="cloud-upload" aria-hidden="true"></i>保存配置并连接</span></button>'
      +'<button class="btn btn-sm" data-act="sync-gencode" type="button"><span class="st-btn-ic"><i data-lucide="key-round" aria-hidden="true"></i>生成新同步码</span></button>'
      +'<button class="btn btn-sm" data-act="sync-now" type="button"><span class="st-btn-ic"><i data-lucide="refresh-cw" aria-hidden="true"></i>立即同步</span></button>'
      +'<button class="btn btn-ghost btn-sm" data-act="sync-unbind" type="button"><span class="st-btn-ic"><i data-lucide="unlink" aria-hidden="true"></i>解绑</span></button>'
      +'<span id="st-sync-status" class="text-small text-muted">'+(syncCfgReady(scfg)?('已绑定'+(scfg.lastSync?' · 上次同步 '+fmtClock(scfg.lastSync):'')+' · 打开页面会自动同步'):'未配置')+'</span></div></div></details>'

    markup+='<details class="st-mrow danger"><summary><span class="st-mrow-ic"><i data-lucide="trash-2" aria-hidden="true"></i></span><span class="st-mrow-t">清空全部进度</span><span class="st-mrow-sub">保留应急备份 · 二次确认</span><span class="st-chev"><i data-lucide="chevron-down" aria-hidden="true"></i></span></summary><div class="st-mrow-body"><p class="text-small text-muted" style="margin:0 0 8px">清空全部学习进度和本机草稿。若已绑定云同步，删除会在其他设备下次同步时生效。操作前自动保留应急备份，可从「备份与迁移」恢复。</p><div class="viz-row st-reset-row"><button class="btn btn-ghost btn-sm" data-act="reset1" type="button">清空全部进度</button><span id="st-reset-confirm"></span></div></div></details>'      +'</div>'
      +'<div class="st-menu-cap">关于</div>'
      +'<div class="st-menu">'
      +'<details class="st-mrow"><summary><span class="st-mrow-ic"><i data-lucide="info" aria-hidden="true"></i></span><span class="st-mrow-t">关于与版本更新</span><span class="st-mrow-sub">v'+APP_VERSION+'</span><span class="st-chev"><i data-lucide="chevron-down" aria-hidden="true"></i></span></summary><div class="st-mrow-body">'
      +'<div class="st-about-head"><span class="st-about-mark"><i data-lucide="code-xml" aria-hidden="true"></i></span><div style="flex:1;min-width:0"><strong>SQL Lab · 八周训练营</strong><span class="text-small text-muted">版本 v'+APP_VERSION+' · '+(engineMode==='ok'?'本地 SQLite 练习库':(engineMode==='self'?'自评模式':'练习库准备中…'))+'</span></div><button class="btn btn-sm" data-act="check-update" type="button">检查更新</button></div>'
      +'<div id="st-upd-status" class="st-pwa-status text-muted" role="status" aria-live="polite">'+esc(pwa.update)+'</div>'
      +'<div class="st-pwa-actions"><button class="btn btn-primary btn-sm" id="st-update-apply" data-act="apply-update" type="button" hidden>保存并更新</button></div>'
      +'<details class="st-clbox"><summary><span style="font-weight:600">版本更新日志</span><span class="text-small text-muted">'+CHANGELOG.length+' 个版本</span><span class="st-chev"><i data-lucide="chevron-down" aria-hidden="true"></i></span></summary><div class="st-clist">'
      +CHANGELOG.map(function(c){return '<div class="st-clent"><div class="st-clent-h"><span class="st-cl-v">v'+c[0]+'</span><span class="text-small text-muted">'+c[1]+'</span></div><ul>'+c[2].map(function(x){return '<li>'+esc(x)+'</li>'}).join('')+'</ul></div>'}).join('')
      +'</div></details>'
      +'</div></details>'
      +'</div>';
    el.innerHTML=markup;
    var _rt=document.getElementById('st-remind-time');
    if(_rt)_rt.onchange=function(){if(_rt.value)remindTimeChanged(_rt.value)};
    paintPwa();
    refreshIcons();
  }
  /* ---------- v2.5:命令面板 ---------- */
  var CMDK_ITEMS=null;
  function cmdkIndex(){
    if(CMDK_ITEMS)return CMDK_ITEMS;
    var it=[];
    [['dash','今天'],['train','训练营'],['exam','测验'],['me','我的']].forEach(function(t){it.push({t:t[1],k:'页面',go:function(){switchTab(t[0])}})});
    QUESTIONS.forEach(function(q){it.push({t:q.title,k:'W'+q.w+' 题',go:function(){openQuestion(q.id)}})});
    LESSONS.forEach(function(l){it.push({t:l.title,k:'微课',go:function(){openLesson(l.id)}})});
    TEMPLATES.forEach(function(t2){it.push({t:t2.name,k:'模板',go:function(){codes['play']=t2.code;openQuestion('play')}})});
    CMDK_ITEMS=it;return it;
  }
  var cmdkSel=0,cmdkList=[],cmdkReturnTarget=null;
  function cmdkRender(q){
    var box=document.getElementById('cmdk-list');
    var src=cmdkIndex();
    var ql=(q||'').trim().toLowerCase();
    cmdkList=ql?src.filter(function(it){return (it.t+it.k).toLowerCase().indexOf(ql)>=0}).slice(0,12):src.slice(0,8);
    cmdkSel=0;
    box.innerHTML=cmdkList.map(function(it,i){return '<button type="button" class="cmdk-item'+(i===0?' sel':'')+'" data-i="'+i+'">'+esc(it.t)+'<small>'+it.k+'</small></button>'}).join('');
    document.getElementById('cmdk-count').textContent=cmdkList.length?'找到 '+cmdkList.length+' 项，可用方向键选择':'没有匹配的结果';
  }
  function cmdkOpen(){
    var w=document.getElementById('cmdk');if(!w)return;
    cmdkReturnTarget=document.activeElement;
    if(!w.open)w.showModal();
    w.classList.add('on');document.getElementById('cmdk-input').value='';
    cmdkRender('');document.getElementById('cmdk-input').focus();
  }
  function cmdkClose(){
    var w=document.getElementById('cmdk');if(w){w.classList.remove('on');if(w.open)w.close()}
    if(cmdkReturnTarget&&cmdkReturnTarget.isConnected)try{cmdkReturnTarget.focus({preventScroll:true})}catch(error){cmdkReturnTarget.focus()}
  }
  function cmdkRun(i){
    var it=cmdkList[i];if(!it)return;
    cmdkClose();try{it.go();var panelId=topTab==='train'?TRAIN_PANELS[trainSub]:(topTab==='exam'?'panel-'+examSub:'panel-'+topTab);focusContent('#'+panelId+' h2, #'+panelId+' h3')}catch(e){}
  }
  (function(){
    document.body.insertAdjacentHTML('beforeend','<dialog id="cmdk" aria-labelledby="cmdk-title" aria-modal="true"><div class="cmdk-box"><div class="cmdk-head"><strong id="cmdk-title">搜索并跳转</strong><button class="cmdk-close" type="button" aria-label="关闭搜索">关闭</button></div><label class="st-sr-only" for="cmdk-input">搜索页面、题目、微课或模板</label><input id="cmdk-input" type="text" placeholder="搜索页面、题目、微课、模板…" autocomplete="off"><div id="cmdk-count" class="cmdk-count" role="status" aria-live="polite"></div><div class="cmdk-list" id="cmdk-list"></div></div></dialog>');
    var w=document.getElementById('cmdk'),inp=document.getElementById('cmdk-input');
    w.addEventListener('click',function(e){if(e.target===w)cmdkClose()});
    w.querySelector('.cmdk-close').addEventListener('click',cmdkClose);
    w.addEventListener('cancel',function(event){event.preventDefault();cmdkClose()});
    inp.addEventListener('input',function(){cmdkRender(inp.value)});
    w.addEventListener('keydown',function(e){
      var options=w.querySelectorAll('.cmdk-item');
      if(e.key==='Tab'){
        var targets=w.querySelectorAll('button,input'),first=targets[0],last=targets[targets.length-1];
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
        return;
      }
      if(e.key==='ArrowDown'){e.preventDefault();cmdkSel=document.activeElement===inp?0:Math.min(cmdkSel+1,cmdkList.length-1)}
      else if(e.key==='ArrowUp'){e.preventDefault();cmdkSel=document.activeElement===inp?cmdkList.length-1:Math.max(cmdkSel-1,0)}
      else if(e.key==='Enter'&&e.target===inp){e.preventDefault();cmdkRun(0);return}
      else return;
      Array.prototype.forEach.call(options,function(option,index){option.classList.toggle('sel',index===cmdkSel)});
      if(options[cmdkSel])options[cmdkSel].focus();
    });
    w.addEventListener('click',function(e){var it=e.target.closest('.cmdk-item');if(it&&it.dataset.i!==undefined)cmdkRun(parseInt(it.dataset.i,10))});
    document.addEventListener('keydown',function(e){
      if((e.metaKey||e.ctrlKey)&&(e.key==='k'||e.key==='K')){e.preventDefault();w.classList.contains('on')?cmdkClose():cmdkOpen()}
      else if(e.key==='Escape'&&w.classList.contains('on')){e.preventDefault();cmdkClose()}
      else if(e.key==='Escape'&&appFocus){e.preventDefault();toggleAppFocus()}
    });
  })();
  /* ---------- v2.4:轻提示/成就/运行历史/周统计 ---------- */
  function stToast(msg){
    var t=document.getElementById('st-toast');
    if(!t){t=document.createElement('div');t.id='st-toast';t.setAttribute('role','status');document.body.appendChild(t)}
    t.textContent=msg;t.classList.add('on');
    clearTimeout(t._h);t._h=setTimeout(function(){t.classList.remove('on')},2600);
  }
  var MILESTONES=[
    {id:'first',t:'首题通过',c:function(st){return Object.keys(st.done).length>=1}},
    {id:'d3',t:'连续 3 天',c:function(st){return streak()>=3}},
    {id:'d7',t:'连续 7 天',c:function(st){return streak()>=7}},
    {id:'l5',t:'微课 5 讲',c:function(st){var n=0;for(var k in st.lessons){if(st.lessons[k])n++}return n>=5}},
    {id:'t10',t:'十题达成',c:function(st){return Object.keys(st.done).length>=10}},
    {id:'w1',t:'首周通关',c:function(st){var p=weekProgress(1);return p.total>0&&p.done===p.total}},
    {id:'half',t:'过半征程',c:function(st){return Object.keys(st.done).length>=21}},
    {id:'all',t:'全部通关',c:function(st){return Object.keys(st.done).length>=QUESTIONS.length}}
  ];
  var _milLock=false;
  function checkMilestones(){
    if(_milLock)return;_milLock=true;
    state.mil=state.mil||{};
    var got=[];
    MILESTONES.forEach(function(m){if(!state.mil[m.id]&&m.c(state)){state.mil[m.id]=1;got.push(m.t)}});
    if(got.length){saveState();buzz([10,40,18]);stToast('成就解锁：'+got.join(' · '))}
    _milLock=false;
  }
  function pushHistory(qid,sql,ok){
    state.history=state.history||[];
    state.history.unshift({q:qid,s:String(sql).slice(0,400),ok:ok?1:0,t:Date.now()});
    if(state.history.length>12)state.history.length=12;
    try{
      var _hs=document.querySelector('#st-qpanel .st-hist summary');
      if(_hs)_hs.textContent='运行历史（最近 '+state.history.length+' 次）';
      var _hc=document.querySelector('#st-qpanel .st-hlist');
      if(_hc)_hc.innerHTML=state.history.map(function(h,hi){var qq=qById(h.q);return '<button class="btn btn-sm" data-act="hist-load" data-i="'+hi+'" type="button">'+(h.ok?'✓':'✗')+' '+esc(qq?qq.title:h.q)+' · '+fmtClock(h.t)+'</button>'}).join('')||'<span class="text-small text-muted">还没有运行记录</span>';
      var _al=document.getElementById('st-att-line');
      if(_al&&_al.getAttribute('data-qid')===qid)_al.innerHTML='本题已尝试 '+(state.attempts[qid]||0)+' 次'+(viewed[qid]?' · 已看过参考答案':'');
    }catch(e){}
  }
  function weekStatsNow(){
    var now=new Date(),dow=(now.getDay()+6)%7;
    var mon=new Date(now.getFullYear(),now.getMonth(),now.getDate()-dow);mon.setHours(0,0,0,0);
    var ds=0,set={};(state.days||[]).forEach(function(d){set[d]=1});
    for(var i=0;i<7;i++){var dt=new Date(mon.getFullYear(),mon.getMonth(),mon.getDate()+i);var k=dt.getFullYear()+'-'+('0'+(dt.getMonth()+1)).slice(-2)+'-'+('0'+dt.getDate()).slice(-2);if(set[k])ds++}
    var q=0;for(var id2 in state.done){if(state.done[id2]&&state.done[id2].ts>=mon.getTime())q++}
    return {d:ds,q:q};
  }
  var resetArmed=false;
  root.addEventListener('pointerdown',function(event){
    var button=event.target.closest?event.target.closest('[data-act="insert-sql"]'):null;
    if(button)event.preventDefault();
  });
  root.addEventListener('click',function(e){
    var el=e.target.closest?e.target.closest('[data-act]'):null;
    if(!el||!root.contains(el))return;
    var act=el.getAttribute('data-act'),qid=el.getAttribute('data-qid');
    if(act==='open-q'){openQuestion(qid)}
    else if(act==='app-search'){cmdkOpen()}
    else if(act==='app-go'){var destination=el.getAttribute('data-page');if(['dash','train','exam','me','learn','practice','review','tpl','schema','test','wrong'].indexOf(destination)>=0)switchTab(destination)}
    else if(act==='app-back'){if(appRouteIndex>0)history.back();else switchTab('dash')}
    else if(act==='app-focus'){toggleAppFocus()}
    else if(act==='app-plan'){learnView='plan';switchTab('learn')}
    else if(act==='resume-learning'){resumeLearning()}
    else if(act==='end-session'){switchTab('dash');focusContent('#panel-dash h2');stToast('本次学习已结束，进度和草稿已保留。')}
    else if(act==='insert-sql'){insertSQL(el)}
    else if(act==='open-lesson'){openLesson(el.getAttribute('data-lid')||qid)}
    else if(act==='learn-view'){learnView=el.getAttribute('data-view');renderLearn();var viewButton=root.querySelector('[data-act="learn-view"][data-view="'+learnView+'"]');if(viewButton)viewButton.focus()}
    else if(act==='lesson-run'){doLessonRun(el.getAttribute('data-lid'),parseInt(el.getAttribute('data-idx'),10))}
    else if(act==='lesson-done'){toggleLesson(el.getAttribute('data-lid'))}
    else if(act==='lesson-nav'){openLesson(el.getAttribute('data-lid'))}
    else if(act==='plan-check'){var pk=el.getAttribute('data-k');if(state.plan[pk])delete state.plan[pk];else state.plan[pk]=1;saveState();renderLearn()}
    else if(act==='run'){doRun(qid);focusContent('#st-verdict')}
    else if(act==='run-play'){doRunPlay();focusContent('#st-result')}
    else if(act==='reset-db'){resetPlayDatabase()}
    else if(act==='reset-code'){codes[qid]='';viewed[qid]=false;renderQPanel(qid);var emptyEditor=document.getElementById('st-code');if(emptyEditor)emptyEditor.focus()}
    else if(act==='show-hint'){var h=document.getElementById('st-hint');if(h){h.hidden=!h.hidden;el.setAttribute('aria-expanded',String(!h.hidden));el.setAttribute('aria-controls',h.id)}refreshIcons()}
    else if(act==='show-answer'){viewed[qid]=true;var a=document.getElementById('st-answer');if(a){a.hidden=!a.hidden;el.setAttribute('aria-expanded',String(!a.hidden));el.setAttribute('aria-controls',a.id)}}
    else if(act==='show-explain'){viewed[qid]=true;var xp=document.getElementById('st-explain');if(xp){xp.hidden=!xp.hidden;el.setAttribute('aria-expanded',String(!xp.hidden));el.setAttribute('aria-controls',xp.id)}}
    else if(act==='self-pass'){state.done[qid]={ts:Date.now(),used:1};delete state.wrong[qid];srGrade(qid,1);saveState();markToday();renderQPanel(qid);renderQStatus(qid)}
    else if(act==='self-fail'){state.wrong[qid]=(state.wrong[qid]||0)+1;srGrade(qid,0);saveState();markToday();renderQPanel(qid);renderQStatus(qid)}
    else if(act==='wrong-del'){delete state.wrong[qid];saveState();renderWrong()}
    else if(act==='export-progress'){doExport()}
    else if(act==='copy-progress'){doCopyCode()}
    else if(act==='import-file'){doImportFile()}
    else if(act==='import-replace'){doImportCode('replace')}
    else if(act==='import-merge'){doImportCode('merge')}
    else if(act==='sync-save'){doSyncSave()}
    else if(act==='sync-gencode'){var ci=document.getElementById('st-sync-code');if(ci){ci.value=genSyncCode();ci.focus()}syncStatus('已生成新同步码：在其他设备填入同一个码即可绑定','')}
    else if(act==='sync-now'){syncNow(true)}
    else if(act==='sync-unbind'){var uc=loadSyncCfg();delete uc.code;uc.lastSync=0;saveSyncCfg(uc);syncStatus('已解绑：本机不再同步（云端数据保留，重新填码可再绑定）')}
    else if(act==='mode-set'){storage.setItem('sqltrain_mode',JSON.stringify(el.getAttribute('data-mo')));applyMode()}
    else if(act==='font-set'){var chosenFont=el.getAttribute('data-fz')||'m';applyFont(chosenFont);renderMe();root.querySelector('[data-fz="'+chosenFont+'"]').focus()}
    else if(act==='remind-toggle'){var r0=loadRemind();if(r0.on){r0.on=false;saveRemind(r0);remindStatus('提醒已关闭。');renderMe()}else askRemindPermission()}
    else if(act==='check-update'){checkUpdate()}
    else if(act==='apply-update'){applyUpdate()}
    else if(act==='pwa-install'){installPwa()}
    else if(act==='wrong-practice'){qfilter='wrong';switchTab('practice')}
    else if(act==='start-review'){qfilter='review';var _fd=srDueList()[0];if(_fd)openQuestion(_fd);else{switchTab('review');focusContent('#panel-review h3')}}
    else if(act==='hist-load'){var hIdx=parseInt(el.getAttribute('data-i'),10);var hRec=(state.history||[])[hIdx];if(hRec){if(hRec.q!==currentQid)openQuestion(hRec.q);var _ta=document.getElementById('st-code');if(_ta){_ta.value=hRec.s;_ta.dispatchEvent(new Event('input',{bubbles:true}))}}}
    else if(act==='snap-restore'){var sw=null;try{sw=parseSafeJSON(storage.getItem('sqltrain_snap')||'null')}catch(e){}
      if(!sw||!sw.s){backupStatus('还没有自动快照:明天首次打开时才会生成')}
      else{var so=parseBackup(sw.s);if(!so){backupStatus('快照数据无法识别')}
      else if(applyBackup(so,'replace')){backupStatus('已回滚到 '+sw.d+' 的自动快照 · 回滚前进度已留应急备份')}}}
    else if(act==='backup-undo'){
      var undo=null,undoSession=null;
      try{undo=parseBackup(storage.getItem('sqltrain_state_before_import')||'');undoSession=storage.getItem('sqltrain_session_before_import')}catch(e){}
      if(!undo)backupStatus('还没有可恢复的应急备份');
      else if(applyBackup(undo,'replace')){
        if(undoSession){loadSession(undoSession);saveSession();startTestTimer()}
        backupStatus('已恢复导入或清空前的进度与草稿 · 可再次操作撤销本次恢复');
      }
    }
    else if(act==='tpl-load'){codes['play']=TEMPLATES[parseInt(el.getAttribute('data-i'),10)].code;openQuestion('play')}
    else if(act==='test-start'){startTest()}
    else if(act==='test-next'){if(test&&test.idx<test.qids.length-1){test.idx++;saveSession();renderTestRunning();focusContent('#panel-test h3')}}
    else if(act==='test-prev'){if(test&&test.idx>0){test.idx--;saveSession();renderTestRunning();focusContent('#panel-test h3')}}
    else if(act==='test-finish'){finishTest();focusContent('#panel-test h3')}
    else if(act==='test-home'){testResult=null;saveSession();renderTest()}
    else if(act==='reset1'){
      if(resetArmed){if(applyBackup(emptyProgress(),'replace')){resetArmed=false;renderAll();renderMe()}}
      else{resetArmed=true;var c=document.getElementById('st-reset-confirm');if(c){c.innerHTML='<button class="btn btn-sm" data-act="reset1" type="button">再点一次确认清空</button>';setTimeout(function(){resetArmed=false},4000)}}
    }
    saveSession();recordAppRoute();
  });

  var navTabs=root.querySelectorAll('.nav-link[role="tab"]');
  var mobileNavigation=window.matchMedia('(max-width:680px)');
  function updateNavigationOrientation(){(root.querySelector('[role="tablist"]')||document.querySelector('[role="tablist"]')).setAttribute('aria-orientation',mobileNavigation.matches?'horizontal':'vertical')}
  updateNavigationOrientation();
  mobileNavigation.addEventListener('change',updateNavigationOrientation);
  root.querySelector('[role="tablist"]').addEventListener('keydown',function(event){
    var current=Array.prototype.indexOf.call(navTabs,event.target);
    if(current<0)return;
    var destination=current;
    if(event.key==='ArrowDown'||event.key==='ArrowRight')destination=(current+1)%navTabs.length;
    else if(event.key==='ArrowUp'||event.key==='ArrowLeft')destination=(current+navTabs.length-1)%navTabs.length;
    else if(event.key==='Home')destination=0;
    else if(event.key==='End')destination=navTabs.length-1;
    else return;
    event.preventDefault();navTabs[destination].click();navTabs[destination].focus();
  });
  for(var ti=0;ti<navTabs.length;ti++){
    (function(b){b.addEventListener('click',function(){
      buzz(6);
      switchTab(b.getAttribute('aria-controls').replace('panel-',''));
      b.classList.remove('st-bloom');void b.offsetWidth;b.classList.add('st-bloom');
      setTimeout(function(){b.classList.remove('st-bloom')},480);
    })})(navTabs[ti]);
  }
  /* 底部 Tab 栏(≤680px):tablist 移出侧栏挂到 body 下,配滑动药丸指示器;桌面布局不变 */
  var tablistEl=document.querySelector('[role="tablist"]');
  var stPill=document.createElement('span');stPill.id='st-tabpill';stPill.setAttribute('aria-hidden','true');tablistEl.appendChild(stPill);
  function tabGlassColor(value){
    var parts=value.match(/[\d.]+/g)||[0,0,0,0],unit=value.indexOf('color(srgb')===0?1:255;
    return [Number(parts[0])/unit,Number(parts[1])/unit,Number(parts[2])/unit,parts.length>3?Number(parts[3]):1];
  }
  function tabBackdropColor(horizontal,vertical){
    var layers=document.elementsFromPoint(horizontal,vertical),element=null;
    for(var layerIndex=0;layerIndex<layers.length;layerIndex++){if(!tablistEl.contains(layers[layerIndex])){element=layers[layerIndex];break}}
    var color=[0,0,0,0];
    while(element&&color[3]<.995){
      var background=tabGlassColor(getComputedStyle(element).backgroundColor),weight=background[3]*(1-color[3]);
      for(var channel=0;channel<3;channel++)color[channel]+=background[channel]*weight;
      color[3]+=weight;element=element.parentElement;
    }
    return color;
  }
  function updateTabInk(){
    if(!tablistEl||!mqlTab||!mqlTab.matches||!document.elementsFromPoint)return;
    var bounds=tablistEl.getBoundingClientRect();
    if(!bounds.height||getComputedStyle(tablistEl).visibility==='hidden')return;
    var tint=tabGlassColor(getComputedStyle(tablistEl).backgroundColor),tones=[];
    for(var tabIndex=0;tabIndex<navTabs.length;tabIndex++){
      var button=navTabs[tabIndex],buttonBounds=button.getBoundingClientRect(),average=[0,0,0];
      for(var sampleIndex=0;sampleIndex<2;sampleIndex++){
        var background=tabBackdropColor(buttonBounds.left+buttonBounds.width/2,buttonBounds.top+buttonBounds.height*(sampleIndex ? .76 : .32));
        for(var channel=0;channel<3;channel++)average[channel]+=(background[channel]*(1-tint[3])+tint[channel]*tint[3])/2;
      }
      var luminance=0,weights=[.2126,.7152,.0722];
      for(var channel=0;channel<3;channel++){var value=average[channel];luminance+=weights[channel]*(value<=.04045?value/12.92:Math.pow((value+.055)/1.055,2.4))}
      tones.push(luminance<.22?'light':'dark');
    }
    for(var tabIndex=0;tabIndex<navTabs.length;tabIndex++){if(navTabs[tabIndex].getAttribute('data-glass-ink')!==tones[tabIndex])navTabs[tabIndex].setAttribute('data-glass-ink',tones[tabIndex])}
  }
  function movePill(){
    var act=tablistEl.querySelector('.nav-link.active');
    if(!act){stPill.style.opacity='0';return}
    stPill.style.opacity='1';
    stPill.style.width=act.offsetWidth+'px';
    stPill.style.transform='translateX('+act.offsetLeft+'px)';
    stPill.classList.remove('st-squash');void stPill.offsetWidth;stPill.classList.add('st-squash');
    requestAnimationFrame(updateTabInk);
  }
  var mqlTab=window.matchMedia('(max-width:680px)');
  var tabHome=tablistEl.parentNode,tabNext=tablistEl.nextSibling;
  function placeTabbar(){
    if(mqlTab.matches){if(tablistEl.parentNode!==document.body)document.body.appendChild(tablistEl)}
    else if(tablistEl.parentNode!==tabHome){tabHome.insertBefore(tablistEl,tabNext)}
    movePill();
  }
  placeTabbar();
  if(mqlTab.addEventListener)mqlTab.addEventListener('change',placeTabbar);else if(mqlTab.addListener)mqlTab.addListener(placeTabbar);
  window.addEventListener('resize',placeTabbar);
  window.addEventListener('load',placeTabbar);
  /* ---------- 动态字号:校验设置并重算导航 ---------- */
  function applyFont(fz){
    if(['m','l','xl','xxl'].indexOf(fz)<0)fz='m';
    try{if(fz&&fz!=='m')storage.setItem('sqltrain_font',fz);else storage.removeItem('sqltrain_font')}catch(e){}
    if(fz&&fz!=='m')document.documentElement.dataset.font=fz;else document.documentElement.removeAttribute('data-font');
    setTimeout(function(){movePill();tbGlass()},80);
  }
  /* ---------- 键盘避让:编辑时收起底栏,缩放页面不视为键盘 ---------- */
  var _vv=window.visualViewport;
  function kbSync(){
    if(!_vv)return;
    var active=document.activeElement,editing=active&&active.matches('textarea,input,select');
    var kb=editing&&_vv.scale<=1.05?Math.max(0,Math.round(window.innerHeight-_vv.height-_vv.offsetTop)):0;
    document.documentElement.style.setProperty('--st-kb',kb+'px');
    root.classList.toggle('st-kb',kb>90);
    document.documentElement.classList.toggle('st-keyboard',kb>90);
  }
  if(_vv){_vv.addEventListener('resize',kbSync);_vv.addEventListener('scroll',kbSync);kbSync()}
  root.addEventListener('focusin',function(e){
    kbSync();
    var el=e.target;
    if(!el||!el.matches||!el.matches('textarea,input,select'))return;
    setTimeout(function(){if(document.activeElement!==el)return;try{el.scrollIntoView({block:'nearest',behavior:'auto'})}catch(_e){try{el.scrollIntoView()}catch(e2){}}},320);
  });
  root.addEventListener('focusout',function(){setTimeout(kbSync,0)});
  /* ---------- v2.6:滑动切 Tab(移动端;避开输入区/代码块/可滚动列表) ---------- */
  var swOrder=['dash','train','exam','me'];
  var swX=0,swY=0,swT=0,swOn=false;
  root.addEventListener('touchstart',function(e){
    if(e.touches.length!==1||!window.matchMedia('(max-width:680px)').matches){swOn=false;return}
    var t=e.target;
    if(t&&t.closest&&t.closest('textarea,input,select,button,a,pre,.table-responsive,.st-qlist,.st-dots,.nav,#cmdk,summary,.st-subseg,.form-control')){swOn=false;return}
    swX=e.touches[0].clientX;swY=e.touches[0].clientY;swT=Date.now();swOn=true;
  },{passive:true});
  root.addEventListener('touchend',function(e){
    if(!swOn)return;swOn=false;
    var tc=e.changedTouches&&e.changedTouches[0];if(!tc)return;
    var dx=tc.clientX-swX,dy=tc.clientY-swY;
    if(Math.abs(dx)<64||Math.abs(dx)<Math.abs(dy)*1.4||Date.now()-swT>900)return;
    var ni=swOrder.indexOf(topTab)+(dx<0?1:-1);
    if(ni<0||ni>=swOrder.length)return;
    switchTab(swOrder[ni],dx<0?'l':'r');
    buzz(6);
  },{passive:true});
  /* ---------- v2.6:提醒调度(应用打开期间每 30s 检查一次) ---------- */
  setInterval(checkReminder,30000);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)checkReminder()});
  setTimeout(checkReminder,2500);
  /* 顶栏液态玻璃随滚动连续渐显:0px 全透明 → 60px 全强度,状态栏与顶栏始终一体 */
  var tbT=false;
  function tbGlass(){
    if(tbT)return;tbT=true;
    var apply=function(){
      tbT=false;
      var y=window.scrollY||0,p=y<=2?0:(y>=60?1:(y-2)/58);
      root.style.setProperty('--st-tbp',p.toFixed(3));
      root.classList.toggle('st-glass',p>0.05);
      updateTabInk();
    };
    if(document.hidden||typeof requestAnimationFrame==='undefined'){apply();return}
    requestAnimationFrame(apply);
    setTimeout(function(){if(tbT)apply()},120);
  }
  window.addEventListener('scroll',tbGlass,{passive:true});
  root.addEventListener('toggle',tbGlass,true);
  tbGlass();
  [['st-train-seg','train'],['st-exam-seg','exam']].forEach(function(pair){
    var seg=document.getElementById(pair[0]);if(!seg)return;
    seg.addEventListener('click',function(e){
      var b=e.target&&e.target.closest?e.target.closest('button[data-sub]'):null;
      if(!b)return;
      buzz(4);
      captureAppScroll();
      showSub(pair[1],b.getAttribute('data-sub'));
      if(pair[1]==='exam')renderExam();else renderTrain();
      recordAppRoute();window.scrollTo(0,appScroll[appRouteKey(appSnapshot())]||0);tbGlass();
    });
    seg.addEventListener('keydown',function(event){
      var buttons=seg.querySelectorAll('button[data-sub]');
      var index=Array.prototype.indexOf.call(buttons,event.target);if(index<0)return;
      if(event.key==='ArrowRight'||event.key==='ArrowDown')index=(index+1)%buttons.length;
      else if(event.key==='ArrowLeft'||event.key==='ArrowUp')index=(index+buttons.length-1)%buttons.length;
      else if(event.key==='Home')index=0;
      else if(event.key==='End')index=buttons.length-1;
      else return;
      event.preventDefault();buttons[index].click();buttons[index].focus();
    });
  });

  function renderAll(){updateStreak();renderDash()}
  function refreshProgressViews(){
      renderAll();
      if(topTab==='train'&&trainSub==='review')renderReview();
      if(topTab==='exam'&&examSub==='wrong')renderWrong();
      if(currentQid&&topTab==='train'&&trainSub==='practice'){
        renderQStatus(currentQid);
        var note=document.getElementById('st-note');
        if(note&&document.activeElement!==note)note.value=state.notes[currentQid]||'';
      }
      refreshIcons();
  }
  function receiveProgress(incoming){
    var clean=normalizeState(incoming);if(!clean)return;
    var merged=mergeStates(state,clean);
    if(JSON.stringify(merged)!==JSON.stringify(state)&&commitProgress(merged,false)){
      refreshProgressViews();
    }
  }
  try{window.addEventListener('zcode:set_globals',function(ev){
    try{var g=ev.detail&&ev.detail.globals;if(g&&g.widgetState)receiveProgress(g.widgetState.privateContent)}catch(e){}
  })}catch(e){}
  window.addEventListener('storage',function(ev){
    if(ev.key==='sqltrain_state'&&ev.newValue){try{receiveProgress(parseSafeJSON(ev.newValue))}catch(e){}}
  });
  window.addEventListener('pagehide',saveSession);
  window.addEventListener('beforeunload',saveSession);
  window.addEventListener('sql-lab:storage-error',function(){stToast('本机文件保存失败，请保留当前页面并先导出备份。')});
  platform.onAppState(function(event){
    if(event.isActive){refreshTestClock();platform.refreshPermission().then(refreshNativeReminder).catch(function(){})}
    else{saveBeforeUpdate();storage.flush().catch(function(){storageFailed()})}
  });
  platform.onOpenTraining(function(){resumeLearning()});
  document.addEventListener('visibilitychange',function(){if(document.hidden)saveSession();else refreshTestClock()});

  loadState();
  state.lessons=state.lessons||{};state.plan=state.plan||{};
  state.attempts=state.attempts||{};state.sr=state.sr||{};
  /* 存量进度回填:已通过的题按周次分三天摊入复习计划,避免升级首日一次压垮 */
  if(!state.srSeeded){
    QUESTIONS.forEach(function(q){if(state.done[q.id]){var r=srRec(q.id);r.rep=1;r.ef=2.5;r.iv=q.w<=3?0:(q.w<=6?1:2);r.due=addDaysStr(r.iv)}});
    state.srSeeded=1;
  }
  try{var _snap=JSON.parse(storage.getItem('sqltrain_snap')||'null');var _today=todayStr();
    if(state.savedAt&&(!_snap||_snap.d!==_today)){storage.setItem('sqltrain_snap',JSON.stringify({d:_today,t:state.savedAt,s:JSON.stringify(state)}))}
  }catch(e){}
  loadSession();
  initEngine();
  setTimeout(function(){syncNow(false)},1500);
  switchTab(topTab);
  checkMilestones();
  applyMode();
  refreshNativeReminder();
  if(loadWarning)stToast(loadWarning);
  window.__SQLTRAIN_PWA__={start:startPwa};
  window.__SQLTRAIN__={QUESTIONS:QUESTIONS,LESSONS:LESSONS,WEEKS:WEEKS,TEMPLATES:TEMPLATES,buildDatabase:buildDatabase,runQuery:runQuery,resultRows:resultRows,cmpRows:cmpRows,
    normalizeState:normalizeState,mergeStates:mergeStates,gradeAnswer:gradeAnswer};

}
