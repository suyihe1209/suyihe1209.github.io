(function (root) {
  'use strict';
  const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 });
  const sign = x => (x > 0 ? '+' : '') + number.format(x);
  const movement = (asset, before, after) => asset.kind === 'yield' ? (after-before)*100 : (after/before-1)*100;
  const unit = asset => asset.kind === 'yield' ? '基点' : '%';
  const within = (rows,start,end) => rows.filter(r => r.date >= start && r.date <= end);

  // Both observations in every change must be present on both calendars.
  function pairChanges(a,b,start,end) {
    const other = new Map(within(b.rows,start,end).map(r=>[r.date,r.close]));
    let prev;
    const result=[];
    for (const point of within(a.rows,start,end)) {
      if (!other.has(point.date)) continue;
      const second=other.get(point.date);
      if (prev) result.push({from:prev.date,date:point.date,x:movement(a,prev.first,point.close),y:movement(b,prev.second,second)});
      prev={date:point.date,first:point.close,second};
    }
    return result;
  }
  function correlation(pairs) {
    if (pairs.length<2) return null;
    const mx=pairs.reduce((s,p)=>s+p.x,0)/pairs.length;
    const my=pairs.reduce((s,p)=>s+p.y,0)/pairs.length;
    let cross=0,xx=0,yy=0;
    for(const p of pairs){const x=p.x-mx,y=p.y-my;cross+=x*y;xx+=x*x;yy+=y*y;}
    return xx>0&&yy>0 ? Math.max(-1,Math.min(1,cross/Math.sqrt(xx*yy))) : null;
  }
  function rolling(pairs,windowSize) {
    const rows=[];
    for(let i=windowSize-1;i<pairs.length;i++){
      const close=correlation(pairs.slice(i-windowSize+1,i+1));
      rows.push({date:pairs[i].date,close});
    }
    return rows;
  }
  function aggregate(rows,period){
    if(period==='day')return rows;
    const buckets=[];
    let lastKey;
    for(const row of rows){
      const stamp=new Date(row.date+'T00:00:00Z');
      stamp.setUTCDate(stamp.getUTCDate()-((stamp.getUTCDay()+6)%7));
      const key=period==='week'?stamp.toISOString().slice(0,10):row.date.slice(0,7);
      if(key!==lastKey){buckets.push({...row});lastKey=key;continue;}
      const group=buckets.at(-1);
      group.date=row.date;group.high=Math.max(group.high,row.high);group.low=Math.min(group.low,row.low);group.close=row.close;
      if(Number.isFinite(row.volume)&&Number.isFinite(group.volume))group.volume+=row.volume;
      else delete group.volume;
    }
    return buckets;
  }
  function indicators(asset,day){
    const i=asset.rows.findIndex(r=>r.date===day);
    const avg=n=>i+1<n?null:asset.rows.slice(i+1-n,i+1).reduce((sum,r)=>sum+r.close,0)/n;
    const change=n=>i<n?null:movement(asset,asset.rows[i-n].close,asset.rows[i].close);
    return {ma5:avg(5),ma20:avg(20),change5:change(5),change20:change(20)};
  }
  function node(tag,text,cls) {
    const n=document.createElement(tag);
    if (text!=null)n.textContent=text;
    if(cls)n.className=cls;
    return n;
  }
  function select(label,choices,value) {
    const wrap=node('label',label);
    const control=node('select');control.setAttribute('aria-label',label);
    for (const [val,title] of choices) control.add(new Option(title,val));
    control.value=value;wrap.append(control);return [wrap,control];
  }
  const regions={cn:'中国大陆',us:'美国',global:'跨市场',other:'其他市场'};
  function marketChoices(assets){
    const primary=assets.filter(a=>['CSI:000300','SP:SPX','NASDAQ:IXIC'].includes(a.id));
    const macro=['UST:10Y','ECB:USDCNY','FED:USDCNY'].map(id=>assets.find(a=>a.id===id)).filter(Boolean);
    const current=[...new Map([...primary,...macro,...assets.filter(a=>['cn','us','global'].includes(a.region))].map(a=>[a.id,a])).values()];
    // An older standalone bundle can still be opened before the market catalog loads.
    const choices=current.length>=2?current:assets;
    return {available:choices,archived:assets.filter(a=>!choices.includes(a)),primary};
  }
  function newsRegion(n){return n.region||(n.id?.startsWith('FOMC:')?'us':'other');}
  function filterNews(news,start,end,region,tone){
    return news.filter(n=>n.date>=start&&n.date<=end&&(region==='全部'||newsRegion(n)===region)&&(tone==='全部'||n.tone===tone))
      .sort((a,b)=>a.date.localeCompare(b.date)||String(a.publishedAt||'').localeCompare(String(b.publishedAt||'')));
  }
  function publicationLabel(n){
    if(n.datePrecision==='day'||!n.publishedAt)return n.date+'（仅公布日期）';
    const when=new Date(n.publishedAt);
    if(!Number.isFinite(when.getTime()))return n.date+'（仅公布日期）';
    const region=newsRegion(n),zone=region==='cn'?'Asia/Shanghai':region==='us'?'America/New_York':null;
    if(!zone)return n.publishedAt;
    const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    return formatter.format(when)+' '+(region==='cn'?'北京时间':'纽约时间');
  }
  function sourceInfo(asset){
    const obj=typeof asset.source==='object'&&asset.source?asset.source:{};
    return {name:obj.name||asset.sourceName||(typeof asset.source==='string'?asset.source:'来源待标注'),
      url:obj.url||asset.sourceUrl||asset.url||'',license:obj.license||asset.license||'',
      licenseUrl:obj.licenseUrl||asset.licenseUrl||''};
  }
  function mount(container) {
    const data=root.ML_ASSETS;
    if(!container||!data?.assets?.length)return;
    container.replaceChildren();
    container.classList.add('obs');
    const header=node('div',null,'panel-head');
    header.append(node('h2','市场观察'),node('span',data.start.slice(0,4)+'—'+data.end.slice(0,4)+' 历史日线','fine'));
    const controls=node('div',null,'obs-controls');
    const groups=marketChoices(data.assets);
    if(groups.available.length<2){container.append(header,node('p','至少需要两项有日线的标的才能比较。'));return;}
    const options=items=>items.map(a=>[a.id,a.name]);
    const [aw,ac]=select('观察标的',options(groups.available),groups.available[0].id);
    const [bw,bc]=select('对照标的',options(groups.available),groups.available[1].id);
    const archives=node('details',null,'obs-legacy');archives.hidden=!groups.archived.length;
    archives.append(node('summary','其他市场归档（'+groups.archived.length+'）'));
    const oldItems=node('div',null,'obs-legacy-items');
    for(const item of groups.archived){
      const button=node('button',item.shortName||item.name);button.type='button';button.title='查看 '+item.name;
      button.onclick=()=>{ac.value=item.id;ac.onchange();};oldItems.append(button);
    }
    archives.append(oldItems);
    const activeChoices=()=>archives.open?[...groups.available,...groups.archived]:groups.available;
    function updateChoices(){
      const items=activeChoices(), first=ac.value,second=bc.value;
      for(const c of [ac,bc])c.replaceChildren(...items.map(a=>new Option(a.name,a.id)));
      ac.value=items.some(a=>a.id===first)?first:items[0].id;
      bc.value=items.some(a=>a.id===second&&a.id!==ac.value)?second:items.find(a=>a.id!==ac.value).id;
      refresh();
    }
    archives.ontoggle=updateChoices;
    const [ww,wc]=select('滚动窗口',[['20','20 个共同区间'],['60','60 个共同区间'],['120','120 个共同区间']],'60');
    function dateControl(label,value) {
      const w=node('label',label);const input=node('input');
      input.type='date';input.value=value;input.min=data.start;input.max=data.end;input.setAttribute('aria-label',label);w.append(input);return [w,input];
    }
    const [sw,sc]=dateControl('起始日期',data.start),[ew,ec]=dateControl('截止日期',data.end);
    controls.append(aw,bw,sw,ew,ww);
    const save=node('button','保存到实验记录');save.type='button';
    const feedback=node('span',null,'subtle');feedback.setAttribute('role','status');
    const archive=node('div',null,'obs-save');archive.append(save,feedback);
    let snapshot, chartDispose, candlePeriod='day';
    const body=node('div'), newsView=node('section',null,'obs-news');
    const news=data.news||[];
    const regionKeys=[...new Set(news.map(newsRegion))].sort();
    const toneKeys=[...new Set(news.map(n=>n.tone).filter(Boolean))];
    const [rw,rc]=select('新闻地区',[['全部','全部地区'],...regionKeys.map(k=>[k,regions[k]||k])],'全部');
    const [tw,tc]=select('政策语气',[['全部','全部语气'],...toneKeys.map(t=>[t,t])],'全部');
    const newsTitle=node('div',null,'panel-head');newsTitle.append(node('h3','政策新闻与语气走势'),rw,tw);
    const newsBody=node('div');newsView.append(newsTitle,newsBody);
    container.append(header);
    if(groups.primary.length<3){
      const loaded=groups.primary.map(a=>a.id);
      const missing=[['CSI:000300','沪深300'],['SP:SPX','标普500'],['NASDAQ:IXIC','纳斯达克综合指数']].filter(([id])=>!loaded.includes(id)).map(([,name])=>name).join('、');
      container.append(node('p',missing+'的本机历史快照尚未载入。当前可查看'+groups.available.slice(0,2).map(a=>a.name).join('与')+'。','subtle obs-status'));
    }
    container.append(archives,controls,body,newsView,archive);
    save.onclick=()=>{
      if(!snapshot)return;
      try {
        const key='ml.observe.runs.v1', prior=JSON.parse(localStorage.getItem(key)||'[]');
        if(!Array.isArray(prior))throw Error('Invalid archive');
        const id=root.crypto?.randomUUID?.()||('observe-'+Date.now()+'-'+Math.random().toString(36).slice(2));
        localStorage.setItem(key, JSON.stringify([{...snapshot,id,createdAt:new Date().toISOString()},...prior]));
        feedback.textContent='已保存，可在研究报告中选取。';
      }catch(e){feedback.textContent='本机未能保存，已有实验记录保留。';}
    };

    function svgEl(name,attrs) {
      const e=document.createElementNS('http://www.w3.org/2000/svg',name);
      for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);
      return e;
    }
    function draw(rows,caption,range,format,style='') {
      const figure=node('figure',null,'obs-plot '+style);
      figure.append(node('figcaption',caption));
      const valid=rows.filter(r=>Number.isFinite(r.close));
      if(!valid.length){figure.append(node('p','当前区间的有效样本不足。','subtle'));return figure;}
      const svg=svgEl('svg',{viewBox:'0 0 500 148',role:'img','aria-label':caption});
      const title=svgEl('title',{});title.textContent=caption;svg.append(title);
      const values=valid.map(r=>r.close);
      let [lo,hi]=range||[Math.min(...values),Math.max(...values)];
      if(hi===lo){const delta=Math.max(Math.abs(lo)*.01,.01);lo-=delta;hi+=delta;}
      const first=Date.parse(rows[0].date),last=Date.parse(rows.at(-1).date);
      const x=d=>last===first?267:62+(Date.parse(d)-first)/(last-first)*428;
      const y=v=>110-(v-lo)/(hi-lo)*100;
      const text=(value,px,py,anchor)=>{
        const t=svgEl('text',{x:px,y:py,'text-anchor':anchor});t.textContent=value;svg.append(t);
      };
      for(const v of [hi,(hi+lo)/2,lo]){
        svg.append(svgEl('line',{x1:60,x2:490,y1:y(v),y2:y(v),class:'grid-line'}));text(format(v),55,y(v)+4,'end');
      }
      text(rows[0].date,60,136,'start');text(rows.at(-1).date,490,136,'end');
      let pen=false,path='';
      for(const r of rows){
        if(!Number.isFinite(r.close)){pen=false;continue;}
        path+=(pen?'L':'M')+x(r.date).toFixed(2)+' '+y(r.close).toFixed(2)+' ';pen=true;
      }
      svg.append(svgEl('path',{d:path,class:'series-line'}));
      if(valid.length===1)svg.append(svgEl('circle',{cx:x(valid[0].date),cy:y(valid[0].close),r:3,fill:'currentColor'}));
      figure.append(svg);return figure;
    }
    function extLink(text,url){
      const a=node('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;
    }
    function assetCard(a,rows,index){
      const card=node('div',null,'obs-card');
      const source=sourceInfo(a);card.append(node('h4',a.name));
      if(!rows.length){card.append(node('p','该区间没有观测。'));return card;}
      const first=rows[0],last=rows.at(-1),change=movement(a,first.close,last.close);
      card.append(node('p',number.format(last.close)+' '+a.unit+'　·　区间变动 '+sign(change)+' '+unit(a),'obs-value'),
        draw(rows,'日度水平 · '+a.unit,null,v=>number.format(v),index?'obs-green':''),
        node('p',a.description,'subtle'),node('p',first.date+' 至 '+last.date+' · '+rows.length+' 天 · '+a.timezone,'subtle'),
        source.url?extLink(source.name,source.url):node('span',source.name));
      if(source.licenseUrl||source.license){
        const note=node('p',null,'subtle');note.append(source.licenseUrl?extLink(source.license||'使用条款',source.licenseUrl):node('span',source.license));card.append(note);
      }
      return card;
    }
    function detailPanel(asset,rows){
      const section=node('section',null,'obs-detail');
      section.append(node('h3',asset.name+' · 日线与指标'));
      if(!rows.length){section.append(node('p','所选期间没有交易记录。'));return section;}
      const fullOHLC=rows.every(r=>[r.open,r.high,r.low,r.close].every(Number.isFinite));
      if(fullOHLC&&typeof root.MarketLabChart==='function'){
        const choices=[['day','日 K'],['week','周 K'],['month','月 K']];
        const [w,choice]=select('K 线周期',choices,candlePeriod);
        const frame=node('div',null,'obs-candles'),canvas=node('canvas');
        canvas.dataset.chart='candles';canvas.tabIndex=0;canvas.setAttribute('aria-label',asset.name+' K线，按左右方向键查阅');
        const cw=node('label','查阅 K 线'), cs=node('select');
        cs.dataset.chart='inspect-date';cs.setAttribute('aria-label','查阅 K 线');cw.append(cs);
        const val=node('p'),meta=node('p',null,'subtle');val.dataset.chart='ohlcv';meta.dataset.chart='chart-meta';
        frame.append(canvas,cw,val,meta);section.append(w,frame);
        function paintCandles(){
          chartDispose?.();
          // chart.js installs input handlers on its canvas and select. Fresh elements
          // keep one set of handlers when switching aggregation modes.
          const newCanvas=frame.querySelector('canvas').cloneNode(false);
          frame.querySelector('canvas').replaceWith(newCanvas);
          const oldSelect=frame.querySelector('select');oldSelect.replaceWith(oldSelect.cloneNode(false));
          candlePeriod=choice.value;
          const bars=aggregate(rows,candlePeriod);
          const chart=root.MarketLabChart(bars,{priceUnit:asset.unit,volumeUnit:asset.volumeUnit||(asset.kind==='etf'?'份':'未标注')},frame);
          chartDispose=chart.dispose;
          chart(bars.length-1,Math.min(60,bars.length));
          const vol=rows.some(r=>Number.isFinite(r.volume))?' · 成交量单位 '+(asset.volumeUnit||(asset.kind==='etf'?'份':'未标注')):' · 数据源未提供成交量';
          meta.textContent=choices.find(p=>p[0]===candlePeriod)[1]+' · 最近 '+Math.min(60,bars.length)+' 根 · 红涨绿跌'+vol
            +(candlePeriod==='day'?'':' · 首末周期只计所选区间内的数据');
        }
        choice.onchange=paintCandles;
        // A size observer redraws the chart once the new section is attached.
        paintCandles();
      }
      const [pick,day]=select('日线查数',rows.map(r=>[r.date,r.date]),rows.at(-1).date);
      const metrics=node('p',null,'obs-value'),values=node('p',null,'subtle');
      const inspectDay=()=>{
        const row=rows.find(r=>r.date===day.value),i=indicators(asset,day.value);
        const label=(v,fmt,suffix)=>v==null?'样本不足':fmt(v)+' '+suffix;
        const basic=fullOHLC?'开 '+number.format(row.open)+'　高 '+number.format(row.high)+'　低 '+number.format(row.low)+'　收 ':'观测值 ';
        values.textContent=basic+number.format(row.close)+' '+asset.unit+(Number.isFinite(row.volume)?'　成交量 '+number.format(row.volume)+' '+(asset.volumeUnit||(asset.kind==='etf'?'份':'未标注')):'');
        metrics.textContent='近 5 日 '+label(i.change5,sign,unit(asset))+'　·　近 20 日 '+label(i.change20,sign,unit(asset))+
          '　·　5 日均值 '+label(i.ma5,v=>number.format(v),asset.unit)+'　·　20 日均值 '+label(i.ma20,v=>number.format(v),asset.unit);
      };
      day.onchange=inspectDay;inspectDay();
      section.append(pick,values,metrics,node('p','指标按所查日期及之前的实际观测日计算。','subtle'));return section;
    }
    function matrix(first,second,start,end) {
      const section=node('details',null,'obs-matrix');
      section.append(node('summary','查看全部标的的相关系数'));
      const table=node('table'), head=node('tr'), assets=activeChoices();
      head.append(node('th',''));assets.forEach(a=>head.append(node('th',a.shortName||a.name)));table.append(head);
      assets.forEach((a,i)=>{
        const row=node('tr');row.append(node('th',a.shortName||a.name));
        assets.forEach((b,j)=>{
          const ps=pairChanges(a,b,start,end),r=correlation(ps),td=node('td');
          if(i===j){td.textContent='—';}
          else{
            const btn=node('button',r==null?'—':r.toFixed(2));
            btn.title=a.name+' × '+b.name+' · '+ps.length+' 个区间';
            btn.setAttribute('aria-label',btn.title);btn.type='button';
            btn.dataset.selected=String(first.id===a.id&&second.id===b.id);
            if(r!=null)btn.style.backgroundColor=r>=0?'rgba(85,138,126,'+(0.06+.3*r)+')':'rgba(199,125,138,'+(0.06-.3*r)+')';
            btn.onclick=()=>{ac.value=a.id;bc.value=b.id;refresh();body.querySelector('details').open=true;};td.append(btn);
          }
          row.append(td);
        });table.append(row);
      });const scroll=node('div',null,'obs-scroll');scroll.append(table);section.append(scroll);return section;
    }
    function showNews(start,end) {
      newsBody.replaceChildren();
      const all=filterNews(news,start,end,rc.value,'全部');
      if(!all.length){newsBody.append(node('p','所选地区与日期范围内没有收录的公告。','subtle'));return;}
      const filtered=filterNews(news,start,end,rc.value,tc.value);
      if(!filtered.length){newsBody.append(node('p','所选期间没有符合语气筛选的公告。','subtle'));return;}
      const counts=toneKeys.map(t=>[t,filtered.filter(n=>n.tone===t).length]).filter(([,n])=>n);
      newsBody.append(node('p',counts.map(([t,n])=>t+' '+n+' 次').join('，')+'。分类依据为来源披露的利率行动或明确政策表述。会议纪要与单日操作单列。','subtle'));
      const timeline=node('div',null,'obs-timeline');timeline.setAttribute('aria-label','政策行动按公布日期排列');
      filtered.forEach(n=>{
        const a=node('a',n.date.slice(2,4)+'/'+n.date.slice(5,7)+' '+(regions[newsRegion(n)]||'')+' '+(n.tone||''));
        a.href=n.sourceUrl;a.target='_blank';a.rel='noopener noreferrer';a.title=n.date+' '+n.summary;a.dataset.tone=n.tone;timeline.append(a);
      });newsBody.append(timeline);
      filtered.reverse();
      const list=node('div',null,'obs-events');
      filtered.forEach(n=>{
        const item=node('details'), heading=node('summary',n.date+'　'+(regions[newsRegion(n)]||'')+'　'+n.title+'　·　'+n.tone);
        item.append(heading,node('p',n.summary),node('p',publicationLabel(n)+'　｜　对象：'+n.subject+(n.evidence?'　｜　分类依据：'+n.evidence:''),'subtle'),
          extLink(n.source+' 原文',n.sourceUrl));list.append(item);
      });newsBody.append(list);
    }
    function refresh() {
      const start=sc.value,end=ec.value;
      chartDispose?.();chartDispose=null;body.replaceChildren();newsBody.replaceChildren();snapshot=null;save.disabled=true;feedback.textContent='';
      if(!start||!end||start>end||start<data.start||end>data.end){body.append(node('p','请选择样本覆盖期间内的有效起止日期。','note'));return;}
      const a=data.assets.find(x=>x.id===ac.value),b=data.assets.find(x=>x.id===bc.value);
      const cards=node('div',null,'obs-cards');
      cards.append(assetCard(a,within(a.rows,start,end),0),assetCard(b,within(b.rows,start,end),1));
      body.append(cards,detailPanel(a,within(a.rows,start,end)));
      const pairs=pairChanges(a,b,start,end),r=correlation(pairs),n=+wc.value;
      const history=rolling(pairs,n),last=history.at(-1);
      body.append(node('h3','跨市场联动'),node('p','全区间相关系数 '+(r==null?'—':r.toFixed(3))+'　·　最近 '+n+' 个区间 '+(last?.close==null?'—':last.close.toFixed(3))+'　·　共同区间 '+pairs.length,'obs-value'),
        draw(history,'滚动相关系数 · '+n+' 个共同区间',[-1,1],v=>v.toFixed(1),'obs-green'),
        node('p','两个标的都有报价的相邻日期构成一个共同区间。价格、指数和汇率取区间涨跌幅，美债收益率取基点差。使用皮尔逊相关系数；各地按当地日期配对，不同市场的收盘时刻可能不同。','subtle'),
        matrix(a,b,start,end));
      showNews(start,end);
      const releases=filterNews(news,start,end,rc.value,tc.value),sourceA=sourceInfo(a),sourceB=sourceInfo(b);
      const level=r==null?'样本不足':r.toFixed(3), trailing=last?.close==null?'样本不足':last.close.toFixed(3);
      const sources=[...new Set([sourceA.name,sourceB.name,...releases.map(n=>n.source)])].join('、');
      const notes=[
        '相邻共同报价日为同一区间，价格与汇率用区间百分比变化，债券收益率用基点差。交易日按各市场当地日期标记，收盘时间不同。',
        '政策行动或明确表述按偏紧 +1、持平 0、偏松 −1 记录。会议纪要及未表达方向的操作公告不评分。时间取来源所在地，只有日期的报道按当地日末进入历史回放。',
        a.name+' 来源 '+sourceA.url+'，许可 '+(sourceA.license||sourceA.licenseUrl),
        b.name+' 来源 '+sourceB.url+'，许可 '+(sourceB.license||sourceB.licenseUrl),
        ...releases.map(item=>publicationLabel(item)+' '+item.source+' '+item.tone+'（'+(Number.isFinite(item.score)?String(item.score):'未评分')+'）｜'+item.summary+' '+item.sourceUrl)
      ];
      snapshot={marketName:a.name+' × '+b.name, source:{name:sources,url:sourceA.url,asOf:end},config:{assets:[a.id,b.id],start,end,window:n,tone:tc.value,newsRegion:rc.value},
        report:{facts:[{label:'日期范围',value:start+' 至 '+end},{label:'共同区间数',value:String(pairs.length)},
          {label:'全区间相关系数',value:level},{label:'最近 '+n+' 个区间的相关系数',value:trailing},
          {label:'新闻地区',value:regions[rc.value]||rc.value},{label:'新闻语气筛选',value:tc.value},{label:'匹配的公告',value:releases.length+' 篇'}],
        lines:[{label:'滚动相关系数',unit:'相关系数',points:history.filter(p=>Number.isFinite(p.close)).map(p=>({x:p.date,y:p.close}))}],notes}};
      save.disabled=pairs.length<2 && releases.length===0;
    }
    ac.onchange=()=>{if(ac.value===bc.value)bc.value=activeChoices().find(a=>a.id!==ac.value).id;refresh();};
    bc.onchange=()=>{if(ac.value===bc.value)ac.value=activeChoices().find(a=>a.id!==bc.value).id;refresh();};
    for(const c of [sc,ec,wc,tc,rc])c.onchange=refresh;
    refresh();
  }
  root.MarketLabObserve={mount,pairChanges,correlation,rolling,movement,aggregate,indicators,marketChoices,filterNews,publicationLabel};
})(typeof window!=='undefined'?window:globalThis);
