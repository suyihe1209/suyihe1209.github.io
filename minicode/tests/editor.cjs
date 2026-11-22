/** Phone-sized Chromium, exercising the editor through its own menus and dialogs. */
const fs=require('node:fs/promises'), path=require('node:path'), assert=require('node:assert/strict');
const {chromium}=require('playwright');
const original=process.env.MINICODE_BASELINE==='1';
const source=process.argv[2]||path.join(__dirname,'..','mini-code-editor.html');
const KEY='mini-code-editor-v1';
async function run(){
 const html=await fs.readFile(source,'utf8'),browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
 try{
  const ctx=await browser.newContext({viewport:{width:390,height:780},isMobile:true,hasTouch:true});
  await ctx.route('https://minicode.test/**',r=>r.fulfill({contentType:'text/html;charset=utf-8',body:html}));
  const p=await ctx.newPage();p.setDefaultTimeout(4500);const errors=[];p.on('pageerror',e=>errors.push(e.message));
  const active=()=>p.locator('#tabs .active .tname').innerText();
  const command=async q=>{await p.locator('#btnPalette').tap();await p.locator('#paletteInput').fill(q);await p.locator('#paletteList .p-item').first().tap();};
  const modal=async v=>{if(v!==undefined)await p.locator('#modalInput').fill(v);await p.locator('#modalOk').tap();};
  const newFile=async name=>{await command('新建文件');await modal(name);};
  const open=async name=>{await command(name);assert.equal(await active(),name);};
  const editor=p.locator('#ta');
  await p.goto('https://minicode.test/editor');await newFile('records.c');await editor.fill('int first = 1;\nint second = 2;\n');await p.locator('#btnSave').tap();
  await newFile('blank.c');await p.locator('#btnSave').tap();await p.reload();
  const lost=await active()!=='blank.c';assert.equal(lost,original,'active empty file after restart');
  await open('records.c');await command('重命名当前文件');await modal('two.c');assert.match(await editor.inputValue(),/second/);
  await p.locator('#btnSave').tap();await p.reload();assert.equal(await active(),'two.c');
  await p.locator('#abFiles').tap();await p.locator('#fileList .file').filter({hasText:'blank.c'}).locator('.del').tap();await modal();
  await p.locator('#fileList .file').filter({hasText:'two.c'}).tap();assert.equal(await active(),'two.c');
  await p.keyboard.press('Control+h');await p.locator('#findInput').fill('int');assert.equal(await p.locator('#findCount').innerText(),'1/2');
  await p.locator('#findNext').tap();assert.equal(await p.locator('#findCount').innerText(),'2/2');await p.locator('#replaceInput').fill('long');await p.locator('#replaceOne').tap();
  assert.match(await editor.inputValue(),/^int first[\s\S]*long second/);await p.locator('#findClose').tap();
  await open('main.js');await editor.fill('User edit to the sample.');await p.locator('#btnMenu').tap();await p.locator('#btnReset').tap();
  const blocked=await p.locator('#modalOk').evaluate(b=>{const r=b.getBoundingClientRect();return !b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
  assert.equal(blocked,original,'settings sheet must allow tapping its dialog');
  if(blocked){await p.locator('#modalOk').focus();await p.keyboard.press('Enter');}else await modal();
  const resetLost=(await editor.inputValue())==='User edit to the sample.';assert.equal(resetLost,original,'restore same active example');
  await p.keyboard.press('Escape');await editor.fill('unsaved-work');
  // Induce the normal storage-quota failure deterministically without filling a device.
  await p.evaluate(()=>{window.workingSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError');};});
  await p.locator('#btnSave').tap();const msg=await p.locator('#toast').innerText();assert.equal(msg.includes('已保存到本机'),original,'storage failure must not be shown as success');
  if(!original){
   assert.equal(await p.locator('#statusSaveText').innerText(),'未保存');
   await p.keyboard.press('Control+s');assert.match(await p.locator('#toast').innerText(),/保存失败/);
   await command('保存当前文件');assert.match(await p.locator('#toast').innerText(),/保存失败/);
  }
  await p.evaluate(()=>{Storage.prototype.setItem=window.workingSet;});await p.locator('#btnSave').tap();await p.reload();assert.equal(await editor.inputValue(),'unsaved-work');
  console.log('Empty current tab lost at relaunch:',lost,'| active sample restore ignored:',resetLost,'| save failure told user:',msg);
  if(!original){
   await open('two.c');await command('转到行');await modal('2:3');assert.equal(await p.locator('#statusPos').innerText(),'行 2, 列 3');
   await p.locator('#ta').press('Control+g');await modal('500:90');assert.match(await p.locator('#statusPos').innerText(),/^行 3, 列 1$/);
   const d=await p.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
   assert(!Object.hasOwn(d.files,'records.c'));assert(!Object.hasOwn(d.files,'blank.c'));assert.equal(d.files['main.js'],'unsaved-work');
   assert.deepEqual(errors,[]);
  }
  await ctx.close();
 }finally{await browser.close();}
}
run().catch(err=>{console.error(err);process.exitCode=1;});
