'use strict';
window.MarketLabReports = (() => {
  const {el,num,percent,table,lines,uid,saved}=MLView;
  const groups={observe:['市场观察','ml.observe.runs.v1'],quant:['量化研究','ml.quant.runs.v1'],replay:['交易复盘','ml.replay.runs.v1'],macro:['情景推演','ml.macro.runs.v1']};
  const textValue=v=>typeof v==='object'&&v!==null?JSON.stringify(v):String(v??'—');
  const when=t=>new Date(t).toLocaleString('zh-CN',{hour12:false});
  const formDate=()=>new Date().toLocaleDateString('zh-CN');
  let connection;
  function archive(){
    if(!connection)connection=new Promise((resolve,reject)=>{
      const open=indexedDB.open('marketlab-research-reports',1);
      open.onupgradeneeded=()=>open.result.createObjectStore('reports',{keyPath:'id'});
      open.onsuccess=()=>resolve(open.result);
      open.onerror=()=>{connection=null;reject(open.error);};
      open.onblocked=()=>{connection=null;reject(Error('请关闭较早的工作台窗口后再试。'));};
    });return connection;
  }
  async function persist(record){
    const db=await archive();return new Promise((resolve,reject)=>{
      const tx=db.transaction('reports','readwrite');tx.objectStore('reports').put(record);
      tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
    });
  }
  async function allReports(){
    const db=await archive();return new Promise((resolve,reject)=>{
      const req=db.transaction('reports').objectStore('reports').getAll();
      req.onsuccess=()=>resolve(req.result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));req.onerror=()=>reject(req.error);
    });
  }
  const scopeInfo=source=>typeof source==='string'?source:[source?.name,source?.url,source?.asOf,source?.license].filter(Boolean).join(' · ');
  function pack(title,range,facts,notes=[],plots=[],tables=[],sources=[],raw={}){
    return {title,range,facts,notes,plots,tables,sources,raw};
  }
  function validation(d){
    const v=d.experiment,model=v.scores.logistic,base=v.scores.baseline;
    const bars=d.bars;const first=bars[0].close;
    return pack('历史模型验证 · '+d.market.name,v.validationStart+' 至 '+v.validationEnd+'（预测起点）',[
      ['验证样本',model.n+' 个已到期预测起点'],['频率基准',percent(base.accuracy)+' 方向命中，Brier '+num(base.brier,4)],
      ['逻辑回归',percent(model.accuracy)+' 方向命中，Brier '+num(model.brier,4)],
      ['模型版本',v.modelVersion],['训练范围','每个截止日最近 '+v.minTrain+' 至 '+v.maxTrain+' 个已揭晓样本'],
      ['大致结论',model.brier===base.brier?'两种模型的平均概率误差相同。':(model.brier<base.brier?'逻辑回归':'频率基准')+' 在这段历史验证中的平均 Brier 分较低。']
    ],['按时间前推训练。五日窗口会相互重叠，样本数不能视为独立押注次数。','标的价格变化未计入分红或真实交易费用；这是模型方向验证。'],
    [{label:'完整数据期间的价格变化（首日为 0）',series:[{label:d.market.name,unit:'%',points:bars.map(b=>({x:b.date,y:(b.close/first-1)*100}))}]}],[],
    [scopeInfo(d.source),'行情区间 '+bars[0].date+' 至 '+bars.at(-1).date],{market:d.market,source:d.source,experiment:v});
  }
  function prediction(r,d){
    const actual=r.revealed?r.settlement:null;
    const facts=[['市场',r.marketId],['模式',r.mode==='official'?'本机服务预先记时的正式预测':r.mode==='latest'?'最新快照跟踪':'本机历史练习'],['提交时间',when(r.submittedAt)],['你的上涨概率',percent(r.userProbability)],['频率基准上涨概率',percent(r.baseline)],['逻辑回归上涨概率',percent(r.logistic)],['量化模型版本',r.modelVersion],['AI 上涨概率',r.ai?percent(r.ai.probability)+' · '+r.ai.version:'本次没有保存 AI 预测']];
    const notes=['一次预测的概率分数不能代表长期能力。'];let plots=[];
    if(actual){facts.push(['五日结算',actual.date+' 收盘 '+num(actual.close)+'，区间变化 '+percent(actual.close/r.startClose-1)],['用户 Brier 分',num((r.userProbability-actual.actual)**2,4)],['基准 Brier 分',num((r.baseline-actual.actual)**2,4)],['逻辑回归 Brier 分',num((r.logistic-actual.actual)**2,4)]);
      if(r.ai)facts.push(['AI Brier 分',num((r.ai.probability-actual.actual)**2,4)]);
      if(d?.market?.id===r.marketId&&d.experiment.snapshotSha256===actual.snapshot){
        const slice=d.bars.filter(b=>[r.cutoff,...actual.days].includes(b.date));plots=[{label:'结算窗口收盘价',series:[{label:d.market.name,unit:d.market.priceUnit,points:slice.map(b=>({x:b.date,y:b.close}))}]}];
      }
    }else facts.push(['结算','尚未到期或尚未揭晓']);
    plots.push({label:'同一截止日的上涨概率',series:[{label:'预测时记录的上涨概率',unit:'%',points:[{x:'1 · 你的判断',y:r.userProbability*100},{x:'2 · 频率基准',y:r.baseline*100},{x:'3 · 逻辑回归',y:r.logistic*100},...(r.ai?[{x:'4 · AI',y:r.ai.probability*100}]:[])]}],kind:'categories'});
    if(r.trainEnd&&r.trainCount)facts.push(['本期模型训练',(r.trainStart?r.trainStart+' 至 ':'训练起点最迟 ')+r.trainEnd+'，共 '+r.trainCount+' 个已揭晓样本']);
    if(r.reason)facts.push(['提交时的理由',r.reason]);
    if(r.ai){facts.push(['AI 分析',r.ai.reasoning]);for(const f of r.ai.bullishFactors||[])facts.push(['AI 看涨因素',f]);for(const f of r.ai.bearishFactors||[])facts.push(['AI 看跌因素',f]);notes.push(...r.ai.uncertainties);}
    // A report about an unopened replay must not disclose the hidden future settlement.
    const evidence={...r,settlement:actual};
    return pack('人机预测 · '+r.marketId,r.cutoff+' 收盘起，未来 '+r.horizon+' 个交易日',facts,notes,plots,[],[r.sourceName+' · 行情截至 '+r.sourceAsOf],evidence);
  }
  const cfgLabels={startDate:'回合起点',endDate:'回合终点',initialCash:'初始资金',initialCapital:'期初资金',model:'数学模型',strategy:'策略',features:'输入指标',trainStart:'训练开始',trainEnd:'训练截止',validStart:'验证开始',validEnd:'验证截止',horizon:'预测交易日数',feeBp:'费率（基点）',slipBp:'滑点（基点）',fast:'短均线',slow:'长均线',lookback:'回看长度',threshold:'信号阈值',marketId:'市场',sessions:'回合长度',feeRate:'手续费率',slipRate:'滑点率',from:'开始日期',to:'结束日期'};
  const settingsText={forest:'随机森林',logistic:'逻辑回归',trend:'趋势评分',ma:'均线交叉',momentum:'动量',buyHold:'买入持有',model:'模型择时'};
  function experiment(key,r){
    const report=r.report||{},cfg=r.config||{},m=r.metrics||{};
    const facts=(report.facts||[]).map(f=>[String(f.label),String(f.value)]);
    if(r.conclusion&&!facts.some(f=>f[1]===r.conclusion))facts.push(['实验结论',r.conclusion]);
    const tables=[];
    let notes=[...(report.notes||[])];
    const sources=[scopeInfo(r.source)].filter(Boolean);
    if(key==='observe'){
      const releases=[],method=[];
      for(const line of notes){
        const news=/^(\d{4}-\d{2}-\d{2})\s+([^｜]+)｜(.+?)\s+(https?:\/\/\S+)$/.exec(line);
        if(news)releases.push(news.slice(1));
        else if(typeof line==='string'&&line.includes(' 来源 ')&&line.includes('http'))sources.push(line);
        else method.push(line);
      }
      notes=method;
      if(releases.length)tables.push({title:'入选政策新闻',headers:['公布日期','政策语气','摘要','原文'],rows:releases});
    }
    if(key==='macro'){
      const labels={rate:'政策利率（%）',inflation:'预期通胀（%）',growth:'实际增长率（%）',risk:'风险偏好（级）'};
      tables.push({title:'两组宏观假设',headers:['变量','情景 A','情景 B'],rows:Object.keys(labels).map(k=>[labels[k],num(cfg.A[k]),num(cfg.B[k])])});
      tables.push({title:'条件估值',headers:['项目','A','B','相对变化'],rows:Object.entries(r.results).map(([k,v])=>[{equity:'股票估值点',bond:'面值 100 的债券',cash:'初始 100 的购买力'}[k],num(v.a),num(v.b),percent(v.change)])});
    }else{
      const inputs=Object.entries(cfg).filter(([k])=>cfgLabels[k]).map(([k,v])=>[cfgLabels[k],Array.isArray(v)?v.join('、'):settingsText[v]||textValue(v)]);
      if(inputs.length)tables.push({title:'实验设置',headers:['设置','取值'],rows:inputs});
    }
    if(r.trades?.length){
      const rows=r.trades.map(t=>[t.date||t.executionDate||t.tradeDate,t.side==='buy'?'买入':t.side==='sell'?'卖出':t.side,num(t.units??t.quantity??t.qty??t.shares,4),num(t.price??t.fillPrice,4),num(t.fee??t.fees,4)]);
      tables.push({title:'成交明细',headers:['执行日','方向','数量','成交价','手续费'],rows});
    }
    if(key==='replay'&&r.decisions?.length){
      const sides={buy:'买入',sell:'卖出',hold:'观望'},states={recorded:'已记录',filled:'已成交',rejected:'已拒绝',cancelled:'已撤销',expired:'已过期',pending:'待执行'};
      tables.push({title:'逐日决策与理由',headers:['决定日','决定','状态','理由'],rows:r.decisions.map(d=>[d.date,sides[d.side],states[d.status]||d.status,[d.note,d.message].filter(Boolean).join(' · ')||'—'])});
    }
    if(key==='replay'&&r.analyses?.length)tables.push({title:'当时取得的 AI 分析',headers:['截止日','模型','上涨概率','当时的理由'],rows:r.analyses.map(a=>[a.cutoff,a.version||a.model,percent(a.probability),a.reasoning])});
    if(key==='observe'&&!r.conclusion){
      const corr=facts.find(([k])=>k==='全区间相关系数')?.[1];
      if(corr&&Number.isFinite(Number(corr)))facts.push(['观察结论','在选定的共同报价区间，两项资产的变动相关系数为 '+corr+'。相关性描述同期变化，无法单独证明因果。']);
    }
    if(key==='macro'){
      const order=Object.entries(r.results).sort((a,b)=>Math.abs(b[1].change)-Math.abs(a[1].change));
      const [k,v]=order[0];facts.push(['推演结论',Math.abs(v.change)<1e-12?'两组设定得出相同的三项估值。':'这组假设下变化幅度最大的是'+{equity:'股票估值',bond:'债券价值',cash:'现金购买力'}[k]+'，B 相对 A 为 '+percent(v.change)+'。']);
    }
    const s=(report.lines||[]).filter(v=>v.points?.length);
    const byUnit=new Map();s.forEach(v=>{const k=v.unit||'';if(!byUnit.has(k))byUnit.set(k,[]);byUnit.get(k).push(v);});
    const plots=[...byUnit].map(([unit,series])=>({label:'实验曲线'+(unit?' · '+unit:''),series}));
    if(key==='quant'&&!plots.length&&r.predictions?.length){
      const valid=r.predictions.filter(p=>typeof p.date==='string'&&Number.isFinite(p.probability));
      if(valid.length){
        const series=[{label:'模型上涨概率',unit:'%',points:valid.map(p=>({x:p.date,y:p.probability*100}))}];
        const base=m.baselineProbability;
        if(Number.isFinite(base))series.push({label:'训练窗上涨频率',unit:'%',points:valid.map(p=>({x:p.date,y:base*100}))});
        plots.push({label:'逐次样本外验证 · 上涨概率',series});
      }
    }
    if(key==='macro')plots.push({label:'情景对比（情景 A = 100）',series:Object.entries(r.results).map(([k,v])=>({label:{equity:'股票估值',bond:'债券价值',cash:'现金购买力'}[k],unit:'指数',points:[{x:'情景 A',y:100},{x:'情景 B',y:v.b/v.a*100}]}))});
    const period=[cfg.validStart||cfg.startDate||cfg.from||cfg.start,m.endDate||cfg.validEnd||cfg.endDate||cfg.to||cfg.end].filter(Boolean).join(' 至 ');
    return pack(groups[key][0]+' · '+r.marketName,period||'保存于 '+when(r.createdAt),facts,notes,plots,tables,sources,r);
  }
  // Keep the evidence payload bounded in actual escaped UTF-8 bytes, including
  // long personal rationales. At most 68 items * (810 bytes + a short ID).
  const encoder=new TextEncoder();
  function excerpt(value){
    const pieces=[];let bytes=0;
    for(const ch of String(value)){
      const cost=encoder.encode(JSON.stringify(ch).slice(1,-1)).length;
      if(bytes+cost>810||pieces.length>=790)break;
      pieces.push(ch);bytes+=cost;
    }
    return pieces.join('');
  }
  function rotateEvidence(groups,limit,prefix){
    const out=[];
    const count=Math.max(0,...groups.map(g=>g.length));
    for(let i=0;i<count&&out.length<limit;i++){
      for(const group of groups){
        if(i<group.length&&out.length<limit)out.push({id:prefix+(out.length+1),text:excerpt(group[i])});
      }
    }
    return out;
  }
  function evidence(sections){
    const facts=[],risks=[];
    for(const section of sections){
      const ranked=(section.facts||[]).slice();
      const best=ranked.findIndex(([label])=>/结论|五日结算|账户收益|样本外命中率|全区间相关系数/.test(label));
      if(best>0)ranked.unshift(...ranked.splice(best,1));
      facts.push(ranked.map(([k,v])=>section.title+' · '+k+'：'+v));
      // Older saved observations stored official news and source URLs in notes.
      const method=(section.notes||[]).filter(t=>typeof t==='string'&&!/https?:\/\/|^\d{4}-\d{2}-\d{2}\s/.test(t));
      const specific=method.filter(t=>/不确定|不包含|不具|缺少|局限|重叠|不同|误差|因果|不能|可能|受限|校准|不同步/.test(t));
      risks.push([...new Set([...specific,...method])].map(t=>section.title+' · '+t));
    }
    return {facts:rotateEvidence(facts,48,'F'),risks:rotateEvidence(risks,20,'R')};
  }
  function reportBody(r){
    const body=el('article',undefined,'report-body');
    body.append(el('h2',r.title),el('p','生成于 '+when(r.createdAt)+' · 编号 '+r.id.slice(0,8),'fine'));
    if(r.ai){
      body.append(el('h3','AI 研究提要'),el('p','模型 '+r.ai.model+' · 版本 '+r.ai.version+' · '+when(r.ai.generatedAt),'fine'));
      const ul=el('ul');for(const id of r.ai.summaryIds){const f=r.facts.find(x=>x.id===id);if(f)ul.append(el('li',f.text));}body.append(ul);
      if(r.ai.riskIds?.length){body.append(el('h3','AI 选出的局限'));const u=el('ul');for(const id of r.ai.riskIds){const f=r.risks.find(x=>x.id===id);if(f)u.append(el('li',f.text));}body.append(u);}
    }
    for(const s of r.sections){
      const part=el('section');part.append(el('h3',s.title),el('p',s.range,'fine'));
      if(s.facts.length)part.append(table(['观察项目','研究结果'],s.facts));
      for(const t of s.tables){part.append(el('h4',t.title),table(t.headers,t.rows));}
      for(const g of s.plots){part.append(el('h4',g.label),g.kind==='categories'?MLView.probabilities(g.series[0].points):lines(g.series));}
      if(s.notes.length){part.append(el('h4','解释与局限'));const ul=el('ul');s.notes.forEach(n=>ul.append(el('li',n)));part.append(ul);}
      s.sources.forEach(s=>part.append(el('p','依据 · '+s,'fine')));body.append(part);
    }
    body.append(el('p','研究与学习用途。各节采用自己的市场、时间范围和实验假设。','fine'));
    return body;
  }
  function download(r,type){
    let blob;
    if(type==='json')blob=new Blob([JSON.stringify(r,null,2)],{type:'application/json;charset=utf-8'});
    else{
      const doc=document.implementation.createHTMLDocument(r.title);
      doc.documentElement.lang='zh-CN';
      const charset=doc.createElement('meta');charset.setAttribute('charset','utf-8');doc.head.prepend(charset);
      const meta=doc.createElement('meta');meta.name='viewport';meta.content='width=device-width, initial-scale=1';doc.head.append(meta);
      const style=doc.createElement('style');style.textContent='body{max-width:920px;margin:30px auto;padding:0 18px;color:#201c2e;font:16px/1.65 system-ui,sans-serif}h2,h3{color:#173f48}h3{border-bottom:1px solid #aaa;padding-bottom:6px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #dedbd6;padding:6px;text-align:left;vertical-align:top}th{background:#f4f0eb}.scroll-table{overflow:auto}p,td{overflow-wrap:anywhere}.fine,figcaption{font-size:13px;color:#595363}figure{margin:10px 0}figure svg{width:100%;height:auto}figcaption span{margin-right:1em}@media print{figure,tr{break-inside:avoid}thead{display:table-header-group}}';doc.head.append(style);
      doc.body.append(doc.importNode(reportBody(r),true));blob=new Blob(['<!doctype html>\n',doc.documentElement.outerHTML],{type:'text/html;charset=utf-8'});
    }
    const u=URL.createObjectURL(blob),a=el('a');a.href=u;a.download='MarketLab-'+r.createdAt.slice(0,10)+'-'+r.id.slice(0,8)+'.'+type;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000);
  }
  async function mount(container){
    const renderId=uid();container.dataset.renderId=renderId; const active=()=>container.dataset.renderId===renderId;
    container.innerHTML=`<header class="ml-head"><div><h2>研究报告</h2><p>选定实验后保存一份独立快照。报告可以离线阅读、打印或分享。</p></div></header>
    <section class="panel report-compose"><label>报告名称<input data-report="title" maxlength="100"></label><div class="ml-pair" data-report="sources"></div>
    <button type="button" class="primary" data-report="create">生成并保存报告</button><p role="status" class="ml-status" data-report="status"></p></section>
    <section class="panel wide"><label>已保存的研究报告<select data-report="archive"></select></label><div class="ml-buttons" data-report="actions" hidden>
    <button data-report="html">导出 HTML（可打印）</button><button data-report="json">导出实验凭据 JSON</button><button data-report="ai" hidden>生成 AI 研究提要</button></div><p class="fine" data-report="aiNotice"></p><div data-report="preview"></div></section>`;
    const get=n=>container.querySelector('[data-report="'+n+'"]');get('title').value='市场研究记录 · '+formDate();
    let items=[],preds=[],archiveOk=true,service=false;
    try{items=await allReports();}catch{archiveOk=false;}
    try{preds=await(await openMarketLabRecords()).all();}catch{}
    if(!active())return;
    const data=window.MARKETLAB_DATA,choices=[];
    const addSelect=(key,label,rows,selected=false)=>{
      const field=el('label',label),s=el('select');s.dataset.source=key;s.add(new Option('不纳入',''));
      rows.forEach(([value,title])=>s.add(new Option(title,value)));
      if(selected&&rows.length)s.selectedIndex=1;
      field.append(s);get('sources').append(field);choices.push([key,s,rows]);
    };
    const activeMarkets=[data,...(window.MLMarkets?.snapshots.values()||[])].filter((d,i,a)=>d?.experiment?.scores?.logistic?.n&&a.indexOf(d)===i);
    addSelect('validation','历史模型验证',activeMarkets.map(d=>[d.market.id,d.market.name+' · 验证汇总',()=>validation(d)]),true);
    addSelect('prediction','个人预测',preds.sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt)).map(r=>[r.id,r.cutoff+' · '+r.marketId+' · '+percent(r.userProbability),()=>prediction(r,window.MLMarkets?.snapshots.get(r.marketId)||data)]));
    let officialRows=[];
    if(/^https?:$/.test(location.protocol)){
      try{
        const response=await fetch('/api/marketlab/official?marketId='+encodeURIComponent(data?.market?.id||'CSI:000300'),{cache:'no-store',signal:AbortSignal.timeout(3500)});
        if(response.ok&&response.headers.get('content-type')?.includes('json'))officialRows=(await response.json()).records||[];
      }catch{}
    }
    if(!active())return;
    const cap=window.MLMarkets?.cap;
    if(cap)officialRows=officialRows.filter(r=>r.cutoff<=cap&&!(r.settlement?.days?.at(-1)>cap));
    addSelect('official','本机服务正式预测',officialRows.map(r=>[r.marketId+'|'+r.cutoff,r.cutoff+' · '+r.marketId,()=>{
      const original=prediction({...r,userProbability:r.user,sourceAsOf:r.cutoff,mode:'official',revealed:Boolean(r.settlement)},data);
      original.title='正式前瞻 · '+r.marketId;
      original.facts.push(['本机服务截止时刻',when(r.closesAt)]);
      original.raw=r;
      return original;
    }]));
    for(const [key,[title,ls]] of Object.entries(groups)){
      const rows=saved(ls).slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
      addSelect(key,title,rows.map(r=>[r.id,when(r.createdAt)+' · '+r.marketName,()=>experiment(key,r)]));
    }
    let current=null;
    function selectReport(id){
      current=items.find(r=>r.id===id)||null;get('preview').replaceChildren();
      get('actions').hidden=!current;
      get('ai').hidden=!current||!service||Boolean(current.ai);
      if(current)get('preview').append(reportBody(current));
    }
    function list(id){
      const s=get('archive');s.replaceChildren();
      if(!items.length)s.add(new Option('暂无已保存报告',''));
      else for(const r of items)s.add(new Option(r.title+' · '+when(r.createdAt),r.id));
      s.value=id||items[0]?.id||'';selectReport(s.value);
    }
    list();get('archive').onchange=()=>selectReport(get('archive').value);
    if(!archiveOk){get('status').textContent='浏览器禁止本机存储。生成的报告仍可立即导出。';}
    get('create').onclick=async()=>{
      const title=get('title').value.trim();
      if(!title){get('status').textContent='请填写报告名称。';return;}
      const sections=choices.map(([,sel,rows])=>rows.find(row=>row[0]===sel.value)?.[2]()).filter(Boolean);
      if(!sections.length){get('status').textContent='至少选择一份实验或历史验证。';return;}
      const {facts,risks}=evidence(sections);
      const r={schema:1,id:uid(),createdAt:new Date().toISOString(),title,sections,facts,risks,ai:null};
      let stored=true;try{await persist(r);}catch{stored=false;}
      items.unshift(r);list(r.id);get('status').textContent=stored?'报告已存入本机档案。':'存储失败。请导出当前报告，关闭页面前保留副本。';
    };
    get('html').onclick=()=>{if(current)download(current,'html');};get('json').onclick=()=>{if(current)download(current,'json');};
    get('ai').onclick=async()=>{
      const r=current;if(!r||!service)return;const btn=get('ai');btn.disabled=true;
      get('status').textContent='正在根据所选实验生成提要…';
      const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),48000);
      try{
        const {facts,risks}=evidence(r.sections);
        const res=await fetch('/api/marketlab/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:r.title,facts,risks}),signal:ctrl.signal});
        const ai=await res.json();if(!res.ok)throw Error(ai.error||'模型服务失败');
        if(!Array.isArray(ai.summaryIds)||!ai.summaryIds.length||!ai.summaryIds.every(id=>facts.some(f=>f.id===id))||!Array.isArray(ai.riskIds)||!ai.riskIds.every(id=>risks.some(f=>f.id===id))||!ai.model||!ai.version||!Number.isFinite(Date.parse(ai.generatedAt)))throw Error('模型返回的事实引用无效。');
        const updated={...r,facts,risks,ai};
        items=items.map(it=>it.id===r.id?updated:it);
        let durable=true;
        try{await persist(updated);}catch{durable=false;}
        if(active()){
          list(current?.id);
          get('status').textContent=durable?'AI 提要已随报告保存。':'AI 提要已生成，本机未能保存。请在离开前导出 HTML 或 JSON 留存。';
        }
      }catch(e){if(active())get('status').textContent='生成失败：'+e.message;}
      finally{clearTimeout(timer);if(active())btn.disabled=false;}
    };
    get('aiNotice').textContent='AI 服务未配置。结构化报告、图表和导出可直接使用。';
    if(/^https?:$/.test(location.protocol)){
      try{const resp=await fetch('/api/marketlab/status',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(resp.ok&&resp.headers.get('content-type')?.includes('json'))service=(await resp.json()).configured===true;}catch{}
      if(active()&&service){get('aiNotice').textContent='AI 可提炼已选记录中的事实和风险。仅在点按钮后发送上列研究数据到你配置的模型。';selectReport(current?.id);}
    }
  }
  return {mount};
})();
