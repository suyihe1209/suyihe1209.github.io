/** Tests UTF-8 line endings and the BOM through the actual file chooser and browser download. */
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const old = process.env.MINICODE_BASELINE === '1';
const source = process.argv[2] || path.join(__dirname,'..','mini-code-editor.html');
const url = 'https://minicode.test/editor';
const fixtures = {
  'windows.txt':'甲\r\n乙\r\n\r\n',
  'windows-no-final.c':'a\r\nb',
  'unix.txt':'a\nb\n',
  'empty.txt':'',
  'utf8-bom.txt':'\uFEFF首行\r\n第二行\r\n',
  'only-bom.txt':'\uFEFF',
  'mixed.txt':'a\rb\nc\r\n',
  'old-mac.txt':'a\rb\r'
};

async function main(){
  const html=await fs.readFile(source,'utf8');
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined});
  try {
    const context=await browser.newContext({viewport:{width:390,height:780},isMobile:true,hasTouch:true});
    await context.route(url,route=>route.fulfill({contentType:'text/html; charset=utf-8',body:html}));
    const page=await context.newPage();
    page.setDefaultTimeout(4500);
    const errors=[];
    page.on('pageerror',err=>errors.push(err.message));
    const el=s=>page.locator(s);
    const command=async query=>{
      await el('#btnPalette').tap();
      await el('#paletteInput').fill(query);
      await el('#paletteList .p-item').first().tap();
    };
    const choose=async list=>{
      const waiting=page.waitForEvent('filechooser');
      await command('导入文件');
      const picker=await waiting;
      await picker.setFiles(list.map(([name,text])=>({name,mimeType:'text/plain',buffer:Buffer.from(text)})));
    };
    const getDownload=async label=>{
      const waiting=page.waitForEvent('download');
      await command(label);
      const file=await waiting;
      return {name:file.suggestedFilename(),bytes:await fs.readFile(await file.path())};
    };
    const expectBytes=async(name,raw)=>{
      await command(name);
      const result=await getDownload('导出当前文件');
      assert.equal(result.name,name);
      assert.deepEqual(result.bytes,Buffer.from(raw),name);
    };
    const confirm=async value=>{
      if(value!==undefined) await el('#modalInput').fill(value);
      await el('#modalOk').tap();
    };
    await page.goto(url);
    if(!old){
      assert.equal(await el('#keybar').evaluate(bar=>bar.classList.contains('expanded')),false);
      await el('#btnKeys').tap();
      await el('#btnSave').tap();
      await page.reload();
      assert.equal(await el('#keybar').evaluate(bar=>bar.classList.contains('expanded')),true);
    }
    await choose(Object.entries(fixtures));
    await el('#tabs .active .tname').filter({hasText:'windows.txt'}).waitFor();
    if(old) {
      const exported=await getDownload('导出当前文件');
      assert.deepEqual(exported.bytes,Buffer.from(fixtures['windows.txt'].replace(/\r\n/g,'\n')));
      await command('utf8-bom.txt');
      const marked=await getDownload('导出当前文件');
      assert.notDeepEqual(marked.bytes,Buffer.from(fixtures['utf8-bom.txt']));
      console.log('2.1 confirmed: UTF-8 import/export strips the BOM and silently converts CRLF to LF.');
      return;
    }
    for(const [name,raw] of Object.entries(fixtures)) await expectBytes(name,raw);
    const backup=JSON.parse((await getDownload('导出全部文件')).bytes.toString());
    for(const [name,raw] of Object.entries(fixtures)) assert.equal(backup.files[name],raw,name+' backup');
    await command('utf8-bom.txt');
    assert.equal(await el('#ta').inputValue(),'首行\n第二行\n');
    await el('#ta').fill('修改\n行\n');
    await command('重命名当前文件');await confirm('renamed-bom.txt');
    await page.reload();
    await expectBytes('renamed-bom.txt','\uFEFF修改\r\n行\r\n');
    await command('windows-no-final.c');await el('#ta').fill('');
    await el('#btnSave').tap();await page.reload();await el('#ta').fill('x\ny');
    await expectBytes('windows-no-final.c','x\r\ny');
    await command('unix.txt');await el('#ta').fill('lf\nedit');await expectBytes('unix.txt','lf\nedit');

    // A legacy local account contains raw strings, with no separate format map.
    const oldContext=await browser.newContext({viewport:{width:390,height:780},isMobile:true,hasTouch:true});
    await oldContext.route(url,r=>r.fulfill({contentType:'text/html;charset=utf-8',body:html}));
    await oldContext.addInitScript(()=>localStorage.setItem('mini-code-editor-v1',JSON.stringify({
      files:{'older.c':'\uFEFF甲\r\n乙','welcome.md':'我的自定义欢迎页'},order:['older.c','welcome.md'],open:['older.c'],active:'older.c',
      settings:{keys:true}
    })));
    const legacy=await oldContext.newPage();
    await legacy.goto(url);
    assert.equal(await legacy.locator('#ta').inputValue(),'甲\n乙');
    assert.equal(await legacy.locator('#keybar').evaluate(bar=>bar.classList.contains('expanded')),true);
    await legacy.locator('#ta').fill('first\nlast\n');
    await legacy.locator('#btnSave').tap();
    const stored=await legacy.evaluate(()=>JSON.parse(localStorage.getItem('mini-code-editor-v1')));
    assert.equal(stored.files['older.c'],'\uFEFFfirst\r\nlast\r\n');
    assert.equal(stored.files['welcome.md'],'我的自定义欢迎页');
    await oldContext.close();

    // Restore a backup with a UTF-8 marker; a native or external editor can add one.
    await choose([['minicode-backup-20261101-1000.json.txt','\uFEFF'+JSON.stringify(backup)]]);
    await confirm();await page.reload();
    await expectBytes('windows.txt',fixtures['windows.txt']);
    await expectBytes('utf8-bom.txt',fixtures['utf8-bom.txt']);
    assert.deepEqual(errors,[]);
    console.log('2.2 passed: byte-for-byte UTF-8 CRLF/LF/CR/mixed, empty/trailing lines and BOM; edited and renamed document, restart, legacy strings, backup and restore; mobile keybar preferences.');
  } finally { await browser.close(); }
}
main().catch(err=>{console.error(err);process.exitCode=1;});
