import { genSyncCode } from './identity.js';

export function createSync({ storage, getState, parseBackup, mergeBackup, commitProgress, refreshProgressViews }) {
  var SYNC_CFG_KEY='sqltrain_sync';
  var syncPushTimer=null,syncBusy=false,syncDirty=false,syncKeyCache=null;
  function loadSyncCfg(){
    try{var raw=storage.getItem(SYNC_CFG_KEY);if(raw){var c=JSON.parse(raw);if(c&&typeof c==='object')return c}}catch(e){}
    return {};
  }
  function saveSyncCfg(c){try{storage.setItem(SYNC_CFG_KEY,JSON.stringify(c))}catch(e){}}
  function syncCfgReady(c){c=c||loadSyncCfg();return c.provider==='lc'?!!(c.base&&c.appId&&c.appKey&&c.code):!!(c.token&&c.code)}
  function fmtClock(ts){var d=new Date(ts);function p(n){return ('0'+n).slice(-2)}return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes())}
  function syncStatus(msg,cls){
    var el=document.getElementById('st-sync-status');
    if(el){el.textContent=msg;el.className='text-small '+(cls==='err'?'text-destructive':(cls==='ok'?'st-pass':'text-muted'))}
  }
  function b64ToBytes(b){b=b.replace(/-/g,'+').replace(/_/g,'/');while(b.length%4)b+='=';var s=atob(b),a=new Uint8Array(s.length);for(var i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return a}
  function bytesToB64(a){var s='';for(var i=0;i<a.length;i++)s+=String.fromCharCode(a[i]);return btoa(s)}
  var SYNC_SALT='sqltrain-sync-v1';
  async function getSyncKey(code){
    if(typeof crypto==='undefined'||!crypto.subtle)throw new Error('此环境不支持加密（crypto.subtle 不可用）');
    var km=await crypto.subtle.importKey('raw',new TextEncoder().encode(code),'PBKDF2',false,['deriveKey']);
    return await crypto.subtle.deriveKey({name:'PBKDF2',salt:new TextEncoder().encode(SYNC_SALT),iterations:100000,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function encSyncPayload(obj,code){
    var key=await getSyncKey(code);syncKeyCache=key;
    var iv=crypto.getRandomValues(new Uint8Array(12));
    var data=await crypto.subtle.encrypt({name:'AES-GCM',iv:iv},key,new TextEncoder().encode(JSON.stringify(obj)));
    return JSON.stringify({enc:'AES-GCM',v:1,iv:bytesToB64(iv),data:bytesToB64(new Uint8Array(data))});
  }
  async function decSyncPayload(str,code){
    var o=JSON.parse(str);
    if(!o||o.enc!=='AES-GCM')return o;
    var key=syncKeyCache||await getSyncKey(code);
    var pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64ToBytes(o.iv)},key,b64ToBytes(o.data));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  function lcHeaders(c){return {'X-LC-Id':c.appId,'X-LC-Key':c.appKey,'Content-Type':'application/json'}}
  function lcUrl(c,path){return c.base.replace(/\/+$/,'')+'/1.1/classes/Progress'+(path||'')}
  async function lcQuery(c){
    var where=encodeURIComponent(JSON.stringify({code:c.code}));
    var res=await fetch(lcUrl(c,'')+'?where='+where+'&order=-updatedAt&limit=2',{headers:lcHeaders(c)});
    if(!res.ok)throw new Error('HTTP '+res.status+(res.status===403?'（安全域名限制？）':''));
    var j=await res.json();
    return (j.results||[])[0]||null;
  }
  async function lcUpsert(c,payloadStr){
    var exist=await lcQuery(c);
    if(exist){
      var res=await fetch(lcUrl(c,'/'+exist.objectId),{method:'PUT',headers:lcHeaders(c),body:JSON.stringify({payload:payloadStr})});
      if(!res.ok)throw new Error('HTTP '+res.status);
    }else{
      var res2=await fetch(lcUrl(c,''),{method:'POST',headers:lcHeaders(c),body:JSON.stringify({code:c.code,payload:payloadStr})});
      if(!res2.ok)throw new Error('HTTP '+res2.status);
    }
  }
  function gistApiBase(c){return c.gistApi||'https://api.github.com'}
  function ghHeaders(c){return {'Authorization':'Bearer '+c.token,'Accept':'application/vnd.github+json','Content-Type':'application/json'}}
  async function gistGet(c){
    if(!c.gistId)return null;
    var res=await fetch(gistApiBase(c)+'/gists/'+c.gistId,{headers:ghHeaders(c)});
    if(res.status===404)return null;
    if(!res.ok)throw new Error('HTTP '+res.status);
    var j=await res.json();
    var f=j.files&&j.files['sync.json'];
    return {payload:f&&f.content};
  }
  async function gistPut(c,payloadStr){
    if(!c.gistId){
      var res=await fetch(gistApiBase(c)+'/gists',{method:'POST',headers:ghHeaders(c),body:JSON.stringify({description:'SQL训练系统同步数据（端到端加密）',public:false,files:{'sync.json':{content:payloadStr}}})});
      if(!res.ok)throw new Error('HTTP '+res.status);
      var j=await res.json();c.gistId=j.id;saveSyncCfg(c);
      var gi=document.getElementById('st-sync-gistid');if(gi)gi.value=c.gistId;
    }else{
      var res2=await fetch(gistApiBase(c)+'/gists/'+c.gistId,{method:'PATCH',headers:ghHeaders(c),body:JSON.stringify({files:{'sync.json':{content:payloadStr}}})});
      if(!res2.ok)throw new Error('HTTP '+res2.status);
    }
  }
  function scheduleSyncPush(){
    if(syncBusy){syncDirty=true;return}
    if(!syncCfgReady())return;
    clearTimeout(syncPushTimer);
    syncPushTimer=setTimeout(function(){syncNow(false)},4000);
  }
  async function syncNow(manual){
    var c=loadSyncCfg();
    if(!syncCfgReady(c)){if(manual)syncStatus(c.provider==='lc'?'请先填写 API 域名、AppID、AppKey 和同步码并保存':'请先填写 GitHub 令牌和同步码并保存','err');return}
    if(syncBusy){if(manual)syncStatus('同步进行中…');return}
    syncBusy=true;
    if(manual)syncStatus('同步中…');
    try{
      var remote=c.provider==='gist'?await gistGet(c):await lcQuery(c);
      if(remote){
        if(typeof remote.payload!=='string'||!remote.payload.trim())throw new Error('云端进度校验失败，已停止上传，请先检查云端备份');
        var parsed=null,o=null;
        try{parsed=JSON.parse(remote.payload)}catch(e){parsed=null}
        if(parsed&&parsed.enc==='AES-GCM'){
          try{o=parseBackup(JSON.stringify(await decSyncPayload(remote.payload,c.code)))}
          catch(e){o=null;syncStatus('云端数据解密失败：各设备必须使用同一个同步码','err');syncBusy=false;return}
        }else if(parsed){o=parseBackup(remote.payload)}
        if(!o)throw new Error('云端进度校验失败，已停止上传，请先检查云端备份');
        if(o){
          var merged=mergeBackup(o);
          if(JSON.stringify(merged)!==JSON.stringify(getState())){
            if(!commitProgress(merged,false))throw new Error('本地存储写入失败，未上传进度');
            refreshProgressViews();
          }
        }
      }
      var payload=c.enc?await encSyncPayload(getState(),c.code):JSON.stringify(getState());
      if(c.provider==='gist'){await gistPut(c,payload)}else{await lcUpsert(c,payload)}
      c.lastSync=Date.now();saveSyncCfg(c);
      syncStatus('已同步 · '+fmtClock(c.lastSync)+(manual?'':'（自动）'),'ok');
    }catch(e){
      var emsg=String(e.message||e);if(emsg.indexOf('401')>=0)emsg+='（令牌无效或已过期：GitHub → Settings → Developer settings 重新生成，勾选 gist 权限）';
      syncStatus('同步失败：'+emsg+' · 本地进度不受影响，可稍后重试','err');
    }finally{syncBusy=false;if(syncDirty){syncDirty=false;scheduleSyncPush()}}
  }
  function doSyncSave(){
    var c=loadSyncCfg();
    var provEl=document.querySelector('input[name="st-sync-prov"]:checked');
    c.provider=provEl?provEl.getAttribute('data-prov'):'gist';
    c.code=(document.getElementById('st-sync-code').value||'').trim();
    c.enc=!!document.getElementById('st-sync-enc').checked;
    if(c.provider==='gist'){
      c.token=(document.getElementById('st-sync-token').value||'').trim();
      c.gistId=(document.getElementById('st-sync-gistid').value||'').trim();
      if(c.token.length<20){syncStatus('GitHub 令牌不能为空：github.com → Settings → Developer settings → Personal access tokens → Tokens (classic) → 生成，只勾选 gist 权限','err');return}
    }else{
      c.base=(document.getElementById('st-sync-base').value||'').trim().replace(/\/+$/,'');
      c.appId=(document.getElementById('st-sync-id').value||'').trim();
      c.appKey=(document.getElementById('st-sync-key').value||'').trim();
      if(!/^https?:\/\//.test(c.base)){syncStatus('REST API 域名要以 https:// 开头（LeanCloud 控制台 → 设置 → 应用凭证）','err');return}
      if(!c.appId||!c.appKey){syncStatus('AppID / AppKey 不能为空','err');return}
    }
    if(c.code.length<8){syncStatus('同步码太短：点"生成新同步码"，或在其他设备复制同一个码','err');return}
    saveSyncCfg(c);syncKeyCache=null;
    syncStatus('配置已保存，正在连接…');
    syncNow(true);
  }


  return { loadSyncCfg, saveSyncCfg, syncCfgReady, fmtClock, syncStatus, scheduleSyncPush, syncNow, doSyncSave };
}
