(function(global){
  'use strict';
  const E=global.MarketLabQuantEngine, KEY='ml.quant.runs.v1';
  const percent=v=>Number.isFinite(v)?(v*100).toFixed(2)+'%':'—';
  const fmt=v=>Number.isFinite(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:4}):'—';
  const defaults={return1:1,return5:2,return20:1,maGap5:1,maGap20:1,volatility20:-1};
  const el=(tag,txt,cls)=>{const n=document.createElement(tag);if(txt!==undefined)n.textContent=txt;if(cls)n.className=cls;return n;};
  function option(select,v,label){const o=el('option',label);o.value=v;select.append(o);}
  function assets(){
    const main=global.MARKETLAB_DATA,more=global.ML_ASSETS, out=[];
    if(main?.bars?.length)out.push({id:main.market.id,name:main.market.name,unit:main.market.priceUnit,kind:main.market.marketType==='指数'?'index':'etf',
      rows:main.bars,source:{...main.source,snapshotSha256:main.experiment?.snapshotSha256||main.source.sha256}});
    for(const a of more?.assets||[]){
      if(out.some(x=>x.id===a.id)||!Array.isArray(a.rows)||a.rows.length<55||a.rows.some(r=>!Number.isFinite(r.close)||r.close<=0)) continue;
      const meta=a.source&&typeof a.source==='object'?a.source:{name:a.source};
      out.push({...a,source:{...meta,name:meta.name||a.sourceName||more.sourceName||a.name,
        url:meta.url||a.sourceUrl||a.url||'',license:meta.license||a.license||a.licenseUrl||more.license||'见行情来源说明',
        licenseUrl:a.licenseUrl||meta.licenseUrl,from:a.rows[0].date,rows:a.rows.length,
        asOf:a.rows.at(-1).date,snapshotSha256:a.sha256||meta.sha256||undefined}});
    }
    return out;
  }
  async function identifySource(asset){
    if(asset.source.snapshotSha256)return;
    const bytes=new TextEncoder().encode(JSON.stringify(asset.rows));
    if(global.crypto?.subtle){
      const digest=new Uint8Array(await global.crypto.subtle.digest('SHA-256',bytes));
      asset.source.snapshotSha256=Array.from(digest,x=>x.toString(16).padStart(2,'0')).join('');
    }else{
      let hash=2166136261;
      for(const b of bytes)hash=Math.imul(hash^b,16777619)>>>0;
      asset.source.snapshotId='fnv1a32-'+hash.toString(16).padStart(8,'0');
    }
  }
  function report(run){
    const m=run.metrics, c=run.config, samples=run.samples;
    const facts=[
      {label:'研究标的',value:run.marketName},{label:'模型与预测期限',value:E.MODELS[c.model]+' · '+c.horizon+' 个交易日'},
      {label:'训练样本',value:samples.train+' 条，'+samples.trainStart+' 至 '+samples.trainEnd},
      {label:'标签最迟揭晓',value:samples.lastTrainingLabel},{label:'验证窗口',value:samples.validationStart+' 至 '+samples.validationEnd},
      {label:'已到期验证预测',value:samples.validation+' 条'}, {label:'方向命中率',value:percent(m.accuracy)},
      {label:'Brier 分数',value:m.brier.toFixed(4)},{label:'频率基准命中率',value:percent(m.baseline.accuracy)},
      {label:'频率基准 Brier',value:m.baseline.brier.toFixed(4)}
    ];
    const parameter=c.model==='forest'?c.trees+' 棵树，最大深度 '+c.depth+'，固定种子 1729':
      c.model==='logistic'?'L2 正则化，C = '+c.C:c.features.map(k=>E.FEATURES[k]+' × '+c.weights[k]).join('，');
    facts.push({label:'输入指标',value:c.features.map(k=>E.FEATURES[k]).join('、')},{label:'模型参数',value:parameter});
    if(run.curves.length){
      const parameter=c.strategy==='ma'?c.fast+' / '+c.slow+' 日均线':c.strategy==='momentum'?c.lookback+' 日动量':
        c.strategy==='model'?'上涨概率阈值 '+percent(c.threshold):'首日开盘买入并持有';
      facts.push({label:'交易参数',value:parameter});
    }
    if(run.curves.length)facts.push({label:'交易策略',value:E.STRATEGIES[c.strategy]},
      {label:'费用 / 滑点（单边）',value:c.feeBp+' / '+c.slipBp+' 基点'},
      {label:'累计收益',value:percent(m.totalReturn)},{label:'买入持有累计收益',value:percent(run.benchmark.totalReturn)},
      {label:'最大回撤',value:percent(m.maxDrawdown)},{label:'成交次数',value:m.tradeCount+' 次'},
      {label:'年化波动率',value:percent(m.annualVolatility)},
      {label:'夏普比率（无风险收益设为零）',value:fmt(m.sharpe)});
    const lines=run.curves.length?['value','benchmark'].map((key,i)=>({label:i?'买入持有':'所选策略',unit:'%',
      points:run.curves.map(d=>({x:d.date,y:(d[key]-1)*100}))})): [];
    const notes=['训练在验证窗口前结束，概率未额外校准。相邻多日预测的持有区间会重叠。'];
    if(run.curves.length)notes.push('信号收盘生成，下一交易日开盘执行。按收盘价估值期末持仓，费用和滑点已计入。');
    else notes.push('该标的缺少完整日线开高低收，只计算模型验证，无交易策略回测。');
    if(c.model==='trend')notes.push('趋势评分为自定义指标的加权标准分，经逻辑函数映射为研究分数。');
    return {facts,lines,notes};
  }
  function loadRuns(){
    const value=global.localStorage.getItem(KEY);
    if(!value)return [];
    const parsed=JSON.parse(value);
    if(!Array.isArray(parsed))throw new Error('实验记录格式有误。');
    return parsed;
  }
  function table(head, rows){
    const box=el('div',undefined,'scroll-table'), t=el('table'), tr=el('tr'), thead=el('thead'),tb=el('tbody');
    for(const name of head)tr.append(el('th',name));thead.append(tr);t.append(thead);
    rows.forEach(row=>{const r=el('tr');row.forEach(cell=>r.append(el('td',cell)));tb.append(r);});t.append(tb);box.append(t);return box;
  }
  function drawCurve(box,run){
    box.append(el('h3','累计收益曲线'));
    const controls=el('div',undefined,'q-curve-controls'),period=el('select'), label=el('label','显示范围');
    for(const [v,s] of [[0,'整个验证期'],[60,'最后 60 日'],[20,'最后 20 日']])option(period,v,s);
    label.append(period);controls.append(label);box.append(controls);
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 650 210');svg.setAttribute('role','img');
    svg.setAttribute('aria-label','策略与买入持有的累计收益率曲线，详细数值见下方日线明细');
    const caption=el('p',undefined,'fine'), legend=el('p','━━ 所选策略　┈┈ 买入持有','q-legend');
    box.append(svg,legend,caption);
    function paint(){
      const n=Number(period.value), points=n?run.curves.slice(-n):run.curves;
      const ys=points.flatMap(x=>[x.value-1,x.benchmark-1]);
      const low=Math.min(0,...ys),high=Math.max(0,...ys),span=high-low||.01;
      const x=i=>60+i*570/Math.max(1,points.length-1), y=v=>14+154*(1-(v-low)/span);
      function shape(tag,attrs,text){
        const e=document.createElementNS(svg.namespaceURI,tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));
        if(text!==undefined)e.textContent=text;svg.append(e);
      }
      svg.replaceChildren();
      for(let i=0;i<4;i++){
        const v=low+i*span/3;shape('line',{x1:58,x2:632,y1:y(v),y2:y(v),stroke:'var(--line2)'});
        shape('text',{x:52,y:y(v)+4,'text-anchor':'end'},(v*100).toFixed(1)+'%');
      }
      for(const [key,color,dash] of [['benchmark','var(--pink)','5 4'],['value','var(--cyan)','none']]){
        shape('polyline',{points:points.map((r,i)=>x(i)+','+y(r[key]-1)).join(' '),
          fill:'none',stroke:color,'stroke-width':2.3,'stroke-dasharray':dash});
      }
      shape('text',{x:60,y:192},points[0].date);shape('text',{x:630,y:192,'text-anchor':'end'},points.at(-1).date);
      caption.textContent='横轴为交易日期，纵轴为相对验证期初本金的累计收益率。';
    }
    period.addEventListener('change',paint);paint();
  }
  function renderResult(box,r){
    box.replaceChildren();box.append(el('h3',r.marketName+' · '+E.MODELS[r.config.model]));
    const download=el('button','下载本次实验 JSON');download.type='button';
    download.onclick=()=>{
      const url=URL.createObjectURL(new Blob([JSON.stringify(r,null,2)],{type:'application/json'}));
      const link=el('a');link.href=url;link.download='marketlab-quant-'+r.id+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
    };
    box.append(download);
    const metrics=el('div',undefined,'q-metrics');
    function metric(name,value){const item=el('div');item.append(el('span',name),el('strong',value));metrics.append(item);}
    metric('样本外命中率',percent(r.metrics.accuracy));metric('Brier 分数',r.metrics.brier.toFixed(4));
    metric('频率基准命中率',percent(r.metrics.baseline.accuracy));metric('频率基准 Brier',r.metrics.baseline.brier.toFixed(4));
    if(r.curves.length){metric('策略累计收益',percent(r.metrics.totalReturn));metric('最大回撤',percent(r.metrics.maxDrawdown));metric('成交次数',r.metrics.tradeCount+' 次');}
    box.append(metrics,el('p',r.conclusion,'note'),el('p',
      '训练起点 '+r.samples.trainStart+' 至 '+r.samples.trainEnd+'（'+r.samples.train+' 条），训练标签最迟 '+r.samples.lastTrainingLabel+
      ' 已揭晓。验证期 '+r.samples.validationStart+' 至 '+r.samples.validationEnd+'，检验 '+r.samples.validation+' 个已到期方向预测。','fine'));
    if(r.curves.length){
      drawCurve(box,r);
      box.append(el('p','初始本金 '+fmt(r.metrics.initialCapital)+'，期末权益 '+fmt(r.metrics.finalEquity)+
        '。手续费 '+fmt(r.metrics.totalFees)+'，滑点成本 '+fmt(r.metrics.totalSlippage)+
        '（均以账户计价单位计）。年化波动率 '+percent(r.metrics.annualVolatility)+'，夏普比率 '+fmt(r.metrics.sharpe)+'。','fine'));
    }
    const detail=(title,element)=>{const d=el('details');d.append(el('summary',title));d.addEventListener('toggle',()=>{if(d.open&&d.children.length===1)d.append(element());});box.append(d);};
    detail('逐次验证预测',()=>table(['起点','到期交易日','上涨概率','实际方向'],
      r.predictions.map(p=>[p.date,p.targetDate,percent(p.probability),p.actual?'上涨':'未上涨'])));
    if(r.curves.length){
      detail('成交明细（'+r.trades.length+' 次）',()=>r.trades.length?table(['信号收盘日','成交开盘日','操作','开盘价（'+(r.unit||'价格')+'）','成交价（'+(r.unit||'价格')+'）','份额','费用','滑点成本'],
        r.trades.map(t=>[t.signalDate,t.date,t.side==='buy'?'买入':'卖出',fmt(t.open),fmt(t.price),fmt(t.units),fmt(t.fee),fmt(t.slippage)])):el('p','验证期内没有触发交易。'));
      detail('每日净值与回撤',()=>table(['日期','策略净值','对照净值','回撤'],r.curves.map(p=>[p.date,fmt(p.value),fmt(p.benchmark),percent(p.drawdown)])));
    }
    detail('实验设置与来源',()=>{
      const div=el('div'),c=r.config;
      const params=c.model==='forest'?c.trees+' 棵树，最大深度 '+c.depth+'，种子 1729':c.model==='logistic'?'正则强度 C = '+c.C:
        c.features.map(f=>E.FEATURES[f]+' × '+c.weights[f]).join('，');
      div.append(el('p','模型 '+E.MODELS[c.model]+' · '+r.version+' · 期限 '+c.horizon+' 日。'+params+'。指标：'+c.features.map(k=>E.FEATURES[k]).join('、')+'。'),
        el('p','数据：'+(r.source.name||r.marketName)+'，截止 '+r.source.asOf+'。'+(r.source.license||'')));
      if(r.source.snapshotSha256||r.source.snapshotId)div.append(el('p','快照指纹 '+(r.source.snapshotSha256||r.source.snapshotId),'q-hash'));
      try{const u=new URL(r.source.url);if(['https:','http:'].includes(u.protocol)){const a=el('a','查看行情来源');a.href=u.href;div.append(a);}}catch{}
      return div;
    });
  }
  function mount(container){
    if(!container||container.dataset.quantMounted)return;
    container.dataset.quantMounted='1';container.classList.add('q-lab');
    const all=assets();
    if(!all.length){container.append(el('p','暂无足够的市场日线。请载入有效快照后再打开量化研究。','notice'));return;}
    const form=el('form',undefined,'panel'),grid=el('div',undefined,'q-grid'),fields={};
    form.append(el('h2','量化研究中心'),el('p','先固定训练期，再用后续行情检验模型；交易策略按下一交易日开盘成交。','note'),grid);
    function field(name,title,type,options,parent=grid){
      const label=el('label',title),input=el(type==='select'?'select':'input');
      input.name=name;if(type!=='select')input.type=type;else for(const [k,v] of Object.entries(options)) option(input,k,v);
      input.required=true;label.append(input);parent.append(label);fields[name]=input;return input;
    }
    field('market','研究标的','select',Object.fromEntries(all.map(a=>[a.id,a.name])));
    field('horizon','预测期限','select',{'1':'1 个交易日','5':'5 个交易日','10':'10 个交易日','20':'20 个交易日'}).value='5';
    field('model','预测模型','select',E.MODELS).value='logistic';
    field('strategy','交易策略','select',E.STRATEGIES).value='ma';
    for(const [key,t] of [['trainStart','训练开始'],['trainEnd','训练截止'],['validStart','验证开始'],['validEnd','验证截止']])field(key,t,'date');
    function num(key,title,value,min,max,step,parent){
      const n=field(key,title,'number',null,parent);Object.assign(n,{min,max,step,value});return n;
    }
    const features=el('fieldset',undefined,'q-features');features.append(el('legend','输入指标'));form.append(features);
    const checks={},weights={};
    for(const [key,name] of Object.entries(E.FEATURES)){
      const label=el('label'),input=el('input');input.type='checkbox';input.checked=['return5','return20','maGap5','volatility20'].includes(key);
      label.append(input,document.createTextNode(' '+name));features.append(label);checks[key]=input;
    }
    const params=el('div',undefined,'q-grid q-params');form.append(params);
    num('C','逻辑回归 C',1,.01,100,.01,params);num('trees','森林树数',31,3,61,1,params);num('depth','最大树深',5,1,10,1,params);
    num('fast','短均线（日）',5,2,100,1,params);num('slow','长均线（日）',20,3,200,1,params);
    num('lookback','动量回看（日）',10,1,120,1,params);num('threshold','买入概率阈值（%）',50,0,100,.1,params);
    num('feeBp','单边费用（基点）',5,0,999,.1,params);num('slipBp','单边滑点（基点）',5,0,999,.1,params);
    const ws=el('fieldset',undefined,'q-features q-weights');ws.append(el('legend','趋势权重（负值反向）'));form.append(ws);
    for(const [key,name] of Object.entries(E.FEATURES))weights[key]=num('w'+key,name,defaults[key],-10,10,.1,ws);
    const current=()=>all.find(a=>a.id===fields.market.value);
    const availability=el('p',undefined,'fine');form.append(availability);
    function adapt(){
      const model=fields.model.value,strategy=fields.strategy.value,ohlc=E.hasOHLC(current().rows);
      function show(name,on){fields[name].disabled=!on;fields[name].parentNode.hidden=!on;}
      show('C',model==='logistic');show('trees',model==='forest');show('depth',model==='forest');
      for(const k of ['fast','slow'])show(k,ohlc&&strategy==='ma');
      show('lookback',ohlc&&strategy==='momentum');show('threshold',ohlc&&strategy==='model');
      show('feeBp',ohlc);show('slipBp',ohlc);fields.strategy.disabled=!ohlc;
      ws.hidden=model!=='trend';for(const k of Object.keys(weights))show('w'+k,model==='trend'&&checks[k].checked);
      availability.textContent=ohlc?'1 基点 = 0.01%。所有费用、滑点与买入持有对照采用同一口径。':'该标的只有收盘序列。可验证预测模型；真实开盘价不足，交易回测关闭。';
      if(current().kind==='index')availability.textContent+=' 指数按点位模拟组合，实际跟踪工具有跟踪误差。';
      if(current().kind==='yield')availability.textContent+=' 此处预测收益率水平的升降，不能当作债券价格收益。';
    }
    function dates(){
      const rows=current().rows,cut=Math.min(rows.length-2,Math.floor(rows.length*.65));
      Object.assign(fields.trainStart,{value:rows[0].date});fields.trainEnd.value=rows[cut-1].date;
      fields.validStart.value=rows[cut].date;fields.validEnd.value=rows.at(-1).date;
      for(const k of ['trainStart','trainEnd','validStart','validEnd']){fields[k].min=rows[0].date;fields[k].max=rows.at(-1).date;}
      adapt();
    }
    for(const n of [fields.strategy,fields.model,...Object.values(checks)])n.addEventListener('change',adapt);
    fields.market.addEventListener('change',dates);dates();
    const submit=el('button','运行并保存实验','primary'), status=el('p',undefined,'note');submit.type='submit';status.setAttribute('role','status');
    form.append(submit,status);
    const result=el('section',undefined,'panel q-output'),history=el('section',undefined,'panel q-history');
    result.hidden=true;
    container.append(form,result,history);
    function showHistory(){
      history.replaceChildren(el('h3','本机实验记录'));
      let saved;
      try{saved=loadRuns();}catch{history.append(el('p','无法读取本机保存记录。','note'));return;}
      if(!saved.length){history.append(el('p','运行后可在这里重看当时的参数、成交和验证结果。','fine'));return;}
      const select=el('select'),label=el('label','已保存的实验');saved.slice().reverse().forEach(r=>option(select,r.id,r.marketName+' · '+(E.MODELS[r.config?.model]||'模型')+' · '+new Date(r.createdAt).toLocaleString('zh-CN',{hour12:false})));
      label.append(select);const view=el('button','查看结果');view.type='button';
      view.onclick=()=>{const r=saved.find(v=>v.id===select.value);if(r){renderResult(result,r);result.hidden=false;}};
      const del=el('button','删除这次记录');del.type='button';del.onclick=()=>{
        if(!global.confirm('删除所选的本机量化实验记录？'))return;
        try{global.localStorage.setItem(KEY,JSON.stringify(loadRuns().filter(r=>r.id!==select.value)));showHistory();}
        catch{status.textContent='记录未能删除。';}
      };
      history.append(label,view,del);
    }
    showHistory();
    form.addEventListener('submit',async event=>{
      event.preventDefault();submit.disabled=true;status.textContent='正在训练并验证…';
      await new Promise(resolve=>setTimeout(resolve,20));
      try{
        const c={};for(const [k,f] of Object.entries(fields))if(!k.startsWith('w')&&k!=='market')c[k]=f.type==='number'?Number(f.value):f.value;
        c.horizon=Number(c.horizon);c.threshold/=100;c.features=Object.keys(checks).filter(k=>checks[k].checked);
        c.weights=Object.fromEntries(Object.keys(weights).map(k=>[k,Number(weights[k].value)]));
        const asset=current();await identifySource(asset);const r=E.run(asset,c);
        r.id=global.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
        r.createdAt=new Date().toISOString();r.report=report(r);
        r.conclusion=E.MODELS[c.model]+'的 Brier 分数为 '+r.metrics.brier.toFixed(4)+'，同期频率基准为 '+r.metrics.baseline.brier.toFixed(4)+'（越低越好）。'+
          (r.curves.length?E.STRATEGIES[c.strategy]+'累计收益 '+percent(r.metrics.totalReturn)+'，买入持有对照为 '+percent(r.benchmark.totalReturn)+'。':'该资产仅做方向验证。');
        result.hidden=false;renderResult(result,r);
        try{const records=loadRuns(),reused=records.some(v=>v.marketId===r.marketId&&v.config.validStart===c.validStart&&v.config.validEnd===c.validEnd);
          records.push(r);global.localStorage.setItem(KEY,JSON.stringify(records));showHistory();
          status.textContent='已保存到本机，可在研究报告中引用。'+(reused?'这个验证窗口已在本机使用过；据此调整参数后的成绩属于探索结果。':'');
          global.dispatchEvent(new Event('marketlab:quant-saved'));
        }catch{status.textContent='实验已完成，本机存储不可用或空间不足，结果仅在此页显示。';}
      }catch(e){status.textContent='实验未完成。'+e.message;}
      finally{submit.disabled=false;}
    });
  }
  global.MarketLabQuant={mount};
})(window);
