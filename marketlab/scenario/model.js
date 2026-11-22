'use strict';
(() => {
  const base=Object.freeze({rate:4,inflation:2,growth:2,risk:0});
  const limits={rate:[-1,15],inflation:[-3,18],growth:[-8,12],risk:[-2,2]};
  const params=Object.freeze({years:10,dividend:4,exitMultiple:15,termPremium:1.25,equityPremium:5,riskStep:.75,bondYears:5,coupon:4});
  function present(s){
    for(const [key,[lo,hi]] of Object.entries(limits))if(!Number.isFinite(s[key])||s[key]<lo||s[key]>hi)throw Error('情景参数超出允许范围。');
    const {years,dividend,exitMultiple,termPremium,equityPremium,riskStep,bondYears,coupon}=params;
    const nominalGrowth=(1+s.growth/100)*(1+s.inflation/100)-1;
    const bondYield=(s.rate+termPremium)/100;
    const discountRate=bondYield+(equityPremium-riskStep*s.risk)/100;
    let equity=0;
    for(let t=1;t<=years;t++)equity+=dividend*((1+nominalGrowth)/(1+discountRate))**t;
    equity+=dividend*exitMultiple*((1+nominalGrowth)/(1+discountRate))**years;
    let bond=100/(1+bondYield)**bondYears;
    for(let t=1;t<=bondYears;t++)bond+=coupon/(1+bondYield)**t;
    const cash=(1+s.rate/100)/(1+s.inflation/100)*100;
    return {equity,bond,cash,nominalGrowth,discountRate,bondYield};
  }
  function compare(a,b){
    const av=present(a),bv=present(b);
    return Object.fromEntries(['equity','bond','cash'].map(k=>[k,{a:av[k],b:bv[k],change:bv[k]/av[k]-1}]));
  }
  // Both end points come from matched observation dates; a gap of more than one calendar month is excluded.
  function monthlyReference(market,yields){
    const map=new Map(yields.map(r=>[r.date,r.close]));
    const months=new Map();
    for(const p of market){const y=map.get(p.date);const month=p.date.slice(0,7);if(Number.isFinite(y)&&Number.isFinite(p.close)&&p.close>0&&(!months.has(month)||months.get(month).date<p.date))months.set(month,{date:p.date,value:p.close,y});}
    const byMonth=[...months.values()].sort((a,b)=>a.date.localeCompare(b.date)), groups={rise:[],fall:[],flat:[]};
    const index=d=>Number(d.slice(0,4))*12+Number(d.slice(5,7));
    for(let i=1;i<byMonth.length;i++){
      const p=byMonth[i-1],q=byMonth[i];if(index(q.date)-index(p.date)!==1)continue;
      groups[q.y>p.y?'rise':q.y<p.y?'fall':'flat'].push(q.value/p.value-1);
    }
    return {first:byMonth[0]?.date,last:byMonth.at(-1)?.date,groups};
  }
  const api={base,limits,params,present,compare,monthlyReference};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else window.MLMacroModel=api;
})();
