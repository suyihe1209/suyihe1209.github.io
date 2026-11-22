/* Browser regression suite for a local preview. Set MARKETLAB_URL and CHROME_PATH as needed. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const site = new URL(process.env.MARKETLAB_URL || 'http://127.0.0.1:8765');
const url = p => new URL(p, site).href;
const readRecords = p => p.evaluate(async () => (await window.openMarketLabRecords()).all());
const logs = [];
const shots = process.env.MARKETLAB_QA_SCREENSHOTS;
async function screenshot(page, name) {
  if (shots) await page.screenshot({path:path.join(shots, name + '.png')});
}
async function arena(p) {
  if(await p.locator('#arena-module').isHidden()) await p.locator('.ml-nav a[href="#arena"]').click();
}
async function ready(p) {
  await arena(p);
  await p.locator('#workbench').waitFor({state:'visible'});
  await p.waitForFunction(()=>document.querySelector('#cutoff').value);
}
async function savePrediction(p, prob, reason) {
  await p.locator('#probability').fill(String(prob));
  await p.locator('#reason').fill(reason);
  await p.locator('#lock').click();
  await p.locator('#results').waitFor({state:'visible'});
  assert(await p.locator('#probability').isDisabled());
}
async function run() {
  const browser = await chromium.launch({
    executablePath:process.env.CHROME_PATH || undefined, headless:true,
    args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-background-networking']
  });
  try {
    const ctx=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
    const p=await ctx.newPage();
    p.on('pageerror',e=>logs.push(e.message));
    await p.goto(url('/index.html'));
    await p.locator('a[href="marketlab/index.html"]').click();
    // This archived market fixes the dates for the original settlement regression.
    // The three current primary-market homepage entries are covered in regions_browser.cjs.
    await p.goto(url('/marketlab/index.html?market=TWSE%3A006207#arena'));
    await ready(p);
    assert.match(await p.locator('#ai-status').innerText(), /未配置/);
    await screenshot(p,'desk');
    const data=await p.evaluate(()=>window.MARKETLAB_DATA);
    const cutoff=await p.locator('#cutoff').inputValue();
    const barIndex=data.bars.findIndex(b=>b.date===cutoff);
    const outcome=Number(data.bars[barIndex+5].close>data.bars[barIndex].close);
    for (const period of [5,60,20]) {
      await p.locator('[data-range="'+period+'"]').click();
      const dates=await p.locator('#inspect-date option').evaluateAll(arr=>arr.map(e=>e.value));
      assert.equal(dates.length,period);assert(dates.every(d=>d<=cutoff));
      await p.locator('#inspect-date').selectOption(dates[0]);
      assert((await p.locator('#ohlcv').innerText()).includes('成交'));
    }
    assert(await p.locator('#results').isHidden());
    for(const invalid of ['-1','101','']) {
      await p.locator('#probability').fill(invalid);
      await p.locator('#lock').click();
      assert.equal((await readRecords(p)).length,0);
    }
    await savePrediction(p,0,'历史盲测边界与刷新验证');
    await p.locator('#reveal').click();
    await p.waitForFunction(()=>document.querySelector('#outcome').textContent.includes('第 5'));
    let records=await readRecords(p);assert.equal(records.length,1);
    const saved=records[0];
    assert.equal(saved.settlement.actual,outcome);
    assert.deepEqual(saved.settlement.days,data.bars.slice(barIndex+1,barIndex+6).map(b=>b.date));
    const r=await p.locator('#ranking').innerText();assert(r.includes('Brier'));
    const row=await p.locator('#ranking tr').filter({hasText:'你的预测'}).innerText();
    assert(row.includes((0-outcome)**2+'.0000'));
    await p.reload();await ready(p);
    assert.equal(await p.locator('#cutoff').inputValue(),cutoff);
    assert.equal(await p.locator('#reason').inputValue(),saved.reason);
    assert.deepEqual(await readRecords(p),records);
    await screenshot(p,'settled');
    await p.locator('#mode').selectOption('latest');
    await savePrediction(p,100,'前瞻跟踪，仅测本机证据');
    assert.match(await p.locator('#outcome').innerText(), /等待/);
    assert.equal((await readRecords(p)).find(r=>r.mode==='latest').settlement,null);
    const future=structuredClone(data);
    let latestDay=new Date(future.bars.at(-1).date+'T00:00:00Z');
    for (let i=0;i<5;i++) {
      do {latestDay.setUTCDate(latestDay.getUTCDate()+1);} while([0,6].includes(latestDay.getUTCDay()));
      const date=latestDay.toISOString().slice(0,10);
      future.bars.push({...future.bars.at(-1),date});
      future.forecasts.push({...future.forecasts.at(-1),date});
    }
    future.source.asOf=future.bars.at(-1).date;
    await p.route('**/marketlab/data/market.js',route=>route.fulfill({contentType:'text/javascript',body:'window.MARKETLAB_DATA='+JSON.stringify(future)+';'}));
    await p.reload();await ready(p);
    const late=(await readRecords(p)).find(r=>r.mode==='latest');
    assert(late.revealed);assert.equal(late.settlement.date,future.source.asOf);
    await p.reload();await ready(p);
    assert.deepEqual((await readRecords(p)).find(r=>r.mode==='latest'),late);
    await p.unroute('**/marketlab/data/market.js');
    console.log('Verified cutoff isolation, both probability endpoints, immutable records, five-session settlement, exact Brier, refresh and appended sessions.');

    // Simulated responses exercise the optional AI path without contacting any external provider.
    await p.route('**/api/marketlab/status',route=>route.fulfill({json:{configured:true}}));
    await p.reload();await ready(p);
    await p.waitForFunction(()=>document.querySelector('#ai-status').textContent.includes('已连接')||document.querySelector('#ai-status').textContent.includes('已封存'));
    await p.locator('#mode').selectOption('practice');
    await p.locator('#cutoff').selectOption({index:3});
    const aiCutoff=await p.locator('#cutoff').inputValue();
    await savePrediction(p,42.5,'AI 接口测试');
    await p.route('**/api/marketlab/analyze',route=>route.fulfill({json:{probability:'invalid'}}));
    await p.locator('#ai-run').click();
    await p.waitForFunction(()=>document.querySelector('#ai-status').textContent.includes('失败'));
    await p.unroute('**/api/marketlab/analyze');
    await p.route('**/api/marketlab/analyze',route=>route.fulfill({json:{probability:.55,model:'test',version:'test-1',cutoff:aiCutoff,predictedAt:new Date().toISOString(),reasoning:'测试返回',bullishFactors:['看涨测试'],bearishFactors:['看跌测试'],uncertainties:['不确定性测试']}}));
    await p.locator('#ai-run').click();
    await p.waitForFunction(()=>document.querySelector('#ai-detail').textContent.includes('看涨测试'));
    assert((await readRecords(p)).some(r=>r.ai?.version==='test-1'));

    for (const [body,expected] of [['window.MARKETLAB_DATA={bars:[]};','没有交易日'],['','尚未载入'],['window.MARKETLAB_DATA={schemaVersion:8,bars:[{}]};','格式']]) {
      await p.route('**/marketlab/data/market.js',route=>route.fulfill({contentType:'text/javascript',body}));
      await p.reload();
      await arena(p);
      await p.waitForFunction(s=>document.querySelector('#load').textContent.includes(s),expected);
      assert(await p.locator('#workbench').isHidden());
      await p.unroute('**/marketlab/data/market.js');
    }
    await ctx.close();
    const phone=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true,acceptDownloads:true});
    const m=await phone.newPage();m.on('pageerror',e=>logs.push(e.message));
    await m.goto(url('/tools.html'));
    for(const dest of ['matcher.html','weather.html','todo.html','marketlab/index.html']) assert.equal(await m.locator('main a[href="'+dest+'"]').count(),1);
    await m.waitForFunction(()=>document.querySelector('t800-companion').dataset.render==='3d');
    await m.locator('a[href="marketlab/index.html"]').tap();await ready(m);
    for(const w of [320,375,768]){
      await m.setViewportSize({width:w,height:812});
      assert(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile width '+w);
      await m.locator('[data-range="5"]').tap();
    }
    await m.setViewportSize({width:375,height:812});
    await screenshot(m,'phone');
    await m.locator('#probability').fill('64');
    await m.locator('#lock').tap();await m.locator('#reveal').tap();
    await m.locator('#ranking tr').filter({hasText:'你的预测'}).waitFor();
    await m.goto(url('/matcher.html'));await m.locator('#manualcard summary').tap();await m.locator('#msample').tap();await m.locator('#mgo').tap();
    assert((await m.locator('#result').innerText()).length>30);
    for(const [file,apk] of [['weather.html','shanshui-weather.apk'],['todo.html','todo.apk']]){
      await m.goto(url('/'+file));
      const [dl]=await Promise.all([m.waitForEvent('download'),m.locator('a[download]').tap()]);
      const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      assert.equal(hash(await dl.path()),hash(path.join(root,'downloads',apk)));await dl.delete();
    }
    assert.deepEqual(logs,[]);
    console.log('Verified browser error states, AI fixtures, mobile submission, T800, matcher, original APK downloads.');
  } finally {await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
