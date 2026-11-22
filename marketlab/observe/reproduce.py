"""Rebuild the two-year observation bundle from official reports and statements."""
import argparse
import csv
from datetime import date, datetime
from fractions import Fraction
from concurrent.futures import ThreadPoolExecutor
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError
from zoneinfo import ZoneInfo
import hashlib
import json
import re
import time
import xml.etree.ElementTree as ET

MONTHS = [f'{y}{m:02}' for y in (2023, 2024) for m in range(1, 13)]
MEETINGS = '20230201 20230322 20230503 20230614 20230726 20230920 20231101 20231213 20240131 20240320 20240501 20240612 20240731 20240918 20241107 20241218'.split()
FX_URLS = {2023: 'https://www.cbc.gov.tw/tw/cp-2151-165071-58ddd-1.html',
           2024: 'https://www.cbc.gov.tw/tw/cp-2151-178553-efe4c-1.html'}
OGDL = 'https://data.gov.tw/license'
TWSE = 'https://www.twse.com.tw/rwd/zh/afterTrading/'
TREASURY = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value='
FED = 'https://www.federalreserve.gov/newsevents/pressreleases/monetary'
BASE = Path(__file__).resolve().parent

def urls():
    for m in MONTHS:
        for code in ('0050','00635U'):
            yield f'{code}-{m}.json', f'{TWSE}STOCK_DAY?stockNo={code}&date={m}01&response=json'
        yield f'TAIEX-{m}.json', f'https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_HIST?date={m}01&response=json'
    for y in (2023,2024):
        yield f'fx-{y}.html', FX_URLS[y]
        yield f'treasury-{y}.xml', TREASURY+str(y)
    for m in MEETINGS:
        yield f'fomc-{m}.html', FED+m+'a.htm'

def fetch(cache, item):
    name,url=item
    path=cache/name
    if path.exists():return
    for i in range(4):
        try:
            target=url.replace('www.twse.com.tw','wwwc.twse.com.tw') if i%2 else url
            req=Request(target,headers={'User-Agent':'MarketLab/1.0 historical research', 'Accept':'*/*'})
            with urlopen(req,timeout=12) as stream: data=stream.read()
            if name.endswith('.json') and json.loads(data).get('stat')!='OK':raise ValueError('unavailable report')
            if name.endswith('.xml') and b'BC_10YEAR' not in data:raise ValueError('unavailable rates')
            if name.startswith('fomc') and b'target range for the federal funds rate' not in data:raise ValueError('unavailable statement')
            path.write_bytes(data)
            time.sleep(.5)
            return
        except (ValueError,URLError,OSError) as e:
            if i==3:raise RuntimeError(name+' could not be retrieved') from e
            time.sleep(1+i)

class TableRows(HTMLParser):
    def __init__(self):
        super().__init__(); self.rows=[]; self.row=None; self.cell=None
    def handle_starttag(self,tag,attrs):
        if tag=='tr': self.row=[]
        if tag=='td' and self.row is not None: self.cell=[]
    def handle_data(self,data):
        if self.cell is not None: self.cell.append(data)
    def handle_endtag(self,tag):
        if tag=='td' and self.cell is not None:
            self.row.append(''.join(self.cell).strip()); self.cell=None
        if tag=='tr' and self.row is not None:
            self.rows.append(self.row); self.row=None

def series_info(identifier,name,kind,unit,source,url,license_url,description,rows,timezone='Asia/Taipei'):
    if len(rows)<450:raise ValueError(f'{identifier}: insufficient history')
    dates=[r['date'] for r in rows]
    if dates!=sorted(set(dates)) or dates[0][:4]!='2023' or dates[-1][:4]!='2024': raise ValueError(identifier+' session coverage')
    for r in rows:
        date.fromisoformat(r['date'])
        if not (r['close']>0):raise ValueError(identifier+' closing value')
        if 'open' in r and not (0<r['low']<=min(r['open'],r['close'])<=max(r['open'],r['close'])<=r['high']):raise ValueError(identifier+' OHLC')
    return dict(id=identifier,name=name,kind=kind,unit=unit,timezone=timezone,frequency='日',source=source,sourceUrl=url,
                licenseUrl=license_url,description=description,rows=rows,
                license='政府资料开放授权条款第1版' if license_url==OGDL else '美国联邦政府作品 · 17 USC §105',
                sha256=hashlib.sha256(json.dumps(rows,ensure_ascii=False,separators=(',',':')).encode()).hexdigest())

def twse_rows(cache,code):
    rows=[]
    for m in MONTHS:
        d=json.loads((cache/f'{code}-{m}.json').read_text(encoding='utf-8')); index=code=='TAIEX'
        if not ((index and '發行量加權股價指數' in d['title']) or (not index and code in d['title'])):raise ValueError(d['title'])
        label='指數' if index else '價'
        for x in d['data']:
            vals=dict(zip(d['fields'],x)); yr,mo,dy=map(int,vals['日期'].split('/'))
            day=date(1911+yr,mo,dy)
            if day.strftime('%Y%m')!=m:raise ValueError('wrong month in monthly response')
            row={'date':day.isoformat()}
            for eng,zh in zip(('open','high','low','close'),('開盤','最高','最低','收盤')):
                row[eng]=float(vals[zh+label].replace(',',''))
            if not index:row['volume']=int(vals['成交股數'].replace(',',''))
            rows.append(row)
    return rows

def fx_rows(cache):
    rows=[]
    for y in (2023,2024):
        parser=TableRows();parser.feed((cache/f'fx-{y}.html').read_text(encoding='utf-8'))
        for pair in parser.rows:
            if len(pair)==2 and re.fullmatch(str(y)+r'/\d{1,2}/\d{1,2}',pair[0]):
                rows.append({'date':date(*map(int,pair[0].split('/'))).isoformat(),'close':float(pair[1])})
    return sorted(rows,key=lambda r:r['date'])

def treasury_rows(cache):
    rows=[]
    for y in (2023,2024):
        for p in ET.parse(cache/f'treasury-{y}.xml').findall('.//{*}properties'):
            t=p.find('{*}BC_10YEAR')
            if t is not None and t.text:
                rows.append({'date':p.find('{*}NEW_DATE').text[:10],'close':float(t.text)})
    return rows

def rate_value(s):
    return sum(float(Fraction(x)) for x in s.split('-'))

def decision(cache,m):
    raw=(cache/f'fomc-{m}.html').read_text(encoding='utf-8')
    text=' '.join(unescape(re.sub('<[^>]+>',' ',raw)).replace('‑','-').replace('‐','-').split())
    found=re.search(r'Committee decided to (raise|maintain|lower) the target range for the federal funds rate (?:by [\d/]+ percentage points? )?(?:at|to) ([\d/-]+) to ([\d/-]+) percent',text,re.I)
    published=re.search(r'For release at (\d+):(\d\d) p\.m\. (EST|EDT)',text)
    if not found or not published: raise ValueError('cannot parse official statement '+m)
    act,lo,hi=found.groups()
    lower,upper=rate_value(lo),rate_value(hi)
    action,tone,score={'raise':('上调','偏紧',1),'maintain':('维持','持平',0),'lower':('下调','偏松',-1)}[act]
    stamp=datetime.strptime(m,'%Y%m%d').replace(hour=int(published[1])%12+12,minute=int(published[2]),tzinfo=ZoneInfo('America/New_York'))
    if stamp.tzname()!=published[3]:raise ValueError('statement timezone')
    summary=f'委员会{action}联邦基金利率目标区间至 {lower:g}%–{upper:g}%。'
    if act=='maintain':summary=f'委员会维持联邦基金利率目标区间 {lower:g}%–{upper:g}%。'
    return dict(id='FOMC:'+m,date=stamp.date().isoformat(),publishedAt=stamp.isoformat(),source='美联储 · FOMC',sourceUrl=FED+m+'a.htm',
                originalTitle='Federal Reserve issues FOMC statement',title=f'美联储{action}政策利率目标区间',subject='美国联邦基金利率',
                summary=summary,action=action,tone=tone,score=score,evidence=act,lower=lower,upper=upper)

def bundle(cache):
    source='台湾证券交易所'; dataset='https://data.gov.tw/dataset/11549'
    assets=[series_info('TWSE:TAIEX','台股加权指数','index','点',source,'https://data.gov.tw/dataset/11755',OGDL,'台湾上市股票的发行量加权价格指数。',twse_rows(cache,'TAIEX'))]
    with (BASE.parent/'data/source.csv').open(newline='') as f:
        etf=[{'date':r['date'],**{c:float(r[c]) for c in ('open','high','low','close')},'volume':int(r['volume'])} for r in csv.DictReader(f)]
    for code,name,description,rows in [
            ('006207','复华沪深300 ETF','以台币交易的沪深300跟踪基金，行情为基金未复权成交价。',etf),
            ('0050','元大台湾50 ETF','台湾大型股 ETF 的未复权成交价，收益未计现金分配。',twse_rows(cache,'0050')),
            ('00635U','元大黄金期货 ETF','以台币计价，跟踪黄金期货。基金表现会受期货展期和汇率影响。',twse_rows(cache,'00635U'))]:
        assets.append(series_info('TWSE:'+code,name,'etf','新台币/份',source,dataset,OGDL,description,rows))
    assets.append(series_info('FX:USDTWD','美元兑新台币','fx','新台币/美元','中央银行 · 台北外汇经纪','https://data.gov.tw/dataset/7232',OGDL,'银行间收盘汇率；数值上升表示一美元可兑换更多新台币。',fx_rows(cache)))
    assets.append(series_info('UST:10Y','美国10年期国债收益率','yield','%','美国财政部','https://home.treasury.gov/resource-center/data-chart-center/interest-rates','https://uscode.house.gov/us/usc/t17/s105/','财政部公布的10年恒定期限名义平价收益率。涨跌使用基点，1 个基点等于 0.01 个百分点。',treasury_rows(cache),'America/New_York'))
    news=[decision(cache,m) for m in MEETINGS]
    return {'version':1,'start':'2023-01-01','end':'2024-12-31','assets':assets,'news':news,'newsLicense':'https://www.federalreserve.gov/disclaimer.htm'}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--cache',type=Path,required=True,help='Directory for official raw reports.')
    p.add_argument('--offline',action='store_true')
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args()
    if not args.offline:
        args.cache.mkdir(parents=True,exist_ok=True)
        with ThreadPoolExecutor(max_workers=2) as ex:list(ex.map(lambda item:fetch(args.cache,item),urls()))
    data=bundle(args.cache)
    args.output.write_text('window.ML_ASSETS='+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
    print([(a['id'],len(a['rows'])) for a in data['assets']],len(data['news']),'statements')
