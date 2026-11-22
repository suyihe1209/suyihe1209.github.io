'use strict';
const E=require('./engine.js'),assert=require('node:assert/strict'),test=require('node:test');
const snapshot=require('../data/market.json'),rows=snapshot.bars;
const asset={id:snapshot.market.id,name:snapshot.market.name,unit:snapshot.market.priceUnit,rows};
const cfg={model:'logistic',strategy:'ma',horizon:5,features:['return1','return5','maGap20','volatility20'],
  weights:{return1:1,return5:1,maGap20:.5,volatility20:-1},C:1,trees:15,depth:4,fast:5,slow:20,
  lookback:10,threshold:.5,feeBp:5,slipBp:5,trainStart:rows[0].date,trainEnd:rows[249].date,
  validStart:rows[250].date,validEnd:rows[395].date};
test('purged labels and causality survive future data changes',()=>{
  const base=E.run(asset,cfg), altered=rows.map((r,i)=>i<350?r:{...r,open:r.open*2,high:r.high*2,low:r.low*2,close:r.close*2});
  const rev=E.run({...asset,rows:altered},cfg);
  assert.equal(base.samples.lastTrainingLabel,cfg.trainEnd);
  assert.equal(base.samples.trainEnd,rows[244].date);
  assert.deepEqual(base.predictions.filter(r=>r.targetDate<rows[350].date),rev.predictions.filter(r=>r.targetDate<rows[350].date));
  assert.deepEqual(base.curves.slice(0,100),rev.curves.slice(0,100));
  assert.throws(()=>E.run(asset,{...cfg,validStart:cfg.trainEnd}),/不能重叠/);
});
test('all classifiers predict and forest is actually trained, deterministic, and responds to labels',()=>{
  const x=Array.from({length:100},(_,i)=>[i]),y=x.map(r=>+(r[0]>49));
  const c={model:'forest',trees:21,depth:4};
  const classifier=E.fit(x,y,c);
  assert(classifier([10])<.1&&classifier([90])>.9);
  const reversed=E.fit(x,y.map(i=>1-i),c);
  assert(reversed([10])>.9);
  assert.equal(E.fit(x,y,c)([50]),classifier([50]));
  for(const model of ['trend','logistic','forest']){
    const r=E.run(asset,{...cfg,model});
    assert(r.predictions.length>30&&r.predictions.every(p=>Number.isFinite(p.probability)&&p.probability>=0&&p.probability<=1));
  }
});
test('signal after close trades only at next open; compounded fees, slippage and close valuation',()=>{
  const sessions=[{date:'2024-01-01',open:11,close:11},{date:'2024-01-02',open:20,close:30},{date:'2024-01-03',open:40,close:45}];
  const r=E.simulate(sessions,[1,2],i=>i===0,{feeBp:100,slipBp:100}),qty=10000/(20*1.01*1.01);
  assert.equal(r.trades[0].signalDate,'2024-01-01');assert.equal(r.trades[0].date,'2024-01-02');
  assert(Math.abs(r.metrics.finalEquity-qty*40*.99*.99)<1e-8);assert.equal(r.metrics.tradeCount,2);
  const lower=E.simulate(sessions,[1,2],i=>i===0,{feeBp:0,slipBp:0});assert(r.metrics.totalReturn<lower.metrics.totalReturn);
});
test('close-only stays model-only; each strategy tracks a comparable buy-and-hold curve',()=>{
  const closeOnly=E.run({...asset,rows:rows.map(({date,close})=>({date,close}))},cfg);
  assert.equal(closeOnly.curves.length,0);assert(closeOnly.metrics.brier>=0);
  for(const strategy of ['ma','momentum','buyHold','model']){
    const r=E.run(asset,{...cfg,strategy});
    assert(r.curves.length===146&&r.metrics.maxDrawdown>=0);
    for(const trade of r.trades)assert(trade.signalDate<trade.date);
    if(strategy==='buyHold'){assert.equal(r.metrics.tradeCount,1);assert.deepEqual(r.curves.map(v=>v.value),r.curves.map(v=>v.benchmark));}
  }
});
