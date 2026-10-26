export function createUpdates({ root, version: APP_VERSION, build: APP_BUILD, saveBeforeUpdate, storage, platform, toast: stToast }) {
  var pwa={reg:null,prompt:null,pending:null,busy:false,applying:false,started:false,
    update:'尚未检查线上版本。检查过程不会打断学习。',offline:'离线副本正在准备，请保持联网。'};
  function pwaHosted(){return !platform.isNative&&!import.meta.env.DEV&&/^https?:$/.test(location.protocol)&&window.isSecureContext}
  function pwaInstalled(){return navigator.standalone===true||matchMedia('(display-mode: standalone)').matches}
  function pwaGuide(){
    if(platform.isNative)return '已安装 SQL Lab iOS 客户端，题库、课程与 SQL 引擎包含在安装包中。';
    if(import.meta.env.DEV)return '当前为 Web 开发预览。正式构建提供安装、离线缓存与版本更新。';
    if(pwaInstalled())return '已从主屏或独立窗口打开 SQL Lab。以后固定使用此入口继续学习。';
    if(!pwaHosted())return '当前为本地文件或非安全地址，可直接离线学习。安装与在线更新需从 HTTPS 部署地址打开。';
    if(/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1))return 'iPhone / iPad：在 Safari 点「分享」→「添加到主屏幕」，名称为 SQL Lab，然后从主屏图标打开。';
    return '可在浏览器菜单选择「安装应用」或「添加到主屏幕」。出现下方安装按钮时，也可直接安装 SQL Lab。';
  }
  function paintPwa(){
    var guide=document.getElementById('st-pwa-guide'),offline=document.getElementById('st-pwa-offline'),status=document.getElementById('st-upd-status');
    if(guide)guide.textContent=pwaGuide();
    if(offline)offline.textContent=(navigator.onLine===false?'当前离线 · ':'')+pwa.offline;
    if(status)status.textContent=pwa.update;
    var install=document.getElementById('st-pwa-install'),apply=document.getElementById('st-update-apply');
    if(install){install.hidden=!pwa.prompt||pwaInstalled();install.disabled=pwa.busy}
    if(apply){apply.hidden=!(pwa.pending&&pwa.pending.ready);apply.disabled=pwa.busy||pwa.applying}
    root.querySelectorAll('[data-act="check-update"]').forEach(function(button){button.disabled=pwa.busy||pwa.applying});
  }
  function pwaStatus(worker){
    return new Promise(function(resolve){
      if(!worker){resolve(null);return}
      var channel=new MessageChannel(),finished=false;
      function finish(value){if(finished)return;finished=true;clearTimeout(timer);channel.port1.close();resolve(value)}
      var timer=setTimeout(function(){finish(null)},1600);
      channel.port1.onmessage=function(event){finish(event.data)};
      try{worker.postMessage({type:'SQLTRAIN_STATUS'},[channel.port2])}catch(error){finish(null)}
    });
  }
  function refreshOffline(){
    if(!pwaHosted()){pwa.offline=platform.isNative?'此安装包可直接离线学习，支持草稿和周测恢复。':'开发预览不缓存离线资源；正式构建会校验完整离线包。';paintPwa();return Promise.resolve()}
    return pwaStatus(pwa.reg&&pwa.reg.active).then(function(status){
      pwa.offline=status&&status.offline?(status.build===APP_BUILD?'此版本已可离线使用，断网重开仍可练习与续考。':'已保留 v'+status.version+' 离线副本；当前构建尚未接管。'):'尚未确认完整离线副本，请联网完成准备后再离线使用。';
      paintPwa();
    });
  }
  function registerPwa(){
    if(!pwaHosted()||!navigator.serviceWorker)return Promise.resolve(null);
    return navigator.serviceWorker.register(new URL('sw.js',new URL('./',location.href)).href,{updateViaCache:'none'}).then(function(reg){
      if(pwa.reg!==reg){
        reg.addEventListener('updatefound',function(){
          var worker=reg.installing;
          if(worker)worker.addEventListener('statechange',function(){if(worker.state==='installed'||worker.state==='activated'||worker.state==='redundant')refreshOffline()});
        });
      }
      pwa.reg=reg;refreshOffline();return reg;
    }).catch(function(){pwa.offline='离线准备失败，请确认网络后重新检查更新。当前学习仍可继续。';paintPwa();return null});
  }
  function fetchPwa(path){
    return new Promise(function(resolve,reject){
      var controller=window.AbortController?new AbortController():null;
      var timer=setTimeout(function(){if(controller)controller.abort();reject(new Error('timeout'))},9000);
      fetch(new URL(path,new URL('./',location.href)).href,{cache:'no-store',redirect:'error',signal:controller?controller.signal:undefined}).then(function(response){
        if(!response.ok)throw new Error('http');
        return response.arrayBuffer().then(function(buffer){clearTimeout(timer);resolve(new Response(buffer,{status:response.status,headers:response.headers}))});
      }).catch(function(error){clearTimeout(timer);reject(error)});
    });
  }
  function readRelease(){
    return fetchPwa('release.json?check='+Date.now()).then(function(response){return response.json()}).then(function(release){
      if(!release||release.app!=='sql-trainer'||!/^\d+\.\d+\.\d+$/.test(release.version)||!/^[A-Za-z0-9._-]{1,64}$/.test(release.build)||!Array.isArray(release.assets))throw new Error('release');
      var documentAsset=release.assets.filter(function(asset){return asset.path==='index.html'})[0];
      if(!documentAsset||!/^[a-f0-9]{64}$/.test(documentAsset.sha256))throw new Error('release');
      return fetchPwa('index.html?sqltrain-verify='+encodeURIComponent(release.build)+'&check='+Date.now()).then(function(response){
        if(!/text\/html/i.test(response.headers.get('content-type')||''))throw new Error('html');
        return response.arrayBuffer();
      }).then(function(buffer){
        var html=new TextDecoder().decode(buffer),version=html.match(/<meta name="sqltrain-version" content="([^"]+)">/),build=html.match(/<meta name="sqltrain-build" content="([^"]+)">/);
        if(!version||!build||version[1]!==release.version||build[1]!==release.build)throw new Error('mismatch');
        return crypto.subtle.digest('SHA-256',buffer).then(function(hash){
          var actual=Array.from(new Uint8Array(hash)).map(function(value){return ('0'+value.toString(16)).slice(-2)}).join('');
          if(actual!==documentAsset.sha256)throw new Error('checksum');
          return release;
        });
      });
    });
  }
  function readyWorker(reg,build){
    return new Promise(function(resolve,reject){
      var deadline=Date.now()+11000;
      function inspect(){
        var worker=reg.waiting||reg.active;
        pwaStatus(worker).then(function(status){
          if(status&&status.build===build&&status.offline){resolve(worker);return}
          if(Date.now()>=deadline){reject(new Error('worker'));return}
          setTimeout(inspect,250);
        });
      }
      inspect();
    });
  }
  function checkUpdate(){
    if(pwa.busy||pwa.applying)return;
    if(platform.isNative){pwa.update='当前 iOS 客户端 v'+APP_VERSION+'（'+APP_BUILD+'）。客户端更新通过新安装包分发；此开发版本尚未上架。';paintPwa();return}
    if(!pwaHosted()){pwa.update='本地文件不检查线上版本。请从 HTTPS 部署入口使用安装与更新功能。';paintPwa();return}
    if(navigator.onLine===false){pwa.update='当前离线，保留现有版本；尚未核实线上是否有新版。';paintPwa();return}
    pwa.busy=true;pwa.pending=null;pwa.update='正在核验线上构建与页面完整性…';paintPwa();
    readRelease().then(function(release){
      var current=APP_VERSION.split('.').map(Number),remote=release.version.split('.').map(Number),direction=0;
      for(var index=0;index<3;index++){if(remote[index]!==current[index]){direction=remote[index]>current[index]?1:-1;break}}
      if(direction<0){pwa.update='服务器版本 v'+release.version+' 早于当前版本，暂不更新。';return}
      var same=release.build===APP_BUILD&&release.version===APP_VERSION;
      pwa.update=same?'当前页面已核验为最新版 v'+APP_VERSION+'。':'已核验 v'+release.version+'，正在准备完整离线包…';paintPwa();
      return registerPwa().then(function(reg){
        if(!reg){
          if(navigator.serviceWorker){pwa.update='线上页面已核验，但离线服务未就绪，请稍后重试。';return}
          if(!same){pwa.pending={release:release,ready:true,worker:null};pwa.update='已核验 v'+release.version+'。可保存后更新；此浏览器不支持离线安装。'}
          return;
        }
        return reg.update().then(function(){return readyWorker(reg,release.build)}).then(function(worker){
          if(!same||worker!==reg.active){pwa.pending={release:release,ready:true,worker:worker};pwa.update='v'+release.version+' 已准备好。点「保存并更新」生效，草稿和周测会先保存。'}
          return refreshOffline();
        }).catch(function(){pwa.update=same?'当前页面已核验为最新版；离线包尚未准备完成，请稍后重试。':'线上页面已核验，但离线包尚未准备完成，请稍后重试。'});
      });
    }).catch(function(){pwa.update='检查未完成：网络或发布资源校验失败。保留当前版本，请稍后重试。'}).then(function(){pwa.busy=false;paintPwa()});
  }
  async function applyUpdate(){
    if(!pwa.pending||!pwa.pending.ready||pwa.applying)return;
    if(!saveBeforeUpdate()){pwa.update='本地保存失败，更新已暂停。请先备份或释放存储空间后重试。';paintPwa();return}
    pwa.applying=true;
    try{await storage.flush()}catch(error){pwa.applying=false;pwa.update='本机文件保存失败，已暂停更新。请先导出备份后重试。';paintPwa();return}
    pwa.update='草稿与学习进度已保存，正在切换新版…';paintPwa();
    var pending=pwa.pending;
    async function reopen(){
      if(!saveBeforeUpdate()){pwa.applying=false;pwa.update='切换前保存失败，已保留当前页面，请先备份。';paintPwa();return}
      try{await storage.flush()}catch(error){pwa.applying=false;pwa.update='本机文件保存失败，更新已暂停。';paintPwa();return}
      var url=new URL(location.href);url.searchParams.set('sqltrain-build',pending.release.build);location.replace(url.href);
    }
    if(!pending.worker){if(navigator.onLine===false){pwa.applying=false;pwa.update='当前离线，请联网后再更新。';paintPwa();return}reopen();return}
    if(pwa.reg&&pwa.reg.active===pending.worker){reopen();return}
    var timer=setTimeout(function(){navigator.serviceWorker.removeEventListener('controllerchange',changed);pwa.applying=false;pwa.update='切换尚未完成，草稿已保存，可稍后重试。';paintPwa()},9000);
    function changed(){
      pwaStatus(navigator.serviceWorker.controller).then(function(status){
        if(status&&status.build===pending.release.build){clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',changed);reopen()}
      });
    }
    navigator.serviceWorker.addEventListener('controllerchange',changed);
    pending.worker.postMessage({type:'SQLTRAIN_APPLY',build:pending.release.build});
  }
  function installPwa(){
    if(!pwa.prompt)return;
    var prompt=pwa.prompt;pwa.prompt=null;paintPwa();
    Promise.resolve(prompt.prompt()).then(function(){return prompt.userChoice}).then(function(choice){
      if(choice&&choice.outcome==='accepted')stToast('已提交安装，请从 SQL Lab 图标继续学习。');
    }).catch(function(){stToast('未完成安装，可通过浏览器菜单重试。')});
  }
  function startPwa(){
    if(pwa.started)return;pwa.started=true;
    window.addEventListener('beforeinstallprompt',function(event){event.preventDefault();pwa.prompt=event;paintPwa()});
    window.addEventListener('appinstalled',function(){pwa.prompt=null;paintPwa()});
    window.addEventListener('online',function(){refreshOffline()});
    window.addEventListener('offline',function(){paintPwa()});
    if(!pwaHosted()){refreshOffline();return}
    [['manifest','manifest.webmanifest'],['apple-touch-icon','icons/icon-180.png'],['icon','icons/app.svg']].forEach(function(item){
      var link=document.createElement('link');link.rel=item[0];link.href=new URL(item[1],new URL('./',location.href)).href;document.head.appendChild(link);
    });
    if(navigator.serviceWorker)navigator.serviceWorker.addEventListener('controllerchange',function(){refreshOffline()});
    if(document.readyState==='complete')registerPwa();else window.addEventListener('load',registerPwa,{once:true});
  }

  return { pwa, pwaGuide, paintPwa, checkUpdate, applyUpdate, installPwa, startPwa };
}
