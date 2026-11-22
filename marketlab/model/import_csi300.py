"""Import licensed CSI 300 index bars into a separate local research snapshot."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd

from providers import COLUMNS, CsvProvider, validate_bars
from train import ROOT, build, export_snapshot

ALIASES = {
    "date": ("date", "日期", "交易日期", "trade_date"),
    "open": ("open", "开盘", "开盘价", "开盘点位"),
    "high": ("high", "最高", "最高价", "最高点位"),
    "low": ("low", "最低", "最低价", "最低点位"),
    "close": ("close", "收盘", "收盘价", "收盘点位"),
    "volume": ("volume", "vol", "成交量", "成交量(手)", "成交量(股)", "成交量(万股)"),
}
VOLUME_UNITS = ("股", "手", "万股", "未提供")
TZ = ZoneInfo("Asia/Shanghai")
CN = "CSI:000300"
US = "SP:SPX"
NASDAQ = "NASDAQ:IXIC"
INDEXES = {
    NASDAQ: {"short":"纳斯达克综合","name":"纳斯达克综合指数（IXIC）","currency":"USD","timezone":"America/New_York","closeHour":16,
             "symbols":{"ixic","^ixic",".ixic","nasdaq:ixic","nasdaqcom","comp"}},
    CN: {"short":"沪深300","name":"沪深300指数（000300）","currency":"CNY","timezone":"Asia/Shanghai","closeHour":15,
         "symbols":{"000300","000300.sh","sh000300","399300","399300.sz","sz399300","csi300","csi:000300"}},
    US: {"short":"标普500","name":"标普500指数（S&P 500）","currency":"USD","timezone":"America/New_York","closeHour":16,
         "symbols":{"spx","sp:spx","^spx","^gspc","sp500","s&p 500","s&p500",".inx","indexsp: .inx","indexsp:.inx"}},
}


def read_index(csv_path: Path, volume_unit: str, market_id: str = CN) -> pd.DataFrame:
    spec = INDEXES[market_id]
    try:
        frame = pd.read_csv(csv_path, dtype=str, encoding="utf-8-sig")
    except UnicodeDecodeError:
        frame = pd.read_csv(csv_path, dtype=str, encoding="gb18030")
    frame.columns = [c.strip().lower().replace("（", "(").replace("）", ")") for c in frame.columns]
    symbols = spec["symbols"]
    for column in ("ts_code", "symbol", "ticker", "code", "指数代码", "证券代码", "代码"):
        if column in frame and not frame[column].str.strip().str.lower().isin(symbols).all():
            raise ValueError("代码列含有非"+spec["short"]+"标的，请导出与所选市场匹配的单一指数日线。")
    data = {}
    for key, options in ALIASES.items():
        matched = [col for col in frame.columns if col in options]
        if key == "volume" and not matched and volume_unit == "未提供":
            data[key] = pd.Series(float("nan"), index=frame.index)
            continue
        if len(matched) != 1:
            raise ValueError(f"请保留一列「{options[1]}」（{key}），并删除重复列。")
        name = matched[0]
        if key == "volume" and "(" in name and f"({volume_unit})" not in name:
            raise ValueError("成交量表头里的单位与选择的单位不同。")
        data[key] = frame[name].str.strip()
    output = pd.DataFrame(data)
    volume_found = output["volume"].notna().any()
    if volume_found and volume_unit == "未提供":
        raise ValueError("源文件有成交量。请核对并填写数据源使用的成交量单位。")
    if not volume_found and volume_unit != "未提供":
        raise ValueError("源文件没有成交量。请选择「未提供」。")
    dates = output["date"].str.replace("/", "-", regex=False)
    dates = dates.str.replace(r"^(\d{4})(\d{2})(\d{2})$", r"\1-\2-\3", regex=True)
    output["date"] = pd.to_datetime(dates, format="%Y-%m-%d", errors="raise").dt.strftime("%Y-%m-%d")
    # Some terminal exports put newest observations first. Reject arbitrary disorder.
    if output.date.is_monotonic_decreasing:
        output = output.iloc[::-1]
    bars = validate_bars(output)
    if (bars.index.map(lambda d: datetime.fromisoformat(d).weekday()) > 4).any():
        raise ValueError("发现周末行。请导出所选市场的实际交易日收盘数据。")
    return bars


def server_command(folder: Path):
    return [sys.executable, str(ROOT / "server.py"), "--snapshot", str(folder), "--port", "8766", "--open"]


def import_index(csv_path: Path, dest: Path, source: str, url: str, license_note: str, unit: str, market_id: str = CN):
    if market_id not in INDEXES:
        raise ValueError("不支持的指数标识。")
    spec = INDEXES[market_id]
    if unit not in VOLUME_UNITS:
        raise ValueError("成交量单位必须是股、手、万股，或未提供。")
    if not source.strip() or not license_note.strip():
        raise ValueError("请填写行情来源与获准的使用范围。")
    if dest.exists() or not dest.parent.is_dir():
        raise ValueError("请选择已存在的父文件夹，并使用尚未存在的新快照名称。")
    bars = read_index(csv_path, unit, market_id)
    if len(bars) < 85:
        raise ValueError("至少需要 85 个完整交易日，建议提供一年以上的连续日线。")
    now = datetime.now(ZoneInfo(spec["timezone"]))
    last = datetime.fromisoformat(bars.index[-1]).date()
    if last > now.date() or (last == now.date() and now.hour < spec["closeHour"]):
        raise ValueError("最后一行日期在未来或当日尚未收盘，请仅提供已收盘日线。")
    # Reserve the output name without clobbering a concurrent import or an existing directory.
    staging = Path(tempfile.mkdtemp(prefix=".marketlab-", dir=dest.parent))
    try:
        csv = staging / "source.csv"
        bars.to_csv(csv, columns=COLUMNS[1:], lineterminator="\n")
        stamp = now.isoformat(timespec="seconds")
        metadata = {
            "market": {"id":market_id, "name":spec["name"], "currency":spec["currency"],
                       "timezone":spec["timezone"], "priceUnit":"点", "volumeUnit":unit,
                       "marketType":"指数", "priceBasis":"指数点位"},
            "source": {"name":source.strip(), "url":url.strip(), "license":license_note.strip(),
                       "asOf":bars.index[-1], "updatedAt":stamp, "demo":False,
                       "from":bars.index[0], "rows":len(bars),
                       "sha256":hashlib.sha256(csv.read_bytes()).hexdigest(),
                       "originalSha256":hashlib.sha256(csv_path.read_bytes()).hexdigest(),
                       "basis":"用户提供的"+spec["short"]+"指数日线，训练与结算按文件中的连续交易日计算。"},
        }
        manifest = staging / "source.json"
        manifest.write_text(json.dumps(metadata, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
        result = build(CsvProvider(csv, manifest))
        export_snapshot(result, staging)
        if sys.platform == "darwin":
            launcher = staging / "打开这份快照.command"
            launcher.write_text(
                '#!/bin/sh\ncd "$(dirname "$0")" || exit 1\n'
                + "exec /usr/bin/env python3 " + shlex.quote(str(ROOT / "server.py"))
                + ' --snapshot "$PWD" --port 8766 --open\n', encoding="utf-8")
            launcher.chmod(0o755)
        dest.mkdir(exist_ok=False)
        try:
            for file in staging.iterdir():
                os.replace(file, dest / file.name)
        except BaseException:
            shutil.rmtree(dest)
            raise
    finally:
        shutil.rmtree(staging)
    return result


def picker(kind: str) -> Path:
    scripts = {
        "csv": 'POSIX path of (choose file with prompt "选择已获授权的单一指数日线 CSV")',
        "parent": 'POSIX path of (choose folder with prompt "选择保存新快照的位置")',
    }
    chosen = subprocess.run(["/usr/bin/osascript","-e",scripts[kind]], capture_output=True, text=True)
    if chosen.returncode:
        raise ValueError("未选择文件或保存位置，导入已取消。")
    return Path(chosen.stdout.strip())


def main():
    p = argparse.ArgumentParser(description="将已获授权的沪深300、标普500或纳斯达克综合指数日线导入独立文件夹。")
    p.add_argument("--market", choices=INDEXES, default=CN, help="所导入的实际指数。默认 CSI:000300，标普500使用 SP:SPX，纳斯达克综合使用 NASDAQ:IXIC。")
    p.add_argument("--csv", type=Path)
    p.add_argument("--output", type=Path, help="新快照文件夹，不得已存在")
    p.add_argument("--source-name", help="数据来源名称")
    p.add_argument("--source-url", help="数据提供方网页")
    p.add_argument("--license", help="授权条款名称或实际许可范围")
    p.add_argument("--volume-unit", choices=VOLUME_UNITS)
    p.add_argument("--choose", action="store_true", help="在 Mac 上用访达选择文件")
    p.add_argument("--open", action="store_true", help="导入后打开工作台")
    args = p.parse_args()
    try:
        if args.choose:
            print("请准备"+INDEXES[args.market]["short"]+"指数本身的日线 CSV，以及数据来源、使用许可与成交量单位。", flush=True)
            csv_path = picker("csv")
            parent = picker("parent")
            dest = parent / (INDEXES[args.market]["short"]+"研究快照-" + datetime.now(ZoneInfo(INDEXES[args.market]["timezone"])).strftime("%Y%m%d-%H%M%S"))
            source = input("数据提供方名称：").strip()
            url = input("提供方网页（https://…）：").strip()
            note = input("这份数据的授权范围或许可名称：").strip()
            unit = input("成交量单位（股 / 手 / 万股 / 未提供）：").strip()
        else:
            if not all((args.csv, args.output, args.source_name, args.source_url, args.license, args.volume_unit)):
                p.error("请提供 --csv、--output、--source-name、--source-url、--license、--volume-unit")
            csv_path, dest, source, url, note, unit = (args.csv, args.output, args.source_name,
                                                      args.source_url, args.license, args.volume_unit)
        dest = dest.expanduser().resolve()
        result = import_index(csv_path.expanduser(), dest, source, url, note, unit, args.market)
        print(f"快照保存到 {dest}\n收录 {len(result['bars'])} 根日线、{len(result['forecasts'])} 个预测起点。")
        if sys.platform == "darwin":
            print("以后直接双击新快照文件夹中的「打开这份快照.command」。")
        cmd = server_command(dest)
        print("启动命令：",subprocess.list2cmdline(cmd) if os.name == "nt" else shlex.join(cmd))
        if args.open:
            os.execv(sys.executable, cmd)
    except (OSError, ValueError, EOFError, KeyboardInterrupt) as e:
        p.exit(1, f"导入未完成：{e}\n")


if __name__ == "__main__":
    main()
