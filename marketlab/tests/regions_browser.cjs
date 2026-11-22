/* Exercise the three market routes, the frozen boundary and the source behind each run. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const checks={'CSI:000300':3983.77,'SP:SPX':7323.63,'NASDAQ:IXIC':24429.88};
(async()=>{
 const origin=process.env.MARKETLAB_URL||'http://127.0.0.1:8765',pure=process.env.MARKETLAB_PERSONAL_LOAD==='1';
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 try{
  const p=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(12000);
  await p.goto(origin+'/index.html');await p.locator('a[href="marketlab/index.html"]').click();
  for(const [id,close] of Object.entries(checks)){
    if(await p.locator('#market-picker').inputValue()!==id){await p.locator('#market-picker').selectOption(id);await p.waitForURL(u=>u.searchParams.get('market')===id);}
    if(pure){
      await p.locator('#missing-index:not([hidden])').waitFor();
      await p.locator('#acquire-index').click();
    }
    await p.waitForFunction(id=>window.MARKETLAB_DATA?.market?.id===id,id,{timeout:pure?90000:12000});
    const receipt=await p.evaluate(()=>{
      const d=MARKETLAB_DATA;
      return {id:d.market.id,close:d.bars.at(-1).close,end:d.bars.at(-1).date,dates:d.bars.map(x=>x.date),v:d.experiment.validationEnd,f:d.forecasts.at(-1).date,all:ML_ASSETS.assets.every(a=>a.rows.every(r=>r.date<='2026-11-18')),news:ML_ASSETS.news.every(n=>n.date<='2026-11-18')};
    });
    assert.equal(receipt.id,id);assert.equal(receipt.end,'2026-11-18');assert.equal(receipt.f,receipt.end);
    assert.equal(receipt.close,close);assert(receipt.v<receipt.end&&receipt.news&&receipt.all);assert(receipt.dates.length>=900);
    await p.locator('.ml-nav a[href="#arena"]').click();await p.locator('#mode').selectOption('latest');
    assert((await p.locator('#market-title').textContent()).includes(id==='CSI:000300'?'沪深':id==='SP:SPX'?'标普':'纳斯达克'));
    assert.equal(await p.locator('#cutoff').inputValue(),receipt.end);
    await p.locator('.ml-nav a[href="#quant"]').click();assert.equal(await p.locator('[name="market"]').inputValue(),id);
    await p.locator('.ml-nav a[href="#replay"]').click();await p.locator('[data-r="begin"]').click();
    assert((await p.locator('[data-r="day"]').textContent()).includes(id==='CSI:000300'?'沪深':id==='SP:SPX'?'标普':'纳斯达克'));
    await p.locator('.ml-nav a[href="#observe"]').click();assert.equal(await p.getByLabel('观察标的').inputValue(),id);
    await p.locator('.ml-nav a[href="#overview"]').click();
  }
  assert.equal(await p.locator('#overview-module .overview-indices a').count(),3);
  assert((await p.locator('#android-download').innerText()).includes('安卓版每日更新中美指数行情与官方公告，可用 AI 生成带有原文链接的研究简报。'));
  assert.deepEqual(errors,[]);console.log('三市场真实收盘、冻结日、逐日预测、回测、回放和观察入口通过。');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
