'use strict';
(async function startMarketLab() {
  const $ = id => document.getElementById(id);
  const node = (tag,text) => {
    const el=document.createElement(tag);
    if(text!==undefined)el.textContent=text;
    return el;
  };
  const fmt = n => Number.isFinite(n)?n.toLocaleString('zh-CN',{maximumFractionDigits:4}):'—';
  const pct = n => Number.isFinite(n)?fmt(Number((n*100).toFixed(2)))+'%':'—';
  const score = n => Number.isFinite(n)?n.toFixed(4):'—';
  const probability = n => Number.isFinite(n)&&n>=0&&n<=1;
  const stamp = t => new Date(t).toLocaleString('zh-CN',{hour12:false});
  const table = (head,rows) => {
    const wrap=node('div'),t=node('table'),h=t.createTHead().insertRow();wrap.className='scroll-table';
    for(const s of head){const th=node('th',s);th.scope='col';h.append(th);}
    const body=t.createTBody();
    for(const row of rows){const r=body.insertRow();for(const value of row){
      const c=r.insertCell();if(value instanceof Node)c.append(value);else c.textContent=value;
    }}
    wrap.append(t);return wrap;
  };
  const fail = message => { $('load').hidden=false;$('load').textContent=message; };
  await window.ML_MARKETS_READY;
  const d=window.MARKETLAB_DATA;
  if(!d){fail('所选市场的指数日线尚未载入。请使用上方的行情加载入口。');return;}
  if(!Array.isArray(d.bars)||!d.bars.length){fail('当前数据源没有交易日行情，暂时无法开启预测。');return;}
  const dateValid = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const validBar=(b,i)=>b&&dateValid(b.date)&&(!i||d.bars[i-1].date<b.date)
    &&[b.open,b.high,b.low,b.close].every(Number.isFinite)
    &&(b.volume===null||Number.isFinite(b.volume)&&b.volume>=0)
    &&b.low>0&&b.low<=Math.min(b.open,b.close)&&b.high>=Math.max(b.open,b.close);
  if(d.schemaVersion!==1||d.horizon!==5||!d.market?.id||!d.source?.asOf||!d.experiment?.modelVersion||!d.bars.every(validBar)){
    fail('行情格式或交易日顺序异常，无法可靠地计算收益和结算。请重新导出市场快照。');return;
  }
  const {market,bars,source,experiment}=d, last=bars.at(-1), horizon=d.horizon;
  const index=new Map(bars.map((b,i)=>[b.date,i]));
  const forecasts=new Map((Array.isArray(d.forecasts)?d.forecasts:[]).filter(f=>f&&index.has(f.date)&&probability(f.baseline)&&probability(f.logistic)).map(f=>[f.date,f]));
  const dates=bars.filter(b=>forecasts.has(b.date));
  const historical=dates.filter(b=>index.get(b.date)+horizon<bars.length);
  if(!dates.length){fail('当前快照还没有可对照的量化预测，请补足训练样本后重新导出。');return;}
  const idFor = date => JSON.stringify([market.id,horizon,date]);
  let store=null, records=[],selected='',period=20,loadingAI=false,aiService='loading',aiError='',busy=false;
  let bus=null;
  try { if('BroadcastChannel' in window)bus=new BroadcastChannel('marketlab-records-v1'); } catch { /* local-file storage can be isolated */ }
  const viewKey='marketlab-view:'+market.id;
  function rememberView() {
    try {sessionStorage.setItem(viewKey,JSON.stringify({mode:$('mode').value,date:selected}));} catch { /* navigation remains usable without storage */ }
  }
  const chart=window.MarketLabChart(bars,market);
  const names={user:'你的预测',baseline:'历史上涨频率基准',logistic:'逻辑回归',ai:'AI 分析师'};
  const groupName=m=>m==='latest'?'最新快照跟踪':'历史练习';
  const current=()=>records.find(r=>r.id===idFor(selected));
  const models=r=>Object.entries({user:r.userProbability,baseline:r.baseline,logistic:r.logistic,ai:r.ai?.probability}).filter(([,p])=>probability(p));
  $('market-title').textContent=market.name;
  $('market-id').textContent=market.id;
  const marketNote=[market.exchange,market.currency,market.timezone,market.priceBasis].filter(Boolean).join(' · ');
  $('market-basis').textContent=[marketNote,source.basis].filter(Boolean).join('。');
  const sourceBox=$('data-source');
  let sourceLink=node('span',source.name);
  if(/^https?:\/\//i.test(source.url)){sourceLink=node('a',source.name);sourceLink.href=source.url;sourceLink.target='_blank';sourceLink.rel='noopener noreferrer';}
  const srcLine=node('p','数据源 · ');srcLine.append(sourceLink);sourceBox.append(srcLine);
  sourceBox.append(node('p','行情截至 '+source.asOf+' · 资料更新时间 '+source.updatedAt+' · 市场时区 '+market.timezone),
    node('p','授权说明 · '+source.license));
  if(source.attribution)sourceBox.append(node('p',source.attribution));
  if(source.basis)sourceBox.append(node('p',source.basis));
  if(/^https?:\/\//i.test(source.licenseUrl)){
    const link=node('a','查看授权条款原文');link.href=source.licenseUrl;link.rel='noopener noreferrer';link.target='_blank';
    const line=node('p');line.append(link);sourceBox.append(line);
  }
  const gapDays=(Date.now()-Date.parse(source.asOf+'T00:00:00Z'))/86400000;
  if((source.demo&&!source.originalSha256)||gapDays>7){fail('历史研究快照 · 行情截至 '+source.asOf+'。页面展示已归档交易日，当前没有实时行情接入。');}
  else{fail('本地行情快照 · 数据截至 '+source.asOf+'，更新后可继续结算。');}
  function settle(r) {
    if(r.settlement||r.marketId!==market.id||r.horizon!==horizon||!index.has(r.cutoff))return false;
    const start=index.get(r.cutoff),end=bars[start+horizon];
    if(!end)return false;
    // The starting observation is frozen. Intermediate dates record the exact five trading rows used.
    r.settlement={date:end.date,close:end.close,actual:Number(end.close>r.startClose),days:bars.slice(start+1,start+horizon+1).map(b=>b.date),
      settledAt:new Date().toISOString(),sourceAsOf:source.asOf,snapshot:experiment.snapshotSha256||''};
    if(r.mode==='latest')r.revealed=true;
    return true;
  }
  async function refresh() {
    if(!store)return;
    const all=await store.all();
    const relevant=all.filter(r=>r.marketId===market.id&&r.horizon===horizon&&probability(r.userProbability));
    const pending=relevant.filter(r=>!r.settlement&&index.has(r.cutoff)&&index.get(r.cutoff)+horizon<bars.length);
    if(pending.length)await Promise.all(pending.map(r=>store.change(r.id,settle)));
    records=(pending.length?await store.all():all).filter(r=>r.marketId===market.id&&r.horizon===horizon&&probability(r.userProbability))
      .sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt));
  }
  function choose(mode,requested) {
    $('mode').value=mode;
    const allowed=mode==='practice'?historical:dates.filter(b=>b.date===last.date);
    const otherGroup=new Set(records.filter(r=>r.mode!==mode).map(r=>r.cutoff));
    const choices=new Set(allowed.filter(b=>!otherGroup.has(b.date)).map(b=>b.date));
    for(const r of records)if(r.mode===mode&&index.has(r.cutoff))choices.add(r.cutoff);
    const options=[...choices].sort().reverse();
    $('cutoff').replaceChildren(...options.map(s=>new Option(s,s)));
    selected=choices.has(requested)?requested:options[0]||'';
    $('cutoff').value=selected;$('ranking-mode').value=mode;aiError='';rememberView();
    $('mode-note').textContent=mode==='practice'?'历史练习可自由切换日期，成绩仅反映本机练习。':'最新快照到期后，补入五个后续交易日即可自动结算。本机提交时间未经服务器验证。';
    render();
  }
  function viewChart() {
    if(!selected)return;
    const i=index.get(selected),bar=bars[i];
    $('last').textContent=fmt(bar.close)+' '+market.priceUnit;
    for(const [id,value] of [['ret5',bar.return5],['ret20',bar.return20]]) {
      $(id).textContent=value>0?'+'+pct(value):pct(value);
      $(id).className=value>0?'up':value<0?'down':'';
    }
    chart(i,period);
  }
  function compare(r) {
    const result=r.revealed&&r.settlement;
    const observed=r.settlement;
    $('reveal').hidden=!observed||Boolean(r.revealed);
    $('reveal').disabled=busy;
    if(result){
      const ret=result.close/r.startClose-1;
      $('outcome').textContent='第 5 个交易日 '+result.date+' 收盘 '+fmt(result.close)+' '+market.priceUnit+'，从截止日 '+fmt(r.startClose)+' 变动 '+pct(ret)+'（'+(result.actual?'上涨':'未涨')+'）。';
    }else{
      $('outcome').textContent=observed?'预测已锁定。揭晓后查看第五个交易日的收盘与得分。':'等待后续交易日 · 当前已有 '+Math.min(horizon,Math.max(0,bars.length-index.get(r.cutoff)-1))+' / '+horizon+' 根后续日线。';
    }
    $('compare').replaceChildren(table(['预测者','上涨概率','方向判断','方向结果','Brier 分'],models(r).map(([k,p])=>[names[k],pct(p),p>=.5?'上涨':'未涨',result?((p>=.5)===Boolean(result.actual)?'正确':'错误'):observed?'待揭晓':'待到期',result?score((p-result.actual)**2):'—'])));
    const receipt=$('receipt');receipt.replaceChildren(node('p','模式 · '+groupName(r.mode)+'。提交于 '+stamp(r.submittedAt)+'（本机时间）。'),
      node('p','市场 '+r.marketId+' · 截止 '+r.cutoff+' · 期限 '+r.horizon+' 个交易日 · 量化版本 '+r.modelVersion+'。'),
      node('p','训练样本 '+r.trainCount+' 条，起止 '+r.trainStart+' 至 '+r.trainEnd+'。'),
      node('p','提交时数据源 '+r.sourceName+'，行情截至 '+r.sourceAsOf+'。'),
      node('p','你的理由 · '+(r.reason||'未填写')),
      node('p','Brier 分 =（上涨概率 − 实际结果）²。上涨记为 1，平盘或下跌记为 0。分数越低越好。'));
    if(result)receipt.append(node('p','结算所用的五个后续交易日 · '+result.days.join('、')+'。结算数据截至 '+result.sourceAsOf+'。'));
    const detail=$('ai-detail');detail.replaceChildren();
    if(r.ai){
      const a=r.ai;detail.append(node('h3','AI 分析记录'),node('p','模型 '+a.model+' · 版本 '+a.version+' · 截止 '+a.cutoff+' · 生成于 '+stamp(a.predictedAt)),node('p',a.reasoning));
      for(const [field,title] of [['bullishFactors','看涨因素'],['bearishFactors','看跌因素'],['uncertainties','主要不确定性']]){
        const ul=node('ul');for(const s of a[field])ul.append(node('li',s));detail.append(node('h3',title),ul);
      }
      detail.append(node('p','此概率是语言模型的主观判断，未经统计校准。'));
    }
  }
  function drawRecords() {
    const group=$('ranking-mode').value, history=records.filter(r=>r.mode===group);
    const scores=new Map();
    for(const r of history)if(r.revealed&&r.settlement){
      for(const [k,p] of models(r)){
        const tally=scores.get(k)||{n:0,wins:0,sum:0},a=r.settlement.actual;
        tally.n++;tally.wins+=Number((p>=.5)===Boolean(a));tally.sum+=(p-a)**2;scores.set(k,tally);
      }
    }
    const ranked=[...scores].sort(([,a],[,b])=>a.sum/a.n-b.sum/b.n);
    $('ranking').replaceChildren(ranked.length?table(['预测者','已评分','方向准确率','平均 Brier 分'],ranked.map(([k,t])=>[names[k],t.n,pct(t.wins/t.n),score(t.sum/t.n)])):node('p','这一组尚无已揭晓的成绩。'));
    $('history').replaceChildren(history.length?table(['观察截止','你的概率','状态','凭据'],history.map(r=>{
      const button=node('button','查看记录');button.type='button';button.disabled=!index.has(r.cutoff);
      button.addEventListener('click',()=>{choose(r.mode,r.cutoff);$('results').scrollIntoView({block:'start'});});
      return [r.cutoff,pct(r.userProbability),r.revealed&&r.settlement?'已结算':r.settlement?'待揭晓':'待到期',button];
    })):node('p','这一组暂无预测记录。'));
  }
  function showAI() {
    const r=current(), frozenLatest=r?.mode==='latest'&&r.cutoff!==last.date;
    const status=aiService==='off'?'AI 服务未配置。可在本机服务端设置模型与密钥后重新检查。'
      :aiService==='file'?'AI 服务未配置。双击本目录的「打开实验室.command」可接入本机服务。'
      :aiService==='missing'?'当前为静态网站，AI 服务未配置。'
      :aiService==='failed'?'AI 服务连接失败，行情和本机预测仍可使用。'
      :aiService==='loading'?'正在检查 AI 服务…'
      :!r?'AI 服务已连接，锁定你的预测后可获取同一截止日的分析。'
      :r.ai?'已保存该次分析，可在预测对照中查看。'
      :r.revealed||frozenLatest?'该记录已封存，本次未纳入 AI 判断。'
      :'AI 服务已连接。生成的观点将与本次预测一起保存。';
    $('ai-status').textContent=aiError||status;
    $('ai-run').hidden=aiService!=='on'||!r||Boolean(r.ai)||Boolean(r.revealed)||frozenLatest;
    $('ai-run').disabled=loadingAI;
    $('ai-retry').hidden=!['failed','off','missing'].includes(aiService);
  }
  function render() {
    const r=current();
    $('results').hidden=!r;$('validation').hidden=!r;
    $('question').textContent=selected?'以 '+selected+' 收盘为起点，第五个后续交易日的收盘价高于今天的概率是多少？':'此模式暂时没有符合条件的观察日。';
    $('probability').value=r?String(Number((r.userProbability*100).toFixed(10))):'';
    $('reason').value=r?.reason||'';
    for(const id of ['lock','reason','probability'])$(id).disabled=Boolean(r)||!selected||busy||!store;
    $('lock').textContent=r?'预测已锁定':'锁定预测';
    $('lock-message').textContent=!store?'浏览器未允许保存本机记录，请在普通浏览窗口打开本机服务后再提交。':r?'已保存于 '+stamp(r.submittedAt)+' · '+groupName(r.mode):'';
    if(selected)viewChart();
    if(r)compare(r);
    $('experiment').replaceChildren();
    if(r&&experiment.scores){
      $('experiment').append(node('p','整份快照的历史验证统计，与本机预测分开。按时间前推验证，日期 '+experiment.validationStart+' 至 '+experiment.validationEnd+'。'),
        table(['量化模型','已验证','方向准确率','Brier 分'],Object.entries(experiment.scores).filter(([k])=>k in names).map(([k,s])=>[names[k],s.n,pct(s.accuracy),score(s.brier)])),
        node('p','版本 '+experiment.modelVersion+' · 输入指标 '+(experiment.features||[]).join('、')));
    }
    drawRecords();showAI();
  }
  async function afterChange() {
    await refresh();render();bus?.postMessage('changed');
  }
  async function checkAI() {
    aiError='';
    if(!/^https?:$/.test(location.protocol)){aiService='file';showAI();return;}
    aiService='loading';showAI();
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),7000);
    try {
      const response=await fetch('/api/marketlab/status',{cache:'no-store',signal:ctrl.signal});
      if(response.status===404||response.ok&&!response.headers.get('content-type')?.includes('json'))aiService='missing';
      else if(!response.ok)aiService='failed';
      else {
        const data=await response.json();aiService=data.configured===true?'on':data.configured===false?'off':'failed';
      }
    }catch{aiService='failed';}
    finally{clearTimeout(timer);showAI();}
  }
  $('ai-retry').addEventListener('click',checkAI);
  $('ai-run').addEventListener('click',async()=>{
    const r=current();
    if(aiService!=='on'||loadingAI||!r||r.ai||r.revealed||r.mode==='latest'&&r.cutoff!==last.date)return;
    loadingAI=true;aiError='正在请求同一截止日的分析…';showAI();
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),60000);
    try {
      const res=await fetch('/api/marketlab/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({marketId:market.id,cutoff:r.cutoff}),signal:ctrl.signal});
      const a=await res.json();if(!res.ok)throw Error(typeof a.error==='string'?a.error:'服务响应失败');
      if(!probability(a.probability)||a.cutoff!==r.cutoff||(a.marketId&&a.marketId!==market.id)
        ||!['model','version','reasoning'].every(k=>typeof a[k]==='string'&&a[k].trim())
        ||!Number.isFinite(Date.parse(a.predictedAt))
        ||!['bullishFactors','bearishFactors','uncertainties'].every(k=>Array.isArray(a[k])&&a[k].length>=1&&a[k].length<=5&&a[k].every(s=>typeof s==='string'&&s.trim())))throw Error('返回的分析格式或截止日无效');
      await store.change(r.id,rec=>{if(rec.ai||rec.revealed)return false;rec.ai=a;return true;});
      aiError='';await afterChange();
    }catch(e){if(selected===r.cutoff)aiError='AI 分析失败 · '+(e.name==='AbortError'?'服务响应超时':e.message)+'。可以重试。';}
    finally{clearTimeout(timer);loadingAI=false;showAI();}
  });
  $('prediction-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!store||!selected||current()||!$('prediction-form').reportValidity())return;
    const value=$('probability').valueAsNumber/100;if(!probability(value))return;
    const date=selected,f=forecasts.get(date);if(!f)return;
    const r={id:idFor(date),marketId:market.id,horizon,cutoff:date,mode:$('mode').value,submittedAt:new Date().toISOString(),
      startClose:bars[index.get(date)].close,userProbability:value,reason:$('reason').value.trim(),baseline:f.baseline,logistic:f.logistic,
      trainStart:f.trainStart,trainEnd:f.trainEnd,trainCount:f.trainCount,modelVersion:experiment.modelVersion,sourceAsOf:source.asOf,sourceName:source.name,
      snapshot:experiment.snapshotSha256||'',settlement:null,revealed:false,ai:null};
    settle(r);busy=true;$('lock').disabled=true;
    try{await store.add(r);await afterChange();}
    catch(e){await refresh();render();$('lock-message').textContent=e.name==='ConstraintError'?'这一天的预测已经锁定。':'保存失败，预测尚未锁定。请检查浏览器存储权限后重试。';}
    finally{busy=false;$('lock').disabled=Boolean(current())||!store;if(current())compare(current());}
  });
  $('reveal').addEventListener('click',async()=>{
    const r=current();if(!r?.settlement||r.revealed||busy)return;
    busy=true;$('reveal').disabled=true;
    try{await store.change(r.id,rec=>{if(!rec.settlement||rec.revealed)return false;rec.revealed=true;return true;});await afterChange();}
    catch{$('outcome').textContent='暂时无法保存揭晓状态，请重试。';}
    finally{busy=false;$('reveal').disabled=false;}
  });
  $('mode').addEventListener('change',()=>choose($('mode').value));
  $('cutoff').addEventListener('change',()=>{selected=$('cutoff').value;aiError='';rememberView();render();});
  $('ranking-mode').addEventListener('change',drawRecords);
  document.querySelectorAll('#arena-module [data-range]').forEach(b=>b.addEventListener('click',()=>{
    period=Number(b.dataset.range);
    document.querySelectorAll('#arena-module [data-range]').forEach(t=>t.setAttribute('aria-pressed',String(t===b)));viewChart();
  }));
  try{store=await window.openMarketLabRecords();await refresh();}catch{store=null;}
  $('workbench').hidden=false;
  const untried=[...historical].reverse().find(b=>!records.some(r=>r.cutoff===b.date));
  let savedView;
  try {savedView=JSON.parse(sessionStorage.getItem(viewKey));} catch { /* first visit */ }
  choose(['practice','latest'].includes(savedView?.mode)?savedView.mode:historical.length?'practice':'latest',
    savedView?.date||untried?.date);
  if(bus)bus.onmessage=async()=>{
    const p=$('probability').value,reason=$('reason').value,date=selected;
    await refresh();render();
    if(selected===date&&!current()){$('probability').value=p;$('reason').value=reason;}
  };
  checkAI();
})().catch(()=>{
  const el=document.getElementById('load');el.hidden=false;el.textContent='当前快照无法完整打开，请核对行情文件和模型版本后刷新。';
});
