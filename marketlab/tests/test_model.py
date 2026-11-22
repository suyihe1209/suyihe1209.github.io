"""Regression tests use constructed sessions solely as controlled test inputs."""
import json
import tempfile
import unittest
from pathlib import Path
import sys

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "model"))
from providers import CsvProvider, validate_bars
from train import MAX_TRAIN, MIN_TRAIN, build, evaluate, features, walk_forward


def fixture(n=140):
    i = np.arange(n)
    price = 100 + np.sin(i / 3) * 7 + i * .04
    return pd.DataFrame({
        "date": pd.bdate_range("2019-09-20", periods=n).strftime("%Y-%m-%d"),
        "open": price, "high": price + 1, "low": price - 1, "close": price,
        "volume": i * 1200,
    })


class ModelTests(unittest.TestCase):
    def test_csv_validation(self):
        frame = fixture(3)
        bad = [frame.iloc[:0], frame.iloc[::-1], frame.drop(columns="volume"),
               frame.assign(date=["2020-02-30", "2020-03-02", "2020-03-03"]),
               frame.assign(date=[frame.date[0]] * 3), frame.assign(high=1),
               frame.assign(volume=-1), frame.assign(open=np.nan), frame.assign(close=np.inf)]
        for invalid in bad:
            with self.subTest(case=invalid.to_dict()):
                with self.assertRaises((ValueError, OverflowError)):
                    validate_bars(invalid)
        self.assertTrue(validate_bars(frame.assign(volume=np.nan)).volume.isna().all())

    def test_future_price_never_changes_past_probabilities(self):
        bars = validate_bars(fixture())
        prefix = bars.iloc[:110]
        altered = bars.copy()
        altered.iloc[110:, :4] *= 1.8
        inputs = features(prefix)
        self.assertTrue(inputs.iloc[19].isna().any())
        self.assertTrue(inputs.iloc[20].notna().all())
        pd.testing.assert_frame_equal(inputs, features(altered).iloc[:110])
        earlier = walk_forward(prefix, inputs)
        later = walk_forward(altered, features(altered))
        self.assertTrue(earlier)
        self.assertEqual(earlier, later[:len(earlier)])
        for record in earlier:
            start = bars.index.get_loc(record["trainStart"])
            end = bars.index.get_loc(record["trainEnd"])
            t = bars.index.get_loc(record["date"])
            self.assertEqual(end + 5, t)
            self.assertEqual(end - start + 1, record["trainCount"])
            self.assertGreaterEqual(record["trainCount"], MIN_TRAIN)
            known = [(bars.close.iloc[i+5] > bars.close.iloc[i]) for i in range(start, end+1)]
            self.assertEqual(record["baseline"], sum(known) / len(known))

    def test_bounded_window(self):
        bars = validate_bars(fixture(MAX_TRAIN + 35))
        records = walk_forward(bars, features(bars))
        self.assertEqual(records[-1]["trainCount"], MAX_TRAIN)
        self.assertEqual(records[-1]["trainStart"], bars.index[-5-MAX_TRAIN])

    def test_fifth_subsequent_session_and_tie(self):
        frame = fixture(8)
        frame["date"] = ["2024-02-01", "2024-02-02", "2024-02-05", "2024-02-15",
                         "2024-02-16", "2024-02-19", "2024-02-20", "2024-02-21"]
        frame.loc[5, ["close", "open", "high", "low"]] = frame.loc[0, "close"]
        bars = validate_bars(frame)
        forecasts = [{"date":bars.index[0], "baseline":.5, "logistic":0},
                     {"date":bars.index[3], "baseline":1, "logistic":1}]
        resolved, scores = evaluate(bars, forecasts)
        self.assertEqual(resolved, [bars.index[0]])
        self.assertEqual(scores["baseline"], {"n":1, "accuracy":0., "brier":.25})
        self.assertEqual(scores["logistic"], {"n":1, "accuracy":1., "brier":0.})

    def test_reproducible_build_and_metadata_guard(self):
        frame = fixture(105)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            csv = path / "sample.csv"
            frame.to_csv(csv, index=False)
            meta = {"market":{"id":"fixture","name":"fixture","currency":"TWD",
                              "timezone":"Asia/Taipei","priceUnit":"TWD","volumeUnit":"units"},
                    "source":{"name":"fixture","url":"https://example.org","license":"test only",
                              "asOf":frame.date.iloc[-1], "updatedAt":"2026-01-01T00:00:00Z",
                              "demo":True}}
            manifest = path / "source.json"
            manifest.write_text(json.dumps(meta))
            provider = CsvProvider(csv, manifest)
            snapshot = build(provider)
            self.assertEqual(build(provider), snapshot)
            self.assertEqual(snapshot["bars"][-1]["date"], frame.date.iloc[-1])
            self.assertIsNone(snapshot["bars"][0]["return20"])
            self.assertEqual(len(snapshot["forecasts"])-5, snapshot["experiment"]["scores"]["logistic"]["n"])
            json.dumps(snapshot, allow_nan=False)
            meta["source"]["asOf"] = frame.date.iloc[-2]
            manifest.write_text(json.dumps(meta))
            with self.assertRaisesRegex(ValueError,"asOf"):
                provider.load()


if __name__ == "__main__":
    unittest.main()
