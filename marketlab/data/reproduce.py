"""Rebuild the 006207 historical sample from TWSE monthly trading reports."""
import argparse
import csv
import hashlib
import io
import json
from datetime import date
from decimal import Decimal
from pathlib import Path
import sys
import time
from urllib.request import Request, urlopen

API = "https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY"
FIELDS = ["開盤價", "最高價", "最低價", "收盤價", "成交股數"]
HEADER = ["date", "open", "high", "low", "close", "volume"]


def fetch_report(month, archive):
    if archive:
        return json.loads((archive / (month + ".json")).read_text(encoding="utf-8"))
    query = f"{API}?stockNo=006207&date={month}01&response=json"
    request = Request(query, headers={"User-Agent": "MarketLab/1.0 (historical data)", "Accept": "application/json"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=20) as stream:
                return json.load(stream)
        except (OSError, ValueError):
            if attempt == 2:
                raise
            time.sleep(2 ** (attempt + 1))


def build(archive):
    result = io.StringIO(newline="")
    writer = csv.writer(result, lineterminator="\n")
    writer.writerow(HEADER)
    last = None
    for year in (2023, 2024):
        for n in range(1, 13):
            month = f"{year}{n:02}"
            data = fetch_report(month, archive)
            if (data.get("stat") != "OK" or data.get("date") != month + "01"
                    or "006207" not in data.get("title", "") or not data.get("data")):
                raise ValueError(f"Invalid report for {month}")
            for item in data["data"]:
                row = dict(zip(data["fields"], item))
                y, m, d = map(int, row["日期"].split("/"))
                session = date(y + 1911, m, d)
                if session.strftime("%Y%m") != month or (last and session <= last):
                    raise ValueError(f"Out-of-order or duplicate record on {session}")
                prices = [Decimal(row[field].replace(",", "")) for field in FIELDS[:4]]
                volume = int(row[FIELDS[4]].replace(",", ""))
                opening, high, low, closing = prices
                if not (0 < low <= min(opening, closing) <= max(opening, closing) <= high and volume >= 0):
                    raise ValueError(f"Invalid OHLCV on {session}")
                writer.writerow([session.isoformat(), *(format(x.normalize(), "f") for x in prices), volume])
                last = session
            if not archive:
                time.sleep(1.0)
    return result.getvalue().encode("utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, help="Read the 24 YYYYMM.json monthly reports from this directory.")
    parser.add_argument("--output", type=Path, required=True, help="Write the historical CSV here.")
    args = parser.parse_args()
    content = build(args.archive)
    args.output.write_bytes(content)
    print(f"{len(content.splitlines()) - 1} rows; SHA-256 {hashlib.sha256(content).hexdigest()}")
