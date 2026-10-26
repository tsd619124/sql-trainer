// playwright-cli run-code 用例；Gist/LeanCloud 请求只访问拦截的虚拟服务。
async (page) => {
  const checks=[], errors=[], consoleMessages=[], contexts=[];
  const origin=new URL(page.url()).origin, browser=page.context().browser();
  const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
  const stored=p=>p.evaluate(()=>JSON.parse(localStorage.getItem('sqltrain_state')||'null'));
  const ready=p=>p.waitForFunction(()=>document.querySelector('#st-engine-text')?.textContent==='练习库就绪');
  const openQ=async(p,id)=>{
    await p.locator('#tab-train').click();await p.locator('#st-train-seg [data-sub="practice"]').click();
    await p.locator('#panel-practice [data-act="open-q"][data-qid="'+id+'"]').first().click();
  };
  const sync=async p=>{
    await p.locator('#tab-me').click();
    await p.locator('#panel-me summary').filter({hasText:'云同步'}).first().click();
    await p.locator('[data-act="sync-now"]').click();
    await p.waitForFunction(()=>/^(已同步|同步失败|云端数据解密失败)/.test(document.querySelector('#st-sync-status').textContent));
    const status=await p.locator('#st-sync-status').innerText();
    assert(status.startsWith('已同步'),'同步失败：'+status);
  };
  const legacy={v:1,done:{},wrong:{q1:1},notes:{q1:'旧笔记'},attempts:{q1:1},
    sr:{q1:{due:'2026-10-26',iv:1,rep:1,ef:2.5,lapse:0}},savedAt:100};
  try {
    for(const provider of ['gist','lc']) {
      const server={payload:JSON.stringify(legacy),writes:0,hold:false,held:null,release:null};
      const mockBase=provider==='gist'?'https://api.github.com':'https://sql-reliability-test.lcloud.cn';
      const makeDevice=async suffix=>{
        const ctx=await browser.newContext({serviceWorkers:'block'});contexts.push(ctx);
        await ctx.route(mockBase+'/**',async route=>{
          const req=route.request(), method=req.method();
          if(method==='OPTIONS'){await route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'}});return;}
          if(method==='GET') {
            const body=provider==='gist'?{files:{'sync.json':{content:server.payload}}}:{results:[{objectId:'mock-progress',payload:server.payload}]};
            await route.fulfill({json:body,headers:{'Access-Control-Allow-Origin':'*'}});return;
          }
          const data=req.postDataJSON();
          const payload=provider==='gist'?data.files['sync.json'].content:data.payload;
          if(server.hold) {
            server.hold=false;server.held=payload;
            await new Promise(resolve=>{server.release=resolve;});
          }
          server.payload=payload;server.writes++;
          await route.fulfill({json:{id:'mock-gist',objectId:'mock-progress'},headers:{'Access-Control-Allow-Origin':'*'}});
        });
        const p=await ctx.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));
        p.on('console',message=>{
          // 同步用例主动屏蔽 Service Worker，确保虚拟云请求全部进入 route。
          if(message.type()==='warning'&&message.text()==='Service Worker registration blocked by Playwright')return;
          if(['warning','error'].includes(message.type()))consoleMessages.push(message.type()+': '+message.text());
        });
        await p.addInitScript(({provider,suffix,legacy,mockBase})=>{
          if(localStorage.getItem('sqltrain_device'))return;
          localStorage.setItem('sqltrain_device','test-device-'+provider+'-'+suffix);
          localStorage.setItem('sqltrain_state',JSON.stringify(legacy));
          localStorage.setItem('sqltrain_sync',JSON.stringify({provider,token:'synthetic-token-for-tests-only',code:'synthetic-sync-code-only',
            gistId:'mock-gist',gistApi:mockBase,base:mockBase,appId:'synthetic-app',appKey:'synthetic-key',enc:true}));
        },{provider,suffix,legacy,mockBase});
        await p.goto(origin);await ready(p);return p;
      };
      const a=await makeDevice('a');await sync(a);
      const b=await makeDevice('b');await sync(b);
      await openQ(a,'q1');await a.locator('#st-note').fill('设备 A 新笔记');await sync(a);
      await sync(b);await openQ(b,'q1');
      assert(await b.locator('#st-note').inputValue()==='设备 A 新笔记',provider+' 未拉到 A 笔记');
      await b.locator('#st-note').fill('设备 B 更新笔记');await sync(b);
      await openQ(a,'q1');await a.reload();await ready(a);
      await a.waitForFunction(()=>document.querySelector('#st-note')?.value==='设备 B 更新笔记');
      checks.push(provider+'：两设备先改推送再拉取，笔记按修订更新且显示刷新');
      await a.locator('#st-note').fill('');
      await a.locator('#tab-exam').click();await a.locator('#st-exam-seg [data-sub="wrong"]').click();
      await a.locator('[data-act="wrong-del"][data-qid="q1"]').click();await sync(a);
      await sync(b);
      let s=await stored(b);
      assert(!s.notes.q1&&!s.wrong.q1&&s._sync.records.notes.q1.deleted&&s._sync.records.wrong.q1.deleted,provider+' 未合并删除标记');
      server.payload=JSON.stringify(legacy);await sync(b);
      s=await stored(b);assert(!s.notes.q1&&!s.wrong.q1,provider+' 旧数据复活');
      checks.push(provider+'：笔记清空和错题删除在旧云数据重现后仍生效');
      const remote=await stored(b);
      const revisions=Object.values(remote._sync.records).flatMap(records=>Object.values(records).map(r=>r.t));
      const t=Math.max(Date.now(),remote.savedAt,...revisions)+10;
      remote.attempts.q1=9;remote.sr.q1={due:'2026-11-01',iv:6,rep:3,ef:2.5,lapse:1};
      remote._sync.records.attempts.q1={t,d:'synthetic-remote'};remote._sync.records.sr.q1={t,d:'synthetic-remote'};
      remote.savedAt=t;server.payload=JSON.stringify(remote);
      await sync(a);await a.reload();await ready(a);
      s=await stored(a);assert(s.attempts.q1===9&&s.sr.q1.due==='2026-11-01',provider+' 仅 attempts/sr 改动没有持久化');
      checks.push(provider+'：仅尝试次数和复习安排变化可以同步并刷新保留');
      await sync(a);const before=await stored(a),writesBefore=server.writes;
      server.payload='{"v":1,"done":[],"wrong":{"q1":99}}';
      await a.locator('[data-act="sync-now"]').click();
      await a.waitForFunction(()=>document.querySelector('#st-sync-status').textContent.startsWith('同步失败'));
      assert(server.writes===writesBefore,provider+' 无效云数据被覆盖上传');
      assert(JSON.stringify(await stored(a))===JSON.stringify(before),provider+' 无效云数据污染本机');
      server.payload='';await a.locator('[data-act="sync-now"]').click();
      await a.waitForFunction(()=>document.querySelector('#st-sync-status').textContent.startsWith('同步失败'));
      assert(server.writes===writesBefore,provider+' 空云数据被覆盖上传');
      checks.push(provider+'：无效和空云载荷均停止上传且本机不变');
      server.payload=JSON.stringify(before);
      server.hold=true;
      await a.locator('[data-act="sync-now"]').click();
      for(let i=0;i<50&&!server.release;i++)await new Promise(resolve=>setTimeout(resolve,100));
      assert(server.release,provider+' 未进入同步中测试');
      await openQ(a,'q1');await a.locator('#st-note').fill('同步进行中写下的新笔记');
      const writesDuring=server.writes;server.release();server.release=null;
      for(let i=0;i<100&&server.writes<writesDuring+2;i++)await new Promise(resolve=>setTimeout(resolve,100));
      assert(server.writes>=writesDuring+2,provider+' 同步中修改未补推');
      await sync(b);s=await stored(b);assert(s.notes.q1==='同步进行中写下的新笔记',provider+' 补推丢笔记');
      const encrypted=JSON.parse(server.payload);
      assert(encrypted.enc==='AES-GCM'&&typeof encrypted.data==='string',provider+' 未真实加密上传');
      checks.push(provider+'：同步中修改自动补推，加密上传后另一设备可解密读取');
      await a.context().close();await b.context().close();
    }
    assert(!errors.length,'浏览器脚本报错：'+errors.join('; '));
    assert(!consoleMessages.length,'浏览器控制台错误或警告：'+consoleMessages.join('; '));
    return {ok:true,checks,errors,consoleMessages};
  }catch(e){return {ok:false,checks,failure:e.message,errors,consoleMessages};}
  finally {for(const ctx of contexts)await ctx.close().catch(()=>{});}
}
