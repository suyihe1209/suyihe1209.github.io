# 复华沪深300 ETF 的历史日线

这份样本记录台交所挂牌基金 006207 的实际交易。基金跟踪沪深300指数；交易价格以新台币计算，成交量按 ETF 受益凭证份数统计。需要研究指数点位时，应另行导入有权使用的指数数据。基金名称与跟踪目标见[台交所商品页](https://www.twse.com.tw/zh/ETFortune/etfInfo/006207)和[基金公开说明书摘要](https://www.fhtrust.com.tw/docUpload/Prospectus_Brief/ETF01.pdf)。

## 来源与授权

金融監督管理委員會證券期貨局／臺灣證券交易所，2023–2024，「盤後資訊 > 個股日成交資訊」，资料集 11549。原始盘后日成交数据依政府资料开放授权条款第1版向公众提供。使用者遵守条款并保留来源署名后，可复制、改编和分发。资料集以股数统计成交量，此处股票代码对应 ETF，因此以份数显示。该开放许可用于本数据集，不涵盖指数供应商的其他产品。[数据集与字段](https://data.gov.tw/dataset/11549) · [授权条款](https://data.gov.tw/license)

## 文件和口径

- `source.csv` 含 481 根日线，覆盖 2023-01-03 至 2024-12-31，时区为 Asia/Taipei。仅收录交易所有记录的日期；周末、休市日不补值。
- 列依次为 `date,open,high,low,close,volume`，使用未复权的实际成交价，未计分红再投资。价格单位为新台币／份。成交量包括一般、零股、盘后定价和大额交易，按交易所月报口径统计。
- `source.json` 提供来源、计量单位、覆盖日期及文件 SHA-256。历史回放的最后一个交易日是 2024-12-31；文件整理时间另计。

## 复现与交叉检查

按 2023-01 至 2024-12 逐月查询[台交所个股日成交资讯历史查询](https://www.twse.com.tw/zh/trading/historical/stock-day.html)，证券代码填 006207。每个月对应一份报告，例如[2023年1月官方 JSON](https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?stockNo=006207&date=20230101&response=json)。脚本按字段名提取开、高、低、收和成交股数，去掉数字千分位，将民国日期转换为公历并顺序写出。整理时另用 FinMind 结果逐日核对，481 个日期和全部 2,405 个 OHLCV 数值一致；随包的 CSV 直接取自台交所 24 份月报。

在本目录使用 Python 3 运行以下命令，输出一份可对照的 CSV 与哈希。已下载的 24 份官方 JSON 也可按 `YYYYMM.json` 命名后通过 `--archive 目录` 离线复现。若今后交易所更正历史数据，重新下载可能得到不同的哈希。

```sh
python3 reproduce.py --output reproduced.csv
```
