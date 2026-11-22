import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from test_model import fixture, ROOT
from import_csi300 import read_index


class ImportTests(unittest.TestCase):
    def test_cli_creates_new_snapshot_from_authorized_csv(self):
        with tempfile.TemporaryDirectory() as folder:
            d = Path(folder)
            csv = d / "本地测试.csv"
            frame = fixture(100)
            frame["date"] = frame.date.str.replace("-", "")
            frame["代码"] = "000300"
            frame = frame.rename(columns={"date":"交易日期","open":"开盘","high":"最高",
                                         "low":"最低","close":"收盘","volume":"成交量（手）"})
            frame.iloc[::-1].to_csv(csv, index=False, encoding="gb18030")
            output = d / "沪深300 测试"
            args = [sys.executable, str(ROOT / "model/import_csi300.py"), "--csv", str(csv),
                    "--output", str(output), "--source-name","单元测试", "--source-url","https://example.org",
                    "--license","仅用于本地合成测试", "--volume-unit","手"]
            run = subprocess.run(args, capture_output=True, text=True)
            self.assertEqual(0, run.returncode, run.stderr)
            snap = json.loads((output / "market.json").read_text())
            self.assertEqual(snap["market"]["id"], "CSI:000300")
            self.assertEqual(snap["market"]["priceUnit"], "点")
            self.assertEqual(snap["market"]["volumeUnit"], "手")
            self.assertEqual(len(snap["bars"]), 100)
            self.assertIn("沪深300", run.stdout)
            df = json.loads((output / "source.json").read_text())
            self.assertEqual(df["source"]["license"], "仅用于本地合成测试")
            repeat = subprocess.run(args, capture_output=True, text=True)
            self.assertNotEqual(0, repeat.returncode)
            self.assertEqual(json.loads((output / "market.json").read_text()), snap)
            # A failed import must leave no apparently usable snapshot directory.
            wrong = d / "错误样本"
            args[args.index(str(output))] = str(wrong)
            args[-1] = "股"
            reject = subprocess.run(args, capture_output=True, text=True)
            self.assertNotEqual(0, reject.returncode)
            self.assertFalse(wrong.exists())

    def test_us_index_rejects_etf_and_does_not_relabel_china(self):
        with tempfile.TemporaryDirectory() as folder:
            src=Path(folder)/"SPX.csv"
            frame=fixture(100)
            frame["ticker"]="^GSPC"
            frame.to_csv(src,index=False)
            with self.assertRaisesRegex(ValueError,"非沪深300"):
                read_index(src,"股")
            dest=Path(folder)/"SPX"
            args=[sys.executable,str(ROOT/"model/import_csi300.py"),"--market","SP:SPX","--csv",str(src),"--output",str(dest),
                  "--source-name","合成单测","--source-url","https://example.org","--license","测试","--volume-unit","股"]
            run=subprocess.run(args,capture_output=True,text=True)
            self.assertEqual(run.returncode,0,run.stderr)
            data=json.loads((dest/"market.json").read_text())
            self.assertEqual(data["market"]["id"],"SP:SPX")
            self.assertEqual(data["market"]["timezone"],"America/New_York")
            self.assertEqual(data["market"]["currency"],"USD")
            self.assertAlmostEqual(data["bars"][0]["close"],frame.iloc[0]["close"])
            frame["ticker"]="SPY";frame.to_csv(src,index=False)
            with self.assertRaisesRegex(ValueError,"非标普500"):
                read_index(src,"股","SP:SPX")

    def test_missing_volume_and_mixed_market_guard(self):
        with tempfile.TemporaryDirectory() as folder:
            csv = Path(folder) / "tmp.csv"
            frame = fixture(100).drop(columns="volume")
            frame.to_csv(csv,index=False)
            self.assertTrue(read_index(csv, "未提供").volume.isna().all())
            frame["ts_code"] = "006207.TW"
            frame.to_csv(csv,index=False)
            with self.assertRaisesRegex(ValueError, "非沪深300"):
                read_index(csv, "未提供")


if __name__ == "__main__":
    unittest.main()
