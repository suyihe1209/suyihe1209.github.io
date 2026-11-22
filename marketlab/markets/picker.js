'use strict';
(async()=>{
  const catalog=window.MLMarkets, picker=document.getElementById('market-picker');
  await window.ML_MARKETS_READY;
  const missing=document.getElementById('missing-index'), status=document.getElementById('index-status');
  const requested=catalog.activeId, meta=catalog.specs[requested], loaded=catalog.snapshots.get(requested);
  if(requested==='TWSE:006207')picker.add(new Option('历史归档 · 复华沪深300 ETF',requested));
  picker.value=requested;
  picker.onchange=()=>{const url=new URL(location.href);url.searchParams.set('market',picker.value);location.assign(url.href);};
  missing.hidden=Boolean(loaded);
  if(catalog.onDevice){
    document.getElementById('android-download').hidden=true;
    document.getElementById('edition-info').textContent=loaded?'设备行情截至 '+loaded.source.asOf:'请先在应用行情页刷新以载入研究日线';
  }
  if(catalog.importedPrimary)document.getElementById('edition-info').textContent=loaded?'本机研究快照截至 '+loaded.source.asOf:'本机研究工作台';
  if(loaded||!meta)return;
  const button=document.getElementById('acquire-index'),file=document.getElementById('import-index');
  async function keep(data){
    if(data.market.id!==requested)throw Error('文件中的标的与当前所选研究市场不匹配。');
    if(!catalog.storeSnapshot(data))throw Error('本机浏览器没有足够的存储空间。');
    location.reload();
  }
  async function run(action){
    button.disabled=file.disabled=true;
    try{await action();}catch(e){status.textContent='未能载入。'+e.message+' 可重试或导入已授权的行情快照。';}
    finally{button.disabled=file.disabled=false;}
  }
  file.onchange=()=>run(async()=>{
    const selected=file.files[0];if(!selected)return;
    if(selected.size>10*1024*1024)throw Error('快照过大。');
    const parsed=JSON.parse(await selected.text());
    if(parsed.market?.id!==requested)throw Error('请确认导入的是 '+meta.name+'。');
    const s=await catalog.buildFromBars({id:requested,rows:parsed.bars,source:parsed.source});
    await keep(s);
  });
  button.onclick=()=>run(async()=>{
    const provider='https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';
    status.textContent='正在从腾讯财经读取 '+meta.name+' 的历史日线…';
    const end=catalog.onDevice?new Date().toISOString().slice(0,10):catalog.freeze, dates=new Map();
    for(let y=2023;y<=Number(end.slice(0,4));y++){
      const first=y+'-01-01',last=y+'-12-31'<end?y+'-12-31':end;
      const url=new URL(provider);url.searchParams.set('param',[meta.ticker,'day',first,last,350,'qfq'].join(','));
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
      try{
        const response=await fetch(url,{credentials:'omit',signal:controller.signal});
        if(!response.ok)throw Error('行情源返回 '+response.status+'。');
        const item=(await response.json()).data?.[meta.ticker], daily=item?.day||item?.qfqday;
        if(!Array.isArray(daily)||!daily.length)throw Error(y+' 年行情暂不可用。');
        for(const [date,o,c,h,l] of daily)if(date>=first&&date<=last)dates.set(date,{date,open:+o,high:+h,low:+l,close:+c,volume:null});
      }finally{clearTimeout(timer);}
    }
    const rows=[...dates.values()].sort((a,b)=>a.date.localeCompare(b.date));
    if(!catalog.onDevice&&rows.at(-1)?.date!==end)throw Error('数据源尚未返回冻结日收盘。');
    status.textContent='正在设备上训练模型…';await new Promise(r=>setTimeout(r,20));
    const source={name:'腾讯财经 · 指数日线',url:'https://gu.qq.com/'+meta.ticker,license:'由使用者从行情源载入供个人研究。'};
    await keep(await catalog.buildFromBars({id:requested,rows,source}));
  });
})();
