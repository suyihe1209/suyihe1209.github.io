"""Build a private, 2026-11-18-cutoff US cash-index snapshot from historical source responses."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

LAB=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(LAB/'model'))
END='2026-11-18'
START='2023-01-03'
FIELDS=('open','high','low','close')
INDICES={
    'spx':('SP:SPX','标普500指数（S&P 500）','SP500','INX','^GSPC','https://www.spglobal.com/spdji/en/indices/equity/sp-500/'),
    'ixic':('NASDAQ:IXIC','纳斯达克综合指数（NASDAQ Composite）','NASDAQCOM','IXIC','^IXIC','https://indexes.nasdaqomx.com/Index/Overview/COMP'),
}
JULY_EVIDENCE='https://documents.pse.com.ph/wp-content/uploads/sites/15/2023/07/foreignquote_070323.pdf'

def urls(symbol):
    _,_,fred,qq,yahoo,_=INDICES[symbol]
    result={symbol+'-verified.csv':'https://fred.stlouisfed.org/graph/fredgraph.csv?'+urlencode({'id':fred,'cosd':'2023-01-01','coed':END})}
    prefix='ixic-' if symbol=='ixic' else ''
    for y in range(2023,2027):
        start=date(y,1,1);end=min(date(y,12,31),date.fromisoformat(END))
        utc=lambda day:int(datetime(day.year,day.month,day.day,tzinfo=timezone.utc).timestamp())
        result[f'{prefix}tencent-{y}.json']=f'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=us.{qq},day,{start},{end},640,qfq'
        result[f'{prefix}yahoo-{y}.json']='https://query1.finance.yahoo.com/v8/finance/chart/%5E'+yahoo[1:]+'?'+urlencode({'period1':utc(start),'period2':utc(end+timedelta(days=1)),'interval':'1d'})
    if symbol=='ixic':
        result['nasdaq-official2.json']='https://api.nasdaq.com/api/quote/COMP/historical?assetclass=index&fromdate=2023-01-03&todate='+END+'&limit=1600'
    return result

def load_inputs(symbol,folder):
    entries=urls(symbol)
    def read(item):
        name,url=item
        if folder is not None:return name,(folder/name).read_bytes()
        return name,subprocess.check_output(['curl','--fail','--silent','--show-error','--location','--retry','2',
                         '--connect-timeout','10','--max-time','65','-A','Mozilla/5.0',url])
    with ThreadPoolExecutor(3) as pool:return dict(pool.map(read,entries.items()))

def cents(v):
    return Decimal(str(v).replace(',','')).quantize(Decimal('0.01'),rounding=ROUND_HALF_UP)

def valid(bar):
    o,h,l,c=bar
    return 0<l<=min(o,c)<=max(o,c)<=h

def add(data,day,bar,require_valid=True):
    if not START<=day<=END or date.fromisoformat(day).weekday()>4 or day in data or (require_valid and not valid(bar)):
        raise ValueError(f'日期、交易日重复、或 OHLC 异常：{day}')
    data[day]=bar

def reconcile(symbol,raw):
    _,_,fred_code,tencent,yahoo,_=INDICES[symbol];prefix='ixic-' if symbol=='ixic' else ''
    fred={};qq={};yf={};nasdaq={}
    for r in csv.DictReader(io.StringIO(raw[symbol+'-verified.csv'].decode('utf-8-sig'))):
        if r[fred_code].strip() not in {'.',''}: add(fred,r['observation_date'],cents(r[fred_code]),False)
    for y in range(2023,2027):
        for r in json.loads(raw[f'{prefix}tencent-{y}.json'])['data']['us.'+tencent]['day']:
            add(qq,r[0],tuple(cents(r[i]) for i in (1,3,4,2)))
        item=json.loads(raw[f'{prefix}yahoo-{y}.json'])['chart']['result'][0]
        if item['meta']['symbol']!=yahoo:raise ValueError('Yahoo 标的错误')
        quote=item['indicators']['quote'][0]
        for i,t in enumerate(item['timestamp']):
            d=datetime.fromtimestamp(t,ZoneInfo('America/New_York')).date().isoformat()
            add(yf,d,tuple(cents(quote[k][i]) for k in FIELDS))
    if symbol=='ixic':
        n=json.loads(raw['nasdaq-official2.json'])['data']
        if n['symbol']!='COMP':raise ValueError('Nasdaq 返回的并非综合指数')
        for r in n['tradesTable']['rows']:
            d=datetime.strptime(r['date'],'%m/%d/%Y').date().isoformat()
            add(nasdaq,d,tuple(cents(r[k]) for k in FIELDS),False)
    if not (qq.keys()==yf.keys()==fred.keys() and (not nasdaq or nasdaq.keys()==fred.keys())
            and min(fred)==START and max(fred)==END and len(fred)==974):
        raise ValueError('各来源交易日不一致、缺少端点或不符合已核验交易日历')
    out=io.StringIO(newline='');writer=csv.writer(out,lineterminator='\n');writer.writerow(('date',*FIELDS,'volume'))
    audit=[];matched=0
    for d in sorted(fred):
        candidates=[('Yahoo Finance',yf[d]),('腾讯财经',qq[d])]
        if nasdaq and valid(nasdaq[d]):candidates.insert(0,('Nasdaq',nasdaq[d]))
        # Prefer independently confirmed complete bars, and preserve the true high/low range.
        # An official Nasdaq opening can be outside its published intraday range.
        def rank(item):
            _,bar=item
            confirmations=sum(bar==other[1] for other in candidates)
            primary_agreement=sum(a==b for a,b in zip(bar,nasdaq.get(d,bar)))
            return (bar[3]==fred[d],confirmations,primary_agreement)
        source,bar=max(candidates,key=rank)
        matched+=int(bar[3]==fred[d])
        if symbol=='spx' and bar[3]!=fred[d]:raise ValueError('未能核对标普收盘 '+d)
        if qq[d]!=yf[d] or bar[3]!=fred[d] or (nasdaq and nasdaq[d]!=bar):
            item={'date':d,'selected':source,'fredClose':float(fred[d]),'selectedClose':float(bar[3]),
                  'vendorFieldDifferences':[f for i,f in enumerate(FIELDS) if qq[d][i]!=yf[d][i]]}
            if nasdaq:item['nasdaqOHLCValid']=valid(nasdaq[d])
            if symbol=='spx' and d=='2023-07-03':item['historicalReference']=JULY_EVIDENCE
            audit.append(item)
        writer.writerow([d,*bar,''])
    frozen_last={'spx':('7355.69','7367.68','7285.76','7323.63'),
                 'ixic':('24486.17','24538.78','24225.30','24429.88')}
    last=tuple(map(cents,frozen_last[symbol]))
    if tuple(cents(v) for v in out.getvalue().splitlines()[-1].split(',')[1:5])!=last:raise ValueError('截面日未通过独立核对')
    return out.getvalue().encode(),matched,audit

def build_snapshot(symbol,raw,target):
    from providers import CsvProvider
    from train import build,export_snapshot
    target=target.expanduser().resolve()
    if target.is_relative_to(LAB.parent):raise ValueError('目标须为网站外的私人目录')
    contents,matched,audit=reconcile(symbol,raw)
    code,name,fred,_,_,product=INDICES[symbol]
    source='Yahoo Finance、腾讯财经及 FRED 收盘核对' if symbol=='spx' else 'Nasdaq、Yahoo Finance、腾讯财经及 FRED 收盘核对'
    metadata={'market':{'id':code,'name':name,'currency':'USD','timezone':'America/New_York','priceUnit':'点','volumeUnit':'不适用','marketType':'指数','priceBasis':'美元计价价格指数，不含股息再投资'},
      'source':{'name':source,'url':product,'license':'本机个人研究，未取得公开展示或再分发完整历史行情的许可。','licenseUrl':'https://fred.stlouisfed.org/series/'+fred,
      'distribution':'local-only','demo':False,'from':START,'asOf':END,'rows':974,'updatedAt':datetime.now(timezone.utc).isoformat(timespec='seconds'),
      'basis':'完整交易日日线。现金指数无自身成交量。核验所有交易日期与收盘，修订差异详见来源清单。',
      'sha256':hashlib.sha256(contents).hexdigest(),'inputSha256':{k:hashlib.sha256(v).hexdigest() for k,v in raw.items()},'fetchUrls':urls(symbol),
      'validation':{'matchedFredClose':matched,'fredCompared':974,'vendorDifferences':audit}}}
    if target.exists() and any(target.iterdir()):raise ValueError('目标已有文件，请选新目录保留前一快照')
    target.parent.mkdir(parents=True,exist_ok=True)
    with TemporaryDirectory(dir=target.parent)as t:
        stage=Path(t)/'snapshot';stage.mkdir(mode=0o700)
        (stage/'source.csv').write_bytes(contents)
        (stage/'source.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+'\n')
        result=build(CsvProvider(stage/'source.csv',stage/'source.json'));export_snapshot(result,stage);stage.rename(target)
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--symbol',choices=INDICES,default='spx')
    p.add_argument('--out',type=Path,required=True);p.add_argument('--raw-dir',type=Path);a=p.parse_args()
    r=build_snapshot(a.symbol,load_inputs(a.symbol,a.raw_dir),a.out)
    print(r['market']['id'],len(r['bars']),r['bars'][-1],len(r['forecasts']),r['experiment']['scores'])
