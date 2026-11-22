"""Rebuild the public macro and policy history known by 2026-11-18."""
import argparse
import csv
import hashlib
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'observe'))
from reproduce import FED, MEETINGS, TREASURY, decision

START = '2023-01-01'
END = '2026-11-18'
H10 = 'https://www.federalreserve.gov/releases/h10/hist/dat00_ch.htm'
H10_LAST = '2026-11-13'  # On November 18 the latest H.10 release was Monday, November 16.
FED_LICENSE = 'https://www.federalreserve.gov/disclaimer.htm'
ECB_LICENSE = 'https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html'
US_LICENSE = 'https://uscode.house.gov/us/usc/t17/s105/'
ECB = 'https://data-api.ecb.europa.eu/service/data/EXR/D.{}.EUR.SP00.A?startPeriod=2023-01-01&endPeriod=2026-11-18&format=csvdata'
MINUTES_RELEASE = 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261118a.htm'
MINUTES = 'https://www.federalreserve.gov/monetarypolicy/fomcminutes20261028.htm'
DATES = MEETINGS + '''
20250129 20250319 20250507 20250618 20250730 20250917 20251029 20251210
20260128 20260318 20260429 20260617 20260729 20260916 20261028
'''.split()


def sources():
    return {
        'h10.html': H10,
        'ecb-usd.csv': ECB.format('USD'),
        'ecb-cny.csv': ECB.format('CNY'),
        'minutes-release.html': MINUTES_RELEASE,
        'minutes.html': MINUTES,
        **{f'treasury-{year}.xml': TREASURY + str(year) for year in range(2023, 2027)},
        **{f'fomc-{date}.html': FED + date + 'a.htm' for date in DATES},
    }


def download(cache, item):
    name, url = item
    path = cache / name
    if not path.exists():
        response = subprocess.check_output(['curl','--fail','--silent','--show-error','--location',
            '--connect-timeout','10','--max-time','60','--retry','2','-A','Mozilla/5.0',url])
        path.write_bytes(response)


def rows_for(values, last):
    rows = sorted(values, key=lambda r: r['date'])
    dates = [r['date'] for r in rows]
    if (len(rows) < 900 or len(dates) != len(set(dates)) or dates[0] < START or
            dates[0] > '2023-01-03' or dates[-1] != last or not all(r['close'] > 0 for r in rows)):
        raise ValueError('参考数据日期或数值不符合冻结区间')
    return rows


def h10_rows(text):
    matches = re.findall(r'<th[^>]*>\s*(\d{1,2}-[A-Z]{3}-\d{2})\s*</th>\s*<td[^>]*>\s*([\d.]+)\s*</td>', text)
    values = []
    for date, value in matches:
        day = datetime.strptime(date,'%d-%b-%y').date().isoformat()
        if START <= day <= H10_LAST:
            values.append({'date':day,'close':float(value)})
    return rows_for(values,H10_LAST)


def ecb_rows(cache):
    legs = {}
    for currency in ('USD','CNY'):
        with (cache / f'ecb-{currency.lower()}.csv').open(encoding='utf-8-sig',newline='') as stream:
            leg = {}
            for row in csv.DictReader(stream):
                day = row['TIME_PERIOD']
                if row['KEY'] != f'EXR.D.{currency}.EUR.SP00.A' or day in leg:
                    raise ValueError('ECB 返回的序列或日期异常')
                if START <= day <= END and row['OBS_VALUE']:
                    leg[day] = Decimal(row['OBS_VALUE'])
            legs[currency] = leg
    if legs['CNY'].keys() != legs['USD'].keys():
        raise ValueError('ECB 两种货币须使用同一个参考日')
    return rows_for([{'date':day,'close':float(round(cny / legs['USD'][day],6))}
                     for day,cny in legs['CNY'].items()], END)


def treasury_rows(cache):
    rows = []
    for year in range(2023,2027):
        for entry in ET.parse(cache/f'treasury-{year}.xml').findall('.//{*}properties'):
            day = entry.findtext('{*}NEW_DATE')[:10]
            value = entry.findtext('{*}BC_10YEAR')
            if START <= day <= END and value:
                rows.append({'date':day,'close':float(value)})
    return rows_for(rows,END)


def build(cache):
    ecb = ecb_rows(cache)
    fed = h10_rows((cache/'h10.html').read_text())
    ust = treasury_rows(cache)
    if ecb[-1]['close'] != float(round(Decimal('7.3126') / Decimal('1.0968'),6)) or fed[-1]['close'] != 6.671 or ust[-1]['close'] != 5.07:
        raise ValueError('截面日观测与已核对的发布值不同，请核查源站修订')
    assets = [
        dict(id='ECB:USDCNY',name='美元兑人民币（欧洲央行交叉汇率）',shortName='美元/人民币·ECB',
             kind='fx',unit='人民币元/美元',timezone='Europe/Frankfurt',region='global',
             source='欧洲中央银行（ECB），MarketLab 换算',
             sourceUrl='https://data.ecb.europa.eu/data/datasets/EXR/EXR.D.CNY.EUR.SP00.A',
             license='© 欧洲中央银行。原始参考汇率免费公开，本页按同日两个欧元参考汇率换算。',
             licenseUrl=ECB_LICENSE,description='将 ECB 同日每欧元的人民币数除以每欧元的美元数，保留六位小数。数值上升表示美元升值。',rows=ecb),
        dict(id='UST:10Y',name='美国10年期国债收益率',shortName='美债10年',
             kind='yield',unit='%',timezone='America/New_York',region='us',
             source='美国财政部',sourceUrl='https://home.treasury.gov/resource-center/data-chart-center/interest-rates',
             license='美国联邦政府自行发布的数据，17 USC §105。',licenseUrl=US_LICENSE,
             description='10 年恒定期限名义平价收益率。涨跌用基点表示，1 个基点等于 0.01 个百分点。',rows=ust),
        dict(id='FED:USDCNY',name='美元兑人民币（美联储 H.10）',shortName='美元/人民币·Fed',
             kind='fx',unit='人民币元/美元',timezone='America/New_York',region='global',
             source='美联储 · H.10',sourceUrl=H10,license='美联储公开信息可署名转载。',licenseUrl=FED_LICENSE,
             description='纽约午间即期汇率，按报价日期排列。美联储按周发布，11 月 18 日能取得的最新观测是 11 月 13 日。',rows=fed),
    ]
    for asset in assets:
        asset['frequency'] = '日'
        asset['sha256'] = hashlib.sha256(json.dumps(asset['rows'],separators=(',',':')).encode()).hexdigest()
    news = json.loads((HERE/'china-news.json').read_text())
    for date in DATES:
        news.append({**decision(cache,date),'datePrecision':'minute','region':'us'})
    if ('For release at 2:00 p.m. EST' not in (cache/'minutes-release.html').read_text() or
        'Two members voted against the decision to maintain' not in (cache/'minutes.html').read_text()):
        raise ValueError('会议纪要发布时间或摘要依据变化')
    news.append(dict(id='FOMC:MINUTES:20261118',region='us',date=END,publishedAt=END+'T14:00:00-05:00',
                     datePrecision='minute',title='美联储公开十月会议纪要',subject='联邦公开市场委员会会议纪要',
                     summary='纪要记载十月会议维持政策利率区间，另有两名委员支持上调 25 个基点。',
                     source='美联储 · FOMC',sourceUrl=MINUTES,releaseUrl=MINUTES_RELEASE,tone='会议纪要',score=None,
                     evidence='记录此前会议，未作新的利率决定'))
    news.sort(key=lambda item:datetime.fromisoformat(item['publishedAt']))
    if len(set(n['id'] for n in news)) != len(news) or any(n['date'] > END for n in news):
        raise ValueError('政策公告重复或越过截止日期')
    return dict(start=START,end=END,assets=assets,news=news)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache',type=Path,help='已获取的公开源文件目录。默认临时下载。')
    parser.add_argument('--html',type=Path,help='可复用此前已保存的美联储 H.10 公开源文件。')
    parser.add_argument('--out',type=Path,default=HERE/'context.js')
    args = parser.parse_args()
    with TemporaryDirectory() as temporary:
        cache = args.cache or Path(temporary)
        cache.mkdir(parents=True,exist_ok=True)
        if args.html:
            (cache/'h10.html').write_bytes(args.html.read_bytes())
        with ThreadPoolExecutor(3) as pool:
            list(pool.map(lambda item: download(cache,item),sources().items()))
        data = build(cache)
        us_news = [row for row in data['news'] if row['region'] == 'us']
        (args.out.parent/'us-news.json').write_text(json.dumps(us_news,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        args.out.write_text('window.ML_CONTEXT='+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
        print([(a['id'],len(a['rows']),a['rows'][-1]) for a in data['assets']],len(data['news']))
