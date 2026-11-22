'use strict';
const assert=require('node:assert/strict');
global.window=global;
require('./assets.js');require('./market.js');
const {pairChanges,correlation,rolling,movement}=MarketLabObserve;
const {assets,news}=ML_ASSETS;
assert.deepEqual(assets.map(a=>a.rows.length),[481,481,481,481,492,500]);
for(const a of assets) {
  assert.equal(new Set(a.rows.map(p=>p.date)).size,a.rows.length);
  assert(a.rows.every((p,i)=>p.close>0&&(!i||a.rows[i-1].date<p.date)));
  assert.equal(a.sha256.length,64);
}
const a={kind:'price',rows:[{date:'2024-01-01',close:10},{date:'2024-01-02',close:20},{date:'2024-01-03',close:30},{date:'2024-01-04',close:35}]};
const b={kind:'yield',rows:[{date:'2024-01-01',close:5},{date:'2024-01-03',close:4.75},{date:'2024-01-04',close:4.8}]};
const paired=pairChanges(a,b,'2024-01-01','2024-01-04');
assert.equal(paired.length,2);assert.equal(paired[0].x,200);assert.equal(paired[0].y,-25);
assert.equal(Math.round(correlation(paired)),-1);
assert.equal(rolling(paired,2).length,1);
assert.equal(rolling(paired,3).length,0);
assert.equal(correlation([{x:1,y:0},{x:2,y:0}]),null);assert.equal(correlation([]),null);
assert.equal(movement(b,5,4.75),-25);
const onAll=pairChanges(assets[0],assets[0],'2023-01-01','2024-12-31');
assert.equal(onAll.length,480);assert(Math.abs(correlation(onAll)-1)<1e-12);
const fxBond=pairChanges(assets[4],assets[5],'2023-01-01','2024-12-31');
assert(fxBond.length>440&&fxBond.length<492);assert(rolling(fxBond,60).every(p=>p.close>=-1&&p.close<=1));
assert.equal(news.length,16);
assert.deepEqual([1,0,-1].map(score=>news.filter(n=>n.score===score).length),[4,9,3]);
assert.equal(news.find(n=>n.date==='2024-09-18').lower,4.75);
assert(news.every(n=>n.sourceUrl.includes(n.date.replaceAll('-',''))&&n.publishedAt.startsWith(n.date)));
console.log('PASS: 6 histories, 16 statements, equal-interval calendars, rates, windows, missing/constant observations.');
const small=[{date:'2024-03-29',open:2,high:4,low:1,close:3,volume:5},{date:'2024-04-01',open:5,high:7,low:4,close:6,volume:10},{date:'2024-04-03',open:6,high:8,low:2,close:4,volume:20}];
for(const interval of ['week','month']){
 const agg=MarketLabObserve.aggregate(small,interval);
 assert.equal(agg.length,2);assert.deepEqual(agg[1],{date:'2024-04-03',open:5,high:8,low:2,close:4,volume:30});
}
assert.equal(MarketLabObserve.aggregate(small.slice(0,2),'week').at(-1).close,6);
const longs={kind:'yield',rows:Array.from({length:21},(_,i)=>({date:'d'+i,close:i*.25+1}))};
assert.deepEqual(MarketLabObserve.indicators(longs,'d20'),{ma5:5.5,ma20:3.625,change5:125,change20:500});
assert.equal(MarketLabObserve.indicators(longs,'d2').change5,null);
const observer=MarketLabObserve;
const mixed=[{id:'SP:SPX',region:'us'},{id:'CSI:000300',region:'cn'},{id:'FED:USDCNY',region:'global'},{id:'UST:10Y',region:'us'},{id:'TWSE:006207',region:'other'}];
assert.deepEqual(observer.marketChoices(mixed).available.slice(0,2).map(a=>a.id),['SP:SPX','CSI:000300']);
assert.deepEqual(observer.marketChoices(mixed.slice(2)).available.map(a=>a.id),['UST:10Y','FED:USDCNY']);
assert.deepEqual(observer.marketChoices(mixed).archived.map(a=>a.id),['TWSE:006207']);
const newsCN={date:'2024-03-26',publishedAt:'2024-03-26T23:59:59+08:00',datePrecision:'day',region:'cn',tone:'持平'};
assert.deepEqual(observer.filterNews([...news,newsCN],'2024-03-01','2024-03-31','cn','持平'),[newsCN]);
assert.equal(observer.publicationLabel(newsCN),'2024-03-26（仅公布日期）');
assert.match(observer.publicationLabel(news[0]),/14:00 纽约时间/);
assert.match(observer.publicationLabel({...newsCN,datePrecision:'minute',publishedAt:'2024-03-26T08:30:00+08:00'}),/08:30 北京时间/);

assert.deepEqual(observer.marketChoices([{id:'NASDAQ:IXIC',region:'us'},...mixed]).available.slice(0,3).map(a=>a.id), ['NASDAQ:IXIC','SP:SPX','CSI:000300']);

require('../markets/context.js');
const publicContext=global.ML_CONTEXT;
const usNews=require('../markets/us-news.json');
const chinaNews=require('../markets/china-news.json');
assert.deepEqual(publicContext.news.filter(n=>n.region==='us'),usNews);
assert.deepEqual(publicContext.news.filter(n=>n.region==='cn'),chinaNews);
assert.equal(usNews.length,32);
assert.equal(publicContext.news.filter(n=>n.tone==='会议纪要'&&n.score===null).length,1);
assert.equal(chinaNews.length,9);
assert(publicContext.news.every(n=>n.date<=publicContext.end && Number.isFinite(Date.parse(n.publishedAt))));
const refs=Object.fromEntries(publicContext.assets.map(a=>[a.id,a.rows]));
assert.deepEqual(refs['UST:10Y'].at(-1),{date:'2026-11-18',close:5.07});
assert.deepEqual(refs['ECB:USDCNY'].at(-1),{date:'2026-11-18',close:6.667214});
assert.deepEqual(refs['FED:USDCNY'].at(-1),{date:'2026-11-13',close:6.671});
for(const rows of Object.values(refs)){
  assert(rows.length>900);
  assert(rows.every((r,i)=>r.close>0&&(!i||r.date>rows[i-1].date)));
}
const replay=require('../replay/lab.js');
const atClose=(id,timezone)=>replay.publishedNews(publicContext.news,replay.marketClose({id,timezone},'2026-11-18').time);
assert.deepEqual(atClose('CSI:000300','Asia/Shanghai').filter(n=>n.date==='2026-11-18').map(n=>n.id),['CN:2026-11-18']);
assert.deepEqual(atClose('NASDAQ:IXIC','America/New_York').filter(n=>n.date==='2026-11-18').map(n=>n.id),['FOMC:MINUTES:20261118','CN:2026-11-18']);
console.log('PASS: 三项冻结参考、41 项政策出处、跨时区当日新闻及纳综主标的。');
