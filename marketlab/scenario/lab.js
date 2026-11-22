'use strict';
window.MarketLabMacro = {mount(container) {
  const {el,num,percent,table,uid,saved}=MLView;
  const {base,limits,params,present,compare,monthlyReference}=MLMacroModel;
  const labels={rate:'政策利率',inflation:'预期通胀率',growth:'实际增长率',risk:'风险偏好'};
  const names={equity:'股票现金流估值',bond:'五年期固定息债券',cash:'一年后现金购买力'};
  const presets={base:['基准',base],ease:['降息与温和增长',{rate:3,inflation:2,growth:2.5,risk:1}],tight:['加息抑制通胀',{rate:6,inflation:3,growth:1,risk:-1}],stag:['滞胀',{rate:5,inflation:6,growth:-2,risk:-1}]};
  const state={A:{...base},B:{...presets.ease[1]}};
  container.innerHTML=`<header class="ml-head"><div><h2>宏观推演沙盘</h2><p>比较两组假设下的估值和购买力。参数是教学设定，可分别修改 A 和 B。</p></div></header>
  <div class="ml-pair" id="scenario-inputs"></div>
  <section class="panel wide"><div class="panel-head"><h3>情景差异</h3><button type="button" id="macro-save">保存此次推演</button></div><div id="macro-results"></div><p id="macro-saved" role="status" class="fine"></p></section>
  <section class="panel wide"><h3>历史参照</h3><div id="macro-history"></div></section>
  <details class="ml-method"><summary>计算方法、假设与适用范围</summary><div id="macro-method"></div></details>`;
  const fields={},result=container.querySelector('#macro-results'),status=container.querySelector('#macro-saved');
  for(const side of ['A','B']){
    const box=el('section',undefined,'panel macro-side'),head=el('div',undefined,'panel-head');
    head.append(el('h3','情景 '+side)); const select=el('select');select.setAttribute('aria-label','情景 '+side+' 预设');
    for(const [id,[title]] of Object.entries(presets))select.add(new Option(title,id));
    select.add(new Option('自定义','custom'));select.options[select.length-1].disabled=true;
    select.value=side==='A'?'base':'ease';head.append(select);box.append(head);fields[side]={};
    for(const [key,label] of Object.entries(labels)){
      const row=el('label',undefined,'macro-input'); const unit=key==='risk'?'级':'%';
      const title=el('span',label+'（'+unit+'）');
      const inp=el('input');inp.type='range';inp.id='macro-'+side+'-'+key;
      [inp.min,inp.max]=limits[key];inp.step=key==='risk'?1:.25;inp.value=state[side][key];
      const val=el('output',num(state[side][key])+unit);row.append(title,val,inp);
      fields[side][key]=[inp,val,unit];box.append(row);
      inp.addEventListener('input',()=>{state[side][key]=Number(inp.value);val.textContent=num(state[side][key])+unit;select.value='custom';paint();});
    }
    box.append(el('p','风险偏好从 −2（避险）到 +2（愿意承担更多风险）。','fine'));
    select.onchange=()=>{Object.assign(state[side],presets[select.value][1]);for(const [k,[input,out,unit]] of Object.entries(fields[side])){input.value=state[side][k];out.textContent=num(state[side][k])+unit;}paint();};
    container.querySelector('#scenario-inputs').append(box);
  }
  function paint(){
    status.textContent='';const c=compare(state.A,state.B);
    result.replaceChildren(table(['量化结果','情景 A','情景 B','B 相对 A'],Object.entries(c).map(([k,v])=>[names[k],num(v.a),num(v.b),percent(v.change)])),
      el('p','股票单位为模型估值点；债券面值为 100，现金以初始购买力 100 为基准。各行的绝对数值各自解释。','fine'));
    const strip=el('div',undefined,'scenario-bars');for(const [k,v] of Object.entries(c)){
      const r=el('div');r.append(el('span',names[k]));const bar=el('i');bar.style.width=(Math.min(100,Math.abs(v.change)*100))+'%';bar.style.background=v.change<0?'var(--violet)':'var(--cyan)';r.append(bar,el('strong',percent(v.change)));strip.append(r);
    }result.append(strip);
  }
  const d=window.MARKETLAB_DATA, yieldSeries=window.ML_ASSETS?.assets?.find(a=>a.kind==='yield'||/收益率/.test(a.name));
  let context=null;
  if(d?.bars?.length&&yieldSeries){
    context=monthlyReference(d.bars,yieldSeries.rows);
    const group=context.groups;
    const host=container.querySelector('#macro-history');
    host.append(el('p',d.market.name+'与'+yieldSeries.name+'，按月取最后一个双方都有报价的日期。样本期 '+(context.first||'—')+' 至 '+(context.last||'—')+'。'),
      table(['收益率月度变化','月份数','标的同期平均价格变动'],[['rise','上升'],['flat','持平'],['fall','下降']].map(([key,name])=>[name,group[key].length,group[key].length?percent(group[key].reduce((a,b)=>a+b,0)/group[key].length):'—'])),
      el('p','月末同日仍有跨市场时差。分组使用月末间的实际历史变化，仅供对照，未用于拟合沙盘参数。','fine'));
  }else container.querySelector('#macro-history').textContent='当前快照缺少可对齐的利率与标的日线。';
  const method=container.querySelector('#macro-method');
  for(const line of ['利率、通胀和增长均为年率。两组情景共享下列参数，变化可归因到你改动的输入。','股票：初始分红 4，未来十年分红按 (1＋实际增长率) × (1＋通胀率) − 1 增长，末期价值取末年分红的 15 倍。每笔现金流按政策利率＋1.25 个百分点期限溢价＋5 个百分点股权溢价−0.75 个百分点 × 风险偏好折现。','债券：面值 100，每年付息 4，共五年。以政策利率加 1.25 个百分点折现票息与本金。现金：一年后实质购买力 = 100 × (1＋政策利率) ÷ (1＋通胀率)。','这里固定期限溢价、股息设定和传导系数，忽略税费、信用违约、央行反馈和政策时滞。通胀上升而名义利率固定时，模型名义股票估值可能升高，这取决于现金流随物价同步增长的假设。结果为条件情景，不具有因果或收益保证。'])method.append(el('p',line));
  const ref=el('a','美联储对货币政策传导的说明');ref.href='https://www.federalreserve.gov/monetarypolicy/monetary-policy-what-are-its-goals-how-does-it-work.htm';method.append(ref);
  container.querySelector('#macro-save').onclick=()=>{
    const id=uid(),t=new Date().toISOString(),c=compare(state.A,state.B),facts=Object.entries(c).map(([k,v])=>({label:names[k]+' · B 相对 A',value:percent(v.change)}));
    const rec={id,createdAt:t,marketName:'宏观双情景',config:JSON.parse(JSON.stringify(state)),parameters:params,modelVersion:'cashflow-scenarios-1',results:c,source:'教学假设与折现公式',reference:context?{from:context.first,to:context.last,market:d.market.name,yield:yieldSeries.name,groups:context.groups}:null,
      report:{facts,notes:['股票采用十年分红折现、债券采用五年固定票息折现、现金按通胀折算。','三项都是条件情景结果，敏感度由设定参数决定。'],lines:[]}};
    const key='ml.macro.runs.v1';try{localStorage.setItem(key,JSON.stringify([rec,...saved(key)]));status.textContent='已保存，可在「研究报告」中选用。';}catch{status.textContent='本机存储不可写或空间已满，本次结果仍可查看。';}
  };
  paint();
}};
