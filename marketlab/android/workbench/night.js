'use strict';
(() => {
  const modules = {
    observe: ['两市走势及政策','M3 18V5m0 13h18M6 14l4-5 3 2 6-8'],
    arena: ['五日涨跌判断','M3 18l5-7 4 3 7-9m-5 0h5v5'],
    quant: ['策略与回测','M4 19h16M6 16v-5m6 5V5m6 11V8'],
    replay: ['逐日复盘','M12 4a8 8 0 108 8 8 8 0 00-8-8m0 3v5l3 2'],
    macro: ['双情景推演','M3 18l5-9 4 5 4-8 5 12'],
    reports: ['整理与导出','M6 3h9l4 4v14H6zm8 0v5h5M9 12h7m-7 4h6']
  };
  const ns='http://www.w3.org/2000/svg';
  const shell=document.querySelector('main.lab'),overview=document.querySelector('#overview-module');
  const crumb=document.querySelector('.night-crumb'),marketPicker=document.querySelector('#market-picker');
  function route(){
    const id=location.hash.slice(1);
    document.body.dataset.nightPage=Object.hasOwn(modules,id)?id:'overview';
    crumb.hidden=document.body.dataset.nightPage==='overview';
    window.scrollTo(0,0);
  }
  function decorate(){
    for(const link of overview.querySelectorAll('.ml-grid a:not([data-night-icon])')){
      const id=link.hash.slice(1),info=modules[id];if(!info)continue;
      const svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');
      svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('class','night-symbol');
      path.setAttribute('d',info[1]);svg.append(path);link.prepend(svg);
      const desc=link.querySelector('p');if(desc)desc.textContent=info[0];
      link.dataset.nightIcon=id;
    }
  }
  function markets(){
    const catalog=window.MLMarkets;if(!catalog)return;
    const id=catalog.activeId,meta=catalog.specs[id],snap=catalog.snapshots.get(id);
    document.querySelector('#night-market-name').textContent=meta?.shortName||snap?.market?.name||marketPicker.selectedOptions[0]?.text||'研究市场';
    document.querySelector('#night-context').textContent=document.querySelector('#night-market-name').textContent;
    const date=snap?.bars?.at(-1)?.date;
    document.querySelector('#night-date').textContent=date?'收盘 '+date:'待载入行情';
    const options=document.querySelector('.night-market-options');
    for(const option of marketPicker.options){
      const button=document.createElement('button');button.type='button';
      button.textContent=catalog.specs[option.value]?.shortName||option.text;
      button.setAttribute('aria-pressed',String(option.value===id));
      button.addEventListener('click',()=>{if(option.value===id)return;marketPicker.value=option.value;marketPicker.dispatchEvent(new Event('change',{bubbles:true}));});
      options.append(button);
    }
  }
  // Desktop figures originally have fixed 500–720-unit view boxes. On a phone
  // preserve the plot margins and label font size while narrowing the data area.
  const figures=new WeakMap(),textPositions=new WeakMap();
  function fitCharts(){
    for(const svg of shell.querySelectorAll('svg[role="img"][viewBox]')){
      let original=figures.get(svg);
      if(!original){const v=svg.viewBox.baseVal;original={w:v.width,h:v.height};figures.set(svg,original);}
      const width=svg.getBoundingClientRect().width;
      if(width<150 || !original.w)continue;
      const target=Math.min(original.w,Math.round(width));
      const left=original.w===530?100:55;
      const scale=(target-left-10)/(original.w-left-10),offset=left*(1-scale);
      svg.setAttribute('viewBox','0 0 '+target+' '+original.h);
      for(const item of svg.children){
        if(item.tagName.toLowerCase()==='text'){
          if(!textPositions.has(item))textPositions.set(item,Number(item.getAttribute('x'))||0);
          const x=textPositions.get(item);
          item.setAttribute('x',x<left?x:offset+x*scale);
        }else if(['polyline','line','circle','path','rect'].includes(item.tagName.toLowerCase())){
          item.setAttribute('transform','translate('+offset+' 0) scale('+scale+' 1)');
          if(item.hasAttribute('stroke')||item.tagName.toLowerCase()==='path')item.setAttribute('vector-effect','non-scaling-stroke');
        }
      }
    }
  }
  let queued=false;
  function schedule(){
    if(queued)return;queued=true;requestAnimationFrame(()=>{
      queued=false;decorate();fitCharts();
      for(const region of shell.querySelectorAll('.scroll-table,.obs-scroll')){
        if(region.scrollWidth>region.clientWidth+1){
          region.tabIndex=0;region.setAttribute('role','region');region.setAttribute('aria-label','数据表，可左右滑动或用方向键浏览');
        }else if(region.getAttribute('role')==='region'){
          region.removeAttribute('tabindex');region.removeAttribute('role');region.removeAttribute('aria-label');
        }
      }
    });
  }
  new MutationObserver(schedule).observe(shell,{childList:true,subtree:true});
  window.addEventListener('resize',schedule);
  window.addEventListener('marketlab:navigate',()=>{route();schedule();});
  window.addEventListener('hashchange',route);
  window.ML_MARKETS_READY.then(markets);
  route();schedule();
})();
