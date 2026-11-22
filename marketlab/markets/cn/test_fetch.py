"""Regression tests for official-history normalization; no redistribution of market data."""
import json
from datetime import date, timedelta
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parent))
from fetch import START, END, normalize


class OfficialSnapshot(unittest.TestCase):
    def setUp(self):
        d=date(2023,1,3)
        self.rows=[]
        while len(self.rows)<91:
            if d.weekday()<5:
                self.rows.append(dict(tradeDate=d.strftime("%Y%m%d"),indexCode="000300",indexNameCn="沪深300",
                                      open=2,high=3,low=1,close=2.2,tradingVol=12))
            d+=timedelta(days=1)
        self.rows[-1]["tradeDate"]=END
    def payload(self):
        return json.dumps({"code":"200","success":True,"data":self.rows}).encode()
    def test_empty_volume_preserves_unknown_units(self):
        output,n=normalize(self.payload())
        self.assertEqual(n,len(self.rows))
        self.assertTrue(output.splitlines()[1].endswith(b','))
        self.assertNotIn(b'tradingVol',output)
    def test_duplicate_and_wrong_symbol_rejected(self):
        self.rows[2]["tradeDate"]=self.rows[1]["tradeDate"]
        with self.assertRaises(ValueError):normalize(self.payload())
        self.rows[2]["indexCode"]="OTHER"
        with self.assertRaises(ValueError):normalize(self.payload())
    def test_out_of_range_and_weekend_rejected(self):
        self.rows[0]["tradeDate"]="20230101"
        with self.assertRaises(ValueError):normalize(self.payload())
        self.rows[0]["tradeDate"]=START
        self.rows[1]["tradeDate"]="20230107"
        with self.assertRaises(ValueError):normalize(self.payload())


if __name__=="__main__":
    unittest.main()
