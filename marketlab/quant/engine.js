/* MarketLab · causal features, train-only transforms and next-open execution. */
(function (global) {
  'use strict';
  const VERSION = 'quant-2.0.0';
  const FEATURES = {return1:'1 日收益率',return5:'5 日动量',return20:'20 日动量',maGap5:'偏离 5 日均线',maGap20:'偏离 20 日均线',volatility20:'20 日波动率'};
  const MODELS = {trend:'自定义趋势评分',logistic:'逻辑回归',forest:'随机森林'};
  const STRATEGIES = {ma:'双均线交叉',momentum:'动量策略',buyHold:'买入持有',model:'模型概率择时'};
  function check(condition,message) { if (!condition) throw new Error(message); }
  const avg = a => a.reduce((s,x)=>s+x,0)/a.length;
  const sum = a => a.reduce((s,x)=>s+x,0);
  const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
  const sigmoid = z => 1/(1+Math.exp(-Math.max(-40,Math.min(40,z))));
  function validateRows(rows) {
    check(Array.isArray(rows) && rows.length>=3,'该标的历史日线不足。');
    for (let i=0;i<rows.length;i++) {
      const b=rows[i];
      check(b && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && (i===0 || b.date>rows[i-1].date) && Number.isFinite(b.close) && b.close>0, '日线存在重复日期、乱序或无效收盘价。');
    }
  }
  function hasOHLC(rows) {
    return rows.every(b=>[b.open,b.high,b.low,b.close].every(v=>Number.isFinite(v)&&v>0) &&
      b.low<=Math.min(b.open,b.close) && b.high>=Math.max(b.open,b.close));
  }
  function featureRows(rows, keys) {
    const closes = rows.map(b=>b.close);
    const ret = n => (t => t>=n ? closes[t]/closes[t-n]-1 : null);
    const gap = n => (t => t>=n-1 ? closes[t]/avg(closes.slice(t+1-n,t+1))-1 : null);
    const calculators = {return1:ret(1),return5:ret(5),return20:ret(20),maGap5:gap(5),maGap20:gap(20),
      volatility20(t) {
        if(t<20) return null;
        const values=closes.slice(t-19,t+1).map((c,k)=>c/closes[t-20+k]-1);
        const mean=avg(values); return Math.sqrt(avg(values.map(v=>(v-mean)**2)));
      }};
    return rows.map((_,i)=>{
      const x=keys.map(k=>calculators[k](i));
      return x.every(Number.isFinite)?x:null;
    });
  }
  function normalized(x) {
    const means=x[0].map((_,j)=>avg(x.map(r=>r[j])));
    const scales=means.map((m,j)=>Math.sqrt(avg(x.map(r=>(r[j]-m)**2)))||1);
    return r=>r.map((v,i)=>(v-means[i])/scales[i]);
  }
  /* Positive definite Hessian, solved by partial pivoting for small feature sets. */
  function solve(a,b) {
    const n=b.length, mat=a.map((r,i)=>r.concat(b[i]));
    for(let k=0;k<n;k++) {
      let pivot=k;
      for(let i=k+1;i<n;i++) if(Math.abs(mat[i][k])>Math.abs(mat[pivot][k])) pivot=i;
      [mat[k],mat[pivot]]=[mat[pivot],mat[k]];
      check(Math.abs(mat[k][k])>1e-14,'模型未收敛，请延长训练窗口或减少重复指标。');
      for(let i=k+1;i<n;i++) {
        const f=mat[i][k]/mat[k][k];
        for(let j=k;j<=n;j++) mat[i][j]-=f*mat[k][j];
      }
    }
    const out=Array(n).fill(0);
    for(let i=n-1;i>=0;i--) out[i]=(mat[i][n]-dot(mat[i].slice(i+1,n),out.slice(i+1)))/mat[i][i];
    return out;
  }
  function logistic(xs,ys,C) {
    const transform=normalized(xs), x=xs.map(r=>[1,...transform(r)]), len=x[0].length;
    let weights=Array(len).fill(0);
    const loss=w=>sum(x.map((r,i)=>{
      const s=dot(w,r); return Math.max(0,s)+Math.log1p(Math.exp(-Math.abs(s)))-ys[i]*s;
    }))+sum(w.slice(1).map(v=>v*v))/(2*C);
    for(let iteration=0;iteration<70;iteration++) {
      const h=Array.from({length:len},()=>Array(len).fill(0)), grad=Array(len).fill(0);
      for(let i=0;i<x.length;i++){
        const p=sigmoid(dot(weights,x[i])), v=p*(1-p);
        for(let j=0;j<len;j++){
          grad[j]+=(p-ys[i])*x[i][j];
          for(let k=0;k<len;k++) h[j][k]+=v*x[i][j]*x[i][k];
        }
      }
      for(let j=1;j<len;j++){grad[j]+=weights[j]/C;h[j][j]+=1/C;}
      const step=solve(h,grad);
      if(Math.max(...step.map(Math.abs))<1e-8) break;
      let factor=1, next,oldLoss=loss(weights);
      do {next=weights.map((w,j)=>w-factor*step[j]);factor/=2;} while(loss(next)>oldLoss+1e-10&&factor>1e-8);
      weights=next;
    }
    return r=>sigmoid(dot(weights,[1,...transform(r)]));
  }
  function random(seed) {
    let state=seed>>>0;
    return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  }
  function forest(xs,ys,count,depth,seed) {
    const rnd=random(seed),n=xs.length,d=xs[0].length,leafSize=4,subspace=Math.max(1,Math.floor(Math.sqrt(d)));
    const impurity=(positives,size)=>2*positives*(size-positives)/size;
    function grow(ids,level){
      const total=sum(ids.map(i=>ys[i])), leaf={p:total/ids.length};
      if(level>=depth||total===0||total===ids.length||ids.length<2*leafSize) return leaf;
      const features=Array.from({length:d},(_,i)=>i);
      for(let i=0;i<subspace;i++){const j=i+Math.floor(rnd()*(d-i));[features[i],features[j]]=[features[j],features[i]];}
      let best=null, bestLoss=impurity(total,ids.length);
      for(const j of features.slice(0,subspace)){
        const sorted=ids.slice().sort((a,b)=>xs[a][j]-xs[b][j]);
        let positives=0;
        for(let split=1;split<sorted.length;split++){
          positives+=ys[sorted[split-1]];
          if(split<leafSize||sorted.length-split<leafSize||xs[sorted[split-1]][j]===xs[sorted[split]][j]) continue;
          const v=impurity(positives,split)+impurity(total-positives,sorted.length-split);
          if(v<bestLoss-1e-12){
            bestLoss=v;best={j,threshold:(xs[sorted[split-1]][j]+xs[sorted[split]][j])/2};
          }
        }
      }
      if(!best) return leaf;
      const left=[],right=[];
      ids.forEach(i=>(xs[i][best.j]<=best.threshold?left:right).push(i));
      return {...best,left:grow(left,level+1),right:grow(right,level+1)};
    }
    const trees=Array.from({length:count},()=>grow(Array.from({length:n},()=>Math.floor(rnd()*n)),0));
    return r=>avg(trees.map(root=>{
      let node=root;
      while(!('p' in node)) node=r[node.j]<=node.threshold?node.left:node.right;
      return node.p;
    }));
  }
  function fit(x,y,cfg) {
    if(cfg.model==='trend'){
      const z=normalized(x), w=cfg.features.map(k=>cfg.weights[k]);
      const scale=sum(w.map(Math.abs));
      check(scale>0,'至少一个已选指标的趋势权重须非零。');
      return r=>sigmoid(dot(w,z(r))/scale);
    }
    check(y.includes(0)&&y.includes(1),'训练窗只有一种涨跌结果，无法拟合两类模型。');
    return cfg.model==='logistic'?logistic(x,y,cfg.C):forest(x,y,cfg.trees,cfg.depth,1729);
  }
  function validateConfig(c) {
    check(Object.hasOwn(MODELS,c.model)&&Object.hasOwn(STRATEGIES,c.strategy),'请选择有效的模型和策略。');
    check(Array.isArray(c.features)&&c.features.length&&new Set(c.features).size===c.features.length&&c.features.every(k=>Object.hasOwn(FEATURES,k)),'请至少选择一个有效指标。');
    const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
    check(integer(c.horizon,1,60),'预测期限须在 1 至 60 个交易日之间。');
    check([c.trainStart,c.trainEnd,c.validStart,c.validEnd].every(d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d))&&c.trainStart<=c.trainEnd&&c.trainEnd<c.validStart&&c.validStart<=c.validEnd,'训练日期必须在验证日期之前，两个窗口不能重叠。');
    check(Number.isFinite(c.feeBp)&&c.feeBp>=0&&c.feeBp<1000&&Number.isFinite(c.slipBp)&&c.slipBp>=0&&c.slipBp<1000,'费用和滑点须分别在 0 至 999 基点内。');
    check(c.model!=='trend'||(c.weights&&c.features.every(k=>Number.isFinite(c.weights[k])&&Math.abs(c.weights[k])<=10)),'趋势权重应在 -10 至 10 之间。');
    check(c.model!=='logistic'||(Number.isFinite(c.C)&&c.C>=.01&&c.C<=100),'逻辑回归 C 须在 0.01 至 100 之间。');
    check(c.model!=='forest'||(integer(c.trees,3,61)&&integer(c.depth,1,10)),'树数范围 3–61，深度范围 1–10。');
    check(c.strategy!=='ma'||(integer(c.fast,2,100)&&integer(c.slow,3,200)&&c.fast<c.slow),'短均线需小于长均线，范围分别为 2–100、3–200。');
    check(c.strategy!=='momentum'||integer(c.lookback,1,120),'动量回看窗口为 1–120 个交易日。');
    check(c.strategy!=='model'||(Number.isFinite(c.threshold)&&c.threshold>=0&&c.threshold<=1),'概率阈值须在 0–100% 之间。');
  }
  function simulate(rows,indices,signal,cfg,annualSessions=252){
    const fee=cfg.feeBp/10000,slip=cfg.slipBp/10000,initial=10000;
    let cash=initial,units=0,peak=initial,dd=0,previous=initial,totalFees=0,totalSlip=0,exposureDays=0;
    const curve=[],trades=[],returns=[];
    for(const i of indices){
      const bar=rows[i], want=signal(i-1);
      if(want&&units===0){
        const fill=bar.open*(1+slip);units=cash/(fill*(1+fee));
        const fees=units*fill*fee,cost=units*(fill-bar.open);
        trades.push({date:bar.date,signalDate:rows[i-1].date,side:'buy',price:fill,open:bar.open,units,fee:fees,slippage:cost});
        totalFees+=fees;totalSlip+=cost;cash=0;
      }else if(!want&&units>0){
        const fill=bar.open*(1-slip),fees=units*fill*fee,cost=units*(bar.open-fill);
        cash=units*fill-fees;
        trades.push({date:bar.date,signalDate:rows[i-1].date,side:'sell',price:fill,open:bar.open,units,fee:fees,slippage:cost});
        totalFees+=fees;totalSlip+=cost;units=0;
      }
      const equity=cash+units*bar.close;
      peak=Math.max(peak,equity);
      const drawdown=(peak-equity)/peak;
      dd=Math.max(dd,drawdown);returns.push(equity/previous-1);
      curve.push({date:bar.date,value:equity/initial,drawdown});
      if(units>0)exposureDays++;
      previous=equity;
    }
    const mean=avg(returns),variance=returns.length>1?sum(returns.map(r=>(r-mean)**2))/(returns.length-1):0;
    return {curve,trades,metrics:{totalReturn:previous/initial-1,maxDrawdown:dd,tradeCount:trades.length,
      initialCapital:initial,finalEquity:previous,totalFees,totalSlippage:totalSlip,exposure:exposureDays/indices.length,
      annualVolatility:Math.sqrt(variance*annualSessions),sharpe:variance>0?mean/Math.sqrt(variance)*Math.sqrt(annualSessions):null}};
  }
  function run(asset,cfg) {
    validateConfig(cfg);const rows=asset.rows.filter(r=>r.date<=cfg.validEnd);validateRows(rows);
    const x=featureRows(rows,cfg.features),h=cfg.horizon;
    const train=[],valid=[],sessions=[];
    for(let i=0;i<rows.length;i++){
      const d=rows[i].date, end=rows[i+h]?.date;
      if(x[i]&&d>=cfg.trainStart&&end&&end<=cfg.trainEnd) train.push(i);
      if(d>=cfg.validStart&&d<=cfg.validEnd){
        sessions.push(i);
        if(x[i]&&end&&end<=cfg.validEnd) valid.push(i);
      }
    }
    check(train.length>=30,'去掉指标预热和预测窗口后，训练不足 30 条。请加长训练期。');
    check(valid.length>=1,'验证期至少须覆盖一个完整预测窗口。');
    const labels=train.map(i=>+(rows[i+h].close>rows[i].close)), baseline=avg(labels);
    const predict=fit(train.map(i=>x[i]),labels,cfg);
    const predictions=valid.map(i=>({date:rows[i].date,targetDate:rows[i+h].date,
      probability:predict(x[i]),actual:+(rows[i+h].close>rows[i].close)}));
    const score = key=>({
      accuracy:avg(predictions.map(r=>+((key(r)>=.5)===Boolean(r.actual)))),
      brier:avg(predictions.map(r=>(key(r)-r.actual)**2))
    });
    const metrics={...score(r=>r.probability),baseline:score(()=>baseline),baselineProbability:baseline};
    const samples={train:train.length,validation:predictions.length,trainStart:rows[train[0]].date,
      trainEnd:rows[train.at(-1)].date,lastTrainingLabel:rows[train.at(-1)+h].date,
      validationStart:rows[sessions[0]].date,validationEnd:rows[sessions.at(-1)].date};
    let curves=[],trades=[],benchmark=null;
    if(hasOHLC(rows)){
      const closes=rows.map(r=>r.close),ma=(i,n)=>avg(closes.slice(i-n+1,i+1));
      const signal=i=>{
        if(cfg.strategy==='buyHold') return true;
        if(cfg.strategy==='ma') return i>=cfg.slow-1&&ma(i,cfg.fast)>ma(i,cfg.slow);
        if(cfg.strategy==='momentum') return i>=cfg.lookback&&closes[i]>closes[i-cfg.lookback];
        return x[i]!==null&&predict(x[i])>=cfg.threshold;
      };
      const periods=asset.annualSessions||252;
      const a=simulate(rows,sessions,signal,cfg,periods);
      const b=simulate(rows,sessions,()=>true,cfg,periods);
      curves=a.curve.map((r,i)=>({...r,benchmark:b.curve[i].value}));
      trades=a.trades;benchmark=b.metrics;Object.assign(metrics,a.metrics);
    }
    return {version:VERSION,marketId:asset.id,marketName:asset.name,unit:asset.unit,source:asset.source||{},
      config:JSON.parse(JSON.stringify(cfg)),samples,metrics,benchmark,curves,trades,predictions};
  }
  const api={VERSION,FEATURES,MODELS,STRATEGIES,validateRows,hasOHLC,featureRows,fit,simulate,run};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  global.MarketLabQuantEngine=api;
})(typeof window==='undefined'?globalThis:window);
