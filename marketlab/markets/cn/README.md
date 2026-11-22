# 大陆市场 · 沪深300指数

取数脚本从中证指数有限公司的公开历史查询取得沪深300价格指数（000300）点位，在本机生成固定历史样本。覆盖 2023-01-03 至 2026-11-18，共 938 个实际交易日，按北京时间收盘。原始返回同时含交易量字段，但接口没有注明计量单位，当前快照仅采用已核对的开、高、低、收。成交量保留为空。[中证指数产品页](https://www.csindex.com.cn/zh-CN/indices/index-detail/000300) · [编制与官方发布渠道](https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/000300_Index_Methodology_cn.pdf)

**适用范围**　交易所将指数历史行情列入数据服务产品。尚未找到对本次完整历史日线公开再分发的授权。网站目录仅含本脚本与说明，取得的数据与据此生成的模型快照存于博客外的私人目录。对外展示或提供原始数据前，应核实相应授权范围。[上交所数据产品说明](https://english.sse.com.cn/markets/dataservice/products/)

## 在本机复现

在项目的 `marketlab` 目录下执行。模型用到项目已有的 NumPy、pandas 与 scikit-learn 环境；Mac 已设置的 `~/.marketlab/model-python` 可以直接使用。在其他环境下，改用已安装 `model/requirements.txt` 的解释器。

```sh
~/.marketlab/model-python markets/cn/fetch.py
```

输出默认存至 `~/.marketlab/markets/cn`。可用 `--output 路径` 指定其他未占用的私人目录，用 `--response 原始.json` 从已取得的官方响应离线重建。再次生成相同样本会复用已有快照，遇到不同内容会保留原目录。下载、校验和训练成功后才将完整结果放入目标位置。

## 数据与模型

脚本使用中证指数官网区间查询，起止都选真实交易日。检验指数代码、名称、日期排序、周末、覆盖区间与 OHLC 边界。用休市日作起始参数时，上游可能返回一条复制首日点位的区间边界行，因此应保留查询中的真实首日。[原始查询](https://www.csindex.com.cn/csindex-home/perf/index-perf?indexCode=000300&startDate=20230103&endDate=20261118)

`source.csv` 与 `source.json` 是模型的标准输入，包含数据与原件校验指纹。复用项目逐日前推模型生成 `market.json` 与 `market.js`，每次预测仅使用当时已揭晓的五日标签。本次固定样本得到 854 个预测，末五个预测在样本截止时仍待结算。

运行本目录的解析测试使用 `python3 -m unittest discover -s markets/cn -p 'test_*.py'`。测试数据由测试代码构造，仅用于校验，不属于历史快照。

冻结版另按年核对了腾讯财经 sh000300 的实际交易日清单，四年分别为 242、242、243、211 个，两份来源合计 938 个日期完全一致。最后一根收盘 3983.77 点。
