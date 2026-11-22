"""Rebuild the static walk-forward experiment with an explicit daily cutoff."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

from providers import BarProvider, CsvProvider

ROOT = Path(__file__).resolve().parents[1]
HORIZON = 5
MIN_TRAIN = 60
MAX_TRAIN = 252
FEATURES = ["return1", "return5", "return20", "maGap5", "maGap20", "volatility20"]
MODEL_VERSION = "walkforward-logit-1.0"


def features(bars: pd.DataFrame) -> pd.DataFrame:
    close = bars["close"]
    out = pd.DataFrame(index=close.index)
    for k in (1, 5, 20):
        out[f"return{k}"] = close.pct_change(k, fill_method=None)
    for k in (5, 20):
        out[f"maGap{k}"] = close / close.rolling(k).mean() - 1
    out["volatility20"] = out["return1"].rolling(20).std(ddof=0)
    return out[FEATURES]


def walk_forward(bars: pd.DataFrame, inputs: pd.DataFrame) -> list[dict]:
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    close = bars["close"].to_numpy()
    x = inputs.to_numpy()
    # y[i] is only addressable for sessions with an observed fifth later close.
    y = (close[HORIZON:] > close[:-HORIZON]).astype(int)
    dates = bars.index.to_list()
    warmup = inputs.dropna().first_valid_index()
    if warmup is None:
        return []
    first = dates.index(warmup)
    predictions = []
    for t in range(first + MIN_TRAIN - 1 + HORIZON, len(close)):
        latest_train = t - HORIZON
        start = max(first, latest_train + 1 - MAX_TRAIN)
        train = slice(start, latest_train + 1)
        outcomes = y[train]
        if np.unique(outcomes).size < 2:
            # A two-class logistic regression is undefined on a single class.
            continue
        pipe = make_pipeline(
            StandardScaler(), LogisticRegression(C=1.0, solver="lbfgs", max_iter=500)
        )
        pipe.fit(x[train], outcomes)
        prob = float(pipe.predict_proba(x[t:t + 1])[0, 1])
        predictions.append({
            "date": dates[t], "baseline": float(outcomes.mean()), "logistic": prob,
            "trainStart": dates[start], "trainEnd": dates[latest_train],
            "trainLabelThrough": dates[t], "trainCount": len(outcomes),
        })
    return predictions


def evaluate(bars: pd.DataFrame, predictions: list[dict]):
    dates = bars.index.to_list()
    location = {d: k for k, d in enumerate(dates)}
    close = bars["close"].to_numpy()
    scores = {model: [] for model in ("baseline", "logistic")}
    resolved = []
    for record in predictions:
        i = location[record["date"]]
        j = i + HORIZON
        if j >= len(dates):
            continue
        actual = int(close[j] > close[i])
        resolved.append(record["date"])
        for model in scores:
            p = record[model]
            scores[model].append((int((p >= .5) == actual), (p - actual) ** 2))
    result = {}
    for model, observations in scores.items():
        if observations:
            accuracy, brier = np.array(observations).mean(axis=0)
            result[model] = {"n": len(observations), "accuracy": float(accuracy), "brier": float(brier)}
        else:
            result[model] = {"n": 0, "accuracy": None, "brier": None}
    return resolved, result


def build(provider: BarProvider) -> dict:
    import sklearn

    bars, meta = provider.load()
    x = features(bars)
    predictions = walk_forward(bars, x)
    if not predictions or predictions[-1]["date"] != bars.index[-1]:
        raise ValueError("Insufficient complete samples or only one training class at cutoff")
    resolved, scores = evaluate(bars, predictions)
    records = bars.join(x[["return5", "return20"]]).reset_index()
    # Convert only missing scalar values to null. Keep financial input precision.
    records = records.astype(object).where(pd.notna(records), None).to_dict(orient="records")
    canonical = json.dumps(records, allow_nan=False, separators=(",", ":")).encode()
    return {
        "schemaVersion": 1, "horizon": HORIZON, "market": meta["market"], "source": meta["source"],
        "bars": records, "forecasts": predictions,
        "experiment": {
            "modelVersion": MODEL_VERSION, "features": FEATURES, "minTrain": MIN_TRAIN,
            "maxTrain": MAX_TRAIN, "horizon": HORIZON,
            "validationStart": resolved[0] if resolved else None,
            "validationEnd": resolved[-1] if resolved else None,
            "scores": scores, "snapshotSha256": hashlib.sha256(canonical).hexdigest(),
            "parameters": {"C": 1.0, "max_iter": 500, "solver": "lbfgs", "threshold": .5},
            "environment": {"python": platform.python_version(), "pandas": pd.__version__,
                            "numpy": np.__version__, "sklearn": sklearn.__version__},
        },
    }


def atomic_text(path: Path, text: str) -> None:
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as out:
        temp = Path(out.name)
        try:
            out.write(text)
            out.flush()
            os.fsync(out.fileno())
        except BaseException:
            temp.unlink(missing_ok=True)
            raise
    try:
        temp.chmod(0o644)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def export_snapshot(result: dict, output: Path):
    text = json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    output.mkdir(parents=True, exist_ok=True)
    atomic_text(output / "market.json", text + "\n")
    atomic_text(output / "market.js", "window.MARKETLAB_DATA=" + text + ";\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=ROOT / "data/source.csv")
    parser.add_argument("--meta", type=Path, default=ROOT / "data/source.json")
    parser.add_argument("--out", type=Path, default=ROOT / "data")
    args = parser.parse_args()
    result = build(CsvProvider(args.csv, args.meta))
    export_snapshot(result, args.out)
    print(json.dumps({"bars":len(result["bars"]), "forecasts":len(result["forecasts"]),
                      "scores":result["experiment"]["scores"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
