'use strict';
(() => {
  const freeze='2026-11-18';
  const specs={
    'CSI:000300':{name:'沪深300指数',shortName:'沪深300',region:'cn',ticker:'sh000300',currency:'CNY',timezone:'Asia/Shanghai'},
    'SP:SPX':{name:'标普500指数',shortName:'标普500',region:'us',ticker:'us.INX',currency:'USD',timezone:'America/New_York'},
    'NASDAQ:IXIC':{name:'纳斯达克综合指数',shortName:'纳斯达克综合',region:'us',ticker:'us.IXIC',currency:'USD',timezone:'America/New_York'}
  };
  const onDevice=window.ML_ANDROID===true;
  const stored=key=>{try{return JSON.parse(localStorage.getItem(key));}catch{return null;}};
  const save=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true;}catch{return false;}};
  const cacheKey=id=>'ml.personal-index.v2.'+id;
  const snapshots=new Map(), deviceRows=new Map(), legacy=window.MARKETLAB_DATA;
  const options=Object.keys(specs), features=Object.keys(window.MarketLabQuantEngine.FEATURES);
  const selection=new URL(location.href).searchParams.get('market');
  const importedPrimary=options.includes(window.ML_IMPORTED_PRIMARY)?window.ML_IMPORTED_PRIMARY:null;
  const activeId=selection&&[...options,'TWSE:006207'].includes(selection)?selection:(importedPrimary||options[0]);
  const cap=onDevice||importedPrimary?null:freeze;
  const legacyAssets=window.ML_ASSETS||{assets:[],news:[]};
  const context=window.ML_CONTEXT||{assets:[],news:[]};

  function asAsset(d) {
    const {market,source,bars}=d, meta=specs[market.id]||{};
    return {id:market.id,name:market.name,shortName:meta.shortName||market.name,region:meta.region||'other',
      kind:'index',timezone:market.timezone,frequency:'日',unit:market.priceUnit,volumeUnit:market.volumeUnit,
      source:source.name,sourceUrl:source.url,description:source.basis,license:source.license,
      licenseUrl:source.licenseUrl,sha256:d.experiment?.snapshotSha256,rows:bars};
  }
  async function buildFromBars(input,cutoff=cap) {
    const {id}=input,meta=specs[id],engine=window.MarketLabQuantEngine;
    if(!meta||!Array.isArray(input.rows))throw Error('未识别的研究标的。');
    const rows=input.rows.filter(b=>!cutoff||b.date<=cutoff).map(b=>({date:b.date,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume??null}));
    engine.validateRows(rows);
    if(rows.length<85||!engine.hasOHLC(rows))throw Error(meta.shortName+' 至少需要 85 个交易日的完整开高低收。');
    if(rows.some(b=>b.volume!==null&&(!Number.isFinite(b.volume)||b.volume<0)))throw Error('成交量字段无效。');
    const src=input.source||{},day=rows.at(-1).date;
    const digest=crypto.subtle?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(rows)))),n=>n.toString(16).padStart(2,'0')).join(''):'';
    const previous=stored('ml.ondevice-model.v2.'+id);
    if(digest&&previous?.experiment?.snapshotSha256===digest)return previous;
    const horizon=5,minTrain=60,maxTrain=252;
    const xs=engine.featureRows(rows,features),labels=rows.map((r,i)=>i+horizon<rows.length?Number(rows[i+horizon].close>r.close):null);
    const bars=rows.map((r,i)=>({...r,return5:i>=5?r.close/rows[i-5].close-1:null,return20:i>=20?r.close/rows[i-20].close-1:null}));
    const forecasts=[],scores={baseline:{n:0,accuracy:0,brier:0},logistic:{n:0,accuracy:0,brier:0}};
    let fit=null,calibration=null,validStart=null,validEnd=null;
    for(let i=20+minTrain+horizon-1;i<bars.length;i++){
      if(!fit||i-calibration.index>=5){
        const end=i-horizon,begin=Math.max(20,end+1-maxTrain),ys=labels.slice(begin,end+1);
        if(!ys.includes(0)||!ys.includes(1)){fit=null;continue;}
        fit=engine.fit(xs.slice(begin,end+1),ys,{model:'logistic',features,C:1});
        calibration={index:i,trainStart:rows[begin].date,trainEnd:rows[end].date,trainCount:ys.length,baseline:ys.reduce((s,x)=>s+x,0)/ys.length};
      }
      const f={date:rows[i].date,baseline:calibration.baseline,logistic:fit(xs[i]),trainStart:calibration.trainStart,trainEnd:calibration.trainEnd,trainCount:calibration.trainCount,trainLabelThrough:rows[calibration.index].date};
      forecasts.push(f);
      if(labels[i]!==null){
        validStart=validStart||f.date;validEnd=f.date;
        for(const k of Object.keys(scores)){const s=scores[k];s.n++;s.accuracy+=Number((f[k]>=.5)===Boolean(labels[i]));s.brier+=(f[k]-labels[i])**2;}
      }
    }
    if(!forecasts.length)throw Error('历史样本未覆盖两种涨跌结果。');
    for(const s of Object.values(scores)){s.accuracy=s.n?s.accuracy/s.n:null;s.brier=s.n?s.brier/s.n:null;}
    const data={schemaVersion:1,horizon,market:{...meta,id,priceUnit:'点',priceBasis:'价格指数点位',marketType:'指数',volumeUnit:'未提供'},
      source:{...src,name:src.name||'设备上的行情源',url:/^https:\/\//i.test(src.url||'')?src.url:'',from:rows[0].date,asOf:day,updatedAt:src.updatedAt||new Date().toISOString(),rows:rows.length,demo:false,
        license:src.license||'个人本机研究数据',basis:src.basis||'由本机实际日线训练；每五个交易日用当时已经揭晓的样本重新拟合。'},
      bars,forecasts,experiment:{modelVersion:'device-walkforward-logit-2',horizon,minTrain,maxTrain,features,validationStart:validStart,validationEnd:validEnd,scores,snapshotSha256:digest,parameters:{C:1,refitEverySessions:5}}};
    if(digest)save('ml.ondevice-model.v2.'+id,data);
    return data;
  }
  function prepare(source){
    if(!source?.market?.id||!source.bars?.length||!source.experiment?.scores)return;
    const id=source.market.id;
    if(!specs[id]&&id!=='TWSE:006207')return;
    if(cap&&(source.source.asOf>cap||source.bars.at(-1).date>cap)){
      if(specs[id])deviceRows.set(id,{id,rows:source.bars,source:source.source});
      return;
    }
    snapshots.set(id,source);
  }
  async function initialize(){
    if(legacy)prepare(legacy);
    for(const id of options){const d=stored(cacheKey(id));if(d)prepare(d);}
    for(const d of window.ML_LOCAL_MARKETS||[])prepare(d);
    for(const r of window.ML_DEVICE_BARS||[])if(specs[r.id])deviceRows.set(r.id,r);
    for(const [id,input] of deviceRows){
      try{snapshots.set(id,await buildFromBars(input));}catch(err){console.warn('行情样本未就绪',id,err.message);}
    }
    const selected=snapshots.get(activeId);
    // Keep explicit legacy archive diagnostics (empty or malformed file) available.
    window.MARKETLAB_DATA=selected||(activeId==='TWSE:006207'&&!legacy?.market?.id?legacy:null);
    const sortedIds=[activeId,...options.filter(id=>id!==activeId)].filter(id=>specs[id]&&snapshots.has(id));
    const primary=sortedIds.map(id=>asAsset(snapshots.get(id)));
    const old=legacyAssets.assets.map(a=>({...a,region:a.id==='UST:10Y'?'us':'other'}));
    const assets=new Map([...old,...(context.assets||[]),...primary].map(a=>[a.id,a]));
    const ordered=[...primary,...(context.assets||[]),...old];
    const list=[...new Set(ordered.map(a=>a.id))].map(id=>assets.get(id)).map(a=>({...a,rows:a.rows.filter(b=>!cap||b.date<=cap)})).filter(a=>a.rows.length);
    const news=[...new Map([...(legacyAssets.news||[]),...(context.news||[]),...(onDevice?(window.ML_DEVICE_NEWS||[]):[])].map(n=>[n.id,n])).values()].filter(n=>!cap||n.date<=cap).sort((a,b)=>a.date.localeCompare(b.date));
    window.ML_ASSETS={...legacyAssets,assets:list,news,start:'2023-01-01',end:cap||list.reduce((last,a)=>a.rows.at(-1).date>last?a.rows.at(-1).date:last,'2023-01-01')};
    return selected;
  }
  window.MLMarkets={specs,options,snapshots,activeId,onDevice,importedPrimary,freeze,cap,buildFromBars,storeSnapshot(d){return save(cacheKey(d.market.id),d);}};
  window.ML_MARKETS_READY=initialize();
})();
