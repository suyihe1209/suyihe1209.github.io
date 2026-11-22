'use strict';
(() => {
  const area=document.getElementById('official-arena');
  if(!area)return;
  area.innerHTML=`<div class="panel-head"><div><p class="eyebrow">本机服务记时</p><h2>正式前瞻</h2></div><button type="button" data-of="refresh">刷新状态</button></div>
<p class="fine">提前提交与历史练习分开统计。此组使用本机服务时间，同一市场每个截止日仅接受一次人工预测。记录仅在这台电脑上保存。</p>
<p class="note" data-of="status" role="status">正在检查提交窗口…</p>
<form class="official-form" hidden>
<label>未来五个交易日上涨概率（%）<input data-of="prob" type="number" min="0" max="100" step="any" required inputmode="decimal" placeholder="0–100"></label>
<label>判断理由（选填）<textarea data-of="reason" rows="2" maxlength="800"></textarea></label>
<label class="official-confirm"><input type="checkbox" data-of="confirmed" required>我已核实当前所选指数日线来自所注明的来源，数据连续且最新一行已经收盘。</label>
<button class="primary" type="submit">提交正式前瞻预测</button></form>
<p data-of="action-status" role="status"></p><button type="button" data-of="ai" hidden>加入同期 AI 判断</button>
<details data-of="setup"><summary>如何参加与更新结算</summary><p>准备获准使用的单一指数连续日线 CSV（至少 85 根），在本机打开 MarketLab 目录中的「导入沪深300.command」、「导入标普500.command」或「导入纳斯达克综合.command」，选择文件并填写来源与许可。导入后打开生成的快照工作台，使用相同的本机记录目录。补入后续交易日并重新导入后，打开此区即可按实际第五根日线收盘结算。</p><p>沪深300的窗口为上海时间 15:00 至次日历日 09:15 前。标普500和纳斯达克综合为纽约时间 16:00 至次日历日 09:30 前，随夏令时调整。美国提前收市日也等到 16:00 才开放，周末和长假不延长。只有在窗口内生成并保存的真实 AI 结果才参与同期比较。<a href="docs/正式前瞻.md">查看规则与数据要求</a></p></details>
<div data-of="ledger"></div>`;
  const $=k=>area.querySelector('[data-of="'+k+'"]');
  const form=area.querySelector('form'),api='/api/marketlab/official';
  const el=(tag,value)=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=value;return e;};
  const names={user:'你的预测',baseline:'频率基准',logistic:'逻辑回归',ai:'AI 分析师'};
  const percent=n=>(n*100).toLocaleString('zh-CN',{maximumFractionDigits:2})+'%';
  const price=n=>n.toLocaleString('zh-CN',{maximumFractionDigits:4});
  const local=(t,zone)=>new Date(t).toLocaleString('zh-CN',{timeZone:zone||'Asia/Shanghai',hour12:false});
  let current=null,busy=false,generation=0;
  function table(head,rows){
    const wrap=el('div'),t=el('table');wrap.className='scroll-table';wrap.append(t);
    const h=t.createTHead().insertRow();for(const item of head){const th=el('th',item);th.scope='col';h.append(th);}
    const body=t.createTBody();for(const row of rows){const r=body.insertRow();for(const v of row)r.insertCell().textContent=v;}
    return wrap;
  }
  function render(result){
    const {gate,records,ranking}=result;
    const entry=records.find(r=>r.marketId===gate.marketId&&r.cutoff===gate.cutoff);
    $('status').textContent=(gate.eligible?(entry?'该期人工概率已锁定。':'本期允许提交。')+' 行情截止 '+gate.cutoff+'，窗口关闭于 '+local(gate.closesAt,gate.timezone)+'（'+gate.timezone+'）。':gate.reason);
    form.hidden=!gate.eligible||Boolean(entry);
    $('ai').hidden=!gate.eligible||!entry||Boolean(entry.ai)||!result.aiConfigured;
    const ledger=$('ledger');ledger.replaceChildren();
    ledger.append(el('h3','正式前瞻榜'),ranking.length?table(['预测者','已到期','方向准确率','平均 Brier 分'],ranking.map(r=>[names[r.model],r.n,percent(r.accuracy),r.brier.toFixed(4)])):el('p','尚无已到期的本机正式记录。'));
    if(!records.length)return;
    ledger.append(el('h3','已锁定的前瞻记录'));
    for(const r of records){
      const detail=el('details'),summary=el('summary',r.cutoff+' · '+(r.settlement?'已结算':'待满五个交易日'));
      detail.append(summary,el('p',r.marketId+' · 起点收盘 '+price(r.startClose)+' 点 · 本机服务盖时 '+local(r.submittedAt,r.timezone||gate.timezone)+'（'+(r.timezone||gate.timezone)+'） · 量化版本 '+r.modelVersion),
        el('p','判断理由 · '+(r.reason||'未填写')));
      const probs={user:r.user,baseline:r.baseline,logistic:r.logistic};
      if(r.ai){probs.ai=r.ai.probability;detail.append(el('p','同期 AI · '+r.ai.model+' / '+r.ai.version+' · '+local(r.ai.predictedAt,r.timezone||gate.timezone)));}
      if(r.settlement)detail.append(el('p','已走过 '+r.settlement.days.join('、')+'，第五日收盘 '+price(r.settlement.close)+' 点（'+(r.settlement.actual?'上涨':'未涨')+'）。'));
      detail.append(table(['预测者','锁定概率','方向结果','Brier 分'],Object.entries(probs).map(([k,p])=>{
        const s=r.settlement;return [names[k],percent(p),s?((p>=.5)===Boolean(s.actual)?'正确':'错误'):'待结算',s?((p-s.actual)**2).toFixed(4):'—'];
      })));ledger.append(detail);
    }
  }
  async function refresh(){
    await window.ML_MARKETS_READY;
    const seq=++generation;
    if(!/^https?:$/.test(location.protocol)){current=null;$('status').textContent='此文件预览没有本机服务时间戳。请在本机导入并打开所选市场最新的真实指数快照。';form.hidden=true;$('ai').hidden=true;$('ledger').replaceChildren();return;}
    try{
      const id=window.MARKETLAB_DATA?.market?.id;
      const res=await fetch(api+(id?'?marketId='+encodeURIComponent(id):''),{cache:'no-store'});
      if(res.status===404||res.ok&&!res.headers.get('content-type')?.includes('json'))throw Error('当前为静态预览，正式前瞻需要本机服务。');
      const ans=await res.json();if(!res.ok)throw Error(ans.error||'本机服务暂不可用');
      if(!ans.gate||!Array.isArray(ans.records)||!Array.isArray(ans.ranking))throw Error('本机服务返回的正式记录格式无效。');
      const cap=window.MLMarkets?.cap;
      if(cap&&(ans.gate.cutoff>cap||ans.records.some(r=>r.cutoff>cap||r.settlement?.days?.at(-1)>cap)))throw Error('网页版仅显示截至 '+cap+' 的资料。最新正式记录可在本机导入工作台查看。');
      if(seq!==generation)return;current=ans;render(ans);
    }catch(e){if(seq!==generation)return;current=null;$('status').textContent=e.message;form.hidden=true;$('ai').hidden=true;$('ledger').replaceChildren();}
  }
  async function send(ai){
    if(busy||!current?.gate.eligible)return;
    const gate=current.gate,params={marketId:gate.marketId,cutoff:gate.cutoff};
    if(!ai){
      if(!form.reportValidity())return;
      Object.assign(params,{probability:$('prob').valueAsNumber/100,reason:$('reason').value.trim(),confirmedReal:$('confirmed').checked});
    }
    busy=true;form.querySelector('button').disabled=true;$('ai').disabled=true;$('action-status').textContent=ai?'正在请求同期 AI…':'正在锁定预测…';
    try{
      const res=await fetch(ai?api+'/ai':api,{method:'POST',headers:{'Content-Type':'application/json','X-MarketLab-Snapshot':window.MARKETLAB_DATA?.experiment?.snapshotSha256||''},body:JSON.stringify(params)});
      const a=await res.json();if(!res.ok)throw Error(a.error||'提交失败');
      $('action-status').textContent=ai?'同期 AI 概率、版本与时间已封存。':'本机服务已锁定本期预测。';
      if(!ai)form.reset();
      window.dispatchEvent(new CustomEvent('marketlab:records-changed',{detail:{type:'official'}}));
    }catch(e){$('action-status').textContent=e.message;}
    finally{busy=false;form.querySelector('button').disabled=false;$('ai').disabled=false;await refresh();}
  }
  form.addEventListener('submit',e=>{e.preventDefault();send(false);});
  $('ai').addEventListener('click',()=>send(true));$('refresh').addEventListener('click',refresh);
  window.addEventListener('marketlab:navigate',e=>{if(e.detail==='arena')refresh();});
  window.addEventListener('marketlab:market-changed',refresh);
  window.MarketLabOfficial={refresh};refresh();
})();
