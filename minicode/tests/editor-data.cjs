/** Offline, touch-enabled browser checks. Native dialogs and AI replies are simulated. */
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const KEY = 'mini-code-editor-v1';
const url = 'https://minicode.test/editor';
const old = process.env.MINICODE_BASELINE === '1';
const locallyConfigured = {aiKey:'demo-phone-key', aiUrl:'https://example.test/chat/completions', aiModel:'phone-model'};

async function main(){
  const source = process.argv[2] || path.join(__dirname,'..','mini-code-editor.html');
  const html = await fs.readFile(source,'utf8');
  const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || undefined});
  const context = await browser.newContext({viewport:{width:390,height:780},isMobile:true,hasTouch:true});
  try {
    await context.route(url, route=>route.fulfill({contentType:'text/html; charset=utf-8',body:html}));
    await context.addInitScript(({KEY,locallyConfigured})=>{
      if (!sessionStorage.getItem('prepared')) {
        localStorage.setItem(KEY, JSON.stringify({
          files:{'first.js':'let before = 1;','second.js':'Keep second','empty.js':'','orphan.md':'Old note'},
          open:['missing','empty.js','first.js','first.js'], order:['first.js','empty.js','first.js'],
          active:'first.js', settings:locallyConfigured
        }));
        sessionStorage.setItem('prepared','yes');
      }
      window.calls = [];
      window.exports = [];
      window.AndroidBridge = {
        saveFile:(name,text)=>window.exports.push({name,text}),
        aiComplete:(id,url,key,body)=>window.calls.push({id,body:JSON.parse(body)})
      };
      // Invoke only the editor's request deadline on demand, without a real 60-second wait.
      const defer = window.setTimeout.bind(window);
      window.setTimeout = (callback,ms,...args)=>{
        if(ms===60000) window.expireRequest = callback;
        return defer(callback,ms,...args);
      };
    },{KEY,locallyConfigured});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',err=>errors.push(err.message));
    page.setDefaultTimeout(4500);
    await page.goto(url);
    const el=s=>page.locator(s);
    const editor=el('#ta');
    const doCommand=async query=>{
      await el('#btnPalette').tap();
      await el('#paletteInput').fill(query);
      await el('#paletteList .p-item').first().tap();
    };
    const state=()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
    const confirm=async text=>{
      if (text!==undefined) await el('#modalInput').fill(text);
      await el('#modalOk').tap();
    };
    const showSettings=()=>el('#btnMenu').tap();
    const backup=async()=>{
      await showSettings();
      await el('#btnBackup').tap();
      return JSON.parse(await page.evaluate(()=>window.exports.at(-1).text));
    };
    const submitFiles=async items=>{
      const waiting=page.waitForEvent('filechooser');
      await showSettings();
      await el('#btnImport').tap();
      const picker=await waiting;
      await picker.setFiles(items.map(({name,text})=>({name,mimeType:'text/plain',buffer:Buffer.from(text)})));
    };
    const reply=async()=>{
      await page.evaluate(()=>window.__aiDone(window.calls.at(-1).id,200,
        JSON.stringify({choices:[{message:{content:'REPLY'}}]})));
    };
    await el('#btnSave').tap();
    const first = await state();
    if (!old) {
      assert.deepEqual(first.order,['first.js','empty.js','second.js','orphan.md']);
      assert.deepEqual(first.open,['empty.js','first.js']);
    }
    const b = await backup();
    assert.equal(Object.hasOwn(b.settings,'aiKey'),old);
    assert.equal(Object.hasOwn(b.settings,'aiUrl'),old);
    if (!old) {
      assert.equal(Object.hasOwn(b.settings,'aiModel'),false);
      assert.deepEqual([b.order,b.open,b.active],[first.order,first.open,first.active]);
      assert.doesNotMatch(await el('#toast').innerText(),/已导出/);
      await showSettings();
      await el('#btnExport').tap();
      assert.equal(await page.evaluate(()=>window.exports.at(-1).text),'let before = 1;');
      assert.doesNotMatch(await el('#toast').innerText(),/已导出/);
      await page.keyboard.press('Escape');
    }

    // Release a pending response after a normal switch to another tab.
    await el('#btnAI').tap();
    await doCommand('empty.js');
    await reply();
    const staleVisible=await el('#aiInsert').isVisible();
    assert.equal(staleVisible,old);
    if (old) {
      await el('#aiInsert').tap();
      assert.equal(await editor.inputValue(),'REPLY');
      await showSettings();
      await el('#swAI').tap();
      assert(errors.some(message=>message.includes('saveState')));
      console.log('2.1 confirmed: backup includes device credentials, switching tabs inserts old AI text into another file, AI settings raise saveState error.');
      return;
    }
    assert.equal(await editor.inputValue(),'');
    await el('#btnAI').tap();
    await editor.fill('console.l');
    await reply();
    assert.equal(await el('#aiInsert').isVisible(),false);
    // The local completion list and mobile symbol row insert independently of AI.
    await el('.suggest .sg-row').filter({hasText:'log'}).first().tap();
    assert.equal(await editor.inputValue(),'console.log');
    await editor.fill('');
    await el('#keybar .key').filter({hasText:'↵'}).tap();
    assert.equal(await editor.inputValue(),'\n');
    await editor.fill('abc');
    await el('#btnAI').tap();
    await page.evaluate(()=>window.expireRequest());
    await reply();
    assert.equal(await el('#aiInsert').isVisible(),false);
    assert.match(await el('#aiBody').innerText(),/60 秒/);
    await editor.press('Tab');
    assert.equal(await editor.inputValue(),'abc  ');
    await el('#aiRetry').tap();
    await reply();
    await el('#aiInsert').tap();
    assert.equal(await editor.inputValue(),'abc  REPLY');
    await el('#btnSave').tap();
    await page.reload();
    assert.equal(await editor.inputValue(),'abc  REPLY');

    // A result from the previous app page must not satisfy a newly created request.
    await el('#btnAI').tap();
    const previous = await page.evaluate(()=>window.calls.at(-1).id);
    await page.reload();
    await el('#btnAI').tap();
    assert.notEqual(previous,await page.evaluate(()=>window.calls.at(-1).id));
    await page.evaluate(id=>window.__aiDone(id,200,JSON.stringify({choices:[{message:{content:'LATE'}}]})),previous);
    assert.equal(await el('#aiInsert').isVisible(),false);
    await el('#aiClose').tap();

    // Exercise all four settings writes through real touch targets and reboot the page.
    await showSettings();
    await el('#swAI').tap();
    assert.equal((await state()).settings.aiOn,false);
    for(const [button,value,field] of [
      ['#btnAIKey','example-only-key','aiKey'],
      ['#btnAIUrl','https://example.test/api','aiUrl'],
      ['#btnAIModel','example-model','aiModel']
    ]) {
      await el(button).tap();
      if(field==='aiKey') assert.equal(await el('#modalInput').getAttribute('type'),'password');
      await confirm(value);
      assert.equal((await state()).settings[field],value);
    }
    await page.keyboard.press('Escape');
    await page.reload();
    await showSettings();
    assert.equal(await el('#aiModelSub').innerText(),'example-model');
    assert.equal(await el('#aiKeySub').innerText(),'已填写');
    await page.keyboard.press('Escape');

    // Version 4 backup with old credentials restores files and ordinary preferences only.
    const legacy = {
      app:'minicode',version:4,files:{'restored.md':'Restored text','empty.js':''},
      order:['restored.md','empty.js'], settings:{aiKey:'backup-key',aiUrl:'https://backup.invalid/',aiModel:'backup-model',theme:'light'}
    };
    await submitFiles([{name:'minicode-backup-20261101-1200.json.txt',text:JSON.stringify(legacy)}]);
    await confirm();
    const restored = await state();
    assert.equal(restored.active,'restored.md');
    assert.equal(restored.settings.theme,'light');
    assert.deepEqual([restored.settings.aiKey,restored.settings.aiUrl,restored.settings.aiModel],
      ['example-only-key','https://example.test/api','example-model']);
    assert.equal(restored.files['empty.js'],'');
    assert.equal(restored.files['orphan.md'],'Old note');

    await submitFiles([{name:'unrelated.json.txt',text:JSON.stringify(legacy)}]);
    await el('#tabs .active .tname').filter({hasText:'unrelated.json.txt'}).waitFor();
    assert.equal(await editor.inputValue(),JSON.stringify(legacy));
    await submitFiles([{name:'minicode-backup-example.json.txt',text:'ordinary text'}]);
    await el('#tabs .active .tname').filter({hasText:'minicode-backup-example.json.txt'}).waitFor();
    assert.equal(await editor.inputValue(),'ordinary text');
    await submitFiles([{name:'notes.txt',text:'first'},{name:'notes.txt',text:'second'},{name:'two.txt',text:'third'}]);
    await el('#tabs .active .tname').filter({hasText:'notes.txt'}).waitFor();
    const loaded=await state();
    assert.deepEqual(loaded.order.slice(-3),['notes.txt','notes-2.txt','two.txt']);
    assert.deepEqual(loaded.order.slice(-3).map(name=>loaded.files[name]),['first','second','third']);
    await doCommand('empty.js');
    await el('#btnSave').tap();
    const roundTrip=await backup();
    await doCommand('notes.txt');await editor.fill('LOCAL CHANGE');
    await submitFiles([{name:'new-backup.json',text:JSON.stringify(roundTrip)}]);await confirm();await page.reload();
    assert.equal(await el('#tabs .active .tname').innerText(),'empty.js');
    assert.equal(await editor.inputValue(),'');
    assert.deepEqual((await state()).open,roundTrip.open);
    assert.equal((await state()).files['notes.txt'],'first');

    // The HTML download fallback produces an actual downloadable UTF-8 file.
    await page.evaluate(()=>{delete window.AndroidBridge;});
    await doCommand('notes.txt');
    const downloading=page.waitForEvent('download');
    await doCommand('导出当前文件');
    const file=await downloading;
    assert.equal(file.suggestedFilename(),'notes.txt');
    assert.equal(await fs.readFile(await file.path(),'utf8'),'first');
    assert.deepEqual(errors,[]);
    console.log('2.2 passed: legacy store recovery, settings, native pending export, actual browser download, local completion, phone keyboard, AI stale/timeout/retry, ordered multi-import and v4/v5 restore.');
  } finally {
    await browser.close();
  }
}
main().catch(err=>{console.error(err);process.exitCode=1;});
