'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {base, limits, present, compare, monthlyReference} = require('./model.js');

test('相同条件完全相同，风险偏好仅改变股票折现', () => {
  const same=compare(base, {...base});
  Object.values(same).forEach(row=>assert.equal(row.change,0));
  const changes=compare(base,{...base,risk:1});
  assert.ok(changes.equity.change>0);
  assert.equal(changes.bond.change,0);
  assert.equal(changes.cash.change,0);
});

test('利率、通胀、增长和现金流公式可独立复算', () => {
  const higher=compare(base,{...base,rate:5});
  assert.ok(higher.equity.change<0 && higher.bond.change<0 && higher.cash.change>0);
  const prices=compare(base,{...base,inflation:6});
  assert.ok(prices.cash.change<0 && prices.equity.change>0);
  const recovery=compare(base,{...base,growth:3});
  assert.ok(recovery.equity.change>0 && recovery.bond.change===0 && recovery.cash.change===0);
  const cash=present({...base,rate:3,inflation:3}).cash;
  assert.equal(cash,100);
  const bond=present({...base,rate:2.75}).bond;
  assert.ok(Math.abs(bond-100)<1e-10);
});

test('边界均有限且拒绝损坏的输入', () => {
  for(const [key,[lo,hi]] of Object.entries(limits)){
    for(const v of [lo,hi])Object.values(present({...base,[key]:v})).forEach(n=>assert.ok(Number.isFinite(n)));
    for(const v of [NaN,Infinity,lo-1,hi+1])assert.throws(()=>present({...base,[key]:v}));
  }
});

test('参照月份取共同最后报价，跨年可连续，缺月不计', () => {
  const make=(a)=>a.map(([date,close])=>({date,close}));
  const m=make([['2023-12-28',95],['2023-12-29',100],['2024-01-31',110],['2024-01-30',80],['2024-02-29',99],['2024-04-30',300]]);
  const y=make([['2023-12-29',3],['2024-01-31',4],['2024-01-30',3],['2024-02-29',2],['2024-04-30',2]]);
  const ref=monthlyReference(m,y);
  assert.equal(ref.first,'2023-12-29');
  assert.equal(ref.last,'2024-04-30');
  assert.equal(ref.groups.rise.length,1);
  assert.ok(Math.abs(ref.groups.rise[0]-.10)<1e-12);
  assert.ok(Math.abs(ref.groups.fall[0]+.10)<1e-12);
  assert.equal(ref.groups.flat.length,0);
  assert.equal(monthlyReference(m,[]).last,undefined);
});
