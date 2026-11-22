'use strict';
(() => {
  const {el,num,saved}=MLView;
  const entries = {
    observe:['市场观察','比较资产走势、相关系数和财经新闻情绪。','MarketLabObserve'],
    arena:['预测擂台','对未来五个交易日作出判断，用实际收盘结算。'],
    quant:['量化研究','选择指标、模型和回测策略，比较样本外成绩。','MarketLabQuant'],
    replay:['金融时光机','回到某个交易日，用虚拟资金逐日做决定。','MarketLabReplay'],
    macro:['宏观沙盘','调整利率、通胀、增长和风险偏好，比较两种情景。','MarketLabMacro'],
    reports:['研究报告','汇总实验依据、模型成绩和交易决策，导出带图表的报告。','MarketLabReports']
  };
  const overview=document.getElementById('overview-module');
  let current='',visit=0;const mounted=new Set();
  async function showOverview(ticket){
    overview.replaceChildren();
    const head=el('div',undefined,'ml-head');head.append(el('h2','研究工作台'));overview.append(head);
    const tiles=el('div',undefined,'overview-indices');
    for(const id of MLMarkets.options){
      const snap=MLMarkets.snapshots.get(id),meta=MLMarkets.specs[id],row=snap?.bars?.at(-1);
      const a=el('a',undefined,'overview-market'),url=new URL(location.href);url.searchParams.set('market',id);url.hash='observe';a.href=url.href;
      a.append(el('strong',meta.shortName),el('span',row?num(row.close)+' 点':'载入个人研究行情'),el('small',row?'截至 '+row.date:meta.region==='cn'?'中国大陆':'美国'));
      tiles.append(a);
    }
    overview.append(tiles);
    const grid=el('div',undefined,'ml-grid');Object.entries(entries).forEach(([id,[name,desc]])=>{const a=el('a',undefined,'panel');a.href='#'+id;a.append(el('strong',name),el('p',desc));grid.append(a);});overview.append(grid);
    const recent=el('section',undefined,'panel wide');recent.append(el('h3','本机近期实验'));overview.append(recent);
    let preds=[];try{preds=await(await window.openMarketLabRecords()).all();}catch{}
    if(ticket!==visit)return;
    const recs=preds.map(r=>[r.submittedAt,'预测擂台',r.cutoff+' · 上涨概率 '+num(r.userProbability*100)+'%','arena']);
    for(const [key,id] of [['ml.observe.runs.v1','observe'],['ml.quant.runs.v1','quant'],['ml.replay.runs.v1','replay'],['ml.macro.runs.v1','macro']]){
      for(const r of saved(key))recs.push([r.createdAt,entries[id][0],r.marketName||'实验记录',id]);
    }
    recs.sort((a,b)=>String(b[0]).localeCompare(String(a[0])));
    if(!recs.length)recent.append(el('p','保存一次市场观察、预测、回测、交易回合或情景推演后，可在这里回看。','muted'));
    else for(const [date,name,title,id] of recs.slice(0,5)){const p=el('p');const link=el('a',name+' · '+title);link.href='#'+id;p.append(link,el('span','　'+new Date(date).toLocaleString('zh-CN'),'fine'));recent.append(p);}
  }
  async function route(){
    await window.ML_MARKETS_READY;
    const id=location.hash.slice(1);const next=Object.hasOwn(entries,id)?id:'overview';
    current=next;const ticket=++visit;
    document.querySelectorAll('[data-page]').forEach(s=>s.hidden=s.dataset.page!==current);
    document.querySelectorAll('.ml-nav a').forEach(a=>{if(a.hash==='#'+current)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    window.dispatchEvent(new CustomEvent('marketlab:navigate',{detail:current}));
    try{
      if(current==='overview')await showOverview(ticket);
      else if(current!=='arena'&&(!mounted.has(current)||current==='reports')){
        const module=window[entries[current][2]];if(!module?.mount)throw Error('模块资源未载入');
        await module.mount(document.querySelector('[data-page="'+current+'"]'));mounted.add(next);
      }
    }catch(err){if(ticket===visit){const box=document.querySelector('[data-page="'+next+'"]');box.replaceChildren(el('p','模块暂时无法打开：'+err.message+'。请从完整 Blog 目录刷新预览。','notice'));}}
  }
  window.addEventListener('hashchange',route);route();
})();
