"""Fixed-location market snapshot lookup. Request parameters are IDs, never filesystem paths."""
import json
import os
from pathlib import Path

CN = "CSI:000300"
US = "SP:SPX"
NASDAQ = "NASDAQ:IXIC"


class MissingMarket(ValueError):
    pass


class MarketRegistry:
    def __init__(self, primary, bundled, cache=None, extra=()):
        self.primary = Path(primary).resolve()
        self.bundled = Path(bundled).resolve()
        self.cache = Path(cache or os.environ.get("MARKETLAB_MARKETS_DIR") or Path.home()/".marketlab"/"markets").expanduser().resolve()
        self.extra = [Path(p).expanduser().resolve() for p in extra]

    def imported(self, path):
        return not (path.is_relative_to(self.bundled) or path.is_relative_to(self.bundled.parent/"markets") or path.is_relative_to(self.cache))

    def locations(self):
        rows = []
        if self.imported(self.primary): rows.append((self.primary, None, "import"))
        rows.extend((p, None, "import") for p in self.extra if self.imported(p))
        rows.extend([(self.cache/"cn", CN, "cache"), (self.cache/"us", US, "cache"), (self.cache/"nasdaq", NASDAQ, "cache")])
        for folder in (self.bundled/"markets",self.bundled.parent/"markets"):
            rows.extend((p.parent, None, "archive") for p in sorted(folder.glob("*/market.json")))
        rows.append((self.bundled, None, "archive"))
        if not any(p == self.primary for p, _, _ in rows):
            rows.append((self.primary, None, "archive"))
        return rows

    @staticmethod
    def read(path):
        data=json.loads((path/"market.json").read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("market"),dict) or not isinstance(data["market"].get("id"),str):
            raise MissingMarket("快照缺少实际市场标识。")
        return data

    def candidates(self, local_only=False):
        seen=set()
        for path, expected_id, origin in self.locations():
            if local_only and origin=="archive" or not (path/"market.json").is_file():
                continue
            try:
                data=self.read(path)
            except (OSError,ValueError,TypeError):
                continue
            identifier=data["market"]["id"]
            if expected_id is not None and expected_id!=identifier:
                continue
            if origin=="cache" and data["market"].get("timezone") != {CN:"Asia/Shanghai",US:"America/New_York",NASDAQ:"America/New_York"}[expected_id]:
                continue
            if identifier not in seen:
                seen.add(identifier)
                yield identifier,data,origin

    def select(self, identifier=None):
        if identifier is None:
            data=self.read(self.primary)
            return data, self.imported(self.primary)
        if not isinstance(identifier,str) or not 1 <= len(identifier) <= 80:
            raise MissingMarket("未找到所选市场的快照。")
        for key,data,origin in self.candidates():
            if key == identifier:
                return data,origin=="import"
        raise MissingMarket("本机服务没有该标的的对应行情快照，请先导入或配置数据。")

    def local_snapshots(self):
        return [data for _,data,_ in self.candidates(local_only=True)]
