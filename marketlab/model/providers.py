"""Market bars supplied by a licensed daily CSV or a compatible provider."""
from __future__ import annotations

import hashlib
import json
from io import BytesIO
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Protocol
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

COLUMNS = ["date", "open", "high", "low", "close", "volume"]


class BarProvider(Protocol):
    def load(self) -> tuple[pd.DataFrame, dict]:
        """Return chronological observations and immutable snapshot metadata."""


@dataclass(frozen=True)
class CsvProvider:
    csv_path: Path
    metadata_path: Path

    def load(self) -> tuple[pd.DataFrame, dict]:
        metadata = json.loads(self.metadata_path.read_text(encoding="utf-8"))
        csv_bytes = self.csv_path.read_bytes()
        frame = pd.read_csv(BytesIO(csv_bytes), dtype={"date": str})
        bars = validate_bars(frame)
        for section, names in {
            "market": ("id", "name", "currency", "timezone", "priceUnit", "volumeUnit"),
            "source": ("name", "url", "license", "asOf", "updatedAt"),
        }.items():
            for name in names:
                value = metadata.get(section, {}).get(name)
                if not isinstance(value, str) or not value.strip():
                    raise ValueError(f"Missing metadata: {section}.{name}")
        src = metadata["source"]
        expected_hash = src.get("sha256")
        if expected_hash and hashlib.sha256(csv_bytes).hexdigest() != expected_hash:
            raise ValueError("CSV checksum does not match source.sha256")
        if "rows" in src and src["rows"] != len(bars):
            raise ValueError("Source row count disagrees with the snapshot")
        if "from" in src and src["from"] != bars.index[0]:
            raise ValueError("Source start date disagrees with the snapshot")
        if type(src.get("demo")) is not bool:
            raise ValueError("source.demo must be true or false")
        url = urlsplit(src["url"])
        if not url.netloc or url.scheme not in {"http", "https"}:
            raise ValueError("source.url must be a web URL")
        ZoneInfo(metadata["market"]["timezone"])
        if src["asOf"] != bars.index[-1]:
            raise ValueError("source.asOf must match the last session")
        last_update = datetime.fromisoformat(src["updatedAt"].replace("Z", "+00:00"))
        if last_update.tzinfo is None or last_update.astimezone(
            ZoneInfo(metadata["market"]["timezone"])
        ).date() < date.fromisoformat(src["asOf"]):
            raise ValueError("source.updatedAt must be timezone-aware and cover the final session")
        return bars, metadata


def validate_bars(frame: pd.DataFrame) -> pd.DataFrame:
    missing = set(COLUMNS) - set(frame.columns)
    if missing or frame.empty:
        raise ValueError(f"Empty bars or missing columns: {sorted(missing)}")
    bars = frame.loc[:, COLUMNS].copy()
    dates = bars["date"].astype("string")
    if dates.isna().any() or not dates.str.fullmatch(r"\d{4}-\d{2}-\d{2}").all():
        raise ValueError("Date must be YYYY-MM-DD")
    pd.to_datetime(dates, format="%Y-%m-%d", errors="raise")
    if dates.duplicated().any() or not dates.is_monotonic_increasing:
        raise ValueError("Duplicate or unsorted sessions")
    bars = bars.set_index("date")
    bars.index = dates.to_list()
    bars.index.name = "date"
    for col in COLUMNS[1:]:
        bars[col] = pd.to_numeric(bars[col], errors="raise")
    prices = bars[["open", "high", "low", "close"]]
    if not np.isfinite(prices.to_numpy()).all() or (prices <= 0).any().any():
        raise ValueError("Nonfinite, missing or nonpositive price")
    if (bars["high"] < prices.max(axis=1)).any() or (bars["low"] > prices.min(axis=1)).any():
        raise ValueError("Inconsistent daily OHLC")
    volume = bars["volume"].dropna()
    if not np.isfinite(volume.to_numpy()).all() or (volume < 0).any():
        raise ValueError("Volume must be nonnegative or empty")
    return bars
