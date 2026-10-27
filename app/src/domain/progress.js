import { QUESTIONS, LESSONS } from '../content/catalog.js';
import { PRACTICE_QUESTIONS } from '../content/enrichment.js';

var PROGRESS_GROUPS=['done','wrong','notes','lessons','plan','attempts','sr','mil','days','misc','evidence','tests'];
var MISC_IDS=['history','lastBackup','srSeeded','lastTest','learningProfile'];
var RESULT_KINDS=['passed','result','syntax','query','limit','unanswered'];
var PLAN_IDS=['env_mysql','env_nowcoder','env_sqlbolt','env_notebook','acc_nowcoder','acc_timed','acc_demo'];
var MILESTONE_IDS=['first','d3','d7','l5','t10','w1','half','all'];
function isRecord(o){return !!o&&Object.prototype.toString.call(o)==='[object Object]'}
function hasOwn(o,k){return Object.prototype.hasOwnProperty.call(o,k)}
function cloneProgress(o){return JSON.parse(JSON.stringify(o))}
function parseSafeJSON(raw){return JSON.parse(raw,function(k,v){
  if(k==='__proto__'||k==='constructor'||k==='prototype')throw new Error('非法字段');
  return v;
})}
function validNumber(n){return typeof n==='number'&&isFinite(n)&&n>=0&&n<=8640000000000000}
function validCount(n){return validNumber(n)&&Math.floor(n)===n}
function validDay(s){
  if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
  var d=new Date(s+'T00:00:00Z');
  return isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;
}
function knownProgressId(group,id){
  if(id==='__proto__'||id==='constructor'||id==='prototype')return false;
  if(group==='days')return validDay(id);
  if(group==='misc')return MISC_IDS.indexOf(id)>=0;
  if(group==='evidence'||group==='tests')return validRecordId(id);
  if(group==='plan')return PLAN_IDS.indexOf(id)>=0;
  if(group==='mil')return MILESTONE_IDS.indexOf(id)>=0;
  var list=group==='lessons'?LESSONS:QUESTIONS.concat(PRACTICE_QUESTIONS);
  return list.some(function(item){return item.id===id});
}
function emptyProgress(){return {v:1,done:{},wrong:{},notes:{},lessons:{},plan:{},days:[],attempts:{},sr:{},mil:{},savedAt:0,
  _sync:{reset:{t:0,d:''},records:{}}}}
function progressMap(s,group){
  if(group==='days'){var days={};s.days.forEach(function(day){days[day]=1});return days}
  if(group==='misc'){var misc={};MISC_IDS.forEach(function(k){if(hasOwn(s,k))misc[k]=s[k]});return misc}
  return s[group]||{};
}
function setProgressMap(s,group,map){
  if(group==='days')s.days=Object.keys(map).sort();
  else if(group==='misc')Object.keys(map).forEach(function(k){s[k]=map[k]});
  else s[group]=map;
}
function validProgressValue(group,value){
  if(group==='done')return isRecord(value)&&validNumber(value.ts)&&(value.used===0||value.used===1||typeof value.used==='undefined');
  if(group==='wrong'||group==='attempts')return validCount(value);
  if(group==='notes')return typeof value==='string'&&value.length<=10000;
  if(group==='lessons'||group==='plan'||group==='mil')return value===1||value===true;
  if(group==='sr')return isRecord(value)&&validDay(value.due)&&validCount(value.iv)&&validCount(value.rep)
    &&typeof value.ef==='number'&&isFinite(value.ef)&&value.ef>=1&&value.ef<=10
    &&(typeof value.lapse==='undefined'||validCount(value.lapse))
    &&(typeof value.last==='undefined'||validDay(value.last));
  return false;
}
function normalizeTestResult(r){
  if(!isRecord(r)||typeof r.id!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(r.id)
    ||!validNumber(r.endedAt)||!Array.isArray(r.results)||!r.results.length||r.results.length>5)return null;
  var seen={};
  if(!r.results.every(function(v){
    if(!isRecord(v)||!knownProgressId('done',v.qid)||typeof v.ok!=='boolean'||seen[v.qid])return false;
    if(typeof v.kind!=='undefined'&&(RESULT_KINDS.indexOf(v.kind)<0||v.ok!==(v.kind==='passed')))return false;
    if(typeof v.sql!=='undefined'&&(typeof v.sql!=='string'||v.sql.length>100000))return false;
    seen[v.qid]=true;return true;
  }))return null;
  var clean={id:r.id,results:r.results.map(function(v){
    var row={qid:v.qid,ok:v.ok};
    if(typeof v.kind!=='undefined')row.kind=v.kind;
    if(typeof v.sql!=='undefined')row.sql=v.sql;
    return row;
  }),endedAt:r.endedAt};
  if(typeof r.startedAt!=='undefined'){
    if(!validNumber(r.startedAt)||r.startedAt>r.endedAt||!validNumber(r.elapsed)||r.elapsed>2700||!validCount(r.week)||r.week>8)return null;
    clean.startedAt=r.startedAt;clean.elapsed=r.elapsed;clean.week=r.week;
  }
  return clean;
}
function validRecordId(id){return typeof id==='string'&&['__proto__','constructor','prototype'].indexOf(id)<0&&/^[A-Za-z0-9_-]{8,100}$/.test(id)}
function normalizeLearningProfile(value){
  if(!isRecord(value)||['beginner','some','confident'].indexOf(value.level)<0||['job','analysis','foundation'].indexOf(value.goal)<0
    ||[15,30,60].indexOf(value.minutes)<0||!validCount(value.startWeek)||value.startWeek<1||value.startWeek>8
    ||typeof value.skipKnown!=='boolean'||!validNumber(value.updatedAt))return null;
  var clean={level:value.level,goal:value.goal,minutes:value.minutes,startWeek:value.startWeek,skipKnown:value.skipKnown,updatedAt:value.updatedAt};
  if(typeof value.diagnostic!=='undefined'){
    var ids=['q1','q7','q13','q24'],seen={};
    if(!Array.isArray(value.diagnostic)||value.diagnostic.length!==4||!value.diagnostic.every(function(row){
      if(!isRecord(row)||ids.indexOf(row.qid)<0||seen[row.qid]||typeof row.ok!=='boolean'||RESULT_KINDS.indexOf(row.kind)<0||row.ok!==(row.kind==='passed'))return false;
      seen[row.qid]=true;return true;
    }))return null;
    clean.diagnostic=value.diagnostic.map(function(row){return {qid:row.qid,ok:row.ok,kind:row.kind}});
  }
  return clean;
}
function normalizeState(input){
  if(!isRecord(input)||input.v!==1||!isRecord(input.done))return null;
  try{
    var out=emptyProgress();
    if(typeof input.savedAt!=='undefined'&&!validNumber(input.savedAt))return null;
    out.savedAt=input.savedAt||0;
    PROGRESS_GROUPS.slice(0,8).forEach(function(group){
      var src=typeof input[group]==='undefined'?{}:input[group];
      if(!isRecord(src))throw new Error('字段类型错误');
      Object.keys(src).forEach(function(id){
        if(!knownProgressId(group,id)||!validProgressValue(group,src[id]))throw new Error('无效进度记录');
        var value=src[id];
        if(group==='done')value={ts:value.ts,used:value.used||0};
        else if(group==='sr'){
          var review={due:value.due,iv:value.iv,rep:value.rep,ef:value.ef,lapse:value.lapse||0};
          if(typeof value.last!=='undefined')review.last=value.last;
          value=review;
        }
        out[group][id]=cloneProgress(value);
      });
    });
    ['evidence','tests'].forEach(function(group){
      if(typeof input[group]==='undefined')return;
      if(!isRecord(input[group]))throw new Error('学习记录类型错误');
      out[group]={};
      Object.keys(input[group]).forEach(function(id){
        var value=input[group][id];
        if(!validRecordId(id))throw new Error('无效学习记录 ID');
        if(group==='tests'){
          var record=normalizeTestResult(value);
          if(!record||record.id!==id)throw new Error('周测历史无效');
          out[group][id]=record;
        }else{
          if(!isRecord(value)||!knownProgressId('done',value.qid)||typeof value.ok!=='boolean'||typeof value.used!=='boolean'
            ||!validNumber(value.t)||RESULT_KINDS.indexOf(value.kind)<0||value.ok!==(value.kind==='passed'))throw new Error('学习证据无效');
          out[group][id]={qid:value.qid,ok:value.ok,used:value.used,t:value.t,kind:value.kind};
        }
      });
    });
    if(typeof input.learningProfile!=='undefined'){
      out.learningProfile=normalizeLearningProfile(input.learningProfile);if(!out.learningProfile)return null;
    }
    var days=typeof input.days==='undefined'?[]:input.days;
    if(!Array.isArray(days)||!days.every(validDay))return null;
    out.days=days.filter(function(d,i){return days.indexOf(d)===i}).sort();
    if(typeof input.lastBackup!=='undefined'){
      if(!validNumber(input.lastBackup))return null;out.lastBackup=input.lastBackup;
    }
    if(typeof input.srSeeded!=='undefined'){
      if(input.srSeeded!==1&&input.srSeeded!==true)return null;out.srSeeded=1;
    }
    if(typeof input.history!=='undefined'){
      if(!Array.isArray(input.history)||input.history.length>1000)return null;
      if(!input.history.every(function(h){return isRecord(h)&&(h.q==='play'||knownProgressId('done',h.q))
        &&typeof h.s==='string'&&h.s.length<=100000&&(h.ok===0||h.ok===1)&&validNumber(h.t)
        &&(typeof h.kind==='undefined'||RESULT_KINDS.indexOf(h.kind)>=0)
        &&(typeof h.used==='undefined'||h.used===0||h.used===1)}))return null;
      out.history=input.history.slice(0,12).map(function(h){
        var entry={q:h.q,s:h.s,ok:h.ok,t:h.t};
        if(typeof h.kind!=='undefined')entry.kind=h.kind;
        if(typeof h.used!=='undefined')entry.used=h.used;
        return entry;
      });
    }
    if(typeof input.lastTest!=='undefined'){
      out.lastTest=normalizeTestResult(input.lastTest);if(!out.lastTest)return null;
    }
    function revision(r){
      if(!isRecord(r)||!validCount(r.t)||typeof r.d!=='string'||r.d.length>100
        ||(typeof r.deleted!=='undefined'&&r.deleted!==1))throw new Error('无效修订信息');
      var v={t:r.t,d:r.d};if(r.deleted)v.deleted=1;return v;
    }
    if(typeof input._sync!=='undefined'){
      if(!isRecord(input._sync)||!isRecord(input._sync.records))return null;
      out._sync.reset=revision(input._sync.reset);
      if(out._sync.reset.deleted)return null;
      Object.keys(input._sync.records).forEach(function(group){
        var records=input._sync.records[group];
        if(PROGRESS_GROUPS.indexOf(group)<0||!isRecord(records))throw new Error('无效同步字段');
        out._sync.records[group]={};
        Object.keys(records).forEach(function(id){
          if(!knownProgressId(group,id))throw new Error('无效记录 ID');
          out._sync.records[group][id]=revision(records[id]);
        });
      });
    }
    PROGRESS_GROUPS.forEach(function(group){
      if((group==='evidence'||group==='tests')&&!hasOwn(out,group)&&!hasOwn(out._sync.records,group))return;
      var map=progressMap(out,group),revs=out._sync.records[group]||{};
      out._sync.records[group]=revs;
      Object.keys(map).forEach(function(id){
        if(!revs[id])revs[id]={t:group==='done'?map[id].ts:out.savedAt,d:'legacy'};
        if(revs[id].deleted)throw new Error('记录与删除标记冲突');
      });
      Object.keys(revs).forEach(function(id){if(!hasOwn(map,id)&&!revs[id].deleted)throw new Error('缺少修订记录')});
    });
    return out;
  }catch(e){return null}
}
function compareRevision(a,b){return a.t===b.t?(a.d===b.d?0:(a.d>b.d?1:-1)):(a.t>b.t?1:-1)}
function nextRevision(states,device,now){
  var time=typeof now==='number'?now:Date.now();
  states.forEach(function(s){
    time=Math.max(time,s._sync.reset.t+1,s.savedAt+1);
    PROGRESS_GROUPS.forEach(function(g){Object.keys(s._sync.records[g]||{}).forEach(function(id){time=Math.max(time,s._sync.records[g][id].t+1)})});
  });
  return {t:time,d:device};
}
function stampProgress(next,before,device){
  var revision=nextRevision([next,before],device);
  PROGRESS_GROUPS.forEach(function(g){
    if((g==='evidence'||g==='tests')&&!hasOwn(next,g)&&!hasOwn(before,g))return;
    var a=progressMap(before,g),b=progressMap(next,g),revs=next._sync.records[g]||(next._sync.records[g]={});
    var ids=Object.keys(a).concat(Object.keys(b));
    ids.forEach(function(id){
      if(JSON.stringify(a[id])!==JSON.stringify(b[id])){
        revs[id]={t:revision.t,d:revision.d};if(!hasOwn(b,id))revs[id].deleted=1;
      }
    });
  });
  return next;
}
function mergeStates(left,right){
  var a=normalizeState(left),b=normalizeState(right);
  if(!a||!b)throw new Error('进度数据校验失败');
  var out=emptyProgress(),floor=compareRevision(a._sync.reset,b._sync.reset)>=0?a._sync.reset:b._sync.reset;
  out._sync.reset=cloneProgress(floor);out.savedAt=Math.max(a.savedAt,b.savedAt);
  PROGRESS_GROUPS.forEach(function(g){
    var av=progressMap(a,g),bv=progressMap(b,g),ar=a._sync.records[g],br=b._sync.records[g],map={},revs={};
    if((g==='evidence'||g==='tests')&&!hasOwn(a,g)&&!hasOwn(b,g)&&!ar&&!br)return;
    ar=ar||{};br=br||{};
    var ids=Object.keys(ar).concat(Object.keys(br)).filter(function(id,i,all){return all.indexOf(id)===i}).sort();
    ids.forEach(function(id){
      var ra=ar[id],rb=br[id],useA=!rb||(ra&&compareRevision(ra,rb)>0);
      if(ra&&rb&&compareRevision(ra,rb)===0){
        useA=ra.deleted?true:(rb.deleted?false:JSON.stringify(av[id])>=JSON.stringify(bv[id]));
      }
      var r=cloneProgress(useA?ra:rb),value=(useA?av:bv)[id];
      if(compareRevision(r,floor)<=0)r.deleted=1;
      if(!r.deleted)map[id]=cloneProgress(value);
      revs[id]=r;
    });
    setProgressMap(out,g,map);out._sync.records[g]=revs;
  });
  return out;
}
function rebaseProgress(imported,current,device){
  var next=normalizeState(imported);
  if(!next)throw new Error('进度数据校验失败');
  var reset=nextRevision([next,current],device);
  next._sync={reset:reset,records:{}};
  PROGRESS_GROUPS.forEach(function(g){
    var revs={};Object.keys(progressMap(next,g)).forEach(function(id){revs[id]={t:reset.t+1,d:device}});
    next._sync.records[g]=revs;
  });
  return next;
}

export { isRecord, hasOwn, cloneProgress, parseSafeJSON, validNumber, validCount, validDay, knownProgressId, emptyProgress, progressMap, setProgressMap, validProgressValue, normalizeTestResult, normalizeState, compareRevision, nextRevision, stampProgress, mergeStates, rebaseProgress };
