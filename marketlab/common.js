'use strict';
window.MLView = (() => {
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const num = (v, digits=2) => Number.isFinite(v) ? v.toLocaleString('zh-CN',{maximumFractionDigits:digits}) : '—';
  const percent = v => Number.isFinite(v) ? num(v*100)+'%' : '—';
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-');
  function table(headers, rows) {
    const wrap=el('div',undefined,'scroll-table'), t=el('table');
    const head=t.createTHead().insertRow();
    headers.forEach(h=>{ const th=el('th',h); th.scope='col'; head.append(th); });
    const body=t.createTBody();
    rows.forEach(row=>{const r=body.insertRow(); row.forEach(text=>{r.insertCell().textContent=text??'—';});});
    wrap.append(t);return wrap;
  }
  const palette=['#0a6d7d','#b84442','#6b3fb8','#8a5a00'];
  function lines(series) {
    const valid=series.map(s=>({...s,points:s.points.filter(p=>Number.isFinite(p.y))})).filter(s=>s.points.length);
    if(!valid.length)return el('p','暂无可绘制的观察值。','fine');
    const fig=el('figure',undefined,'ml-figure');
    const svg=(name,attrs)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',name);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,String(v)));return n;};
    const root=svg('svg',{viewBox:'0 0 720 195',role:'img','aria-label':valid.map(s=>s.label).join('、')});
    let min=Infinity,max=-Infinity;
    for(const s of valid)for(const p of s.points){min=Math.min(min,p.y);max=Math.max(max,p.y);}
    const pad=(max-min)*.08||Math.max(Math.abs(max)*.02,1);min-=pad;max+=pad;
    const xs=[...new Set(valid.flatMap(s=>s.points.map(p=>String(p.x))))].sort();
    const positions=new Map(xs.map((x,i)=>[x,i]));
    const x=v=>64+positions.get(String(v))*638/(xs.length>1?xs.length-1:1);
    const y=v=>157-(v-min)*137/(max-min);
    const label=(x,y,value,anchor='start')=>{const n=svg('text',{x,y,'text-anchor':anchor,fill:'#585170','font-size':12});n.textContent=value;root.append(n);};
    for(let i=0;i<4;i++){const val=min+(max-min)*i/3,py=y(val);root.append(svg('line',{x1:64,y1:py,x2:702,y2:py,stroke:'#ded6c9'}));label(58,py+4,num(val),'end');}
    valid.forEach((s,i)=>{
      const points=s.points.map(p=>x(p.x).toFixed(2)+','+y(p.y).toFixed(2)).join(' ');
      root.append(svg('polyline',{points,fill:'none',stroke:palette[i%4],'stroke-width':2.4}));
      if(s.points.length===1)root.append(svg('circle',{cx:x(s.points[0].x),cy:y(s.points[0].y),r:4,fill:palette[i%4]}));
    });
    label(64,182,xs[0]);if(xs.length>1)label(702,182,xs.at(-1),'end');
    fig.append(root);
    const legend=el('figcaption');valid.forEach((s,i)=>{const n=el('span',s.label+(s.unit?'（'+s.unit+'）':''));n.style.color=palette[i%4];legend.append(n);});fig.append(legend);
    return fig;
  }
  function probabilities(points){
    const fig=el('figure',undefined,'ml-figure');
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
    svg.setAttribute('viewBox','0 0 530 '+(points.length*38+8));svg.setAttribute('role','img');svg.setAttribute('aria-label','各方的上涨概率，量程为 0 至 100%');
    points.forEach((p,i)=>{
      const top=i*38+5;
      const label=document.createElementNS(ns,'text');label.setAttribute('x','4');label.setAttribute('y',String(top+18));label.textContent=p.x.slice(4);svg.append(label);
      const rect=document.createElementNS(ns,'rect');rect.setAttribute('x','125');rect.setAttribute('y',String(top+3));rect.setAttribute('width',String(p.y*3));rect.setAttribute('height','17');rect.setAttribute('fill',palette[i%palette.length]);svg.append(rect);
      const value=document.createElementNS(ns,'text');value.setAttribute('x',String(131+p.y*3));value.setAttribute('y',String(top+18));value.textContent=num(p.y)+'%';svg.append(value);
    });
    fig.append(svg);return fig;
  }
  function saved(key){
    try{const items=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(items)?items:[];}catch{return [];}
  }
  return {el,num,percent,uid,table,lines,probabilities,saved};
})();
