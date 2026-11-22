/* Isolated, deterministic contract tests for native callbacks and browser transport. */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const page = fs.readFileSync(path.join(__dirname,'..','mini-code-editor.html'),'utf8');
const match = page.match(/\(function installSimulation\(\)\{[\s\S]*?^\}\)\(\);/m);
assert.ok(match,'packaged editor includes the simulation module');
const engine = match[0];
const question = {question:'输入 2 时输出什么？'};
const answerJSON = (answer='预计输出 4；见 main.c:2。')=>JSON.stringify({choices:[{message:{content:answer,reasoning_content:'PRIVATE-THOUGHT'},finish_reason:'stop'}]});
function create(transport='native',fetch){
  const requests = [], cancelled = [], ordinary = [], clocks = new Map();
  const cfg = {on:true,key:'dummy-sim-key',model:'test-chat',url:'https://model.test/v1/chat/completions'};
  const S = {active:'main.c',order:['main.c','math.h','private.txt'],files:{'main.c':'stale text','math.h':'\uFEFF#define N 2\r\n','private.txt':'UNSELECTED FILE'}};
  const ta = {value:'int main(){\n  return 2+2;\n}\n'};
  let next = 0;
  const win = {MiniCodeModelConfig:{get:()=>cfg}, __aiDone:(...args)=>ordinary.push(args)};
  if(transport==='native') win.AndroidBridge={cancelAI:id=>cancelled.push(id),aiComplete:(id,url,key,body)=>requests.push({id,url,key,body:JSON.parse(body)})};
  else win.fetch = fetch || (()=>{throw new Error('Unexpected network')});
  vm.runInNewContext(engine,{window:win,S,ta,editorText:s=>s.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n'),URL,Blob,AbortController,TextDecoder,
    setTimeout:(f,ms)=>{clocks.set(++next,{f,ms});return next;},clearTimeout:id=>clocks.delete(id)});
  const api = win.MiniCodeSimulation;
  const state = ()=>JSON.parse(JSON.stringify(api.getState()));
  return {api,S,ta,cfg,state,win,ordinary,cancelled,requests,
    done:(i,msg)=>win.__aiDone(requests[i].id,200,answerJSON(msg)),
    timeout:()=>[...clocks.values()].find(e=>e.ms===120000).f()};
}
test('selects only current files, numbers the live editor, and carries earlier dialogue across turns',()=>{
  const t = create();
  assert.equal(t.requests.length,0);
  assert.equal(t.api.listFiles().find(f=>f.active).name,'main.c');
  const busy = [];
  assert.equal(t.api.send({...question,fileNames:['main.c','math.h','math.h']},s=>busy.push(s.busy)),true);
  assert.equal(t.api.send(question),false);
  const first = t.requests[0];
  assert.equal(first.key,t.cfg.key);
  assert.equal(first.url,t.cfg.url);
  assert.deepEqual(Object.keys(first.body).sort(),['messages','model','stream']);
  const content = JSON.parse(first.body.messages.at(-1).content);
  assert.deepEqual(content.files,[{name:'main.c',numberedSource:'1 | int main(){\n2 |   return 2+2;\n3 | }\n4 | '},{name:'math.h',numberedSource:'1 | #define N 2\n2 | '}]);
  const raw=JSON.stringify(first.body);
  assert.doesNotMatch(raw,/stale text|UNSELECTED FILE|dummy-sim-key/);
  assert.match(raw,/测试输入/);assert.match(raw,/预计输出/);assert.match(raw,/边界与不确定性/);
  t.done(0);assert.deepEqual(busy,[true,false]);
  assert(t.state().messages[1].text.startsWith('模拟推演'));
  assert.doesNotMatch(t.state().messages[1].text,/PRIVATE-THOUGHT/);
  t.ta.value='return 9;';
  t.api.send({question:'如果改过了呢？'});
  const next=t.requests[1].body.messages;
  assert.deepEqual(next.map(m=>m.role),['system','user','assistant','user']);
  assert(!JSON.stringify(next).includes('#define N 2'));
  assert(!JSON.stringify(next).includes('return 2+2;'));
  assert.equal(JSON.parse(next.at(-1).content).files[0].numberedSource,'1 | return 9;');
  const externallyRead=t.api.getState();
  externallyRead.messages[0].files.length=0;
  assert.deepEqual(t.state().messages[0].files,['main.c','math.h']);
});
test('closes, retries with fresh files, ignores old responses and preserves completion callback',()=>{
  const t=create();
  t.api.send(question);t.api.close();assert.deepEqual(t.cancelled,[t.requests[0].id]);t.done(0);
  assert.equal(t.state().messages.length,1);
  t.ta.value='new live source';
  assert(t.api.retry());assert(t.requests[1].body.messages.at(-1).content.includes('new live source'));
  t.done(0);assert(t.state().busy);
  t.timeout();assert.deepEqual(t.cancelled,[t.requests[0].id,t.requests[1].id]);t.done(1);assert.equal(t.state().errorCode,'timeout');
  assert(t.api.retry());t.done(2,'OK');t.done(2,'duplicate');
  assert.equal(t.state().messages.length,2);
  t.win.__aiDone('r-completion-id',403,'old callback');
  assert.deepEqual(t.ordinary,[['r-completion-id',403,'old callback']]);
  t.api.send(question);t.api.clear();t.done(3);assert.equal(t.state().messages.length,0);
});
test('settings invalidate in-flight calls and prevent resending old dialogue to another service',()=>{
  const t=create();t.api.send({question:'private first question'});t.done(0);
  t.api.send(question);t.cfg.key='other-key';t.done(1);
  assert.equal(t.state().errorCode,'settings');assert.equal(t.state().messages.length,3);
  t.cfg.url='https://other.test/chat/completions';t.api.settingsChanged();t.api.retry();
  assert(!JSON.stringify(t.requests[2].body).includes('private first question'));
  assert.equal(t.requests[2].body.messages.length,2);t.done(2);
  assert.equal(t.state().messages.length,4);
});
test('enforces configuration and size limits without dispatching partial input',()=>{
  for (const partial of [{on:false},{key:''},{model:''},{url:'http://model.test/chat'},{url:'https://name:pwd@model.test/chat'}]){
    const t=create();Object.assign(t.cfg,partial);
    assert.equal(t.api.send(question),false);assert.equal(t.state().errorCode,'config');assert.equal(t.requests.length,0);
  }
  const t=create();
  assert.equal(t.api.send({question:'😀'.repeat(2001)}),false);
  assert.equal(t.api.send({question:'😀'.repeat(2000)}),true);t.api.clear();
  t.ta.value='界'.repeat(17000);assert.equal(t.api.send(question),false);assert.equal(t.state().errorCode,'limits');
  t.ta.value='\n'.repeat(30000);assert.equal(t.api.send(question),false);assert.equal(t.state().errorCode,'limits');
  assert.equal(t.api.send({...question,fileNames:['missing.txt']}),false);assert.equal(t.state().errorCode,'files');
  t.ta.value='ok';
  for(let i=0;i<8;i++){assert(t.api.send(question));t.done(t.requests.length-1);}
  assert.equal(t.api.send(question),false);assert.equal(t.state().errorCode,'limits');
  assert.equal(t.requests.length,9);
});
test('server and incomplete answers get actionable errors with no completion or hidden reasoning',()=>{
  const t=create();
  for(const [status,body,code] of [
    [401,'account-diagnostic-dummy','auth'],[402,'','quota'],[404,'','provider'],[429,'','quota'],[-1,'','network'],
    [200,'not JSON','provider'],[200,JSON.stringify({choices:[{message:{reasoning_content:'SECRET THOUGHT WITHOUT ANSWER'}}]}),'provider'],
    [200,JSON.stringify({choices:[{finish_reason:'length',message:{content:'incomplete'}}]}),'limits'],
    [200,JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:'unexecuted'}}]}),'provider'],
    [200,'A'.repeat(256*1024+10),'limits']
  ]){
    assert(t.api.send(question));t.win.__aiDone(t.requests.at(-1).id,status,body);
    assert.equal(t.state().errorCode,code);assert.equal(t.state().messages.length,1);
    assert.doesNotMatch(t.state().error,/SECRET|account-diagnostic/);
  }
});
test('web asks only on send, omits cookies, declines redirects, streams bounded data and ignores aborted late replies',async()=>{
  const fetchCalls=[];
  const t=create('web',(url,opts)=>new Promise((resolve,reject)=>fetchCalls.push({url,opts,resolve,reject})));
  assert.equal(fetchCalls.length,0);assert(t.api.send(question));
  const first=fetchCalls[0];assert.equal(first.url,t.cfg.url);
  assert.equal(first.opts.headers.Authorization,'Bearer '+t.cfg.key);
  assert.equal(first.opts.redirect,'error');assert.equal(first.opts.credentials,'omit');assert.equal(first.opts.referrerPolicy,'no-referrer');
  t.api.close();assert(first.opts.signal.aborted);assert(t.api.retry());
  first.resolve(new Response(answerJSON('late result')));
  fetchCalls[1].resolve(new Response(answerJSON('准时')));
  await new Promise(setImmediate);assert.match(t.state().messages[1].text,/准时/);
  t.api.send(question);fetchCalls[2].reject(new TypeError('Failed to fetch'));
  await new Promise(setImmediate);assert.equal(t.state().errorCode,'cors');
  t.api.retry();fetchCalls[3].resolve(new Response('A'.repeat(270000)));
  await new Promise(setImmediate);assert.equal(t.state().errorCode,'limits');
});
