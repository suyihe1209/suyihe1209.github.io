/** Integrates the engine with the real mobile editor and an offline, intercepted model endpoint. */
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');
const app='https://editor.test', model='https://model.test/v1/chat/completions';
async function main(){
  const html = await fs.readFile(process.argv[2] || path.join(root,'mini-code-editor.html'),'utf8');
  const b=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined});
  try{
    for(const native of [false,true]){
      const ctx=await b.newContext({viewport:{width:390,height:780},hasTouch:true,isMobile:true});
      const posts=[],responses=[],blocked=[];
      await ctx.route('**/*',async r=>{
        const req=r.request();
        if(req.url()===app+'/') return r.fulfill({contentType:'text/html;charset=utf-8',body:html});
        if(req.url()===model){
          const cors={'Access-Control-Allow-Origin':app,'Access-Control-Allow-Headers':'authorization, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
          if(req.method()==='OPTIONS') return r.fulfill({status:204,headers:cors});
          assert.equal(req.method(),'POST');
          assert.equal(await req.headerValue('authorization'),'Bearer locally-generated-test-key');
          posts.push(req.postDataJSON());
          return r.fulfill({status:200,headers:cors,contentType:'application/json',body:JSON.stringify({
            choices:[{message:{content:'预计输出 42；依据 main.js:2。',reasoning_content:'PRIVATE THOUGHT'}}]})});
        }
        blocked.push(req.url());return r.abort();
      });
      await ctx.addInitScript(({native})=>{
        window.mockNative=[];
        if(native)window.AndroidBridge={aiComplete:(id,url,key,body)=>window.mockNative.push({id,url,body:JSON.parse(body)}),
          cancelAI:()=>{}};
      },{native});
      const p=await ctx.newPage();
      const errors=[];
      p.on('pageerror',e=>errors.push(e.message));
      await p.goto(app+'/');
      await p.evaluate(({model})=>{
        window.mockConfig={key:'',url:model,model:'test-model',on:true};
        window.MiniCodeModelConfig={get:()=>window.mockConfig};
      },{model});
      await p.locator('#btnPalette').tap();
      await p.locator('#paletteInput').fill('main.js');
      await p.locator('#paletteList .p-item').first().tap();
      await p.locator('#ta').fill('let n = 40;\nconsole.log(n+2);');
      const send=(q,names)=>p.evaluate(({q,names})=>window.MiniCodeSimulation.send({question:q,fileNames:names}),{q,names});
      const state=()=>p.evaluate(()=>window.MiniCodeSimulation.getState());
      assert.equal(await send('输出什么？'),false);assert.equal((await state()).errorCode,'config');
      assert.equal(posts.length,0);
      await p.evaluate(()=>{window.mockConfig.key='locally-generated-test-key';});
      assert(await send('输出什么？',['main.js','hello.py']));
      if(native){
        const req=await p.evaluate(()=>window.mockNative[0]);
        assert.equal(req.url,model);responses.push(req.body);
        await p.evaluate(id=>window.__aiDone(id,200,JSON.stringify({choices:[{message:{content:'预计输出 42；依据 main.js:2。',reasoning_content:'PRIVATE THOUGHT'}}]})),req.id);
      } else await p.waitForFunction(()=>!window.MiniCodeSimulation.getState().busy);
      const last=(await state()).messages.at(-1);
      assert.equal(last.role,'assistant');assert.match(last.text,/42/);assert.match(last.text,/模拟推演/);assert.doesNotMatch(last.text,/PRIVATE/);
      const payload=native?responses[0]:posts[0];
      const files=JSON.parse(payload.messages.at(-1).content).files;
      assert.deepEqual(files.map(f=>f.name),['main.js','hello.py']);
      assert.equal(files[0].numberedSource,'1 | let n = 40;\n2 | console.log(n+2);');
      assert(!JSON.stringify(payload).includes('locally-generated-test-key'));
      assert.deepEqual(errors,[]);assert.deepEqual(blocked.filter(v=>!v.endsWith('/favicon.ico')),[]);
      console.log(native?'Android bridge dispatch on real editor page passed':'Direct browser POST with only selected editable files passed');
      await ctx.close();
    }
  }finally{await b.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
