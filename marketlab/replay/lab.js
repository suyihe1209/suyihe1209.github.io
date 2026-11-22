'use strict';
(function(scope){
  const feeRate=.001, slipRate=.0005, version='replay-open-v1';
  const archiveKey='ml.replay.runs.v1';
  const round = n => Number(n.toFixed(8));
  const number = n => Number.isFinite(n)?n.toLocaleString('zh-CN',{maximumFractionDigits:2}):'—';
  const pct = n => Number.isFinite(n)?number(n*100)+'%':'—';
  const unique = () => scope.crypto?.randomUUID?.() || 'replay-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  function equityPoint(s,bar){
    const equity=s.cash+s.holdings*bar.close,benchmark=s.benchmarkCash+s.benchmarkHoldings*bar.close;
    s.peak=Math.max(s.peak,equity);
    const drawdown=1-equity/s.peak;
    s.maxDrawdown=Math.max(s.maxDrawdown,drawdown);
    return {date:bar.date,cash:s.cash,holdings:s.holdings,close:bar.close,equity:round(equity),
      benchmark:round(benchmark),return:equity/s.config.initialCash-1,benchmarkReturn:benchmark/s.config.initialCash-1,drawdown};
  }
  function makeSession(data,startDate,initialCash,sessions) {
    if(!Number.isFinite(initialCash)||initialCash<1||initialCash>1e10)throw Error('初始资金须在 1 至 100 亿之间。');
    if(!Number.isInteger(sessions)||sessions<1||sessions>250)throw Error('回合长度须为 1 至 250 个交易日。');
    const start=data.bars.findIndex(b=>b.date===startDate);
    if(start<0||start>=data.bars.length-1)throw Error('起点后至少要有一个交易日。');
    const s={id:unique(),createdAt:new Date().toISOString(),marketId:data.market.id,marketName:data.market.name,
      snapshot:data.experiment?.snapshotSha256||data.source.sha256||data.source.asOf,engineVersion:version,
      config:{startDate,initialCash,sessions,feeRate,slipRate,currency:data.market.currency},
      start,cursor:start,end:Math.min(data.bars.length-1,start+sessions),cash:initialCash,holdings:0,
      benchmarkCash:initialCash,benchmarkHoldings:0,peak:initialCash,maxDrawdown:0,totalFees:0,totalSlippage:0,
      pending:null,finished:false,curves:[],trades:[],decisions:[],analyses:[]};
    s.curves.push(equityPoint(s,data.bars[start]));return s;
  }
  function decide(s,side,qty,note){
    if(s.finished)throw Error('回合已经结束。');
    if(s.pending!==null)throw Error('请先撤销当前待成交订单。');
    if(!['buy','sell','hold'].includes(side))throw Error('未知的指令。');
    if(side!=='hold'&&(!Number.isSafeInteger(qty)||qty<=0))throw Error('数量须为正整数。');
    if(side==='sell'&&qty>s.holdings)throw Error('可卖数量不足。');
    const d={index:s.decisions.length,date:s.curves.at(-1).date,side,quantity:side==='hold'?0:qty,
      note:String(note||'').trim().slice(0,800),status:side==='hold'?'recorded':'pending'};
    s.decisions.push(d);if(side!=='hold')s.pending=d.index;
    return d;
  }
  function cancel(s,why='cancelled'){
    if(s.pending===null)return false;
    s.decisions[s.pending].status=why;s.pending=null;return true;
  }
  function execute(s,bar){
    if(s.pending===null)return;
    const d=s.decisions[s.pending],buy=d.side==='buy',price=bar.open*(1+(buy?1:-1)*s.config.slipRate);
    const gross=price*d.quantity,fee=gross*s.config.feeRate,slippage=Math.abs(price-bar.open)*d.quantity;
    s.pending=null;
    if(buy&&gross+fee>s.cash||!buy&&d.quantity>s.holdings){
      d.status='rejected';d.executionDate=bar.date;d.message=buy?'开盘含成本所需资金超过可用现金':'持仓不足';return;
    }
    s.cash=round(s.cash+(buy?-(gross+fee):gross-fee));s.holdings+=(buy?1:-1)*d.quantity;
    s.totalFees+=fee;s.totalSlippage+=slippage;d.status='filled';d.executionDate=bar.date;
    s.trades.push({decisionDate:d.date,date:bar.date,side:d.side,quantity:d.quantity,
      open:bar.open,price:round(price),fee:round(fee),slippage:round(slippage),cash:s.cash,holdings:s.holdings});
  }
  function advance(s,bars){
    if(s.finished||s.cursor>=s.end)return false;
    const bar=bars[s.cursor+1];
    if(!bar||bar.date<=s.curves.at(-1).date||![bar.open,bar.close].every(n=>Number.isFinite(n)&&n>0))throw Error('下一交易日行情无效，已暂停。');
    if(s.cursor===s.start){
      const unit=bar.open*(1+s.config.slipRate)*(1+s.config.feeRate);
      s.benchmarkHoldings=Math.floor(s.config.initialCash/unit);s.benchmarkCash=s.config.initialCash-s.benchmarkHoldings*unit;
    }
    execute(s,bar);s.cursor++;s.curves.push(equityPoint(s,bar));
    if(s.cursor===s.end){s.finished=true;s.finishedAt=new Date().toISOString();}
    return true;
  }
  function finish(s){
    if(s.finished)return;
    cancel(s,'expired');s.finished=true;s.finishedAt=new Date().toISOString();
  }
  function summarize(s,data){
    const last=s.curves.at(-1);
    const metrics={initialCash:s.config.initialCash,finalEquity:last.equity,endingCash:s.cash,endingHoldings:s.holdings,
      totalReturn:last.return,benchmarkReturn:last.benchmarkReturn,excessReturn:last.return-last.benchmarkReturn,
      maxDrawdown:s.maxDrawdown,fees:round(s.totalFees),slippage:round(s.totalSlippage),tradeCount:s.trades.length,
      sessions:s.cursor-s.start,startDate:s.config.startDate,endDate:last.date};
    return {kind:'replay',id:s.id,createdAt:s.createdAt,finishedAt:s.finishedAt,marketName:s.marketName,marketId:s.marketId,
      config:{...s.config,engineVersion:version},source:{...data.source,snapshot:s.snapshot},metrics,
      curves:s.curves,trades:s.trades,decisions:s.decisions,analyses:s.analyses,
      report:{
        facts:[{label:'回放区间',value:metrics.startDate+' 至 '+metrics.endDate},{label:'初始资金',value:number(metrics.initialCash)+' '+s.config.currency},
          {label:'期末净值',value:number(metrics.finalEquity)+' '+s.config.currency},{label:'账户收益',value:pct(metrics.totalReturn)},
          {label:'买入持有收益',value:pct(metrics.benchmarkReturn)},{label:'最大回撤',value:pct(metrics.maxDrawdown)},{label:'成交笔数',value:metrics.tradeCount+' 笔'}],
        lines:[['账户净值','equity'],['买入持有净值','benchmark']].map(([label,key])=>({label,unit:s.config.currency,points:s.curves.map(c=>({x:c.date,y:c[key]}))})),
        notes:['模拟成交使用下一交易日开盘价，每边手续费 0.10%、滑点 0.05%。','期末持仓以末日收盘价估值，不包含未执行的清仓成本。']
      },
      conclusion:'回合推进 '+metrics.sessions+' 个交易日，成交 '+metrics.tradeCount+' 笔。账户收益 '+pct(metrics.totalReturn)+'，买入持有基准 '+pct(metrics.benchmarkReturn)+'，最大回撤 '+pct(metrics.maxDrawdown)+'。末日持仓按收盘价计值。'};
  }
  function marketClose(market,day){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return null;
    const id=String(market.id||''),zone=market.timezone;
    if(zone==='Asia/Taipei'&&id.startsWith('TWSE:'))return {time:Date.parse(day+'T13:30:00+08:00'),label:day+' 13:30 台北时间'};
    if(zone==='Asia/Shanghai'&&/^(CSI|SSE|SZSE):/.test(id))return {time:Date.parse(day+'T15:00:00+08:00'),label:day+' 15:00 北京时间'};
    if(zone==='America/New_York'&&['SP:SPX','NASDAQ:IXIC'].includes(id)){
      const early=['2023-07-03','2023-11-24','2024-07-03','2024-11-29','2024-12-24','2025-07-03','2025-11-28','2025-12-24','2026-11-27','2026-12-24'];
      const covered=day>='2023-01-01'&&day<='2026-12-31',hour=covered&&!early.includes(day)?16:13;
      const utcNoon=Date.parse(day+'T12:00:00Z');
      const localHour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',hourCycle:'h23'}).format(utcNoon));
      return {time:utcNoon+(hour-localHour)*3600000,label:day+' '+hour+':00 纽约时间'+(covered?'':'（保守消息截止）')};
    }
    // UTC+14 starts each calendar date first. Even the earliest local session
    // could only close later than this instant, without guessing its timezone.
    return {time:Date.parse(day+'T00:00:00+14:00'),label:'市场收盘时刻未确认，仅列全球最早进入 '+day+' 时已公开的消息'};
  }
  function publishedNews(news,cutoff){
    if(!Array.isArray(news)||!Number.isFinite(cutoff))return [];
    return news.filter(n=>typeof n?.publishedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(n.publishedAt)
      &&Date.parse(n.publishedAt)<=cutoff&&typeof n.title==='string'&&/^https:\/\//i.test(n.sourceUrl))
      .sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)).slice(0,3);
  }
  const engine={makeSession,decide,cancel,advance,finish,summarize,marketClose,publishedNews};
  if(typeof module!=='undefined'&&module.exports)module.exports=engine;
  const mounts=new WeakMap();
  function mount(container){
    if(mounts.has(container))return mounts.get(container);
    const data=scope.MARKETLAB_DATA;
    if(!data?.market||!Array.isArray(data.bars)||data.bars.length<2||typeof scope.MarketLabChart!=='function'){
      container.textContent='金融时光机需要至少两个有开盘和收盘价的历史交易日，以及日线图组件。';return;
    }
    const bars=data.bars,market=data.market,unit=market.currency||market.priceUnit;
    const ui=document.createElement('section');ui.className='replay-lab';
    ui.innerHTML=`
<header class="replay-intro"><p class="eyebrow">历史回放</p><h2>金融时光机</h2><p>站在当日收盘做决定，下一交易日开盘执行。你可以逐日观察，也可以让行情自动向前播放。</p></header>
<form class="panel replay-setup">
<label>起始交易日<select data-r="start"></select></label>
<label>初始模拟资金<input data-r="funds" type="number" min="1" max="10000000000" step="any" value="100000" required></label>
<label>推进交易日数<input data-r="length" type="number" min="1" max="250" step="1" value="20" required></label>
<button class="primary" data-r="begin" type="submit">开始回合</button>
</form>
<p class="fine" data-r="setup-note"></p>
<div class="replay-body" hidden>
<div class="replay-grid">
<section class="panel"><div class="panel-head"><div><p class="eyebrow">当日收盘</p><h3 data-r="day"></h3></div><strong data-r="progress"></strong></div>
<div class="replay-nav"><button type="button" data-r="step">推进一个交易日</button><button type="button" data-r="play">自动播放</button>
<label>速度<select data-r="speed"><option value="2500">每 2.5 秒</option><option value="1000">每秒</option><option value="5000">每 5 秒</option></select></label></div>
<div class="chart-tools"><strong>已知日 K 线</strong><div class="periods"><button type="button" data-range="5">5 日</button><button type="button" data-range="20">20 日</button><button type="button" data-range="60">60 日</button></div></div>
<canvas tabindex="0" data-chart="candles" aria-label="已知交易日 K 线和成交量，方向键可逐条查阅。"></canvas>
<div class="inspect"><label>查阅日线<select data-chart="inspect-date"></select></label><p data-chart="ohlcv"></p></div><p class="fine" data-chart="chart-meta"></p>
<details><summary>行情与成交假设</summary><p data-r="source"></p><p>买卖均收成交金额 0.10% 的模拟手续费，滑点每边 0.05%（买高、卖低）。整份成交，资金不足则整笔拒绝。无杠杆和做空，未另计税费及分红。期末以收盘价估值，未强制清仓。</p><p>基准使用相同的初始资金，在起点后的首个交易日开盘按相同成本尽量买入整份并持有。若导入指数点位，模拟单位按点位 × 1 计值。</p></details>
</section>
<section class="panel"><p class="eyebrow">模拟账户</p><h3>资产与决策</h3><div class="replay-metrics" data-r="metrics"></div>
<form class="replay-order"><label>操作<select data-r="side"><option value="buy">买入</option><option value="sell">卖出</option><option value="hold">记录观望</option></select></label>
<label data-r="quantity-label">数量（整数份）<input type="number" min="1" max="1000000000" step="1" required value="100" data-r="quantity"></label>
<label class="full">决策理由 <small>选填</small><textarea rows="2" maxlength="800" data-r="reason"></textarea></label>
<button type="submit" data-r="order">提交模拟订单</button><button type="button" data-r="cancel" hidden>撤销待成交订单</button></form>
<p class="fine" data-r="pending"></p><p role="status" data-r="feedback"></p>
<button type="button" data-r="finish">结束回合并复盘</button></section>
</div>
<section class="panel"><h3>当时已公开的消息</h3><p class="fine" data-r="news-cutoff"></p><div data-r="news"></div></section>
<section class="panel"><div class="panel-head"><h3>当日 AI 分析</h3><button type="button" data-r="analyze" hidden>分析当日行情</button></div><p data-r="ai-status"></p><div data-r="analysis"></div></section>
<section class="panel"><h3>交易与决策日志</h3><div data-r="log"></div></section>
<section class="panel" data-r="summary" hidden><h3>回合复盘</h3><div data-r="review"></div><p class="fine" data-r="archive-status"></p><button type="button" data-r="retry-save" hidden>重试保存回合</button></section>
</div>
<details class="panel"><summary>已保存的回合</summary><div data-r="archives"></div></details>`;
    container.replaceChildren(ui);
    const get=key=>ui.querySelector('[data-r="'+key+'"]');
    const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
    const table=(heads,rows)=>{
      const wrap=el('div'),t=el('table');wrap.className='scroll-table';wrap.append(t);
      const h=t.createTHead().insertRow();for(const label of heads){const th=el('th',label);th.scope='col';h.append(th);}
      const body=t.createTBody();for(const row of rows){const tr=body.insertRow();for(const value of row)tr.insertCell().textContent=value;}
      return wrap;
    };
    const labChart=scope.MarketLabChart(bars,market,ui);
    const sessionKey='ml.replay.active.v1.'+market.id;
    const snapshot=data.experiment?.snapshotSha256||data.source.sha256||data.source.asOf;
    let active=null,timer=0,period=20,aiStatus='loading',aiRequest=null,notice='',saving=null,archiveMessage='';
    const signal=new AbortController();
    function listen(target,event,fn){target.addEventListener(event,fn,{signal:signal.signal});}
    function persist(){
      try {sessionStorage.setItem(sessionKey,JSON.stringify(active));}
      catch {notice='此浏览器无法保存回合进度。请保持本页打开。';}
    }
    function pause(){clearInterval(timer);timer=0;get('play').textContent='自动播放';}
    function shutdownAI(){aiRequest?.abort();aiRequest=null;}
    function archiveRows(){
      const saved=JSON.parse(localStorage.getItem(archiveKey)||'[]');
      if(!Array.isArray(saved))throw Error('记录格式异常');return saved;
    }
    function drawArchives(){
      const host=get('archives');host.replaceChildren();
      try {
        const all=archiveRows();
        const rows=active&&!active.finished ? all.filter(r=>r.marketId===active.marketId&&r.metrics.endDate<=bars[active.cursor].date) : all;
        if(rows.length<all.length)host.append(el('p','进行中仅显示当前市场且已在回放截止日前结束的回合。'));
        host.append(rows.length?table(['市场','回合起点','复盘截止','账户收益','基准收益'],[...rows].reverse().map(r=>[r.marketName,r.config.startDate,r.metrics.endDate,pct(r.metrics.totalReturn),pct(r.metrics.benchmarkReturn)])):el('p','尚未保存回合。'));
      }catch{host.append(el('p','无法读取本机回合记录。'));}
    }
    async function archive(){
      if(!active?.finished)return;
      if(saving)return saving;
      const done=summarize(active,data);
      function write(){const rows=archiveRows();if(!rows.some(r=>r.id===done.id)){rows.push(done);localStorage.setItem(archiveKey,JSON.stringify(rows));}}
      saving=(async()=>{
        try {
          if(navigator.locks?.request)await navigator.locks.request(archiveKey,write);else write();
          archiveMessage='已保存到本机，可在研究报告中引用。';get('retry-save').hidden=true;
          window.dispatchEvent(new CustomEvent('marketlab:records-changed',{detail:{type:'replay',id:done.id}}));
        }catch{archiveMessage='本机记录未保存。请检查存储权限或可用空间，再重试。';get('retry-save').hidden=false;}
        get('archive-status').textContent=archiveMessage;drawArchives();
      })();
      try {await saving;}finally{saving=null;}
    }
    const sides={buy:'买入',sell:'卖出',hold:'观望'},states={filled:'已成交',pending:'待成交',rejected:'拒绝成交',cancelled:'已撤销',recorded:'已记录',expired:'回合结束撤销'};
    function drawNews(day){
      const cutoff=marketClose(market,day), host=get('news');
      get('news-cutoff').textContent='消息截止 · '+(cutoff?.label||'交易日期不可用');
      host.replaceChildren();
      const available=publishedNews(scope.ML_ASSETS?.news,cutoff?.time);
      if(!available.length){host.append(el('p','截至此刻，资料库还没有已公开的消息。'));return;}
      const list=el('ul');
      for(const n of available){
        const item=el('li'),link=el('a',n.title),stamp=el('time',n.datePrecision==='day'?n.date+'（仅公布日期）':n.publishedAt.replace('T',' '));
        link.href=n.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';
        stamp.dateTime=n.publishedAt;
        item.append(link,' · '+n.source+' · ',stamp);list.append(item);
      }
      host.append(list);
    }
    function drawAI(){
      if(!active)return;
      const day=bars[active.cursor].date,found=active.analyses.find(a=>a.cutoff===day);
      get('analyze').hidden=active.finished||Boolean(found)||aiStatus!=='on'||active.cursor<20;
      get('analyze').disabled=Boolean(aiRequest);
      get('ai-status').textContent=found?'此判断基于当日及以前的行情，模型概率未经统计校准。':
        aiRequest?'正在分析当前截止日…':aiStatus==='off'?'AI 服务未配置。可在实验室本机服务端配置模型与密钥。':
        aiStatus==='error'?'AI 服务暂不可用。':aiStatus==='loading'?'正在检查本机 AI 服务…':
        active.finished?'本回合已封存。':active.cursor<20?'当时已知行情不足 21 个交易日，暂不调用模型。':'仅向服务端提交当前市场和已揭晓的截止日期。';
      const target=get('analysis');target.replaceChildren();
      if(found){target.append(el('p','主观上涨概率 '+pct(found.probability)+' · '+found.model+' · '+found.cutoff),el('p',found.reasoning));
        for(const [k,name] of [['bullishFactors','看涨'],['bearishFactors','看跌'],['uncertainties','不确定性']])target.append(el('p',name+' · '+found[k].join('；')));}
    }
    function draw(){
      const s=active;if(!s)return;
      ui.querySelector('.replay-body').hidden=false;
      get('begin').textContent=s.finished?'开始新回合':'重新开始';
      const bar=bars[s.cursor],p=s.curves.at(-1);
      get('day').textContent=market.name+' · '+bar.date;
      drawNews(bar.date);
      get('progress').textContent='第 '+(s.cursor-s.start)+' / '+(s.end-s.start)+' 日';
      labChart(s.cursor,period);ui.querySelectorAll('[data-range]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.range)===period)));
      const cells=[['资产净值',number(p.equity)+' '+unit],['现金',number(s.cash)+' '+unit],['持仓',number(s.holdings)+' 份'],['账户收益',pct(p.return)],['买入持有',pct(p.benchmarkReturn)],['最大回撤',pct(s.maxDrawdown)]];
      const host=get('metrics');host.replaceChildren();for(const [label,value] of cells){const c=el('div');c.append(el('span',label),el('strong',value));host.append(c);}
      for(const id of ['play','step','finish','side','quantity','order','reason','speed'])get(id).disabled=s.finished;
      get('cancel').hidden=s.pending===null;get('order').disabled=s.finished||s.pending!==null;
      get('pending').textContent=s.pending===null?'':('待下一交易日开盘 · '+sides[s.decisions[s.pending].side]+' '+number(s.decisions[s.pending].quantity)+' 份。');
      get('feedback').textContent=notice;
      const log=get('log');log.replaceChildren();
      if(s.decisions.length)log.append(table(['决策日','判断','状态','执行日','理由 / 备注'],[...s.decisions].reverse().map(d=>[d.date,sides[d.side]+(d.quantity?' '+number(d.quantity)+' 份':''),states[d.status],d.executionDate||'—',[d.note,d.message].filter(Boolean).join(' · ')||'—'])));
      else log.append(el('p','还没有提交决策。'));
      if(s.trades.length)log.append(table(['成交日','方向','开盘价','含滑点成交价','手续费','成交后现金'],[...s.trades].reverse().map(t=>[t.date,sides[t.side],number(t.open),t.price.toFixed(4),number(t.fee),number(t.cash)])));
      get('summary').hidden=!s.finished;
      if(s.finished){const report=summarize(s,data);get('review').replaceChildren(el('p',report.conclusion),el('p','模拟手续费合计 '+number(report.metrics.fees)+' '+unit+'，滑点成本合计 '+number(report.metrics.slippage)+' '+unit+'。'),
        table(['交易日','账户净值','基准净值','回撤'],report.curves.map(c=>[c.date,number(c.equity),number(c.benchmark),pct(c.drawdown)])));}
      drawAI();
      drawArchives();
    }
    function step(){
      if(!active||active.finished)return;
      shutdownAI();
      try {
        const orderIndex=active.pending;
        advance(active,bars);
        const order=orderIndex===null?null:active.decisions[orderIndex];
        notice=order?(states[order.status]+' · '+(order.message||sides[order.side]+' '+number(order.quantity)+' 份。')):'';
        if(active.finished)pause();
        persist();draw();if(active.finished)archive();
      }catch(e){pause();notice=e.message;draw();}
    }
    function play(){
      if(timer){pause();return;}
      if(!active||active.finished)return;
      get('play').textContent='暂停播放';
      timer=setInterval(()=>{if(document.hidden||!ui.getClientRects().length){pause();return;}step();},Number(get('speed').value));
    }
    listen(ui.querySelector('.replay-setup'),'submit',async e=>{
      e.preventDefault();let next;
      try{next=makeSession(data,get('start').value,get('funds').valueAsNumber,get('length').valueAsNumber);}
      catch(err){get('setup-note').textContent=err.message;return;}
      if(active&&!active.finished){
        pause();
        if(!confirm('结束并保存当前回合，然后用所选设置重新开始？'))return;
        finish(active);persist();draw();
      }
      if(active?.finished){
        await archive();
        if(!get('retry-save').hidden){notice='前一回合尚未保存，请先重试。';draw();return;}
      }
      shutdownAI();active=next;notice='';archiveMessage='';get('reason').value='';get('retry-save').hidden=true;
      persist();draw();
    });
    listen(get('step'),'click',()=>{pause();step();});
    listen(get('play'),'click',play);
    listen(get('speed'),'change',()=>{if(timer){pause();play();}});
    listen(document,'visibilitychange',()=>{if(document.hidden)pause();});
    listen(window,'marketlab:navigate',event=>{if(event.detail!=='replay'){pause();shutdownAI();drawAI();}});
    listen(ui.querySelector('.replay-order'),'focusin',pause);
    listen(get('side'),'change',()=>{
      const hold=get('side').value==='hold';get('quantity-label').hidden=hold;get('quantity').required=!hold;
      get('order').textContent=hold?'记下观望理由':'提交模拟订单';
    });
    listen(ui.querySelector('.replay-order'),'submit',e=>{
      e.preventDefault();if(!active||active.finished)return;pause();
      try{
        const d=decide(active,get('side').value,get('quantity').valueAsNumber,get('reason').value);
        notice=d.side==='hold'?'观望判断已记录。':'已登记，下一交易日开盘尝试成交。';
        get('reason').value='';persist();
      }catch(err){notice=err.message;}draw();
    });
    listen(get('cancel'),'click',()=>{if(!active||active.finished)return;pause();cancel(active);notice='待成交订单已撤销。';persist();draw();});
    listen(get('finish'),'click',()=>{
      if(!active||active.finished)return;pause();
      if(!confirm('按当前已知收盘价结束回合并保存复盘？待成交订单将撤销。'))return;
      shutdownAI();finish(active);notice='已结束回合。';persist();draw();archive();
    });
    listen(get('retry-save'),'click',archive);
    ui.querySelectorAll('[data-range]').forEach(b=>listen(b,'click',()=>{period=Number(b.dataset.range);if(active)draw();}));
    async function checkAI(){
      if(!/^https?:$/.test(location.protocol)){aiStatus='off';drawAI();return;}
      const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),7000);
      try{
        const res=await fetch('/api/marketlab/status',{cache:'no-store',signal:ctl.signal});
        if(res.status===404||res.ok&&!res.headers.get('content-type')?.includes('json'))aiStatus='off';
        else if(!res.ok)aiStatus='error';
        else aiStatus=(await res.json()).configured===true?'on':'off';
      }catch{aiStatus='error';}finally{clearTimeout(t);drawAI();}
    }
    listen(get('analyze'),'click',async()=>{
      const s=active;if(!s||s.finished||aiRequest||aiStatus!=='on')return;
      const date=bars[s.cursor].date;pause();
      if(s.analyses.some(a=>a.cutoff===date))return;
      const req=new AbortController();aiRequest=req;drawAI();
      const timeout=setTimeout(()=>req.abort(),60000);
      try{
        const res=await fetch('/api/marketlab/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({marketId:market.id,cutoff:date}),signal:req.signal});
        const a=await res.json();
        if(!res.ok)throw Error(typeof a.error==='string'?a.error:'服务响应失败');
        if(!Number.isFinite(a.probability)||a.probability<0||a.probability>1||a.cutoff!==date||(a.marketId&&a.marketId!==market.id)||
          !['model','version','reasoning','predictedAt'].every(k=>typeof a[k]==='string'&&a[k].trim())||
          !['bullishFactors','bearishFactors','uncertainties'].every(k=>Array.isArray(a[k])&&a[k].length>0&&a[k].every(x=>typeof x==='string')))throw Error('服务返回的日期或格式无效');
        if(active===s&&!s.finished&&date===bars[s.cursor].date&&aiRequest===req){s.analyses.push(a);persist();}
      }catch(e){if(aiRequest===req){notice='AI 分析未保存 · '+(e.name==='AbortError'?'请求超时':e.message);get('feedback').textContent=notice;}}
      finally{clearTimeout(timeout);if(aiRequest===req)aiRequest=null;drawAI();}
    });
    get('start').replaceChildren(...bars.slice(0,-1).map(b=>new Option(b.date,b.date)));
    get('start').value=bars[Math.max(0,bars.length-61)].date;
    get('setup-note').textContent=market.name+' · 模拟记账币种 '+unit+'。起点为所选交易日收盘，回合最长至快照末日。';
    get('source').textContent=data.source.name+' · '+(market.priceBasis||market.priceUnit)+' · '+(market.timezone||'')+'。'+(data.source.basis||'')+' '+(data.source.attribution||data.source.license||'');
    try{
      const saved=JSON.parse(sessionStorage.getItem(sessionKey)||sessionStorage.getItem('ml.replay.active.v1')||'null');
      if(saved?.marketId===market.id&&saved.snapshot===snapshot&&saved.engineVersion===version&&bars[saved.cursor]?.date===saved.curves?.at(-1)?.date&&Number.isFinite(saved.cash)){
        active=saved;get('start').value=saved.config.startDate;get('funds').value=saved.config.initialCash;get('length').value=saved.config.sessions;
      }
    }catch{ /* session storage may be unavailable for file URLs */ }
    drawArchives();if(active){draw();if(active.finished)archive();}
    listen(window,'storage',e=>{if(e.key===archiveKey)drawArchives();});
    checkAI();
    function cleanup(){pause();shutdownAI();signal.abort();labChart.dispose?.();mounts.delete(container);}
    mounts.set(container,cleanup);return cleanup;
  }
  scope.MarketLabReplay={mount};
})(typeof window!=='undefined'?window:globalThis);
