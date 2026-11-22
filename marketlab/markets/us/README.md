# 美国股价指数历史样本

网页固定使用 2023-01-03 至 2026-11-18 的标普 500（SPX）和纳斯达克综合指数（COMP、IXIC）。两者分别覆盖 974 个纽约交易日，按年份为 250、252、250、222 日。数值均为未含股息的价格指数点位。现金指数的成交量栏留空。[标普指数说明](https://www.spglobal.com/spdji/en/indices/equity/sp-500/) · [纳斯达克综合指数说明](https://indexes.nasdaqomx.com/Index/Overview/COMP)

在 `marketlab` 目录中，用项目模型的 Python 环境运行。每个目标目录用于一个标的，应选择新的私人目录。每次运行在完整核验与训练结束后才放入四个结果文件。

```sh
~/.marketlab/model-python markets/us/build_snapshot.py --symbol spx --out ~/.marketlab/markets/us-20261118
~/.marketlab/model-python markets/us/build_snapshot.py --symbol ixic --out ~/.marketlab/markets/nasdaq-20261118
```

历史原件已另行保存在本机时，加 `--raw-dir 私人原件目录` 可原样复现。每项输入的名称、完整取数地址与 SHA-256 都列在结果 `source.json` 中。标准输入包括该文件与 `source.csv`，输出 `market.json`、`market.js` 使用同一个逐日回放模型。每个指数有 890 个预测，其中末五期的未来五日收益在冻结时尚未揭晓。

## 核对口径与数据差异

- 逐年读取腾讯财经与 Yahoo Finance 的日开、高、低、收，将时刻换为纽约当地交易日，四价保留两位小数。FRED 的 SP500 和 NASDAQCOM 日序列分别由 S&P Dow Jones Indices 与 Nasdaq 提供。三个来源的有效交易日必须逐个一致。纳综还逐日核对 Nasdaq 自身 COMP 历史接口。[标普在 FRED 的序列](https://fred.stlouisfed.org/series/SP500) · [纳综在 FRED 的序列](https://fred.stlouisfed.org/series/NASDAQCOM) · [纳综官方历史查询](https://www.nasdaq.com/market-activity/index/comp/historical)
- 每天只选一套完整四价。先剔除开盘或收盘超出当日高低区间的四价，再依次比较与 FRED 收盘的一致性、其他来源对全组四价的确认数、与 Nasdaq 官方四个字段的吻合数。标普若仍平分则采用 Yahoo 原组。2023-07-03 的半天市另以菲律宾证券交易所发布的海外市场报告核对。[该日交易所报告](https://documents.pse.com.ph/wp-content/uploads/sites/15/2023/07/foreignquote_070323.pdf)
- 标普的 974 个收盘全部通过核对。纳综有 967 个收盘与 FRED 一致，余下七天在 2023 年 8 月 4 日、7–10 日以及 9 月 11–12 日。部分来源的历史开盘落在其对应日的高低区间之外。源间不同的日期、采用的来源与两种收盘都保存在 `source.validation.vendorDifferences` 中。11 月 18 日两项指数的收盘均与 FRED 独立核对一致。
- 这些序列有第三方行情使用条款。网站可分发脚本和说明，本次完整美股历史与据此生成的预测快照仅存放本机供研究。对其他人提供完整行情时须取得适用的再分发许可。FRED 的序列页列明数据提供方和引用条款。
