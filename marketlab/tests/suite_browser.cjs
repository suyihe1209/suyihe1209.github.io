/* Real, isolated browser workflow against a local MarketLab preview with AI unconfigured. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const origin=new URL(process.env.MARKETLAB_URL || 'http://127.0.0.1:8765').origin;
const routes=['observe','arena','quant','replay','macro','reports'];
const display={observe:'市场观察',arena:'预测擂台',quant:'量化研究',replay:'金融时光机',macro:'宏观沙盘',reports:'研究报告'};
const readRuns=(p,key)=>p.evaluate(k=>JSON.parse(localStorage.getItem('ml.'+k+'.runs.v1')||'[]'),key);
async function waits(p,key){
  await p.waitForFunction(k=>JSON.parse(localStorage.getItem('ml.'+k+'.runs.v1')||'[]').length>0,key);
  return (await readRuns(p,key))[0];
}
async function enter(p,id){
  // Visitors use the site's homepage followed by a workbench overview entry.
  await p.goto(origin+'/index.html');
  await p.locator('a[href="marketlab/index.html"]').click();
  const overview=p.locator('#overview-module');
  await overview.locator('.ml-grid').getByRole('link',{name:new RegExp(display[id])}).click();
  await p.locator('#'+id+'-module').waitFor({state:'visible'});
  assert.equal(new URL(p.url()).hash,'#'+id);
}
async function layout(p,id){
  const info=await p.evaluate(()=>({w:innerWidth,full:document.documentElement.scrollWidth,
    over:[...document.querySelectorAll('[data-page]:not([hidden]) button,[data-page]:not([hidden]) input')].filter(e=>{
      const b=e.getBoundingClientRect();
      if(!e.checkVisibility()||b.width===0||b.right<=innerWidth+1)return false;
      for(let parent=e.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
        if(['auto','scroll'].includes(getComputedStyle(parent).overflowX)&&parent.scrollWidth>parent.clientWidth)return false;
      }
      return true;
    }).map(e=>e.textContent||e.name||e.id)}));
  assert(info.full<=info.w+1,'horizontal overflow in '+id+': '+JSON.stringify(info));
  assert.deepEqual(info.over,[],id+' inaccessible controls');
}
async function saveReport(p,title,keys){
  const box=p.locator('#reports-module'), form=box.locator('[data-report=sources] select');
  await box.locator('[data-source=macro]').waitFor();
  for(const item of await form.all()){
    const key=await item.getAttribute('data-source');
    if(keys.includes(key)){
      assert(await item.locator('option').count()>1,'missing source '+key);
      await item.selectOption({index:1});
    }else await item.selectOption('');
  }
  await box.locator('[data-report=title]').fill(title);
  await box.locator('[data-report=create]').click();
  await box.locator('[data-report=preview]').getByRole('heading',{name:title,exact:true}).waitFor();
  return box;
}
async function exportFile(p,format){
  const waiting=p.waitForEvent('download');
  await p.locator('[data-report='+format+']').click();const dl=await waiting;
  assert(dl.suggestedFilename().endsWith('.'+format));
  const content=await fs.readFile(await dl.path(),'utf8');await dl.delete();
  return content;
}
async function shot(page,name){
  if(process.env.MARKETLAB_QA_SCREENSHOTS){
    await fs.mkdir(process.env.MARKETLAB_QA_SCREENSHOTS,{recursive:true});
    await page.screenshot({path:path.join(process.env.MARKETLAB_QA_SCREENSHOTS,name+'.png')});
  }
}
async function main(){
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,headless:true,
    args:['--disable-background-networking','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
  const errors=[];
  try{
    const ctx=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
    const p=await ctx.newPage();p.setDefaultTimeout(10000);
    p.on('pageerror',err=>errors.push(err.message));
    await enter(p,'observe');const obs=p.locator('#observe-module');
    await obs.getByLabel('观察标的').selectOption('CSI:000300');
    await obs.getByLabel('对照标的').selectOption('NASDAQ:IXIC');
    await obs.getByLabel('滚动窗口').selectOption('20');
    await obs.getByLabel('政策语气').selectOption('偏紧');
    assert(await obs.locator('svg').count()>0);
    await obs.getByRole('button',{name:'保存到实验记录'}).click();assert((await waits(p,'observe')).id);
    await layout(p,'observe');
    await enter(p,'arena');await p.waitForFunction(()=>document.querySelector('#ai-status').textContent.includes('未配置'));
    await p.locator('#probability').fill('53');await p.locator('#reason').fill('真实数据端到端测试');
    await p.locator('#lock').click();await p.locator('#reveal').click();
    await p.waitForFunction(()=>document.querySelector('#outcome').textContent.includes('第 5'));
    assert.equal((await p.evaluate(async()=>(await openMarketLabRecords()).all()))[0].userProbability,.53);
    await layout(p,'arena');
    await enter(p,'quant');const q=p.locator('#quant-module');
    await q.locator('[name=market]').selectOption('NASDAQ:IXIC');
    await q.locator('[name=model]').selectOption('forest');await q.locator('[name=strategy]').selectOption('model');
    await q.getByRole('button',{name:'运行并保存实验'}).click();const quant=await waits(p,'quant');
    assert.equal(quant.config.model,'forest');assert(quant.samples.validation>0&&quant.curves.length>0);
    assert(quant.trades.every(t=>t.signalDate<t.date));
    await q.getByRole('button',{name:'查看结果'}).click();await q.locator('.q-output svg').waitFor();
    await layout(p,'quant');await shot(p,'quant');
    await enter(p,'replay');const rp=p.locator('#replay-module'), ctrl=n=>rp.locator('[data-r='+n+']');
    await ctrl('length').fill('4');await ctrl('begin').click();
    const day=await ctrl('day').innerText();
    await ctrl('quantity').fill('2');await ctrl('order').click();
    assert((await ctrl('pending').innerText()).includes('待下一交易日'));
    await ctrl('step').click();assert.notEqual(await ctrl('day').innerText(),day);
    await ctrl('side').selectOption('sell');await ctrl('quantity').fill('1');await ctrl('order').click();await ctrl('step').click();
    p.once('dialog',d=>d.accept());await ctrl('finish').click();
    const replay=await waits(p,'replay');assert.equal(replay.trades.length,2);assert(replay.curves.length>=2);
    await ctrl('summary').waitFor();await layout(p,'replay');
    await enter(p,'macro');const m=p.locator('#macro-module');await m.getByLabel('情景 B 预设').selectOption({index:0});
    const slider=m.locator('#macro-B-rate');await slider.focus();await slider.press('ArrowRight');
    await m.locator('#macro-save').click();const macro=await waits(p,'macro');assert(macro.config.A&&macro.config.B);
    await layout(p,'macro');
    await enter(p,'reports');
    const full='六项综合回归验收';const all=['validation','prediction','observe','quant','replay','macro'];
    await saveReport(p,full,all);const exported=JSON.parse(await exportFile(p,'json'));
    assert.equal(exported.title,full);assert.equal(exported.sections.length,6);assert.equal(exported.ai,null);
    const html=await exportFile(p,'html');assert(html.includes(full)&&html.includes('<svg'));assert(!/<script\b/i.test(html));
    assert(await p.locator('[data-report=ai]').isHidden());
    const only='只含宏观的情景研究';await saveReport(p,only,['macro']);
    const preview=p.locator('[data-report=preview]');
    assert.equal(await preview.locator('article > section').count(),1);
    assert(await preview.locator('svg').count()>0,'macro-only report missing its chart');
    const macroPayload=JSON.parse(await exportFile(p,'json'));
    assert.equal(macroPayload.sections.length,1);
    assert((await exportFile(p,'html')).includes('<svg'),'macro-only HTML missing chart');
    await p.reload();await preview.getByRole('heading',{name:only,exact:true}).waitFor();
    const archive=p.locator('[data-report=archive]');await archive.selectOption(exported.id);
    await preview.getByRole('heading',{name:full,exact:true}).waitFor();
    assert.equal((JSON.parse(await exportFile(p,'json'))).id,exported.id);
    await layout(p,'reports');await shot(p,'report');
    // There are six distinct nonempty sections, including dense observation notes.
    const riskPattern=[/重叠|不能/,/不能代表|不确定/,/收盘时间不同|不能|因果/,/重叠|校准/,/不含|不包含|估值/,/假设|条件|因果/];
    for(const [i,section] of exported.sections.entries()){
      assert(exported.facts.some(f=>f.text.startsWith(section.title+' · ')), 'omitted section facts '+section.title);
      const risks=exported.risks.filter(r=>r.text.startsWith(section.title+' · '));
      assert(risks.some(r=>riskPattern[i].test(r.text)),'omitted substantive limitation '+section.title);
    }
    assert(exported.risks.every(r=>!r.text.includes('http')));
    const observation=exported.sections.find(s=>s.title.startsWith('市场观察'));
    assert(observation.tables.some(t=>t.title==='入选政策新闻'&&t.rows.length));
    assert(observation.sources.some(s=>s.includes('http')));
    assert(observation.notes.every(s=>!s.includes('http')));
    // Real close-only market: direction model is valid, fictional OHLC trades are forbidden.
    await enter(p,'quant');
    await q.locator('[name=market]').selectOption('FED:USDCNY');
    await q.getByRole('button',{name:'运行并保存实验'}).click();
    await p.waitForFunction(()=>JSON.parse(localStorage.getItem('ml.quant.runs.v1')).some(r=>r.marketId==='FED:USDCNY'));
    await enter(p,'reports');
    await saveReport(p,'只有收盘价的量化研究',['quant']);
    const limited=JSON.parse(await exportFile(p,'json')), sec=limited.sections[0];
    assert.equal(sec.raw.marketId,'FED:USDCNY');assert.equal(sec.raw.trades.length,0);
    const series=sec.plots.find(g=>g.label.includes('上涨概率')).series;
    assert.equal(series.length,2);assert.equal(series[0].points.length,sec.raw.predictions.length);
    assert.equal(series[0].points[0].y,100*sec.raw.predictions[0].probability);
    assert.equal(series[1].points[0].y,100*sec.raw.metrics.baselineProbability);
    assert((await exportFile(p,'html')).includes('<svg'));
    // Simulate successful AI + failed persistence on a browser-only origin; no external AI call.
    let received;
    await p.route('**/api/marketlab/status',route=>route.fulfill({json:{configured:true}}));
    await p.route('**/api/marketlab/report',route=>{
      received=route.request().postDataJSON();
      return route.fulfill({json:{model:'验收',version:'fixture',generatedAt:new Date().toISOString(),
        summaryIds:[received.facts[0].id],riskIds:[received.risks[0].id]}});
    });
    await p.reload();await p.locator('[data-source=macro]').waitFor();await archive.selectOption(exported.id);
    await p.evaluate(()=>{
      const original=IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction=function(name,mode,...rest){
        if(name==='reports'&&mode==='readwrite')throw new DOMException('QA storage is full','QuotaExceededError');
        return original.call(this,name,mode,...rest);
      };
    });
    await p.locator('[data-report=ai]').click();
    await p.waitForFunction(()=>document.querySelector('[data-report=status]').textContent.includes('请在离开前导出'));
    await preview.getByRole('heading',{name:'AI 研究提要',exact:true}).waitFor();
    assert(Buffer.byteLength(JSON.stringify(received),'utf8')<65536);
    assert.equal(received.facts.length,48);
    for(const s of exported.sections){
      assert(received.facts.some(f=>f.text.startsWith(s.title+' · ')));
      assert(received.risks.some(r=>r.text.startsWith(s.title+' · ')));
    }
    const memoryCopy=JSON.parse(await exportFile(p,'json'));
    assert.equal(memoryCopy.id,exported.id);assert.equal(memoryCopy.ai.version,'fixture');
    assert.deepEqual(memoryCopy.facts,received.facts);assert.deepEqual(memoryCopy.risks,received.risks);
    assert((await exportFile(p,'html')).includes('AI 研究提要'));

    console.log('Desktop: six homepage journeys, saved evidence from five modules, integrated and macro-only reports, exports and persistent reload passed.');
    await ctx.close();
    const mobile=await browser.newContext({viewport:{width:375,height:812},hasTouch:true,isMobile:true});
    const phone=await mobile.newPage();phone.setDefaultTimeout(10000);phone.on('pageerror',err=>errors.push(err.message));
    await phone.goto(origin+'/index.html');await phone.locator('a[href="marketlab/index.html"]').tap();
    for(const width of [320,375,768]){
      await phone.setViewportSize({width,height:812});
      for(const id of routes){
        await phone.locator('.ml-nav a[href="#'+id+'"]').tap();
        const panel=phone.locator('#'+id+'-module');await panel.waitFor({state:'visible'});
        await layout(phone,id);
      }
    }
    await phone.setViewportSize({width:375,height:812});await phone.locator('.ml-nav a[href="#quant"]').tap();
    await phone.getByRole('button',{name:'运行并保存实验'}).tap();await waits(phone,'quant');await layout(phone,'quant result');await shot(phone,'quant-phone');
    await phone.locator('.ml-nav a[href="#reports"]').tap();
    await saveReport(phone,'手机端量化报告',['quant']);await layout(phone,'report result');await shot(phone,'report-phone');
    assert.deepEqual(errors,[]);await mobile.close();
    console.log('Mobile: six sections at 320/375/768 px, touch submission, saved quant run and generated report passed.');
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
