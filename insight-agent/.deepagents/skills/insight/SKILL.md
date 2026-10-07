---
name: insight
description: 当任务涉及归因分析、业务诊断、活动复盘、营销分析、渠道/用户/商品/优惠/地域/漏斗分析，或需要先通过 `db_query` 查询业务数据库、再用 pandas 在工作区完成多维对比分析并最终输出 HTML 报告时使用此技能。
---

# 归因分析技能

> ⚠️ **读我自己的提示**：本文件 > 100 行。deepagents 的 read_file 工具默认只读 100 行。
> 调用我时必须用 `read_file(path="/skills/insight/SKILL.md", limit=2000)` 才能读到全部内容，
> 否则会丢掉后半段（退款归因专题、HTML 渲染规范等关键内容）。

## 什么时候进入归因分析模式
出现以下任一情况时，不要只做单点查数：
- 用户问“为什么”
- 用户问“谁贡献了增长/下滑”
- 用户问“活动/渠道/商品/地域/人群表现如何”
- 用户问“帮我复盘”“帮我详细分析”“输出报告”
- 用户只给了一个核心指标，但本质是经营诊断问题

## 核心要求
- 数据库数据**只能**通过 `db_query` 获取（**绝对不要**直接 exec python 读 MySQL）
- 不要停留在单点查数；默认做多维拆解和归因判断
- 查询结果要保存为 pandas 可直接加载的文件
- 中间结果写入 `analysis/`
- 最终输出 `outputs/*.html`
- Python 一律使用 `uv run`，安装依赖一律使用 `uv add`

## 电商数仓字段硬约束
**这一节专门针对 warehouse 库的 dwd_fact_trade_* / dwd_dim_* 表，避免 AI 幻觉字段名和数值。**

| 字段类别 | 真实取值 | 易错点 |
|---|---|---|
| `refund_status` | 中文枚举：`'退款成功'` / `'退款审核中'` / `'已拒绝'` / `'已关闭'` | **严禁用 `'SUCCESS'`**（数据库里不存在）。⚠️ 当前 mock 数据里**只有 `'退款成功'` 一种取值**，所以 `WHERE refund_status='退款成功'` 是恒等过滤、不会筛掉任何行——对账时别把这个条件当成"占比变化的解释" |
| **`pay_status`** | ⚠️ **实际只有 `'成功'` 一个值**（54,295 行）。且在**支付表** `dwd_fact_trade_pay_detail_di`，**订单表没有这个字段** | **写成 `'支付成功'` 会返回 0 行**；**不要在订单表上引用 `pay_status`**（字段不存在，会触发 join 和 SQL 纠错，显著拖长耗时） |
| **「支付成功订单」的三种等价口径** | ① 支付表 `pay_status='成功'` ② 订单表 `order_pay_time IS NOT NULL` ③ 订单表 `order_status <> '未支付关闭'` —— 三者指向**同一批 54,295 单**（已做双向差集校验，完全一致） | **优先用 ②**：单表、免 join、data-agent 最容易生成正确 SQL |
| `dwd_fact_trade_order_detail_di.order_status` | `'已完成'` / `'未支付关闭'` / `'签收后退款'` / `'支付后取消'` / `'拒收退款'` | 唯一未支付态是 `'未支付关闭'`；`'支付后取消'` 是**已支付过**的 |
| `refund_reason_desc` | 中文：`'不想要了'` / `'商品质量问题'` / `'尺寸/规格不符'` 等 | 严禁用 `'refund_reason'`（字段不存在） |
| `refund_success_time` | datetime，钱到账时间 | 用作"退款归因"时间窗口 |
| `apply_time` | datetime，退款申请时间 | 用户感知到的"申请退款"时间 |
| **`order_pay_time`** | datetime，订单支付时间。**没有 `pay_time` 这个字段** | 算"支付金额分母"必须用 `order_pay_time`，写 `pay_time` 会直接 SQL 报错 |
| 所有 `*_amount` 字段 | 单位**分**（不是元）| SQL 必须 `* 0.01` 转元再展示 |
| `*.province_code` | 6 位省码，实际只有 `110000`(北京) / `120000`(天津) / `130000`(河北) 三个值 | 关联地域维表**必须** `= dwd_dim_geo_region_df.province_code` **且 `region_level = 1`**；维表的 `region_code` 是 **12 位**，写成 `= g.region_code` 会 **0 行匹配、省名全 NULL** |
| `dwd_fact_trade_order_detail_di.province_code` | 订单表**自带**省码 | 做地域拆解优先用它，比绕用户维表更稳；退款表没有省码，需经 `order_detail_id` join 订单表取 |
| `dwd_fact_trade_order_detail_di.paid_amount` | 实付金额（分）| 计算退款率分母用这个 |
| `dwd_fact_trade_order_detail_di.payable_amount` | 应付金额 | 跟 paid_amount 差 = 优惠 |


**SQL 必须显式写**：
- 退款时间窗口：`WHERE refund_success_time >= 'YYYY-MM-DD' AND refund_success_time < 'YYYY-MM-DD'`
- 退款状态：`AND refund_status = '退款成功'`
- 金额转元：`SUM(refund_success_amount) * 0.01 AS refund_yuan`
- 退款率口径：`SUM(refund_success_amount) / SUM(paid_amount)`（同窗口，分母用 `order_pay_time` 过滤）
- 省份名：`LEFT JOIN dwd_dim_geo_region_df g ON o.province_code = g.province_code AND g.region_level = 1`

**可直接跑的模板（退款 × 省份 × 渠道 × 原因，已验证字段全部存在）**：
```sql
SELECT
  DATE_FORMAT(r.refund_success_time, '%Y-%m')      AS refund_month,
  r.refund_reason_desc                              AS reason,
  g.province_name                                   AS province,
  p.payment_channel_code                            AS channel,
  ROUND(SUM(r.refund_success_amount) * 0.01, 2)     AS refund_yuan,
  COUNT(DISTINCT r.order_id)                        AS refund_orders
FROM dwd_fact_trade_refund_detail_di r
LEFT JOIN dwd_fact_trade_order_detail_di o ON r.order_detail_id = o.order_detail_id
LEFT JOIN dwd_dim_geo_region_df g          ON o.province_code = g.province_code AND g.region_level = 1
LEFT JOIN dwd_fact_trade_pay_detail_di p   ON r.order_id = p.order_id
WHERE r.refund_status = '退款成功'
  AND r.refund_success_time >= '2026-06-01'
  AND r.refund_success_time <  '2026-09-01'
GROUP BY refund_month, reason, province, channel
```
（退款表没有 `province_code`，必须经 `order_detail_id` join 订单表取；不要 join 用户维表）

**严禁**：
- WHERE refund_status = 'SUCCESS' / 'PENDING'（**过滤掉所有行**）
- WHERE pay_time = ...（**字段不存在，直接报错**）
- JOIN geo ON u.province_code = g.region_code（**0 行匹配，省名全 NULL**）
- SUM(refund_success_amount)（不 *0.01，数字大 100 倍）
- 跨窗口的分子分母（3 个月退款金额 / 3 年订单金额 → 退款率 > 100%）

## 默认工作流
1. 明确分析对象、目标指标、对比口径、归因目标
2. **【数据获取铁律】** 只能走 `db_query`：
   - 1 个 db_query 拿基础数据（退款表 + 订单表 + 维表）
   - **【绝对不要】** `uv run python -c "import pymysql; ..."`（绕开 db_query 会丢失元数据召回 + 字段别名 + 大表保护）
3. 把 db_query 返回的 CSV/JSON 用 pandas 读、清洗、聚合、对比、分层
4. 默认补齐关键维度并做交叉分析
5. **【数据对账】** 至少做 3 步对账：
   - A. 跑 1 个"总量校验" SQL，跟 AI 自己算的数对比，偏差 >10% 主动重算
   - B. 跑 1 个"分类占比校验" SQL，确认各维度占比用的是同窗口数据
   - C. 跑 1 个"金额单位校验" SQL，确认 *0.01 已加
6. 形成归因判断、异常点和机会点
7. 输出中间文件、报告 payload 和最终 HTML

## 退款归因专题工作流
针对"最近 3 个月退款归因"类问题，标准工作流：

### Step 1: 明确时间口径
"最近 3 个月"在业务上有 3 个可能含义，**必须问清或主动选定**：
- **申请时间 `apply_time`**：用户感知到的"我申请退款了"——业务上最贴近"客户行为"
- **退款成功时间 `refund_success_time`**：钱到账时间——财务上最贴近"实际损失金额"
- **退款完结时间 `close_time`**：流程结束——含"已拒绝"和"已关闭"
- **默认推荐 `refund_success_time`**（最常用，反馈"实际损失"）

**窗口选法**：优先用**自然月**（`YYYY-06-01` ~ `YYYY-09-01` 左闭右开），口径干净、可复现、能覆盖完整大促月；不要用"今天往前推 90 天"这种滚动窗口，边界落在月中会让月度趋势图失真。

### Step 2: 1 个 db_query 拿核心数据
让 data-agent 一次返回：
```sql
SELECT
  DATE_FORMAT(r.refund_success_time, '%Y-%m')   AS refund_month,
  r.refund_reason_desc                            AS reason,
  g.province_name                                 AS province,
  p.payment_channel_code                          AS channel,
  ROUND(SUM(r.refund_success_amount) * 0.01, 2)  AS refund_yuan,
  COUNT(DISTINCT r.order_id)                      AS refund_orders
FROM dwd_fact_trade_refund_detail_di r
LEFT JOIN dwd_fact_trade_order_detail_di o ON r.order_detail_id = o.order_detail_id
LEFT JOIN dwd_dim_geo_region_df g          ON o.province_code = g.province_code AND g.region_level = 1
LEFT JOIN dwd_fact_trade_pay_detail_di p   ON r.order_id = p.order_id
WHERE r.refund_status = '退款成功'
  AND r.refund_success_time >= 'YYYY-MM-DD'
  AND r.refund_success_time <  'YYYY-MM-DD'
GROUP BY refund_month, reason, province, channel
```
**关键约束**：
- `refund_status = '退款成功'`（中文）
- `* 0.01` 转元
- 时间窗口左闭右开
- 4 个 GROUP BY 维度（月/原因/地域/渠道）够交叉

### Step 3: pandas 拆解
```python
import pandas as pd
df = pd.read_csv('/abs/path/result.csv')
# 月度趋势
df.groupby('refund_month')['refund_yuan'].sum()
# 退款原因 Top 5
df.groupby('reason')['refund_yuan'].sum().nlargest(5)
# 渠道 × 原因 交叉
df.pivot_table(index='channel', columns='reason', values='refund_yuan', aggfunc='sum', fill_value=0)
# 地域 Top 10
df.groupby('province')['refund_yuan'].sum().nlargest(10)
```

### Step 4: 写 HTML 报告
- 必备 4 个 section：核心摘要 / 月度趋势 / 退款原因 / 渠道 × 原因交叉
- 数字带单位（"元" / "万元"）
- 退款率 14.25% 这种**口径标注**清楚（分子分母都是哪段时间）
- 末尾"附录"标注：时间口径 / 状态过滤 / 金额单位 / 已知局限

## 必须补齐的分析动作
- 基线对比：同比、环比、活动前后或对照组
- 规模拆解：流量、曝光、访问、下单人数
- 结构拆解：渠道、人群、商品、地域、优惠、时间结构
- 效率拆解：转化率、客单价、件单价、复购率
- 贡献拆解：哪些维度拉动增长，哪些维度拖累结果
- 异常识别：高流量低转化、高转化低覆盖、高曝光低成交

如果数据不足，至少完成：
- 规模变化分析
- 结构变化分析
- 关键效率指标分析

## 默认分析维度
默认至少覆盖 4 个维度；活动复盘、经营诊断、增长分析建议覆盖 6 个以上。
- 用户：新老客、会员等级、生命周期、购买力
- 渠道：自然/付费、私域/公域、搜索/直播/短视频
- 商品：品类、品牌、SPU、SKU、价格带、爆款/长尾
- 优惠：券类型、折扣力度、满减门槛、补贴
- 地域：省份、城市、区域、城市等级
  - ⚠️ **当前 mock 数据的省码只有 3 个值**：`130000` 河北省（约占 80% 订单/退款额）、`110000` 北京市、`120000` 天津市。
    地域维度**区分度很低**，不要硬做"地域 Top10"（只会出来 3 行）；地域结论要配一句"样本仅覆盖 3 个省市、代表性有限"
- 时间：天、周、小时、活动阶段
- 行为：曝光、点击、访问、加购、下单、支付、复购

常用交叉维度：
- 新老客 × 渠道
- 新老客 × 优惠
- 渠道 × 商品
- 地域 × 商品
- 活动阶段 × 渠道表现

## 归因结论的写法
不要只写"谁最高""谁最低"，要明确：
- 指标变了什么，幅度多少
- 变化主要来自哪些维度
- 哪个因素是主因，哪些只是表象
- 对业务动作意味着什么

每个重要结论尽量包含：
1. 一句话结论
2. 关键数字
3. 归因判断
4. 业务建议

## 数据与文件产物
推荐目录：
- `db_query_results/`: 原始查询结果
- `analysis/`: 清洗结果、汇总表、归因拆解表、图表数据
- `outputs/`: HTML 报告和其他交付文件

推荐中间文件：
- `analysis/base_cleaned.csv`
- `analysis/metric_summary.csv`
- `analysis/channel_contribution.csv`
- `analysis/user_segment_summary.csv`
- `analysis/product_mix_summary.csv`
- `analysis/region_summary.csv`
- `analysis/time_trend.csv`
- `analysis/chart_data.json`
- `analysis/report_payload.json`

## pandas 与 uv 规则
优先从 `db_query` 返回的文件继续分析，不要重复查库。

**正确示例（推荐）**：
```bash
# 1. 短命令用 -c（命令行 < 4KB 时 OK）
uv run python -c "import pandas as pd; df = pd.read_csv('/abs/path/result.csv'); print(df.head())"

# 2. 长代码必须 write_file 写文件再执行（Windows 命令行有 8KB 上限）
# Step 1: write_file 写 analysis_step1.py
# Step 2: uv run python /abs/path/analysis_step1.py
```

**关键约束**：
- `uv run python -c "..."` 在 Windows 单行命令 **>4KB 时会报"命令行太长"**——必须拆成文件
- 禁止 echo "长代码" > file.py（绕开 = 用 write_file）
- 禁止 `python script.py`（直接 python 不会激活 venv）
- 禁止 `pip install ...`（统一 `uv add xxx`）

**安装依赖**：
```bash
uv add seaborn
```

## HTML 报告要求
如果用户要详细分析、汇报页、可分享结果，默认输出 HTML，而不是只在对话里贴结论。

HTML 至少应包含：
- 标题区：主题、时间范围、数据口径、生成时间
- 核心摘要区：3 到 6 条核心发现
- 指标卡片区：核心指标与对比值
- 归因总览区：增长/下滑由哪些因素驱动
- 多维拆解区：用户、渠道、商品、优惠、地域、时间
- 异常与机会区
- 行动建议区
- 附录区：口径说明、数据文件路径、限制说明

## 图表要求
归因分析不要只输出表格和文字。只要数据具备可视化价值，默认应生成图表并放入 HTML。

优先出图场景：
- 时间趋势
- 维度 TopN 对比
- 结构变化
- 归因贡献拆解
- 漏斗变化

默认优先图表方案：
- 时间趋势：`echarts` 折线图
- 维度对比：`echarts` 柱状图
- 贡献拆解：`echarts` 柱状图或瀑布图
- 指标总览：`metrics`
- 结论摘要：`cards`
- 明细口径：`table`

图表原则：
- 一张图只表达一个核心问题
- 标题写清楚指标、维度、时间范围
- 图下要有一句解释
- 优先展示最支持结论的 1 到 3 张图
- 默认优先使用 `echarts` block，把图表 `option` 直接写入 HTML 渲染
- 只有在不适合用 `echarts` 或需要快速兜底时，再使用 `line-chart`、`bar-chart`

## HTML 渲染脚本
使用 [scripts/render_report.py](./scripts/render_report.py) 把 `analysis/report_payload.json` 渲染为 HTML：
```bash
uv run python /home/kodey/agents/insight-agent/.deepagents/skills/insight/scripts/render_report.py \
  --input analysis/report_payload.json \
  --output outputs/insight_report.html
```

payload 顶层字段：
- `meta`
- `blocks`

支持的 block 类型：
- `section`
- `prose`
- `list`
- `metrics`
- `cards`
- `table`
- `echarts`
- `bar-chart`
- `line-chart`
- `ranking`
- `callout`
- `columns`

常用字段：
- `title`
- `summary`
- `items`
- `option`
- `series`
- `columns`
- `rows`
- `blocks`

`echarts` block 示例：
```json
{
  "type": "echarts",
  "title": "渠道 GMV 对比",
  "height": 360,
  "option": {
    "tooltip": {"trigger": "axis"},
    "legend": {"data": ["2024", "2023"]},
    "xAxis": {"type": "category", "data": ["私域", "搜索", "直播"]},
    "yAxis": {"type": "value"},
    "series": [
      {"name": "2024", "type": "bar", "data": [520, 330, 260]},
      {"name": "2023", "type": "bar", "data": [480, 360, 210]}
    ]
  }
}
```

## 最终回复用户时必须包含
- 分析的业务问题
- 使用了哪些数据文件
- 补充了哪些维度分析
- 核心归因结论
- 生成了哪些文件
- 最终 HTML 文件路径

如果数据不足以完成完整归因，要明确说明缺失了哪些字段、当前结论有哪些局限、下一步还需要补什么数据。
