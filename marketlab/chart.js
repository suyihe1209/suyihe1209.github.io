'use strict';
window.MarketLabChart = function (bars, market, container = document) {
  const find = role => container === document ? document.getElementById(role) : container.querySelector('[data-chart="' + role + '"]');
  const canvas = find('candles');
  const select = find('inspect-date');
  const number = new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 4});
  let visible = [], selected = 0, plotLeft = 0, step = 1;
  function paint() {
    if (!visible.length) return;
    const width = Math.round(canvas.getBoundingClientRect().width), height = canvas.clientHeight;
    if (!width || !height) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);
    ctx.font = '11px system-ui, sans-serif';
    let min = Math.min(...visible.map(b => b.low)), max = Math.max(...visible.map(b => b.high));
    const delta = Math.max((max-min)*.08, Math.abs(max)*.0005,.0001);
    min -= delta; max += delta;
    const bottom = height*.68, top = 15, volumeBase = height-24, volumeHeight = height*.19;
    plotLeft = Math.max(ctx.measureText(number.format(max)).width+8, 40);
    const plotWidth = width-plotLeft-5;
    step = plotWidth/visible.length;
    const x = i => plotLeft+(i+.5)*step;
    const y = p => bottom-(p-min)/(max-min)*(bottom-top);
    const line = (x1,y1,x2,y2,color) => {
      ctx.strokeStyle=color; ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    };
    for (let i=0; i<4; i++) {
      const price = min+(max-min)*i/3, pos=y(price);
      line(plotLeft,pos,width-4,pos,'#e0d3bf');
      ctx.textAlign='right'; ctx.fillStyle='#585170';ctx.fillText(number.format(Number(price.toFixed(2))),plotLeft-5,pos+4);
    }
    const volMax = Math.max(1,...visible.map(b=>b.volume).filter(Number.isFinite));
    const body = Math.max(1, Math.min(17, step*.62));
    visible.forEach((b,i)=>{
      const color=b.close===b.open?'#6b6484':b.close>b.open?'#b3261e':'#0f7a46';
      line(x(i),y(b.low),x(i),y(b.high),color);ctx.fillStyle=color;
      ctx.fillRect(x(i)-body/2,Math.min(y(b.open),y(b.close)),body,Math.max(1,Math.abs(y(b.open)-y(b.close))));
      if (!Number.isFinite(b.volume)) return;
      const v = b.volume/volMax*volumeHeight;
      ctx.globalAlpha=.7;ctx.fillRect(x(i)-body/2,volumeBase-v,body,v);ctx.globalAlpha=1;
    });
    ctx.setLineDash([3,3]);line(x(selected),top,x(selected),volumeBase,'#0a6d7d');ctx.setLineDash([]);
    ctx.fillStyle='#585170';ctx.textAlign='left';ctx.fillText('量',4,volumeBase-volumeHeight/2);
    ctx.fillText(visible[0].date,plotLeft,height-5);
    if(visible.length>1){ctx.textAlign='right';ctx.fillText(visible.at(-1).date,width-4,height-5);}
  }
  function inspect(i) {
    selected=Math.max(0,Math.min(visible.length-1,i));
    const b=visible[selected]; if(!b)return;
    select.value=b.date;
    find('ohlcv').textContent='开 '+number.format(b.open)+'　高 '+number.format(b.high)+'　低 '+number.format(b.low)+'　收 '+number.format(b.close)+' '+market.priceUnit+'　成交量 '+(Number.isFinite(b.volume)?number.format(b.volume)+' '+market.volumeUnit:'未提供');
    paint();
  }
  select.addEventListener('change',()=>inspect(select.selectedIndex));
  function point(e) { inspect(Math.floor((e.clientX-canvas.getBoundingClientRect().left-plotLeft)/step)); }
  canvas.addEventListener('pointermove',e=>{if(e.pointerType==='mouse')point(e)});
  canvas.addEventListener('pointerdown',point);
  canvas.addEventListener('keydown',e=>{
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    e.preventDefault();
    inspect(e.key==='Home'?0:e.key==='End'?visible.length-1:selected+(e.key==='ArrowLeft'?-1:1));
  });
  const observer = 'ResizeObserver' in window ? new ResizeObserver(paint) : null;
  if(observer)observer.observe(canvas);
  else window.addEventListener('resize',paint);
  const draw = (end,period)=>{
    visible=bars.slice(Math.max(0,end-period+1),end+1);
    select.replaceChildren(...visible.map(b=>new Option(b.date,b.date)));
    find('chart-meta').textContent='日线 · '+visible.length+' 个交易日 · 价格（'+market.priceUnit+'）／成交量（'+market.volumeUnit+'） · 红涨绿跌';
    inspect(visible.length-1);
  };
  draw.dispose=()=>{observer?.disconnect();window.removeEventListener('resize',paint);};
  return draw;
};
