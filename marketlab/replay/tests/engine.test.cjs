'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const e=require('../lab.js');
const d=JSON.parse(readFileSync(path.join(__dirname,'../../data/market.json')));
const market={id:'TEST',name:'测试市场',currency:'TWD'};
const source={asOf:'2024-01-09',name:'测试'};
const bars=[
  {date:'2024-01-04',open:8,close:10},
  {date:'2024-01-05',open:12,close:13},
  {date:'2024-01-08',open:14,close:10},
  {date:'2024-01-09',open:9,close:9}];
const fixture={market,source,bars};
const make=(cash=1000,n=3)=>e.makeSession(fixture,bars[0].date,cash,n);
function approx(a,b){assert.ok(Math.abs(a-b)<1e-7, a+' '+b);}
test('收盘下单不会当日成交；下一实际交易日开盘收费与滑点；现金持仓可复算',()=>{
 const s=make();
 e.decide(s,'buy',20,'突破后模拟买入');assert.equal(s.holdings,0);assert.equal(s.cash,1000);assert.equal(s.trades.length,0);
 assert.throws(()=>e.decide(s,'buy',1,''));e.advance(s,bars);
 const buy=12*1.0005*20;assert.equal(s.holdings,20);approx(s.cash,1000-buy*1.001);
 assert.equal(s.trades[0].decisionDate,'2024-01-04');assert.equal(s.trades[0].date,'2024-01-05');
 assert.equal(s.decisions[0].status,'filled');
 e.decide(s,'sell',20,'兑现');e.advance(s,bars);const sell=14*.9995*20;
 assert.equal(s.trades[1].date,'2024-01-08');approx(s.cash,1000-buy*1.001+sell*.999);assert.equal(s.holdings,0);
 approx(s.totalSlippage,(.006+.007)*20);approx(s.totalFees,(buy+sell)*.001);
});
test('买入持有用同一开盘与成本；现金、净值和最大回撤一致',()=>{
 const s=make();e.decide(s,'buy',20,'');e.advance(s,bars);
 const benchmarkShares=Math.floor(1000/(12*1.0005*1.001));
 const expected=1000-benchmarkShares*12*1.0005*1.001+benchmarkShares*13;
 approx(s.curves[1].benchmark,expected);e.advance(s,bars);const peak=s.curves[1].equity;
 approx(s.maxDrawdown,(peak-s.curves[2].equity)/peak);
 e.advance(s,bars);assert.equal(s.finished,true);assert.equal(e.advance(s,bars),false);
 const r=e.summarize(s,fixture);approx(r.metrics.finalEquity,s.cash+20*9);assert.equal(r.report.lines[0].points.length,4);
 assert.equal(r.trades[0].quantity,20);assert.match(r.report.facts[1].value,/TWD/);
});
test('资金不足整笔拒绝、禁止做空、撤单及提前结束',()=>{
 const s=make();assert.throws(()=>e.decide(s,'sell',1,''));
 e.decide(s,'buy',100,'按昨收估计');e.advance(s,bars);assert.equal(s.cash,1000);
 assert.equal(s.decisions[0].status,'rejected');assert.equal(s.trades.length,0);
 e.decide(s,'buy',1,'');assert.equal(e.cancel(s),true);assert.equal(s.decisions[1].status,'cancelled');
 e.decide(s,'hold',null,'等待');e.decide(s,'buy',2,'');e.finish(s);
 assert.equal(s.decisions[3].status,'expired');assert.throws(()=>e.decide(s,'buy',1,''));assert.equal(e.advance(s,bars),false);
});
test('已知历史与未来修改独立，回放推进不会读取未到达的未来日线',()=>{
 const s=make();const allowed=new Proxy(bars,{get(target,key){if(['2','3'].includes(String(key)))throw Error('读取了未来行情');return target[key];}});
 e.decide(s,'buy',1,'');assert.doesNotThrow(()=>e.advance(s,allowed));
 assert.equal(s.curves.at(-1).date,bars[1].date);assert.equal(s.curves.length,2);
});
test('使用打包真实行情，跨非交易日、首末窗口及整段账户恒等式',()=>{
 const start=d.bars.length-45,s=e.makeSession(d,d.bars[start].date,50000,100);
 e.decide(s,'buy',50,'');while(!s.finished)e.advance(s,d.bars);
 const r=e.summarize(s,d);
 assert.equal(s.trades[0].date,d.bars[start+1].date);assert.equal(s.trades[0].open,d.bars[start+1].open);
 assert.equal(r.metrics.endDate,d.bars.at(-1).date);assert.equal(r.curves.length,45);
 for(const p of r.curves)approx(p.equity,p.cash+p.holdings*p.close);
 for(let i=0;i<r.curves.length;i++)assert.equal(r.curves[i].date,d.bars[start+i].date);
 assert.throws(()=>e.makeSession(d,d.bars.at(-1).date,10,1));assert.throws(()=>make(Infinity));assert.throws(()=>make(1000,0));
});
test('消息按带时区的实际公布时刻筛选，收盘边界、跨日、夏令时和未知市场均受限',()=>{
 const tw={id:'TWSE:006207',timezone:'Asia/Taipei'},cn={id:'CSI:000300',timezone:'Asia/Shanghai'};
 const news=(title,publishedAt)=>({title,publishedAt,sourceUrl:'https://www.federalreserve.gov/'});
 const rows=[news('收盘一秒后','2024-09-18T05:30:01Z'),news('恰好收盘','2024-09-18T05:30:00Z'),
   news('较早','2024-09-18T03:00:00+08:00'),news('仅有日期','2024-09-18'),news('时区未知','2024-09-17T00:00:00'),
   news('九月决议','2024-09-18T14:00:00-04:00'),news('更早','2024-09-17T09:00:00Z'),news('最早','2024-09-15T10:00:00Z')];
 const at=(m,d)=>e.publishedNews(rows,e.marketClose(m,d).time).map(n=>n.title);
 assert.deepEqual(at(tw,'2024-09-18'),['恰好收盘','较早','更早']);
 assert.deepEqual(at(cn,'2024-09-18'),['收盘一秒后','恰好收盘','较早']);
 assert.equal(at(tw,'2024-09-19')[0],'九月决议');
 assert.deepEqual(at({id:'CUSTOM',timezone:'?'},'2024-09-18'),['更早','最早']);
});
