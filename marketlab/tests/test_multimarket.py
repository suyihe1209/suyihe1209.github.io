"""Offline integration tests for market isolation, routing and local-clock cutoffs."""
from io import BytesIO
import copy
import datetime as dt
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.parse import quote
from zoneinfo import ZoneInfo
from test_ai import server
from test_official import fixture, when

o=server.official
NY=ZoneInfo("America/New_York")


def eastern(s):
    return dt.datetime.fromisoformat(s).replace(tzinfo=NY)


def make_us(days,stamp):
    data=fixture(days,stamp)
    data['market']={'id':o.US_MARKET,'timezone':'America/New_York','name':'S&P 500'}
    data['experiment']['snapshotSha256']='e'*64
    return data


class MultiMarketTests(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);self.base=Path(tmp.name)
        self.bundle=self.base/'blog'/'marketlab'/'data';self.cache=self.base/'cache';self.imported=self.base/'imports'/'us'
        self.days=['2024-07-03','2024-07-05','2024-07-08','2024-07-09','2024-07-10','2024-07-11']
        self.us=make_us(self.days[:1],eastern('2024-07-03T16:05'))
        self.cn=fixture(self.days[:1],when('2024-07-03T15:05'))
        self.tw=copy.deepcopy(self.cn);self.tw['market']={'id':'TWSE:006207','timezone':'Asia/Taipei'}
        self.write(self.bundle,self.tw);self.write(self.cache/'cn',self.cn);self.write(self.cache/'us',self.us)
        self.db=self.base/'official.sqlite3'

    def write(self,directory,data):
        directory.mkdir(parents=True,exist_ok=True);(directory/'market.json').write_text(json.dumps(data))

    def test_lookup_never_substitutes_other_assets_and_import_overrides_cache(self):
        registry=server.MarketRegistry(self.bundle,self.bundle,self.cache)
        self.assertEqual(registry.select()[0]['market']['id'],'TWSE:006207')
        self.assertEqual(registry.select(o.US_MARKET),(self.us,False))
        self.write(self.cache/'us',self.cn)
        with self.assertRaises(server.MissingMarket):registry.select(o.US_MARKET)
        self.write(self.cache/'us',self.us);preferred=copy.deepcopy(self.us);preferred['source']['name']='actual private import'
        self.write(self.imported,preferred)
        registry=server.MarketRegistry(self.imported,self.bundle,self.cache)
        self.assertEqual(registry.select(o.US_MARKET),(preferred,True))
        self.assertEqual({r['market']['id'] for r in registry.local_snapshots()},{o.US_MARKET,o.MARKET})
        self.assertEqual(registry.select(o.MARKET),(self.cn,False))

    def test_new_york_summer_winter_and_early_close_news(self):
        self.assertEqual(o.window('2024-07-03',o.US_MARKET)[0].utcoffset(),dt.timedelta(hours=-4))
        self.assertEqual(o.window('2024-12-24',o.US_MARKET)[0].utcoffset(),dt.timedelta(hours=-5))
        gate=o.eligibility(self.us,True,eastern('2024-07-04T09:29:59'))
        self.assertTrue(gate['eligible']);self.assertFalse(o.eligibility(self.us,True,eastern('2024-07-04T09:30'))['eligible'])
        self.assertFalse(o.eligibility(self.us,False,eastern('2024-07-03T17:00'))['eligible'])
        def release(t):return {'summary':t,'publishedAt':t,'source':'test','tone':'neutral'}
        summer=[release('2024-07-03T17:00:00+00:00'),release('2024-07-03T17:01:00+00:00')]
        self.assertEqual(len(server.known_news(self.us['market'],'2024-07-03',summer)),1)
        winter=[release('2024-12-23T20:59:00+00:00'),release('2024-12-23T21:01:00+00:00')]
        self.assertEqual(len(server.known_news(self.us['market'],'2024-12-23',winter)),1)
        book=server.policy_news();noon=[n for n in book if n.get('id')=='CN:2024-07-23']
        self.assertEqual(len(noon),1);self.assertFalse(server.known_news(self.cn['market'],'2024-07-23',noon))
        self.assertTrue(server.known_news(self.cn['market'],'2024-07-24',noon))

    def test_five_us_sessions_skip_holiday_and_do_not_settle_same_date_china(self):
        for d,t in [(self.us,eastern('2024-07-03T17:00')),(self.cn,when('2024-07-03T16:00'))]:
            o.submit(d,{'marketId':d['market']['id'],'cutoff':self.days[0],'probability':1,'reason':'','confirmedReal':True},True,self.db,lambda:t)
        full=make_us(self.days,eastern('2024-07-11T16:01'))
        state=o.state(full,True,self.db,lambda:eastern('2024-07-11T17:00'))
        self.assertEqual(len(state['records']),1);self.assertEqual(state['records'][0]['settlement']['days'],self.days[1:])
        self.assertTrue(all(row['n']==1 for row in state['ranking']))
        self.assertIsNone(o.state(self.cn,True,self.db,lambda:when('2024-07-12T16:00'))['records'][0]['settlement'])
        self.assertFalse(o.state(self.tw,False,self.db)['ranking'])

    def test_http_routes_use_market_id_and_return_only_fixed_local_sources(self):
        service=SimpleNamespace(server_port=8765,cache_path=self.base/'ai.sqlite3',markets_dir=self.cache,snapshot_dir=self.bundle,snapshot_id='test')
        def get(path,method="GET",params=None,extra_headers=""):
            body=json.dumps(params).encode() if params else b""
            raw=(f"{method} {path} HTTP/1.0\r\nHost: localhost:8765\r\nOrigin: http://localhost:8765\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\n{extra_headers}\r\n").encode()+body
            class Socket:
                def makefile(self,mode,*args):return BytesIO(raw)
                def sendall(self,bytes_):self.out.write(bytes_)
            s=Socket();s.out=BytesIO()
            with patch.object(server.Handler,'log_message',lambda *a:None),patch.object(server,'MODULE',self.bundle.parent):
                server.Handler(s,('127.0.0.1',12345),service)
            header,body=s.out.getvalue().split(b'\r\n\r\n',1);return int(header.split()[1]),body
        for key in [o.US_MARKET,o.MARKET]:
            code,body=get('/api/marketlab/snapshot?marketId='+quote(key,safe=''))
            self.assertEqual(code,200);self.assertEqual(json.loads(body)['market']['id'],key)
            code,body=get('/api/marketlab/official?marketId='+quote(key,safe=''))
            self.assertEqual(code,200);self.assertFalse(json.loads(body)['gate']['eligible'])
        self.assertEqual(get('/api/marketlab/snapshot?marketId=UNKNOWN')[0],404)
        self.assertEqual(get('/marketlab/markets/local.js?path=whatever')[0],400)
        code,body=get('/marketlab/markets/local.js')
        self.assertEqual(code,200);self.assertEqual({d['market']['id'] for d in json.loads(body.decode().removeprefix('window.ML_LOCAL_MARKETS=').removesuffix(';'))},{o.US_MARKET,o.MARKET})
        with patch.object(server,'settings',return_value=('test','m','https://example.invalid')),patch.object(server,'analyze',side_effect=lambda d,p,*args:{'routedTo':d['market']['id']}) as model:
            code,body=get('/api/marketlab/analyze','POST',{'marketId':o.US_MARKET,'cutoff':self.days[0]})
            self.assertEqual(code,200);self.assertEqual(json.loads(body)['routedTo'],o.US_MARKET)
            self.assertEqual(get('/api/marketlab/analyze','POST',{'marketId':o.US_MARKET,'cutoff':self.days[0]},'X-MarketLab-Snapshot: different\r\n')[0],409)
            self.assertEqual(model.call_count,1)
