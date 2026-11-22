"""Fetch one reproducible CSI 300 research sample into a private local directory."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path
import sys
import tempfile
from datetime import datetime
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SYMBOL = "000300"
START = "20230103"
END = "20261118"
API = "https://www.csindex.com.cn/csindex-home/perf/index-perf"
URL = API + "?" + urlencode({"indexCode": SYMBOL, "startDate": START, "endDate": END})
PRODUCT = "https://www.csindex.com.cn/zh-CN/indices/index-detail/000300"
DEFAULT = Path.home() / ".marketlab" / "markets" / "cn"
FIELDS = ("open", "high", "low", "close")
sys.path.insert(0, str(ROOT / "model"))


def fetch_response():
    request = Request(URL, headers={"Accept": "application/json", "User-Agent": "MarketLab/1.0 personal research"})
    with urlopen(request, timeout=25) as response:
        if response.geturl().split("/")[2] != "www.csindex.com.cn":
            raise ValueError("上游返回了非中证指数官网地址。")
        raw = response.read(4_000_001)
    if len(raw) > 4_000_000:
        raise ValueError("上游响应超出预期。")
    return raw


def normalize(raw):
    envelope = json.loads(raw)
    if not envelope.get("success") or str(envelope.get("code")) != "200":
        raise ValueError("中证指数未返回成功状态。")
    rows = envelope["data"]
    if not isinstance(rows, list) or len(rows) < 90:
        raise ValueError("沪深300日线覆盖不足。")
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(("date", *FIELDS, "volume"))
    previous = ""
    for record in rows:
        day = record["tradeDate"]
        if record["indexCode"] != SYMBOL or record["indexNameCn"] != "沪深300":
            raise ValueError("行情返回的标的不是沪深300价格指数。")
        if not isinstance(day,str) or len(day)!=8 or not day.isdecimal():
            raise ValueError("源数据中的交易日期无效。")
        when = datetime.strptime(day, "%Y%m%d").date()
        if not START <= day <= END or day <= previous or when.weekday() >= 5:
            raise ValueError("日线有非交易日、重复或顺序异常。")
        values = [float(record[key]) for key in FIELDS]
        opening, high, low, closing = values
        if not all(map(math.isfinite,values)) or not 0 < low <= min(opening,closing) <= max(opening,closing) <= high:
            raise ValueError("日线点位无效。")
        writer.writerow((when.isoformat(), *values, ""))
        previous = day
    if rows[0]["tradeDate"] != START or previous != END:
        raise ValueError("行情未覆盖固定样本的首末交易日。")
    return output.getvalue().encode("utf-8"), len(rows)


def validate_existing(folder, csv_hash):
    try:
        metadata=json.loads((folder/"source.json").read_text())
        market=json.loads((folder/"market.json").read_text())
        return (metadata["source"]["sha256"] == csv_hash
                and hashlib.sha256((folder/"source.csv").read_bytes()).hexdigest() == csv_hash
                and market["market"]["id"]=="CSI:000300" and market["source"]==metadata["source"]
                and (folder/"market.js").read_text().strip()=="window.MARKETLAB_DATA="+(folder/"market.json").read_text().strip()+";")
    except (OSError,ValueError,KeyError):
        return False


def generate(raw, output):
    from providers import CsvProvider
    from train import build, export_snapshot

    dest=output.expanduser().resolve()
    if ROOT.parent == dest or ROOT.parent in dest.parents:
        raise ValueError("请将研究快照保存到博客目录之外。")
    payload, count = normalize(raw)
    days = [row["date"] for row in csv.DictReader(io.StringIO(payload.decode("utf-8")))]
    calendar_hash = hashlib.sha256("\n".join(days).encode("ascii")).hexdigest()
    if count != 938 or calendar_hash != "bae2426e9865b5febeb2e0be33ad1ac3111bd822d20cede49fdb8d73e22153ca":
        raise ValueError("固定窗口与已独立核对的交易日日历不一致。")
    csv_hash = hashlib.sha256(payload).hexdigest()
    if dest.exists():
        if validate_existing(dest, csv_hash):return dest
        raise ValueError("目标目录已存在且内容不同。请用 --output 选择一个新目录，保留原记录。")
    dest.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=dest.parent) as tmp:
        stage=Path(tmp)/"cn";stage.mkdir(mode=0o700)
        (stage/"source.csv").write_bytes(payload)
        metadata={
            "market":{"id":"CSI:000300","name":"沪深300指数（000300）","currency":"CNY","timezone":"Asia/Shanghai",
                      "priceUnit":"点","volumeUnit":"未提供","marketType":"指数","priceBasis":"沪深300价格指数官方日线点位"},
            "source":{"name":"中证指数有限公司 · 沪深300日线","url":PRODUCT,"dataUrl":URL,
                      "license":"本机研究快照，未确认行情的公开再分发授权。","redistributable":False,
                      "from":"2023-01-03","asOf":"2026-11-18","updatedAt":datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(timespec="seconds"),
                      "demo":False,"rows":count,"sha256":csv_hash,"originalSha256":hashlib.sha256(raw).hexdigest(),
                      "basis":"冻结于 2026-11-18 的连续历史样本。点位由中证指数官方接口提供；源响应未附交易量单位，因此此快照仅使用真实开高低收。"}
        }
        (stage/"source.json").write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        result=build(CsvProvider(stage/"source.csv",stage/"source.json"))
        export_snapshot(result,stage)
        try:
            os.rename(stage,dest)
        except OSError:
            if not validate_existing(dest,csv_hash):raise
    return dest


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",type=Path,default=DEFAULT)
    parser.add_argument("--response",type=Path,help="离线使用已经取得的中证官方 JSON 原件。")
    args=parser.parse_args()
    try:
        folder=generate(args.response.read_bytes() if args.response else fetch_response(),args.output)
        print(f"沪深300历史研究快照已就绪：{folder}")
    except (ImportError,OSError,TypeError,KeyError,ValueError) as exc:
        parser.exit(1, f"未生成快照：{exc}\n")
