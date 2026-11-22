"""Local, server-timed CSI 300 forward rounds. No third-party identity or market-data attestation."""
import contextlib
import datetime as dt
import json
import math
import re
import sqlite3
from pathlib import Path
from zoneinfo import ZoneInfo

CHINA = dt.timezone(dt.timedelta(hours=8))
HORIZON = 5
MARKET = "CSI:000300"
US_MARKET = "SP:SPX"
NASDAQ = "NASDAQ:IXIC"
SESSIONS = {
    MARKET: ("Asia/Shanghai", dt.time(15), dt.time(9,15)),
    US_MARKET: ("America/New_York", dt.time(16), dt.time(9,30)),
    NASDAQ: ("America/New_York", dt.time(16), dt.time(9,30)),
}


class Denied(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


def utc_clock():
    return dt.datetime.now(dt.timezone.utc)


def window(cutoff, market_id=MARKET):
    day = dt.date.fromisoformat(cutoff)
    zone, close, next_open = SESSIONS[market_id]
    market_tz = ZoneInfo(zone)
    return (dt.datetime.combine(day, close, market_tz),
            dt.datetime.combine(day + dt.timedelta(days=1), next_open, market_tz))


def real_probability(value):
    return type(value) in (float, int) and math.isfinite(value) and 0 <= value <= 1


def provenance(data, external):
    source, market = data.get("source", {}), data.get("market", {})
    if not external or market.get("id") not in SESSIONS or market.get("timezone") != SESSIONS[market["id"]][0]:
        return False
    return all(isinstance(source.get(k), str) and source[k].strip() for k in ("name", "license", "url")) and all(
        isinstance(value, str) and re.fullmatch("[0-9a-f]{64}", value)
        for value in (source.get("originalSha256"), source.get("sha256"), data.get("experiment", {}).get("snapshotSha256")))


def eligibility(data, external, now):
    bars = data.get("bars", [])
    last = bars[-1] if bars else {}
    cutoff = last.get("date", "")
    result = {"eligible": False, "marketId": data.get("market", {}).get("id"), "cutoff": cutoff,
              "serverTime": now.isoformat(), "horizon": HORIZON, "timezone": data.get("market", {}).get("timezone"),
              "marketName": data.get("market", {}).get("name", data.get("market", {}).get("id"))}
    reason = ""
    if not provenance(data, external):
        reason = "当前不是由本机导入并核实的沪深300、标普500或纳斯达克综合指数快照（行情截至 " + (cutoff or "未知") + "）。归档行情与研究缓存只能用于练习。"
    elif data.get("horizon") != HORIZON or not cutoff or cutoff != data["source"].get("asOf"):
        reason = "数据截止日或预测周期不匹配。"
    else:
        start, end = window(cutoff, result["marketId"])
        result.update(opensAt=start.isoformat(), closesAt=end.isoformat())
        imported = dt.datetime.fromisoformat(data["source"]["updatedAt"].replace("Z", "+00:00"))
        if imported.tzinfo is None or not start <= imported <= now:
            reason = "本机导入时间须在该交易日收盘后，且不能晚于服务器当前时间。"
        elif start.weekday() >= 5:
            reason = "最新一行不是该市场的常规交易日，请核对来源。"
        elif now < start:
            reason = "该日尚未收盘，请在收盘后重新导入最终行情。"
        elif now >= end:
            reason = "该行情的提交窗口已经关闭。请导入最新一个已收盘交易日的完整数据。"
        elif not any(f.get("date") == cutoff and real_probability(f.get("baseline")) and real_probability(f.get("logistic"))
                     for f in data.get("forecasts", [])):
            reason = "该截止日还没有两种可同时锁定的量化模型。"
    result.update(eligible=not reason, reason=reason)
    return result


@contextlib.contextmanager
def connect(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with contextlib.closing(sqlite3.connect(path, timeout=8)) as db:
        db.execute("""CREATE TABLE IF NOT EXISTS rounds (
            market TEXT NOT NULL, cutoff TEXT NOT NULL, horizon INTEGER NOT NULL,
            receipt TEXT NOT NULL, ai TEXT, settlement TEXT,
            PRIMARY KEY(market,cutoff,horizon))""")
        yield db


def validated_params(params, with_probability):
    expected = {"marketId", "cutoff", "probability", "reason", "confirmedReal"} if with_probability else {"marketId", "cutoff"}
    if not isinstance(params, dict) or set(params) != expected:
        raise Denied(400, "请求字段无效，提交时间、行情与模型数据只能由本机服务写入。")
    if not isinstance(params["marketId"], str) or not isinstance(params["cutoff"], str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", params["cutoff"]) or params["marketId"] not in SESSIONS:
        raise Denied(400, "市场或截止日无效。")
    if with_probability and (not real_probability(params["probability"]) or params["confirmedReal"] is not True
                             or not isinstance(params["reason"], str) or len(params["reason"]) > 800):
        raise Denied(400, "请确认数据来源，概率应为 0 至 1，理由最多 800 个字符。")


def check_current(data, params, external, now):
    gate = eligibility(data, external, now)
    if not gate["eligible"]:
        raise Denied(409, gate["reason"])
    if gate["marketId"] != params["marketId"] or gate["cutoff"] != params["cutoff"]:
        raise Denied(409, "当前行情快照已经改变，请刷新后再提交。")
    return gate


def submit(data, params, external, path, clock=utc_clock):
    validated_params(params, True)
    with connect(path) as db, db:
        db.execute("BEGIN IMMEDIATE")
        now = clock()
        gate = check_current(data, params, external, now)
        market, cutoff = params["marketId"], params["cutoff"]
        f = next(f for f in data["forecasts"] if f["date"] == cutoff)
        last = data["bars"][-1]
        r = {"marketId": market,"marketName": data["market"].get("name",market),"timezone":gate["timezone"], "cutoff": cutoff, "horizon": HORIZON, "submittedAt": now.isoformat(),
             "closesAt": gate["closesAt"], "startClose": last["close"], "user": params["probability"],
             "reason": params["reason"].strip(), "baseline": f["baseline"], "logistic": f["logistic"],
             "trainEnd": f.get("trainEnd"), "trainCount": f.get("trainCount"), "modelVersion": data["experiment"]["modelVersion"],
             "snapshot": data["experiment"]["snapshotSha256"], "sourceName": data["source"]["name"]}
        try:
            db.execute("INSERT INTO rounds(market,cutoff,horizon,receipt) VALUES(?,?,?,?)",
                       (market, cutoff, HORIZON, json.dumps(r, ensure_ascii=False)))
        except sqlite3.IntegrityError as exc:
            raise Denied(409, "该市场、截止日与期限的本机正式预测已经锁定。") from exc
        return r


def attach_ai(data, params, external, path, generate, clock=utc_clock):
    validated_params(params, False)
    keys = (params["marketId"], params["cutoff"], HORIZON)
    with connect(path) as db:
        row = db.execute("SELECT receipt,ai FROM rounds WHERE market=? AND cutoff=? AND horizon=?", keys).fetchone()
        if not row:
            raise Denied(409, "请先锁定本机正式预测。")
        if row[1]:
            return json.loads(row[1])
        check_current(data, params, external, clock())
        receipt = json.loads(row[0])
        if receipt["snapshot"] != data["experiment"]["snapshotSha256"]:
            raise Denied(409, "行情与锁定时的快照不同，不能追加同期 AI。")
        answer = generate()
        with db:
            db.execute("BEGIN IMMEDIATE")
            now = clock()
            check_current(data, params, external, now)
            start, end = window(params["cutoff"], params["marketId"])
            timestamp = dt.datetime.fromisoformat(answer["predictedAt"].replace("Z", "+00:00"))
            if (not real_probability(answer["probability"]) or answer["marketId"] != keys[0] or answer["cutoff"] != keys[1]
                    or timestamp.tzinfo is None or not start <= timestamp <= now < end):
                raise Denied(409, "AI 的数据截止或生成时刻不在本次窗口内。")
            db.execute("UPDATE rounds SET ai=? WHERE market=? AND cutoff=? AND horizon=? AND ai IS NULL",
                       (json.dumps(answer, ensure_ascii=False), *keys))
            saved = db.execute("SELECT ai FROM rounds WHERE market=? AND cutoff=? AND horizon=?", keys).fetchone()
            return json.loads(saved[0])


def reconcile(db, data, external, now):
    if not provenance(data, external) or data.get("horizon") != HORIZON:
        return
    bars = data["bars"]
    market_id = data["market"]["id"]
    positions = {b["date"]: i for i, b in enumerate(bars)}
    pending = db.execute("SELECT cutoff,receipt FROM rounds WHERE market=? AND horizon=? AND settlement IS NULL", (market_id, HORIZON)).fetchall()
    for cutoff, encoded in pending:
        i = positions.get(cutoff)
        if i is None or i + HORIZON >= len(bars):
            continue
        r = json.loads(encoded)
        later = bars[i+1:i+HORIZON+1]
        if bars[i]["close"] != r["startClose"] or any(window(b["date"], market_id)[0].weekday() >= 5 for b in later):
            continue
        if any(a >= b for a,b in zip([cutoff]+[b["date"] for b in later[:-1]], [b["date"] for b in later])):
            continue
        end = later[-1]
        if now < window(end["date"], market_id)[0]:
            continue
        result = {"days": [b["date"] for b in later], "date": end["date"], "close": end["close"],
                  "actual": int(end["close"] > r["startClose"]), "settledAt": now.isoformat(),
                  "snapshot": data["experiment"]["snapshotSha256"]}
        db.execute("UPDATE rounds SET settlement=? WHERE market=? AND cutoff=? AND horizon=? AND settlement IS NULL",
                   (json.dumps(result), market_id, cutoff, HORIZON))


def state(data, external, path, clock=utc_clock):
    now = clock()
    gate = eligibility(data, external, now)
    market_id = data["market"]["id"]
    with connect(path) as db, db:
        reconcile(db, data, external, now)
        rows = db.execute("SELECT receipt,ai,settlement FROM rounds WHERE market=? AND horizon=? ORDER BY cutoff DESC",
                          (market_id, HORIZON)).fetchall()
    records, totals = [], {}
    for encoded, ai, settled in rows:
        r = json.loads(encoded)
        r["ai"] = json.loads(ai) if ai else None
        r["settlement"] = json.loads(settled) if settled else None
        records.append(r)
        if not settled:
            continue
        actual = r["settlement"]["actual"]
        probs = {k:r[k] for k in ("user","baseline","logistic")}
        if ai:
            probs["ai"] = r["ai"]["probability"]
        for key, p in probs.items():
            t = totals.setdefault(key, [0,0,0.0])
            t[0] += 1
            t[1] += int((p >= .5) == bool(actual))
            t[2] += (p-actual)**2
    ranking = sorted([{"model":k,"n":v[0],"accuracy":v[1]/v[0],"brier":v[2]/v[0]} for k,v in totals.items()], key=lambda t:t["brier"])
    return {"gate": gate, "records": records, "ranking": ranking}
