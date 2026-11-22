/* Browser QA for the packaged WebView, using a private, real three-market cache. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const [assets,cache,shots]=process.argv.slice(2);
if(!assets||!cache)throw Error('Pass the generated assets folder, a private Android dashboard JSON, and an optional screenshot folder.');
const keys=['observe','arena','quant','replay','macro','reports'];
const origin='https://appassets.androidplatform.net';
async function main(){
  const d=JSON.parse(await fs.readFile(cache,'utf8')),markets=d.markets.map(m=>({id:m.id,rows:m.bars,source:{name:m.source,url:m.url,asOf:m.date,updatedAt:m.fetchedAt,license:'个人研究缓存'}}));
  assert.equal(markets.length,3);assert(markets.every(m=>m.rows.length>=85));
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined,args:['--disable-background-networking']});
  try{
    const context=await browser.newContext({viewport:{width:393,height:744},isMobile:true,hasTouch:true});
    await context.addInitScript(()=>{window.MarketLabExport={save:(name,text)=>{window.savedDoc={name,text};}};});
    await context.route('**/*',async r=>{
      const u=new URL(r.request().url());if(u.origin!==origin)return r.abort();
      if(u.pathname==='/site/marketlab/markets/local.js')return r.fulfill({contentType:'application/javascript',body:'window.ML_ANDROID=true;window.ML_DEVICE_BARS='+JSON.stringify(markets)+';window.ML_LOCAL_MARKETS=[];window.ML_DEVICE_NEWS=[];'});
      if(u.pathname.startsWith('/api/'))return r.fulfill({json:{configured:false}});
      const file=path.join(assets,decodeURIComponent(u.pathname));
      try{await r.fulfill({path:file});}catch{await r.fulfill({status:404,body:''});}
    });
    const p=await context.newPage();p.setDefaultTimeout(12000);const errors=[];
    p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
    const top=p.locator('#overview-module');const back=async()=>{await p.locator('.night-crumb a').tap();await top.locator('.ml-grid a').first().waitFor();};
    async function enter(key){await top.locator('.ml-grid a[href="#'+key+'"]').tap();await p.locator('#'+key+'-module').waitFor({state:'visible'});}
    async function layout(label){const x=await p.evaluate(()=>({w:innerWidth,v:document.documentElement.scrollWidth}));assert(x.v<=x.w+1,label+' overflow '+JSON.stringify(x));}
    async function shot(n){if(!shots)return;await fs.mkdir(shots,{recursive:true});await p.screenshot({path:path.join(shots,n+'.png')});}
    await p.goto(origin+'/site/marketlab/index.html');await top.locator('[data-night-icon=reports]').waitFor();
    assert.equal(await top.locator('.ml-grid a').count(),6);
    const marketsBox=p.locator('.night-market-options');await marketsBox.locator('button').last().tap();
    await top.locator('[data-night-icon=observe]').waitFor();assert((await p.locator('#night-market-name').innerText()).includes('纳斯达克'));
    await marketsBox.locator('button').first().tap();await top.locator('[data-night-icon=observe]').waitFor();
    await layout('overview');await shot('overview');
    for(const k of keys){await enter(k);await layout(k);await back();}
    await enter('observe');await p.getByRole('button',{name:'保存到实验记录'}).tap();await shot('observe');await back();
    await enter('arena');await p.locator('#probability').fill('54');await p.locator('#lock').tap();await p.locator('#reveal').tap();await p.locator('#outcome').filter({hasText:'第 5'}).waitFor();await back();
    await enter('quant');await p.locator('#quant-module [name=model]').selectOption('forest');await p.getByRole('button',{name:'运行并保存实验'}).tap();
    await p.locator('.q-output svg').waitFor();await layout('quant output');await p.locator('.q-output svg').scrollIntoViewIfNeeded();await shot('quant');await back();
    await enter('replay');await p.locator('[data-r=length]').fill('4');await p.locator('[data-r=begin]').tap();await p.locator('[data-r=step]').tap();await p.locator('[data-r=finish]').tap();await p.locator('[data-r=summary]').waitFor();await back();
    await enter('macro');await p.locator('#macro-B-rate').focus();await p.keyboard.press('ArrowRight');await p.locator('#macro-save').tap();await back();
    await enter('reports');const title='夜读纪要 · 实验复核';await p.locator('[data-report=title]').fill(title);
    for(const s of await p.locator('[data-report=sources] select').all()){if(await s.locator('option').count()>1)await s.selectOption({index:1});}
    await p.locator('[data-report=create]').tap();await p.locator('[data-report=preview]').getByRole('heading',{name:title,exact:true}).waitFor();
    await p.locator('[data-report=html]').tap();await p.waitForFunction(()=>window.savedDoc?.name.endsWith('.html'));const html=await p.evaluate(()=>window.savedDoc.text);
    assert(html.includes('--paper:#201923')&&html.includes('@media print')&&html.includes(title)&&html.includes('<svg'));
    await p.locator('[data-report=json]').tap();await p.waitForFunction(()=>window.savedDoc?.name.endsWith('.json'));assert.equal((await p.evaluate(()=>JSON.parse(window.savedDoc.text))).sections.length,6);
    await p.locator('[data-report=preview] h2').first().scrollIntoViewIfNeeded();await shot('report');
    for(const w of [320,360,430,820]){
      await p.setViewportSize({width:w,height:760});await layout('report '+w);await back();
      for(const key of keys){await enter(key);await layout(key+' '+w);await back();}
      await enter('reports');
    }
    const cold=await browser.newContext({viewport:{width:360,height:660},isMobile:true,hasTouch:true});
    await cold.route('**/*',async r=>{
      const u=new URL(r.request().url());
      if(u.origin!==origin)return r.abort();
      if(u.pathname==='/site/marketlab/markets/local.js')return r.fulfill({contentType:'application/javascript',body:'window.ML_ANDROID=true;window.ML_LOCAL_MARKETS=[];window.ML_DEVICE_BARS=[];window.ML_DEVICE_NEWS=[];'});
      if(u.pathname.startsWith('/api/'))return r.fulfill({json:{configured:false}});
      try{await r.fulfill({path:path.join(assets,decodeURIComponent(u.pathname))});}catch{await r.fulfill({status:404,body:''});}
    });
    const empty=await cold.newPage();empty.on('pageerror',e=>errors.push(e.message));await empty.goto(origin+'/site/marketlab/index.html');
    await empty.locator('#overview-module [data-night-icon=reports]').waitFor();
    assert.match(await empty.locator('#night-date').innerText(),/待载入/);assert(await empty.locator('#missing-index').isVisible());
    await empty.locator('#overview-module [data-night-icon=macro]').tap();await empty.locator('#macro-save').waitFor();
    assert.equal(await empty.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await cold.close();
    assert.deepEqual(errors,[]);
    console.log('PASS — three real markets, six modules at 320/360/393/430/820px, five saved experiment types, six-section HTML + JSON via Android export bridge, fresh install without cached prices, no page errors.');
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
