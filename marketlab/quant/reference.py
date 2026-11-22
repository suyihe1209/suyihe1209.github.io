"""Independent pandas/scikit-learn reproduction of a saved quant configuration."""
import argparse
import json
from pathlib import Path
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "model"))
from providers import validate_bars
from train import features


def experiment(bars, c):
    bars = bars.loc[:c["validEnd"]]
    h = c["horizon"]
    x = features(bars)[c["features"]]
    days = pd.Series(bars.index, index=bars.index)
    ahead = days.shift(-h)
    y = (bars.close.shift(-h) > bars.close).astype(int)
    train = (days >= c["trainStart"]) & (ahead <= c["trainEnd"]) & ahead.notna() & x.notna().all(axis=1)
    val = (days >= c["validStart"]) & (ahead <= c["validEnd"]) & ahead.notna() & x.notna().all(axis=1)
    if c["trainEnd"] >= c["validStart"] or train.sum() < 30 or not val.any():
        raise ValueError("Insufficient or overlapping chronological split")
    scaler = StandardScaler().fit(x[train])
    z = scaler.transform(x.dropna())
    idx = x.dropna().index
    if c["model"] == "trend":
        w = np.array([c["weights"][k] for k in c["features"]])
        if not np.abs(w).sum():
            raise ValueError("Trend weights cannot all be zero")
        p = 1/(1+np.exp(-np.clip(z @ w / np.abs(w).sum(), -40, 40)))
    elif c["model"] == "logistic":
        model = LogisticRegression(C=c["C"], solver="lbfgs", max_iter=1000, tol=1e-12)
        model.fit(scaler.transform(x[train]), y[train])
        p = model.predict_proba(z)[:, 1]
    elif c["model"] == "forest":
        model = RandomForestClassifier(n_estimators=c["trees"], max_depth=c["depth"], min_samples_leaf=4,
                                       max_features="sqrt", random_state=1729, n_jobs=1)
        model.fit(x[train], y[train])
        p = model.predict_proba(x.dropna())[:, 1]
    else:
        raise ValueError("Unknown model")
    preds = pd.Series(p,index=idx)
    val_idx = bars.index[val]
    baseline = y[train].mean()
    # Positions are based only on the preceding session's close.
    signal = pd.Series(True,index=days.index)
    if c["strategy"] == "ma":
        signal = bars.close.rolling(c["fast"]).mean() > bars.close.rolling(c["slow"]).mean()
    elif c["strategy"] == "momentum":
        signal = bars.close > bars.close.shift(c["lookback"])
    elif c["strategy"] == "model":
        signal = (preds >= c["threshold"]).reindex(days.index, fill_value=False)
    elif c["strategy"] != "buyHold":
        raise ValueError("Unknown strategy")
    cash,qty,peak,dd,fees,slippage,trades=10000.,0.,10000.,0.,0.,0.,0
    curve=[]
    order=signal.shift(1,fill_value=False)
    for d,r in bars.loc[c["validStart"]:c["validEnd"]].iterrows():
        opening, closing = r["open"], r["close"]
        if order[d] and qty==0:
            fill=opening*(1+c["slipBp"]/10000)
            qty=cash/(fill*(1+c["feeBp"]/10000))
            fees+=qty*fill*c["feeBp"]/10000
            slippage+=qty*(fill-opening)
            trades+=1;cash=0.
        elif not order[d] and qty>0:
            fill=opening*(1-c["slipBp"]/10000)
            fee=qty*fill*c["feeBp"]/10000
            fees+=fee;slippage+=qty*(opening-fill)
            cash=qty*fill-fee
            trades+=1;qty=0.
        wealth=cash+qty*closing
        peak=max(peak,wealth);dd=max(dd,1-wealth/peak);curve.append(wealth/10000)
    result={"probabilities":preds[val_idx].to_list(),"dates":val_idx.to_list(),"curve":curve,
            "scores":{"accuracy":float(((preds[val_idx]>=.5)==y[val]).mean()),
                      "brier":float(((preds[val_idx]-y[val])**2).mean()),
                      "baselineBrier":float(((baseline-y[val])**2).mean())},
            "strategy":{"maxDrawdown":dd,"tradeCount":trades,"fees":fees,"slippage":slippage}}
    return result


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv",type=Path,default=ROOT/"data/source.csv")
    parser.add_argument("--config",type=Path,required=True,help="Saved run JSON, or its config object")
    parser.add_argument("--out",type=Path)
    args=parser.parse_args()
    config=json.loads(args.config.read_text(encoding="utf-8"))
    bars=validate_bars(pd.read_csv(args.csv,dtype={"date":str}))
    output=json.dumps(experiment(bars,config.get("config",config)),allow_nan=False,ensure_ascii=False)
    if args.out:
        args.out.write_text(output+"\n",encoding="utf-8")
    else:
        print(output)
