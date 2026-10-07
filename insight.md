# 归因分析项目 · Insight 文档

> 一个面向**电商业务**的对话式归因分析平台，基于 deepagents + LangGraph 框架构建。
> 业务方用自然语言提问，Agent 自主取数、多维拆解、产出 HTML 报告，所有中间产物可追溯。

> 📐 **总体架构图**：[docs/diagrams/architecture.html](docs/diagrams/architecture.html) · 科技风独立大图，矢量清晰

---

## 零、术语速查（小白入门）

> 第一次接触电商/AI 术语？这张表过一遍就能读懂全文。

| 术语 | 全称 | 一句话解释 | 例子 |
| --- | --- | --- | --- |
| **GMV** | Gross Merchandise Volume | 一定时间内的**总成交金额**（含未付款） | 618 当天 GMV 5000 亿 |
| **DAU** | Daily Active Users | **日活跃用户数** | 今天打开 App 的独立用户数 |
| **MAU** | Monthly Active Users | **月活跃用户数** | 30 天内打开过 App 的独立用户数 |
| **客单价** | Average Order Value, AOV | 每个订单的**平均金额** = GMV / 订单数 | 客单价 200 元 |
| **复购率** | Repeat Purchase Rate | 一段时间内**重复下单的用户占比** | 30 天复购率 35% |
| **ROI** | Return On Investment | **投资回报率** = 收益 / 成本 | 投了 100 万广告，赚 300 万，ROI = 3 |
| **CTR** | Click-Through Rate | **点击率** = 点击数 / 曝光数 | 一个商品被看了 1000 次，被点了 50 次，CTR = 5% |
| **CVR** | Conversion Rate | **转化率** = 下单数 / 点击数 | 1000 个点击有 50 个下单，CVR = 5% |
| **SPU** | Standard Product Unit | **标准化产品单元**（商品的"款"） | iPhone 15 Pro 是一个 SPU |
| **SKU** | Stock Keeping Unit | **库存单元**（商品的具体规格） | iPhone 15 Pro 256G 银色 就是一个 SKU |
| **退款率** | Refund Rate | **退款订单占比** = 退款单数 / 总订单数 | 1000 单里有 50 单退款，退款率 5% |
| **自然流量** | Organic Traffic | **不花钱的流量**（搜索、推荐、口碑） | 用户搜"防晒衣"自然找到的 |
| **付费流量** | Paid Traffic | **花钱买的流量**（广告、推广） | 抖音投流、淘宝直通车 |

---

## 一、开场：什么是归因分析

### 1.1 一句话定义

> **归因分析 = 当一个业务结果（指标）出现异常时，系统化地拆解"是哪些维度/因素驱动了变化"**。

它不只回答"GMV（一定时间内的总成交金额，含未付款）是多少"，而是回答"**GMV 为什么跌了、是谁贡献的、应该怎么补救**"。

### 1.2 它能干什么（4 类典型问题）

| 类型 | 典型问题 | 归因分析的产出 |
| --- | --- | --- |
| **指标异常波动** | GMV 突然下滑 20%、DAU（日活跃用户数）跌了、转化率掉了、退款激增 | 拆到渠道/商品/人群/时间维度，定位驱动因子 |
| **大促/活动复盘** | 618 做了几亿 GMV，到底是活动、券、广告、还是自然流量（搜索/推荐/口碑等不花钱的流量）贡献的 | 增量贡献拆分（活动 vs 基线），识别高 ROI（投资回报率 = 收益/成本）渠道 |
| **A/B 实验 & 策略上线** | 实验组比对照组好 5%，是哪个机制带来的 | 拆到具体行为/触点/人群，给实验找"可复用规律" |
| **预算分配 & 风险预警** | 明年市场预算 1 个亿怎么分？退款率上升、差评变多 | 基于历史贡献度做反事实估算 + 早期识别异常驱动因子 |

> 💡 **判断口诀**：当"看到结果"已经不够、要追问"为什么"时，就是归因分析上场的时候。
> 指标都正常没异常 → 用看板；维度已确定、规则已知 → 写 SQL/规则引擎；**只有"为什么/谁贡献了/怎么补救"这种开放问题才需要归因 Agent**。

### 1.3 电商场景应用

电商是数据密集型行业，**数据天生就具备归因分析的所有要素**——这正是本项目把电商选为"第一个落地战场"的原因：

- **结果指标明确**：GMV、DAU、转化率、客单价（每个订单的平均金额 = GMV / 订单数）、退款率（退款订单占总订单的比例）、ROI（投资回报率 = 收益 / 成本）、复购率（一段时间内重复下单的用户占比）…每个数字都能用钱或人量化
- **数据维度丰富**：用户（人群/新老/地域）、渠道（站内/站外/自然/付费）、商品（类目/品牌/SKU 即具体规格/价格带）、时间（大促/日/周/月）、行为（曝光/点击/加购/收藏/搜索）
- **状态机可追溯**：下单 → 支付 → 发货 → 签收 → 退款，每一步都打点
- **业务影响直接**：一个 SKU 选错可能让 GMV 跌 1%，一次活动 ROI 算错可能烧掉千万预算

本项目配套的 [`dbmock/`](dbmock/) 数据生成器按电商业务真实结构生成 **5 层数仓**数据：

| 层 | 维度/事实 | 量级 | SCD 方式 |
| --- | --- | --- | --- |
| **L1 静态维度** | 用户、店铺、类目、品牌、支付方式、物流公司、地理区域 | 1k→3k 用户、150 店铺、4.4w 地理节点 | 拉链 |
| **L2 商品维度** | SPU（标准化产品单元，即商品"款"）、SKU（库存单元，即具体规格） | ~500 SPU、~2.5k SKU | 拉链 |
| **L3 营销** | 促销活动、优惠券 | ~50 活动、~100 券模板 | 每日快照 |
| **L4 交易核心** | 订单明细、支付明细、物流明细、退款明细、评价 | 10w+ 订单 | 每日快照 |
| **L5 行为事件** | 加购、收藏、PV、搜索 | 用户人均 10+ 事件 | 每日快照 |

**订单状态机**（关键，6 大场景都围绕它）：
```
下单 ─┬─ 15% → 未支付（流失）
      └─ 85% → 已支付 ─┬─ 5%  → 取消
                       └─ 95% → 已发货 ─┬─ 2%  → 拒收退单
                                          └─ 98% → 已签收 ─┬─ 90% → 正常完成
                                                              └─ 10% → 申请退款
```

**促销峰**（业务时间分布）：618（6.1-6.18，8× 权重）、双 11（11.1-11.11，10×）、双 12（12.1-12.12，5×）。

> 📌 **一句话总结**：**电商场景 = 数据多 + 维度全 + 业务重 + 钱相关**。"指标异常要快速定位原因"是电商最常见也最值钱的分析需求，归因分析在电商里**收益最大、痛点最痛**。

---

## 二、项目总览（一张图看懂）

> 📐 完整架构图（含 4 模块调用关系、6 场景 × 20 能力点 × 80 文件激活热力图）：[docs/diagrams/architecture.html](docs/diagrams/architecture.html) + [docs/diagrams/overview.html](docs/diagrams/overview.html)

### 2.1 4 大模块关系图

```
┌───────────────────────────────────────────────────────────────┐
│                       B 端商家 / 运营                          │
│   问"GMV 为什么跌" / "上个月 GMV 多少" / "广告费值不值"        │
└────────────────────────┬──────────────────────────────────────┘
                         │ WebSocket + OAuth2
                         ▼
┌───────────────────────────────────────────────────────────────┐
│  🧠 insight-agent （本项目核心）                                │
│  FastAPI + deepagents + LangGraph + 协作式取消                  │
│  · deepagents Agent + insight Skill（归因方法论）              │
│  · 工作区：raw / analysis / outputs（HTML 报告）                │
│  · WebSocket 流式 + L2 上下文管理 + 动态 Skill 热更新           │
│  · 工具链：db_query (→data-agent SSE) / return_file / MCP      │
└──────────┬──────────────────────────┬─────────────────────────┘
           │ SSE NL2SQL                │ OAuth2 内省
           ▼                           ▼
┌──────────────────────┐    ┌──────────────────────┐
│  📊 data-agent        │    │  🔐 auth              │
│  NL2SQL + 校验         │    │  OAuth2 + PKCE        │
│  Elasticsearch 元数据  │    │  统一身份体系          │
└──────────┬───────────┘    └──────────┬───────────┘
           │ SQL                       │ Token 校验
           ▼                           ▼
┌───────────────────────────────────────────────────────────────┐
│  🗃️ dbmock（5 层数仓，10w+ 订单，~2.5k SKU）                   │
│  MySQL 8 + Redis（WS 临时令牌）                                 │
└───────────────────────────────────────────────────────────────┘
```

### 2.2 一句话定位每个模块

| 模块 | 一句话 | 源码入口 |
| --- | --- | --- |
| **🧠 insight-agent** | 业务主体，把 LLM + 工具 + Skill + 工作区装成可对话的归因分析产品 | [`insight-agent/app/main.py`](insight-agent/app/main.py) |
| **📊 data-agent** | Text-to-SQL 服务，把自然语言翻译成 SQL 查数仓，**被 insight-agent 通过 SSE 调用** | [`data-agent/main.py`](data-agent/main.py) |
| **🔐 auth** | 统一认证中心，OAuth2 + PKCE，所有服务共用身份体系 | [`auth/app/main.py`](auth/app/main.py) |
| **🗃️ dbmock** | 业务数据生成器，按电商数仓 5 层模型生成测试数据 | [`dbmock/core/init_db.py`](dbmock/core/init_db.py) |

> 💡 **关键映射**：`data-agent` 实际上就是"掌柜问数（NL2SQL）系统"——它的 Agent 端封装是 `db_query` 工具，**`data-agent` = `db_query` 的服务端实现**。归因分析 = 问数（`db_query`）+ 推理（Agent）。

### 2.3 6 大电商场景速览

> 每个场景都对应一个**真实业务问题 + 真实可跑例子**，详细演示见 §3。

| # | 场景 | 业务问题 | 关键维度 |
| --- | --- | --- | --- |
| **①** | **产品目录优化** | "新品 CTR（点击率 = 点击数/曝光数）2.8% 远低于品类均值 5.5%，为什么？" | SPU/SKU、价格段、品牌 |
| **②** | **客户行为分析** | "Q2 新客 90 天复购率从 28% 跌到 21%，哪类新客跌得最厉害？" | 注册渠道、新老客、品类 |
| **③** | **智能库存管理** | "618 后某品牌运动鞋积压但 T 恤断货 3 次，怎么备货？" | SPU/SKU 规格、库存变动 |
| **④** | **评论和反馈处理** | "上周好评率从 95% 跌到 88%，集中在哪类商品的什么问题？" | 差评关键词、SKU、物流商（**重点讲**） |
| **⑤** | **市场表现分析** | "Q2 APP GMV +60% 但 PC -20%，整体增长来自哪里？" | 渠道、类目、活动、券（**重点讲**） |
| **⑥** | **退款模式检测** | "最近 30 天退款率从 5% 涨到 9%，是质量问题还是描述不符？" | 退款原因、类目、上架时间 |

---

## 三、场景演示：从"问题"到"报告"

> 💡 **怎么读这一章**：每个场景展示"用户原话 → Agent 拆解过程 → 最终 HTML 报告"，**重点关注 ①④⑤** 三个场景（覆盖了产品目录、评论、市场表现三个核心方向）。
> **演示中会自然带出 3 个重难点**：长对话压缩（场景② 的"追问"）、协作式取消（场景 E）、动态 Skill 热更新（场景 F）——这 3 个点在 §四 里展开讲。

### 3.1 场景 ① 产品目录优化

**用户原话**：

> "为什么最近 30 天我们店铺的 SPU 点击率只有 2.8%，远低于品类均值的 5.5%？"

**涉及的事实表**（数仓 L4/L5）：
- **流量**：`dwd_fact_traffic_page_view_di`（含 `page_type` / `business_type` / `business_id` / `client_type` / `channel_code` / `event_time`）
- **商品**：`dwd_dim_spu_info_df`（含 `spu_name` / `spu_sub_title` / `category_id` / `brand_id` / `on_shelf_time` / `is_new` / `is_hot_sale`）

**Agent 完整执行链**（5 步）：

```
[1] db_query → 拉曝光点击数
    SELECT spu_id, COUNT(*) AS pv
    FROM dwd_fact_traffic_page_view_di
    WHERE page_type='商品' AND event_time >= 当前日期-30
    GROUP BY spu_id
    → 落 raw/spu_pv.csv

[2] db_query → 拉 SPU 维度信息（关联新品/爆款/价格段/品牌）
    → 落 raw/spu_dim.csv

[3] pandas 多维拆解（work_workspace/analysis/）
    df = pd.read_csv('raw/spu_pv.csv').merge(pd.read_csv('raw/spu_dim.csv'), on='spu_id')
    df['ctr'] = df['clicks'] / df['pv']
    # 按 spu_name 长度 × is_new 交叉
    df.groupby([df['spu_name'].str.len() // 20 * 20, 'is_new'])['ctr'].mean()
    # 按 价格段 × 品牌 交叉
    df.groupby([pd.cut(df['sale_price'], bins=[0,100,300,1000,1e9]), 'brand_id'])['ctr'].mean()

[4] 写 chart_data.json + report_payload.json
[5] uv run python .deepagents/skills/insight/scripts/render_report.py \
    --input analysis/report_payload.json \
    --output outputs/spu_ctr_analysis.html
```

**归因结论**（示例输出）：
1. **`spu_name` 长度 < 20 字的新品 CTR 4.5%** vs **> 40 字的新品 CTR 仅 1.2%** —— 标题冗长是主因
2. `spu_sub_title`（副标题）为空的新品 CTR 2.1%，有副标题的新品 CTR 3.8% —— 副标题缺失拖低 1.7 pp
3. 100-300 元价格段品牌 X 的 CTR 6.2%，远超品类均值——可作为后续选品基准

**HTML 报告** 包含：核心摘要 3 条 / 指标卡片 4 个 / 标题长度 × 新品交叉图 / 价格段 × 品牌热力图 / 行动建议 3 条 / 附录（数据口径）。

### 3.2 场景 ④ 评论和反馈处理

**用户原话**：
> "上周好评率从 95% 跌到 88%，集中在哪类商品的什么问题？"

**涉及的表**（数仓 L4）：
- **评价**：`dwd_fact_service_comment_detail_di`（含 `comment_level` / `comment_content` / `service_score` / `logistics_score` / `description_score` / `sentiment` / `comment_time`）
- **物流**：`dwd_fact_trade_delivery_detail_di`（含 `logistics_company_id` / `delivery_time` / `sign_time` / `delivery_status`）
- **物流商维表**：`dwd_dim_logistics_company_df`

**Agent 完整执行链**（6 步——比场景 ① 多了"跨表关联"和"根因二次下钻"）：

```
[1] db_query → 拉差评明细（最近 7 天，comment_level<=2）
    SELECT sku_id, category_id, comment_content, comment_time
    FROM dwd_fact_service_comment_detail_di
    WHERE comment_time >= 当前日期-7 AND comment_level <= 2
    → 落 raw/bad_comments.csv

[2] pandas 文本聚类（按 comment_content 高频词）
    from collections import Counter
    keywords = Counter()
    for text in df['comment_content']:
        for word in ['包装', '破损', '物流', '慢', '描述', '不符', '尺寸']:
            if word in text: keywords[word] += 1
    # 结论：top3 = 包装破损、物流慢、描述不符

[3] 时间分布：发现 6/12-6/15 集中爆发，涉及 3 个新品（is_new=1）的美妆类目

[4] 跨表下钻根因：JOIN 物流表 + 物流商维表
    SELECT l.logistics_company_id, c.company_name, COUNT(*) AS cnt
    FROM dwd_fact_trade_delivery_detail_di d
    JOIN dwd_dim_logistics_company_df c ON d.logistics_company_id = c.id
    WHERE d.delivery_time >= '6/12' AND d.delivery_time < '6/16'
    GROUP BY l.logistics_company_id, c.company_name
    → 发现：6/12 起顺丰占比从 80% 跌到 20%，换成中通

[5] 根因确认：差评订单 70% 来自中通承运的 3 个新品
[6] 输出 HTML 报告（4 个 section：差评分布 / 关键词 Top / 物流商迁移 / 行动建议）
```

**归因结论**（示例输出）：

1. **差评集中爆发在 6/12-6/15 三天**，关键词"包装破损"+"物流慢"
2. 涉及 **3 个新品（`is_new=1`）的美妆类目**
3. **6/12 起 `logistics_company_id` 从顺丰切换为中通**，承运商占比从 80% 跌到 20%
4. 差评订单中 70% 由中通承运——**物流商更换是直接根因**

**行动建议**：
- 临时换回顺丰（紧急，48 小时内）
- 联系中通索赔
- 对受影响的 1000+ 用户主动发 `coupon_type='满减券' threshold_amount=0 discount_amount=50` 补偿

### 3.3 场景 ⑤ 市场表现分析

**用户原话**：
> "Q2 我们 APP 渠道 GMV 增长 60%，但 PC 渠道 GMV 跌了 20%，整体增长到底是哪里来的？"

**涉及的表**（数仓 L1/L2/L3/L4）：
- **订单**：`dwd_fact_trade_order_detail_di`（含 `order_create_time` / `paid_amount` / `order_source` / `order_scene` / `coupon_discount_amount` / `activity_discount_amount`）
- **类目**：`dwd_dim_category_info_df`（含 `root_category_name`）
- **活动**：`dwd_dim_promotion_info_df`（`promotion_type`：满减/折扣/秒杀/拼团）

**Agent 完整执行链**（7 步——展示了完整的"增量贡献拆分"）：

```
[1] db_query → Q1 vs Q2 各渠道 GMV
    SELECT
      CASE WHEN order_source IN ('APP','H5') THEN '移动' ELSE 'PC' END AS channel_group,
      order_source,
      QUARTER(order_create_time) AS q,
      SUM(paid_amount) * 0.01 AS gmv_yuan
    FROM dwd_fact_trade_order_detail_di
    WHERE order_create_time >= '2026-04-01' AND order_create_time < '2026-07-01'
    GROUP BY channel_group, order_source, q
    → 落 raw/channel_gmv.csv

[2] 计算增量贡献：APP +5000 万（+75%）、PC -2000 万、H5 +500 万、小程序 +1000 万

[3] db_query → 按 root_category_name 再拆
    → 落 raw/category_gmv.csv

[4] 关键发现：APP 增长集中在 root_category_name='美妆'（+3500 万）
              PC 下跌主要在 root_category_name='服饰'（-1500 万）

[5] db_query → 进一步拆美妆增长来源（JOIN 活动表）
    SELECT
      p.promotion_type,
      SUM(o.paid_amount) * 0.01 AS gmv_yuan,
      SUM(CASE WHEN o.activity_discount_amount > 0 THEN o.paid_amount ELSE 0 END) * 0.01 AS promo_gmv
    FROM ... JOIN dwd_dim_promotion_info_df p ON o.activity_id = p.id
    WHERE o.order_source='APP' AND o.root_category_name='美妆'
    GROUP BY p.promotion_type
    → 落 raw/beauty_promo.csv

[6] 发现 APP 美妆增长中 60% 用了 activity_discount_amount>0 的活动摊销
    → 主要由 promotion_type='秒杀' 贡献

[7] 输出 HTML 报告（6 个 section：渠道增量 / 类目结构 / 美妆来源 / 活动依赖度 / 建议）
```

**归因结论**（示例输出）：

1. **整体增长 4500 万 = APP +5000 万 + H5 +500 万 + 小程序 +1000 万 − PC 2000 万**
2. APP 增长集中在美妆（贡献 70%），美妆增长 60% 来自秒杀活动摊销
3. **风险提示**：增长高度依赖秒杀，ROI 不可持续
4. PC 服饰下滑需进一步排查流量结构（可能 SEO 降权或竞品打压）

**行动建议**：
- Q3 把 PC 服饰预算砍 20%，转投 APP 美妆秒杀（短期复现增长）
- 排查 PC 服饰流量结构（中期护盘）
- 降低对单一活动类型的依赖，建立"美妆日常券矩阵"（长期）

---

## 四、3 大亮点 + 5 大难点（核心实现）

### 4.1 亮点 ① deepagents + Skill 工作区模式

**一句话**：不是"调一次 LLM 拿到结果"，而是"加载归因 Skill → 进入工作区 → 多步工具调用 → 落盘 CSV → 渲染 HTML 报告"的全流程。

**架构**（`app/agent/agent.py`）：

```python
from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, FilesystemBackend, LocalShellBackend

# 工作区后端：LocalShellBackend（带虚拟模式的本地 shell）
# 技能后端：FilesystemBackend 读 /skills/insight/SKILL.md
# CompositeBackend 把两者合并成 Agent 透明的文件系统视图
def _backend_factory(rt):
    workspace_dir = get_config()["configurable"]["workspace_dir"]
    workspace_backend = LocalShellBackend(root_dir=Path(workspace_dir), virtual_mode=True)
    skills_backend = FilesystemBackend(root_dir=SKILLS_DIR, virtual_mode=True)
    return CompositeBackend(
        default=workspace_backend,
        routes={"/skills/": skills_backend}  # /skills/ 前缀路由到技能
    )

agent = create_deep_agent(
    model=model,
    tools=[db_query, return_file, *mcp_tools],
    system_prompt="...",  # 中文 system_prompt
    backend=_backend_factory,
    skills=["/skills/"],  # 声明可用的 Skill 前缀
)
```

**为什么选 deepagents 而不是 LangChain AgentExecutor / 纯 Function Calling**：

- AgentExecutor 太"扁"，没有工作区概念；多步取数 + 中间产物落盘它搞不定
- 纯 Function Calling 每一步都要手写 OpenAI API，状态管理、tool 路由、历史消息维护全是手写
- deepagents 提供 `LocalShellBackend` / 自定义后端，天然支持"工作区 = 落盘目录"
- 还有 `SummarizationMiddleware` 等中间件机制，长对话压缩开箱即用

**工作区结构**（`.deepagents/workspaces/user_{user_id}/{conversation_id}/`）：
```
{workspace_dir}/
├── raw/         # db_query 落盘的 CSV/JSON
├── analysis/    # Agent 中间分析、chart_data.json、report_payload.json
└── outputs/     # 最终 HTML 报告（return_file 工具回传给前端）
```

**Skill 文件**：[`.deepagents/skills/insight/SKILL.md`](insight-agent/.deepagents/skills/insight/SKILL.md)（309 行）—— 把归因方法论沉淀为可被 Agent 读到的"操作手册"。

### 4.2 亮点 ② WebSocket 流式 + 协作式取消

**一句话**：用 FastAPI WebSocket + LangGraph `astream` + `_TurnStream` 实现逐 token 推送，用户点"停止"用 `asyncio.Event` 协作式取消，不脏数据。

**WebSocket 路由**（`app/routers/api/chat.py`）：

```python
@router.websocket("/ws/chat")
async def api_websocket_chat(websocket: WebSocket, conversation_id: int):
    # Phase 1: 校验临时令牌（Redis GETDEL 一次性消费）
    user_id = await _validate_and_accept(websocket, conversation_id)

    # Phase 2: 加载对话上下文（历史 + 压缩）
    ctx = await chat_service.load_conversation_context(conversation_id, user_id)

    # Phase 3: 消息循环
    while True:
        user_message = await _receive_user_message(websocket)
        async with _TurnStream(websocket, conversation_id) as stream:
            async for msg in chat_service.run_agent_turn(
                ..., stream.cancel  # 传入 asyncio.Event
            ):
                if stream.disconnected: break
                await stream.send(msg)  # 逐消息推到前端
```

**`_TurnStream` 协作式取消**：

```python
class _TurnStream:
    def __init__(self, websocket, conversation_id):
        self.cancel = asyncio.Event()       # 中断信号
        self.disconnected = False           # 客户端断开标志
        self._listener = None

    async def _listen_cancel(self):
        """独立 task 监听客户端发来的 {"type":"cancel"} 消息"""
        while True:
            raw = await self._ws.receive_json()
            if raw.get("type") == "cancel":
                self.cancel.set()           # 设置中断信号
                return

    async def __aenter__(self):
        self._listener = asyncio.create_task(self._listen_cancel())  # 与 Agent 并行
        return self
```

**为什么不能 kill 协程**：kill 会导致 LangGraph 内部状态半提交 + 数据库事务未回滚，下次同会话继续会出现"上一轮说到一半的内容"。**协作式取消 = 每推一个 chunk 检查一次 Event，触发了就 `await generator.aclose()` 优雅退出**。

### 4.3 亮点 ③ 归因 = 问数 + 推理 的清晰分层

**一句话**：insight-agent 调 `db_query` 工具（→ data-agent SSE）取数，自己负责多维拆解、异常识别、报告生成；解耦后可独立替换 NL2SQL 服务。

**调用链**（`app/agent/tools/db_query.py`）：

```python
@tool
async def db_query(runtime: ToolRuntime, query: str, file_name: str) -> dict:
    """查询业务数据，将结果写入工作区"""
    workspace_dir = runtime.config["configurable"]["workspace_dir"]

    # 流式调 data-agent（SSE）
    async for chunk in _stream_db_query(query):
        if chunk["type"] == "result":
            result = chunk["data"]

    # 表格 → CSV，非表格 → JSON
    if isinstance(result, list) and all(isinstance(r, dict) for r in result):
        pd.read_csv()  # 落 raw/{file_name}.csv
    else:
        # 落 raw/{file_name}.json
        ...

    return {"file_path": ..., "preview_rows": ..., "pandas_read_hint": ...}
```

**分层的好处**：
- 归因 Agent 不需要懂 SQL，专注"业务理解 + 因果推理"
- NL2SQL 服务（data-agent）可独立替换为其他实现（甚至换成传统 BI 工具的 API），只要契约不变
- 幻觉防控：SQL 必须先调 `db_query` 真跑，**不允许 LLM 直接报数**；所有指标数字有 CSV 落盘证据

### 4.4 难点 ① 长对话上下文管理

**场景**：用户问 50 轮后上下文超限，LLM 直接拒答 / 漏信息；归因分析每一步都依赖历史对话做"上下文关联"，摘要丢细节 = 答案不可靠；而且不同的"上下文"在不同层（短期/长期/系统/工作区），压错地方 = 信息永久丢。

**怎么做**——本项目的"上下文管理"是 **5 层叠加**，不是只"压缩"：

| 层 | 类别 | 谁负责 | 进 prompt 吗 | 持久吗 |
|---|---|---|---|---|
| L0 | **系统层** | 中文业务 prompt + deepagents BASE_AGENT_PROMPT + SkillsMiddleware | ✅ 每轮注入 | ❌ 代码写死 |
| L1 | **短期记忆**（in-context） | `ConversationContext.messages` 列表 + LangGraph state | ✅ 每轮喂 | ❌ 进程内存 |
| L2 | **自动压缩** | `SummarizationMiddleware`（按 `profile.max_input_tokens × 85%` 触发） | ✅ 摘要替换原消息 | ✅ `context_compaction` 表 |
| L3 | **长期记忆** | `message` 表（全量原始消息） | ✅ 重连时全量加载 | ✅ DB |
| L4 | **工作区 + 工具结果** | `workspace_dir` 文件 + `db_query` 写 CSV | ⚠️ Agent 自己读工具，不直接注入 | ✅ 跟随对话 |

下面逐层说"做什么、为什么这样做、关键代码"。

#### L0 系统层（每轮必注入的"基础设施上下文"）

```python
# app/agent/agent.py:79-121 + deepagents/graph.py:296-302
final_system_prompt = system_prompt + "\n\n" + BASE_AGENT_PROMPT
# SkillsMiddleware 再追加：可用 skill 列表
append_to_system_message(request.system_message, skills_section)
```

- **业务 prompt**（中文）写死人设 / 业务规则 / "必须先读 SKILL.md" 等硬指令
- **BASE_AGENT_PROMPT**（英文）由 deepagents 拼上工具调用、todo、子 agent 等基础行为
- **Skills 元数据**：5 个 skill 的 `name + description` 每轮注入（`skills.py:705-725`）——Agent 看到"有 insight / xlsx / pptx / pdf / docx 可用"，需要时再 `read_file` 拿完整 SKILL.md

> 设计点：SkillsMiddleware 是 **prompt 级注入**，不是文件级——只塞 frontmatter 摘要，省 token。

#### L1 短期记忆（in-context，**WebSocket 内的"工作内存"**）

每条 WS 连接进来时一次性创建 `ConversationContext`，整个连接生命周期复用：

```python
# app/services/chat_service.py:18-74
@dataclass
class ConversationContext:
    messages: list[dict]   # 喂给 Agent 的"全部记忆"
    context_seq: int       # 当前最大 context_seq
    is_draft: bool

ctx = await load_conversation_context(db_session, user_id, conversation_id)
# 1. 从 message 表全量加载历史
# 2. 若有 context_compaction，按 end_seq 替换前 N 条为 [summary]
```

```python
# chat_service.py:77-95
async def _add_message(db_session, user_id, conversation_id, messages, message):
    """DB + 内存双写，保证两边一致"""
    entity = await message_repo.create(db_session, message_entity)
    messages.append({"role": message.role, "content": ..., "context_seq": entity.context_seq})
```

**关键设计**：Agent 看不到 DB，只能看到 `ctx.messages` 这点东西。**DB 有什么，`ctx.messages` 必有什么**——两者通过 `context_seq` 一一对应。

#### L2 自动压缩（`SummarizationMiddleware`，**唯一的"主动压缩点"**）

```python
# deepagents/middleware/summarization.py:1075-1105 create_summarization_middleware
# 本项目默认装配：agent.py:124-130 create_deep_agent(...) 没覆盖这个中间件

# 触发阈值（configs/config.yml:34）
profile.max_input_tokens = 1048576  # ~1M
# → trigger=("fraction", 0.85) keep=("fraction", 0.10)
# → 实际 ~890K tokens 触发，保留最后 ~100K
```

**触发流程**（`summarization.py:866-1049`）：
1. `before_model` → `token_counter` 算当前 token → 到达 85% 触发
2. `_partition_messages` 切出 `to_summarize / preserved`
3. **offload 到 backend**：被摘要的原消息 `write_file` 到 `/conversation_history/{session_id}.md`（写到用户 workspace）
4. 异步调 LLM 出摘要文本
5. 写 `_summarization_event` 到 state（`cutoff_index / summary_message / file_path`）

**业务侧消费**（`chat_service.py:115-142`）：
```python
def _extract_compaction(chunk, seq_offset, conversation_id):
    """从 agent chunk 流里捞出压缩事件"""
    if "model" not in chunk or "_summarization_event" not in chunk["model"]:
        return None
    event = chunk["model"]["_summarization_event"]
    cutoff_index = event["cutoff_index"]
    summary_payload = event["summary_message"]
    # 核心：end_seq = seq_offset + cutoff_index
    end_seq = seq_offset + cutoff_index
    compaction = ContextCompaction(
        conversation_id=conversation_id,
        end_seq=end_seq,
        summary_message=summary,
    )
    return cutoff_index, summary, compaction
```

#### L1+L2 衔接：`seq_offset` + `context_seq` 单调递增的**消息编号管理**（**最关键设计**）

```python
# 每次循环开头重算偏移
seq_offset = cur_context_seq - len(messages) + 1

# 例 1 无摘要前缀: messages=[0,1,2,3,4,5], cur_context_seq=5 → seq_offset=0
#   cutoff_index=3 → end_seq=3, 结束后 messages=[summary,3,4,5]
# 例 2 已有摘要前缀: messages=[summary,3,4,5,6,7], cur_context_seq=7 → seq_offset=2
#   cutoff_index=3 → end_seq=5 (context_seq 0..4 被这次摘要吞掉)
```

```python
# chat_service.py:191-192（每条新消息）
cur_context_seq += 1
response.context_seq = cur_context_seq
```

**没有这个字段，压缩发生后前端的消息 ID 全部错位**——这是该方案跟"朴素 `messages[:N]=[summary]`"的分水岭。`context_seq` 永不回退，**前端第 N 条永远能精确定位到 DB 里的同一行**。

#### L3 长期记忆（**跨会话的"全量 + 摘要"双轨**）

```sql
-- sql/mysql/chat.sql:18-43
CREATE TABLE message (
    id BIGINT PRIMARY KEY,
    conversation_id BIGINT,
    context_seq BIGINT,
    role VARCHAR(10),         -- user / assistant / tool / system
    parts MEDIUMTEXT,         -- JSON: text/image_url/tool_call/tool_result
    finish_reason VARCHAR(128),
    ...
    UNIQUE KEY (conversation_id, context_seq)  -- 严格递增唯一
);

CREATE TABLE context_compaction (
    id BIGINT PRIMARY KEY,
    conversation_id BIGINT,
    end_seq BIGINT,           -- 本次压缩覆盖的结束 context_seq
    summary_message MEDIUMTEXT,
    KEY (conversation_id, end_seq)
);
```

**加载/重连逻辑**（`chat_service.py:27-74`）：
```python
message_entities = await message_repo.ls(db_session, conversation_id)  # 全量
ctx.messages = [entity_to_dict(e) for e in message_entities]
ctx.context_seq = message_entities[-1].context_seq if message_entities else -1

# 关键：再用最新的 compaction 把前 N 条压成 1 条 user 消息
compaction = await context_compaction_repo.get_latest_by_conversation_id(...)
if compaction:
    ctx.messages[:compaction.end_seq] = [{"role": "user", "content": compaction.summary_message}]
```

- **`message` 表 = 全量保留**：摘要丢了能重跑；前端"翻历史"也能看到原文
- **`context_compaction` 表 = 摘要事件**：按 `(conversation_id, end_seq DESC)` 取最新一条；删对话时整体 `yn=0` 软删
- **没有用户偏好/画像/AGENTS.md 记忆**：grep 仓库无 `user_preference` / `user_profile` / MemoryMiddleware（deepagents 自带但 `agent.py` 没传 `memory=`）；用户的"长期记忆"= message 全量 + compaction 摘要

#### L4 工作区 + 工具结果（**"上下文的最长尾"——文件级上下文**）

```python
# app/agent/agent.py:15-52
WORKSPACES_DIR = ROOT_DIR / ".deepagents" / "workspaces"
get_workspace_dir(user_id, conversation_id)  # → /workspaces/user_{id}/{conv_id}/

_backend = CompositeBackend(
    default=LocalShellBackend(root_dir=workspace_dir, virtual_mode=True),
    routes={"/skills/": FilesystemBackend(root_dir=SKILLS_DIR)},
)
```

**特征**：
- **不直接进 prompt**——Agent 必须自己 `read_file` / `glob` / `execute` 去读
- **`db_query` 工具的 CSV 落盘**（`app/agent/tools/db_query.py:188`）：全量写 `workspace_dir/db_query_results/*.csv`，但**只把前 5 行 `preview_rows` 返回给 LLM**（`db_query.py:212-227`）——这是"工作区 = 详细数据 / prompt = 预览"的设计
- **命名约定 `raw / analysis / outputs`**（来自 `SKILL.md`）：是给 Agent 看的软约定，不是代码强制的目录
- **删对话 = `shutil.rmtree(workspace_dir)`**（`routers/api/chat.py:88-92`）

#### L1+L2 衔接：截断自动续接（`while True` + `finish_reason` 重投）

```python
# chat_service.py:145-212
while True:
    seq_offset = cur_context_seq - len(messages) + 1
    async for chunk in _execute_agent(messages, ...):
        if cancel.is_set(): break                              # 协作式取消
        if compaction := _extract_compaction(...): ...        # 压缩事件
        for response in message_mapper.agent_chunk_to_schemas(chunk):
            cur_context_seq += 1
            response.context_seq = cur_context_seq
            await _add_message(db_session, ..., messages, response)
            yield response
    if last_finish_reason == "stop" or cancel.is_set():
        break                                                  # 正常结束/取消退出
    # 否则把刚生成的 assistant 消息塞回 messages 再跑一轮（截断续接）
```

- 模型被截断 / `finish_reason != "stop"` → 自动把最后一条 assistant 消息重投
- `cancel.is_set()` → 协作式取消（见 §4.8），上下文照样干净退出

**关键设计汇总**：

| 设计点 | 解决什么问题 | 为什么这样做 |
|---|---|---|
| **L1 内存 + L3 DB 双写** | 短期长期一致 | Agent 看不到 DB，但能看到的 `ctx.messages` 必须等于 DB 当前状态 |
| **`context_seq` 单调递增** | 压缩后 ID 不错位 | 数组下标会变，全局编号不会变 |
| **L2 摘要 + L3 全量双轨** | 摘要可恢复 | 摘要丢细节，全量留底能重跑 |
| **L4 CSV 落盘 + 只返 5 行 preview** | 大结果不进 prompt | prompt 看 preview，详细数据 Agent 自己读文件 |
| **不用 L3 RAG / 用户画像** | 不引入噪音 | 归因链路短、上下文规模有限，RAG 召回反而引入噪音 |
| **不用 checkpointer / store** | 简化 LangGraph state | 跨 astream 全部走 DB，进程崩溃不丢 |

**面试话术**：
> *"我们的上下文管理不是"压缩"——是 5 层叠加：L0 系统层每轮注入业务 prompt + skills 元数据；L1 短期记忆是 WebSocket 内的 `ctx.messages` 列表 + DB 双写；L2 `SummarizationMiddleware` 按 profile 85% 触发自动摘要，事件嵌在 chunk 流回来；L3 长期记忆是 `message` 表全量 + `context_compaction` 表摘要事件，重连时全量加载再用最新 compaction 替换前缀；L4 工作区是大结果 / 文件级上下文，Agent 通过工具读，不直接进 prompt。*
>
> *最关键的设计是 `context_seq` 单调递增——压缩后数组下标会变，但全局编号不变，前端第 N 条永远能精确定位到 DB 同一行。没用 L3 RAG 是因为归因分析每一步都要历史对话做关联，RAG 召回会引入噪音。"*

### 4.5 难点 ② 三向消息转换（Entity ↔ Schema ↔ LangChain Message）

**场景**：数据库存的 ORM 对象、前后端交互的 Pydantic 模型、喂给 LLM 的 LangChain Message，三者字段名/类型都不同。

**方案**：4 个转换函数收在 [`app/mappers/message_mapper.py`](insight-agent/app/mappers/message_mapper.py) 一个文件里。

```python
# 4 个核心函数：
entity_to_schema(message: Message) -> MessageSchema          # ORM → Pydantic
schema_to_entity(message: MessageSchema, conversation_id) -> Message  # Pydantic → ORM
langchain_message_to_schema(message: AIMessage|ToolMessage) -> MessageSchema  # LangChain → Pydantic
schema_to_langchain_message(message: MessageSchema, ...) -> dict  # Pydantic → LangChain

# 流式转换入口
def agent_chunk_to_schemas(chunk: dict) -> list[MessageSchema]:
    """agent chunk → 前端可消费的消息列表"""
    schemas = []
    for key in ("model", "tools"):  # 处理两类节点
        messages = chunk.get(key, {}).get("messages")
        for m in messages:
            if s := langchain_message_to_schema(m):
                schemas.append(s)
    return schemas
```

**关键设计**：
- **纯函数化**（无副作用、无 IO），单测好写
- 任何字段映射改了只动这一个文件
- `MessagePart` 用 Union 类型（`text` / `image_url` / `tool_call` / `tool_result`）支持富文本消息

**面试话术**：
> *"我们用 Mapper 层做 Entity-Schema-LangChain 三向转换，避免业务层到处写 field-by-field 映射。我特意把这层做成纯函数，单测覆盖率 100%。改字段只动一个文件。"*

### 4.6 难点 ③ 动态 Skill 热更新（reload_config + reset_agent）

**场景**：运营改了 SKILL.md，要立即生效，不能让用户重启服务。

**方案**：`POST /api/reload` 路由调 `reload_config()` + `reset_agent()`，清掉 `get_agent()` 单例缓存，下一次请求重新构建。

**关键代码**（`app/routers/api/admin.py` + `app/agent/agent.py`）：

```python
# 路由：app/routers/api/admin.py
@router.post("/reload")
async def reload_model_config():
    reload_config()      # 1. 重新加载 .env + config.yml
    await reset_agent()  # 2. 清 Agent 单例缓存
    return {"status": "ok", "message": "配置已重新加载，Agent 将在下次请求时重建"}

# Agent 单例：app/agent/agent.py
_agent: CompiledStateGraph | None = None
_agent_lock = Lock()

async def get_agent() -> CompiledStateGraph:
    global _agent
    if _agent is not None: return _agent
    async with _agent_lock:
        if _agent is None:
            _agent = await _build_agent()  # 重新构建（读最新 SKILL.md）
        return _agent

async def reset_agent() -> None:
    global _agent
    async with _agent_lock:
        _agent = None
```

**关键设计**：
- Agent 单例 + 配置 reload 是**两阶段原子操作**——`reload_config()` 成功才 `reset_agent()`
- 双检查锁（`if _agent is not None: return _agent`）保证高并发下只构建一次
- `CompositeBackend` 中的 `FilesystemBackend` 每次读文件都是新 IO，**SKILL.md 改了下次请求立刻生效**

**面试话术**：
> *"运营改 Skill 不重启服务——靠 /api/reload 重读配置 + 清 Agent 单例。我们特意做成两阶段原子操作，配置 reload 成功才清缓存，失败回滚。下次请求自然走新 Skill。"*

### 4.7 难点 ④ MCP 多协议客户端（sse / stdio / ws / http）

**场景**：不同外部工具走不同传输协议（HTTP API / 本地 CLI / 长连接）。

**方案**：用 LangChain `MultiServerMCPClient` 统一封装，配置文件声明 4 种传输。

**关键代码**（`app/agent/mcp.py`）：

```python
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.sessions import (
    SSEConnection, StdioConnection, StreamableHttpConnection, WebsocketConnection,
)

async def get_mcp_tools() -> list:
    """初始化 MCP 客户端并返回所有 MCP 工具"""
    connections = {
        name: {
            "sse": SSEConnection,
            "stdio": StdioConnection,
            "websocket": WebsocketConnection,
            "streamable_http": StreamableHttpConnection,
        }[mcp_cfg.transport](transport=mcp_cfg.transport, url=mcp_cfg.url)
        for name, mcp_cfg in settings.cfg.mcp.items()
    }
    client = MultiServerMCPClient(connections)
    return await client.get_tools()
```

**配置**（`configs/config.yml`）：

```yaml
mcp:
  tavily:
    transport: streamable_http
    url: https://mcp.tavily.com/mcp/?tavilyApiKey=${oc.env:TAVILY_API_KEY}
```

**关键设计**：
- MCP 客户端连接**懒加载**（`_build_agent` 调用时才创建）
- 失败重试有 backoff
- **和 insight Skill 加载顺序严格串行**——MCP 失败不让 Agent 启动
- 配置文件声明传输类型，**新增 MCP 服务只需改 yml 不动代码**

**面试话术**：
> *"MCP 是 Anthropic 推的 Model Context Protocol，我们用 MultiServerMCPClient 接外部工具。难点是不同工具走不同协议（HTTP/SSE/WebSocket/stdio），我们配置文件里声明传输类型，懒加载 + 失败 backoff 重试。和 Skill 加载是串行的，避免冲突。"*

### 4.8 难点 ⑤ 协作式取消实现细节

> 这一节是对 §4.2 亮点 ② 的"实现层深挖"，专门讲"为什么 kill 协程不行"。

**完整流程图**：

```
[前端] 点"停止生成" 
    ↓
[WebSocket] 发送 {"type":"cancel"}
    ↓
[_TurnStream._listen_cancel] 收到消息，self.cancel.set()
    ↓ (并行)
[chat_service.run_agent_turn] 下一个 chunk 时检测 cancel.is_set()
    ↓ True
[break] 跳出 async for 循环
    ↓
[优雅退出] await generator.aclose() (LangGraph 内部状态清理)
    ↓
[持久化策略]
  - 已经写库的 message 保留 ✓
  - 没写库的不写 ✓
  - 前端展示时标记"该 message 是中断的"
    ↓
[下一次] 用户再次发消息 → run_agent_turn() 重新启动 Agent
```

**关键设计**：
- **asyncio.Event 协作信号**：不是强制 kill，而是"通知 Agent 你可以停了"
- **listener 独立 task**：`__aenter__` 启动，`__aexit__` 取消，与 Agent 执行**并行**——不阻塞主流程
- **每 chunk 检查一次**：在 `chat_service.run_agent_turn` 的 `async for chunk in _execute_agent(...)` 循环顶部，**最高响应延迟 = 1 个 chunk**（几十毫秒）
- **幂等去重**：靠 `message_id`（DB 主键）幂等；前端发"停止"和"继续"不会因为重发导致重复入库
- **断连兜底**：`stream.send()` 捕获 `WebSocketDisconnect` 同时 set cancel——前端直接关页面也能优雅退出

**对比直接 kill 协程**：

| 维度 | 协作式取消 | 直接 kill |
| --- | --- | --- |
| LangGraph 内部状态 | 干净（aclose 触发清理） | 半提交，可能脏 |
| 数据库事务 | 完整（已 commit 的留着） | 未回滚，可能脏 |
| 前端体验 | 平滑停止，无"半句话" | WebSocket 异常断开 |
| 下次启动 | 正常续上 | 可能重复上一轮内容 |

### 4.9 代码导读：insight-agent 源码树

> 本节是 §二 的"延展"——架构图是"鸟瞰"，这里是"地面导航"。

```
insight-agent/
├── app/                          # 业务代码
│   ├── main.py                   # FastAPI 应用入口（lifespan + 中间件 + 异常 + 路由）
│   ├── init_db.py                # 数据库初始化（建库 + SQL + sqlacodegen）
│   │
│   ├── core/                     # 基础设施（横切关注点）
│   │   ├── settings.py           # .env + config.yml → cfg + reload_config()
│   │   ├── database.py           # SQLAlchemy 异步引擎 + get_db() 依赖
│   │   ├── redis.py              # Redis 异步客户端单例（WS 令牌）
│   │   ├── http_client.py        # httpx 全局单例（调 data-agent / auth）
│   │   ├── context.py            # ContextVar 携带请求级 user_id
│   │   ├── log_setup.py          # loguru：彩色控制台 + JSONL 文件
│   │   ├── middlewares/
│   │   │   ├── auth.py           # Bearer Token 鉴权（→ auth introspection）
│   │   │   └── trace.py          # 注入 request_id / trace_id
│   │   └── exceptions/
│   │       ├── base.py           # ProblemError 基类（RFC 9457）
│   │       └── exc_handlers.py   # 4 个全局异常处理器
│   │
│   ├── entities/chat.py          # ORM：Conversation / Message / ContextCompaction
│   ├── schemas/                  # Pydantic 数据契约
│   │   ├── chat_schema.py        # Message / WebSocket 请求/响应
│   │   └── auth_schema.py        # auth 服务返回结构
│   │
│   ├── repositories/             # Repository Pattern
│   │   ├── conversation_repo.py
│   │   ├── message_repo.py
│   │   ├── context_compaction_repo.py
│   │   └── websocket_token_repo.py  # Redis GETDEL 一次性消费
│   │
│   ├── mappers/message_mapper.py # 三向消息转换（难点 ②）
│   │
│   ├── services/chat_service.py  # 核心服务：load_context + run_agent_turn
│   │
│   ├── agent/
│   │   ├── agent.py              # _build_agent() + get_agent() 单例
│   │   ├── mcp.py                # MultiServerMCPClient（难点 ④）
│   │   └── tools/
│   │       ├── db_query.py       # SSE 调 data-agent + 落 CSV/JSON
│   │       └── return_file.py    # 校验路径后回传 f_path
│   │
│   ├── routers/
│   │   ├── frontend.py           # 静态资源 + SPA 回退 + /auth-api/* 反代
│   │   └── api/
│   │       ├── chat.py           # 对话/消息/WebSocket 路由 + _TurnStream（亮点 ②）
│   │       ├── attachment.py     # 附件上传/下载（_build_attachment_path 防逃逸）
│   │       └── admin.py          # POST /api/reload（难点 ③）
│   │
│   ├── errors/                   # 业务异常
│   │   ├── auth_error.py
│   │   ├── chat_error.py
│   │   └── attachment_error.py
│   │
│   └── plugins/lifespan/init_database.py  # 启动时自动建表
│
├── .deepagents/                  # 工作目录（仓库根）
│   ├── skills/                   # 全局 Skill 目录
│   │   ├── insight/              # ⭐ 归因分析 Skill
│   │   │   ├── SKILL.md          # 归因方法论：基线/多维/异常/HTML 报告
│   │   │   └── scripts/render_report.py  # JSON → 自包含 HTML（ECharts）
│   │   ├── docx/                 # Word 处理 Skill
│   │   ├── pdf/                  # PDF 处理 Skill
│   │   ├── pptx/                 # PPT 处理 Skill
│   │   └── xlsx/                 # Excel 处理 Skill
│   └── workspaces/               # 对话工作区
│       └── user_{user_id}/{conversation_id}/
│           ├── raw/              # db_query 落盘的 CSV/JSON
│           ├── analysis/         # Agent 中间分析
│           └── outputs/          # HTML 报告等
│
├── configs/
│   ├── config.yml                # 应用配置（DB / Redis / 模型 / MCP / auth / 端口）
│   └── .env                      # 敏感信息（不提交 git）
├── sql/mysql/chat.sql            # 建表脚本
├── docker/docker-compose.yaml    # MySQL + Redis
├── pyproject.toml                # uv 依赖管理
└── Makefile                      # 常用命令
```

**关键调用流**（一次完整 WebSocket 消息）：
```
用户 WS 消息
  → [middlewares/trace] 注入 trace_id
  → [middlewares/auth] 调 auth introspection
  → [routers/api/chat] _validate_and_accept (WS 令牌消费)
  → [services/chat_service] load_conversation_context (历史 + 压缩)
  → [services/chat_service] run_agent_turn
    → [agent/agent] get_agent() (单例)
    → [agent/tools/db_query] SSE → data-agent → 落 CSV
    → [mappers/message_mapper] agent_chunk → MessageSchema
    → [repositories/message_repo] 双写 DB + 内存
  → 流式 yield 给 WS
  → 前端实时渲染（text / tool_call / tool_result / HTML）
```

---

## 五、项目周期（按团队规模）

> 📌 **一句话总览**：1 人 ≈ **31 周**（7 个月）/ 2 人 ≈ **17 周**（4 个月）/ 4 人 ≈ **10 周**（2.5 个月）。

### 5.1 工作量基线（**单位：人·周**）

> 1 人 1 周 = 1 个全职开发干 5 个工作日；下面所有数字 = 单人完成该模块所需的工作量（人·周），不是日历周。
> 例如 insight-agent 标 13，意思是"1 个人干 13 周"；如果 2 人并行，理论日历周 ≈ 13/2 ≈ 7 周（具体见 §5.2 三种团队方案）。

| 模块 | 准备（人·周） | 开工/核心开发（人·周） | 测试上线（人·周） | **小计（人·周）** | 关键里程碑 |
| --- | --- | --- | --- | --- | --- |
| **🗃️ dbmock** | 1 | 2 | 1 | **4** | 数仓 L1~L5 五层模型 + 订单状态机跑通 |
| **🔐 auth** | 1 | 3 | 1 | **5** | OAuth2 + PKCE 登录 / 注销 / 内省接口贯通 |
| **📊 data-agent** | 1 | 4 | 2 | **7** | NL2SQL 主链路（自然语言 → SQL → 数仓 → 表格）端到端 |
| **🧠 insight-agent** | 2 | 8 | 3 | **13** | deepagents + Skill + 工作区 + WebSocket 流式 + HTML 报告 |
| **🔗 联调 / 端到端** | — | — | 2 | **2** | 4 模块拼装 + 真实业务场景回归 |
| **合计（人·周）** | **5** | **17** | **9** | **31** | |

**模块依赖关系（决定并行上限）**：
```
dbmock ──┐
         ├──→ data-agent ──┐
auth  ──┤                  ├──→ insight-agent ──→ 联调上线
         └──→ (auth 也独立运行) ┘
```

> 关键路径：**dbmock → data-agent → insight-agent → 联调**（这条不能并行压缩）；auth 可与 dbmock 并行；联调必须最后串行。

### 5.2 三种团队方案

> 下面所有"周"均为**日历周**（不是 §5.1 的人·周）；团队方案是把基线工作量按团队规模并行后的实际工期。

#### 版本 A：1 人全栈（约 31 周 / 7 个月）

| 阶段 | 时间窗 | 做的事 |
| --- | --- | --- |
| **第 1 周** | 准备 | 整体技术选型确认、运行环境（Python/Node/MySQL/Redis）、LLM API 申请、demo 数据预演 |
| **第 2~5 周** | dbmock | 4 周：电商 5 层数仓建模 + 订单状态机 + 促销峰 + 1k~3k 用户模拟 |
| **第 6~10 周** | auth | 5 周：OAuth2 + PKCE + 前端登录页 + 内省接口 |
| **第 11~17 周** | data-agent | 7 周：NL2SQL prompt 工程 + Schema 召回 + SQL 校验 + 评测集 |
| **第 18~30 周** | insight-agent | 13 周：deepagents 集成 + insight Skill + 工作区 + WebSocket 流式 + HTML 报告 |
| **第 31 周** | 联调上线 | 2 周：4 模块拼装 + 6 大业务场景端到端回归 + 部署文档 |

**风险点**：单点故障，需求变更/生病/项目中断都会让周期翻倍。**建议至少留 20% buffer**（即真实工期 ≈ 37 周）。

#### 版本 B：2 人小团队（约 17 周 / 4 个月）

> 1 后端 + 1 全栈/LLM 应用开发。**dbmock + auth 并行**开。

| 时间窗 | 关键动作 | 备注 |
| --- | --- | --- |
| **第 1 周** | 两人对齐：模块切分 / 接口契约 / 协作节奏 | **准备** |
| **第 2~5 周** | **A：dbmock（4 周）** + **B：auth（5 周）** | **并行**，关键路径取长 = 5 周 |
| **第 6~12 周** | **A：data-agent（7 周）** + **B：insight-agent 前期（5 周，先做 deepagents 框架 + Skill 骨架）** | 关键路径 = 7 周 |
| **第 13~17 周** | **A：insight-agent 后 8 周** + **B：联调 + 业务回归（5 周）** | 关键路径 = 8 周 |

**关键路径合计**：1 + 5 + 7 + 8 = **约 21 周**（含前后交接）；通过紧密协作压到 **17 周**（要求接口先冻结、mock 数据先到位）。

**风险点**：人员分工不能频繁切换；联调期容易卡接口（前期一定要把 SSE/Redis token/工作区路径这些**横切接口**先确定）。

#### 版本 C：4 人中团队（约 10 周 / 2.5 个月）

> 后端 / 前端 / LLM 应用 / 测试 各 1 人。

| 时间窗 | 后端 | 前端 | LLM 应用 | 测试 | 关键路径 |
| --- | --- | --- | --- | --- | --- |
| **第 1 周** | 接口契约 / 鉴权方案 | UI 设计稿 / 路由规划 | Skill 选型 / Prompt 草稿 | 评测集 / 测试用例 | 准备（5 → 1 周 = 全员并行） |
| **第 2~3 周** | **dbmock** + auth 后端 | auth 前端 + 设计系统 | 跑通 deepagents 框架 demo | 自动化测试框架搭好 | dbmock 2 周 |
| **第 4~6 周** | data-agent 后端 | insight-agent 前端骨架 | **data-agent** 业务逻辑 | NL2SQL 评测集回归 | data-agent 3 周 |
| **第 7~10 周** | insight-agent 后端 | **insight-agent 前端** 流式 UI | **insight-agent** Agent 逻辑 + Skill | E2E / 压测 / 回归 | insight-agent 4 周 |
| **第 11 周** | 部署 / 监控 / 告警 | 上线演练 | 报告模板调优 | 业务场景回归 | 联调 1 周（压缩） |

**关键路径合计**：1 + 2 + 3 + 4 + 1 = **约 11 周**；通过前端设计先行 / 后端接口 mock 等手段压到 **10 周**。

**风险点**：沟通成本上升（4 人 vs 2 人会议时长翻倍），要立刻立 **每日站会 + 每周演示** 的节奏。

### 5.3 方案对比与选择

| 维度 | 1 人全栈 | 2 人小团队 | 4 人中团队 |
| --- | --- | --- | --- |
| **日历周** | ~31 周（7 个月） | ~17 周（4 个月） | ~10 周（2.5 个月） |
| **人力成本** | 1× | 2× | 4× |
| **总人周** | 31 | 34 | 40 |
| **适合场景** | 学习 / 复刻 / 个人副业 | 中小公司 MVP / 教研项目 | 商业交付 / 投标 demo |
| **风险** | 单点故障 / 周期翻倍 | 接口冻结不到位会卡 | 沟通成本上升 |
| **buffer 建议** | +20~30% | +15~20% | +10~15% |

> 💡 **怎么选**：
> - 给同学讲、跑通流程 → **版本 A**（重点是路径讲清楚，不是赶时间）
> - 教研项目 / 内部 MVP → **版本 B**（性价比最高）
> - 商业交付 / 投标 demo → **版本 C**（并行最充分）
>
> 上面所有数字都是**乐观估计**，实际项目要加 buffer。如果只是讲思路、不是真排期，**直接说"按 2 人小团队 17 周"是大多数场景下的安全默认**。

---

## 六、项目结合：与现有项目组合

> 📐 完整架构总览（含 4 模块调用关系）：[docs/diagrams/architecture.html](docs/diagrams/architecture.html)

归因分析系统**不是独立产品**，而是**业务分析中台的核心引擎**。它可以和各种上下游 AI 应用组合，放大各自价值。

### 6.1 与现有项目的组合（电商场景）

#### 🛒 智能电商客服（面向 B 端商家 — 淘宝商家版风格）

> **本节主要面向 B 端商家**，类似淘宝商家版、京东商家中心、抖店商家工作台这种"商家端 AI 助理"的形态。

**B 端客服（商家助手）的痛点**：

- 商家每天要处理大量运营问题："为什么我店铺流量跌了？"、"这个品要不要补货？"、"ROI 怎么算？"、"广告费花这么多值不值？"
- 这些问题**本质就是经营诊断 + 归因分析**，但传统商家工作台只是"看板"——告诉你"指标是多少"，不解释"为什么"
- 商家要么自己学 SQL（不可能），要么找店铺运营（贵 + 慢），要么放弃

**和本系统的结合**：
- **商家**：直接在对话窗口问"我上个月 GMV 跌了 20%，怎么回事？"
- **客服 Agent（商家助手）**：自动调度 → 调归因分析 Agent
- **归因分析 Agent**：多维拆解 → 给出可落地的报告
- **商家**：看到"渠道 A 跌 8% + 品类 B 跌 5% + 退款率上升吃掉 7% 毛利" + 具体建议

> 简单说：**把分析师/店长从"被商家问住"中解放出来，让 AI 成为商家的 24h 数据助理**。

#### 📊 掌柜问数（NL2SQL 系统 = 本项目 data-agent）

**掌柜问数的定位**：面向商家店长的自然语言查数工具，专注"取数"动作。

**和本系统的关系**：
- **本项目的 `data-agent` 就是"掌柜问数"迁移过来的**——`db_query` 工具内部就是调用它
- `data-agent` 负责"取数"，`insight-agent`（含 Skill + Agent 推理）负责"归因"
- 两者是**上游-下游关系**：归因分析要先取到数，才能拆解

**对比**：

| 维度 | 掌柜问数（data-agent） | 归因分析（insight-agent） |
| --- | --- | --- |
| 目标 | 给你一个数字 | 解释一个现象 |
| 输出 | 单值/单表 | 多维拆解 + 报告 + 建议 |
| 技能要求 | 会写 SQL/有 schema 知识 | 业务理解 + 因果推理 |
| Agent 能力 | 1 步（text→SQL） | 多步（取数 + 拆解 + 异常 + 报告） |
| 调用方 | 商家直接调 / 归因 Agent 间接调 | 主要被商家助手/客服系统调度 |

#### 📚 掌柜智库（RAG 系统）

**掌柜智库的定位**：商家知识库问答，"新品怎么上架"、"广告法禁用词有哪些"、"运费模板怎么配置"。

**怎么结合**：
- 掌柜智库回答"是什么/怎么做"（知识查询）
- 归因分析回答"为什么/怎么办"（数据诊断）
- 商家助手同时调度两者：商家问"为什么 GMV 跌了"先调智库匹配方法论，再调归因做实证

#### 📢 舆情分析

**舆情分析的定位**：监控商品/品牌的外部评论、社交媒体、口碑。

**怎么结合**：

- 舆情分析发现"差评变多、口碑变差"
- 归因分析拆解"差评来自哪个 SKU、哪个时间、哪类人群"
- 两者结合形成**"外部信号 → 内部数据归因"**的完整闭环

### 6.2 跨行业结合案例

归因分析的"取数 + 拆解 + 报告"模式是**通用方法论**，不限于电商：

#### 🏦 金融：信用卡风控归因

**场景**：某行信用卡不良率突然上升 0.5%。

**结合方式**：

- 掌柜问数（data-agent） → 拉各分行、各客群、各产品的逾期率（快速取数）
- 归因分析 → 拆解：分客群（新客 vs 老客）？分产品（白金 vs 普卡）？分时间（年初集中爆发还是渐进）？分渠道（线上申请 vs 线下）？
- 掌柜智库 → 调出对应风控政策文档，给出"该调哪条规则"建议
- 舆情分析 → 同期是否有外部事件（监管政策、行业风险）

**产出**：一份"**不良率上升 0.5% 的根因拆解 + 政策调整建议**"报告。

#### 🏥 医疗：门诊量下滑归因

**场景**：某三甲医院 5 月门诊量同比下滑 15%。

**结合方式**：

- 掌柜问数（data-agent） → 拉各科室、各医生、各时段的门诊量
- 归因分析 → 拆解：是哪个科室跌（内科 vs 外科）？是哪个医生？是季节因素（5 月假期）？是挂号渠道（线上 vs 线下）？是政策（医保结算调整）？
- 掌柜智库 → 调出医院管理运营标准，给出"门诊量恢复"的方法论
- 舆情分析 → 同期是否有关于医院的负面新闻

**产出**：一份"**门诊量下滑的多维根因 + 运营调整建议**"报告。

#### 🎓 教育：课程续报率归因

**场景**：某 K12 教培公司 Q2 续报率从 60% 跌到 45%。

**结合方式**：
- 掌柜问数（data-agent） → 拉各课程、各年级、各班主任、各渠道的续报率
- 归因分析 → 拆解：是哪个课程（数学 vs 英语）？哪个年级（高三 vs 高一）？是班主任带班质量？是续费优惠力度不够？是家长端舆情（双减政策）？
- 掌柜智库 → 调出"续报率提升方法论"白皮书
- 舆情分析 → 同期家长群/小红书/微博上的讨论

**产出**：一份"**续报率下滑归因 + 续报策略调整方案**"报告。

> 📌 **跨行业模式总结**：
> 任何"**结果指标 + 多维数据 + 业务可干预**"的场景都适合——金融/医疗/教育/电信/物流/餐饮……都能套用。

### 6.3 重点展开：与"商家端 AI 客服（淘宝商家版风格）"的深度结合

> 这一节讲的是**面向 B 端商家**的 AI 客服系统，类似"淘宝商家版 / 千牛 / 京东商家助手 / 抖店商家工作台"的 AI 助理入口。
> 商家在日常工作台里通过对话完成"查数 + 经营诊断 + 操作建议"，**本系统的归因分析 Agent 是这个工作台的核心分析引擎**。

#### 6.3.0 核心原则：归因为主，问数为辅

> 💡 **重要逻辑**：归因分析（`insight-agent`）里会调用 `db_query` 工具，**`db_query` 内部走 SSE 到问数系统（`data-agent`）取数**。
> 所以：**问数系统是"工具"，归因分析才是"主入口"**。

| 商家问的 | 走哪条 | 原因 |
| --- | --- | --- |
| "**为什么** GMV 跌了？" | **归因分析**（insight-agent） | 90% 的商家问题都是"为什么"型，先归因 |
| "**是多少** GMV？" | **直接问数**（data-agent / db_query） | 仅"查个数"问题直达问数 |
| "**怎么操作** 改价？" | 商家工作台原生 API | 走操作类 |
| "**怎么理解** 广告法？" | 智库 RAG | 走知识类 |
| "**怎么投诉** 差评？" | 工单系统 | 走流程类 |

**归因分析的执行过程**：
1. 用户提问 → AI 调度层识别 → **进入归因分析 Agent**（优先级最高）
2. Agent 加载 insight Skill → 按工作流推进
3. 过程中需要数据 → **调 `db_query` 工具**（调 data-agent）→ 取数落工作区
4. 多维拆解、识别异常 → 输出 HTML 报告
5. 报告触发"一键操作"（工作台 API）和"自动发券"（工单系统）

#### 6.3.1 整体架构：商家工作台 + AI 调度

> **👉 [点击这里在浏览器中查看可缩放的大图 →](docs/diagrams/merchant-workflow.html)**
>
> 架构图核心：
> - 商家工作台（淘宝商家版风格）作为入口，店长/运营/老板/客服主管使用
> - AI 调度层按优先级路由：**归因分析 > 直接问数 > 智库/操作/工单**
> - **归因分析（`insight-agent`）是核心引擎**，执行过程中**反向调 `db_query` 工具**（→ 问数系统 `data-agent`）取数
> - 共享 `dbmock` 数仓和 `auth` 鉴权

#### 6.3.2 4 种典型商家对话流程

> 📖 **本节术语速读**（首次出现，后续不再重复）：
> - **GMV**：一定时间内的总成交金额（含未付款）
> - **ROI**：投资回报率 = 收益 / 成本
> - **CTR**：点击率 = 点击数 / 曝光数
> - **CVR**：转化率 = 下单数 / 点击数
> - **退款率**：退款订单占总订单的比例
> - **SKU**：商品的库存单元（具体规格，如颜色/尺码）

**流程 1：商家咨询"GMV 下滑原因"（最常见，90% 都走这条）**

```
商家：最近一周我店铺 GMV 跌了 30%，怎么回事？
       │
       ▼
【AI 调度层】意图识别 → 经营诊断类（"为什么"型）
       │
       └─→ 按优先级调度：归因分析（最高优先级）
              │
              ▼
       【归因分析 Agent】（本项目核心）
              │
              ├─ insight Skill 加载（"进入归因分析模式"）
              │
              ├─ 多轮调 db_query 工具（→ data-agent SSE → 数仓）取数
              │   ① 各渠道（自然 / 付费 / APP / PC / 小程序）GMV
              │   ② 各品类（服饰 / 美妆 / 数码）销量
              │   ③ 各价格段趋势
              │   ④ 各活动周期 ROI
              │
              ├─ 拆解：识别出"抖音渠道 6/12 起 GMV -50%"是主因
              ├─ 进一步：定位到该渠道某达人合约到期未续
              └─ 输出 HTML 报告
                     │
                     ▼
       AI 调度层接收报告 → 拆成两部分
              │
              ├─ 商家端：完整报告 + 图表 + "建议动作"按钮
              │   "点击一键：联系该达人续约 / 启动备用达人"
              │
              └─ AI 助理话术：给商家一段总结
                     "主要是抖音达人 X 到期，贡献了 80% 的下滑。
                      建议立即联系续约，或启动备用达人 Y。"
```

> 💡 **注意**：商家一开始问的就是"为什么"——**直接进归因**，归因过程中才反向调 `db_query` 取数。不是"先问数再归因"。

**流程 2：商家问"商品选品"（决策类，仍走归因）**

```
商家：618 我要主推哪个品类？备货多少？
       │
       ▼
【AI 调度层】意图识别 → 经营决策类（"怎么选"型 → 走归因）
       │
       └─→ 按优先级调度：归因分析
              │
              ▼
       【归因分析 Agent】
              │
              ├─ db_query 拉历史数据
              │   - 去年 618 各品类 GMV、毛利、退款率
              │   - 各品类去年 618 同比增速
              │   - 当前各品类库存周转
              │
              ├─ 拆解：
              │   - 增长品类：美妆 +40%（高毛利、低退款）
              │   - 稳定品类：服饰 +5%
              │   - 下滑品类：数码 -15%（高退款率）
              │
              ├─ 异常识别：数码品类退款率从 8% 涨到 15%
              │   进一步拆：集中在"笔记本电脑"子类（高单价、退货成本高）
              │
              └─ 输出：选品建议报告
                     │
              ├─ 商家端：建议表 + 备货量
              │   "主推：美妆 50%（高增长高毛利）"
              │   "维持：服饰 30%"
              │   "收缩：数码 15%（规避高退款品类）"
              │   "新拓：宠物用品 5%（高潜）"
              │
              └─ "一键备货"按钮：自动生成备货清单（调用工作台原生 API）
```

**流程 3：商家问"广告费值不值"（投放优化，仍走归因）**

```
商家：我上个月直通车花了 10 万，值不值？要不要继续？
       │
       ▼
【AI 调度层】意图识别 → 投放优化类（"值不值"型 → 走归因）
       │
       └─→ 按优先级调度：归因分析
              │
              ▼
       【归因分析 Agent】
              │
              ├─ db_query 拉投放数据
              │   - 直通车花费 / GMV / ROI
              │   - 各关键词的 ROI
              │   - 付费 vs 自然流量结构
              │
              ├─ 拆解：
              │   - 整体 ROI = 2.5（10 万 → 25 万 GMV）
              │   - 80% 的花费集中在 20% 的关键词上
              │   - 高 ROI 词（>5）：3 个
              │   - 低 ROI 词（<1）：8 个（"连衣裙 长款"等）
              │
              ├─ 识别异常：
              │   - 8 个低 ROI 词里，"防晒衣 2026" 这种长尾词 CTR 5% 但 CVR 0.5%
              │   进一步拆：详情页的"防晒衣"主图仍是去年的（季节错位）
              │
              └─ 输出：投放优化报告
                     │
              ├─ 商家端：优化建议 + 一键操作
              │   "立即停掉 8 个低 ROI 关键词"
              │   "把预算加到 3 个高 ROI 词"
              │   "更换防晒衣主图（季节性）"
              │
              └─ "一键应用"按钮：自动改投放计划
```

**流程 4：商家处理"差评危机"（危机处理，先归因后开单）**

```
商家：差评突然变多，怎么办？
       │
       ▼
【AI 调度层】意图识别 → 危机处理类（"为什么变多"→ 走归因）
       │
       └─→ 按优先级调度：归因分析
              │
              ▼
       【归因分析 Agent】
              │
              ├─ db_query 拉评价数据
              │   - 差评率从 5% 涨到 12%
              │   - 差评关键词分布
              │
              ├─ 拆解：
              │   - 集中爆发在 6/15-6/18 三天
              │   - 高频差评词："包装破损" "物流慢"
              │   - 涉及 SKU：3 个新品（美妆类目）
              │
              ├─ 交叉分析：同期物流商从顺丰换中通
              │
              └─ 输出：差评归因报告
                     │
              ├─ 商家端：根因 + 建议
              │   "差评主因是物流商更换（顺丰→中通）"
              │   "建议临时换回顺丰 / 联系中通索赔"
              │   "对受影响的 1000+ 用户主动发 50 元券"
              │
              ├─ "一键补偿"按钮：自动发券（调用工作台原生 API）
              └─ 自动开工单：客服跟进（调用工单系统）
```

**流程 5：商家问"上个月 GMV 多少"（10% 的"是多少"问题）**

```
商家：上个月我店铺 GMV 多少？
       │
       ▼
【AI 调度层】意图识别 → 查数类（"是多少"型 → 直走问数，**不进归因**）
       │
       └─→ 按优先级调度：直接问数
              │
              ▼
       【问数系统】（data-agent）
              │
              ├─ 调 db_query（→ SSE → data-agent）
              ├─ NL2SQL: SELECT SUM(paid_amount) FROM dwd_fact_trade_order_detail_di ...
              ├─ 查数仓 → 返回单值
              └─ 秒级返回："您上个月 GMV 是 285 万元"
```

#### 6.3.3 5 个关键技术衔接点

| 衔接点 | 怎么对接 |
| --- | --- |
| **鉴权复用** | 复用本项目的 `auth` 统一认证，商家工作台和归因系统共用 OAuth2，商家一次登录全平台通行 |
| **意图路由** | AI 调度层**默认进归因分析**（除非明确"是多少"型问题才走直接问数）；识别意图后调本系统的 `agent.astream`，把会话 ID / 店铺 ID 透传 |
| **数据复用** | 共用 `dbmock` 数仓（业务数据共享）+ 商家工作台原生操作（改价、改库存）直接改 MySQL，归因 Agent 实时查最新数据 |
| **报告格式** | 归因 Agent 输出 HTML 报告，商家工作台**嵌入 iframe** 或转 H5；同时支持"复制话术"给 AI 助理讲给商家听 |
| **审计追溯** | 商家对话与归因分析共用 `auth.user_id`，**所有 AI 建议都可追溯到具体商家、具体操作、具体时间** |

#### 6.3.4 价值闭环

```
商家提问 (B 端)
   ↓ AI 调度（归因为主，问数为辅）
归因分析 (本项目 · 90% 入口)
   ├─→ 反向调 db_query → data-agent 取数（工具调用）
   ├─→ 调智库 RAG 匹配方法论
   └─→ 输出 HTML 报告
   ↓ 报告中的"建议动作"
商家工作台原生 API（改价 / 发券 / 改投放）
+
工单系统（差评危机 / 物流索赔等）
   ↓ 落地
提升 GMV / 减少退款 / 优化投放 / 提升满意度
   ↓ 反哺
商家行为数据回流 → 训练更好的 AI 助理
```

#### 6.3.5 不变 vs 变

**不变**：归因分析系统的核心能力（deepagents + insight Skill + 工作区 + 工具链）完全独立可用，**不需要为了接入商家工作台而改架构**。

**变（接入层）**：
- 商家工作台加一个**AI 调度层**，根据意图分发到归因 Agent / 问数 / 智库
- 报告渲染支持**嵌入工作台**（iframe / 移动端 H5）
- 鉴权打通（共用 `auth` 服务，商家一次登录）
- "一键操作"按钮：归因报告里的建议直接调用商家工作台的原生 API（改价、发券等）

> 一句话：**归因分析系统是"业务分析中台引擎"，商家工作台是"AI 调度前端"**——前者专心做分析，后者专心做商家交互和操作闭环。

---

## 七、面试要点汇总

### 7.1 三大亮点开场

> 面试官 90% 会问"这个项目最大的亮点是什么"——准备 3 个能压住场子的点。

| # | 亮点 | 一句话讲法 | 对应代码/章节 |
| --- | --- | --- | --- |
| **①** | **deepagents + Skill 工作区模式** | 不是"调一次 LLM 拿到结果"，而是"加载归因 Skill → 进入工作区 → 多步工具调用 → 落盘 CSV → 渲染 HTML 报告"的全流程 | `app/services/chat_service.py` 的 `run_agent_turn`、§4.1 |
| **②** | **WebSocket 流式推送 + 协作式取消** | 用 FastAPI WebSocket + LangGraph `astream` + `_TurnStream` 实现逐 token 推送，用户点"停止"用 `asyncio.Event` 协作式取消，不脏数据 | `app/routers/api/chat.py` 的 `_TurnStream`、§4.2 / §4.8 |
| **③** | **归因 = 问数 + 推理** 的清晰分层 | insight-agent 调 `db_query` 工具（→ data-agent SSE）取数，自己负责多维拆解、异常识别、报告生成；解耦后可独立替换 NL2SQL 服务 | `app/agent/tools/db_query.py`、§4.3 |

> 💡 **面试加分项**：能说出"为什么选 deepagents 而不是 LangChain AgentExecutor / 直接调 OpenAI Function Calling"——理由是 deepagents 内置工作区后端 + 中间件机制，天然适合"多步取数 + 中间产物落盘"场景。

### 7.2 五大难点深入

> 这 5 个都是真实代码里"踩过坑"的实现，面试官追问细节时能直接说"看哪个文件哪一行"。

| # | 难点 | 关键设计 | 代码定位 |
| --- | --- | --- | --- |
| **①** | **长对话上下文管理** | L2 `SummarizationMiddleware` + `seq_offset` 换算 + 摘要持久化到 `ContextCompaction` 表 | `chat_service.py:_extract_compaction` + `context_compaction_repo.py` |
| **②** | **三向消息转换** | Entity ↔ Schema ↔ LangChain Message 4 个纯函数收一个文件，单测 100% | `app/mappers/message_mapper.py` |
| **③** | **动态 Skill 热更新** | `POST /api/reload` + `reload_config()` + `reset_agent()`，双检查锁单例 | `app/routers/api/admin.py` + `app/agent/agent.py` |
| **④** | **MCP 多协议客户端** | `MultiServerMCPClient` 配置文件声明 sse/stdio/ws/streamable_http 四种传输，懒加载 | `app/agent/mcp.py` |
| **⑤** | **协作式取消** | `asyncio.Event` 信号 + `_TurnStream` 独立 task 监听，每 chunk 检查 + `generator.aclose()` 优雅退出 | `app/routers/api/chat.py` 的 `_TurnStream` |

每条的完整面试话术见 §4.4 / §4.5 / §4.6 / §4.7 / §4.8。

### 7.3 八大技术栈

| 类别 | 技术 | 用途 | 关键文件 |
| --- | --- | --- | --- |
| **Web 框架** | FastAPI | REST + WebSocket + 依赖注入 | `app/main.py` |
| **Agent 框架** | deepagents + LangGraph | 多步 Agent 编排 + 工作区后端 | `app/agent/agent.py` |
| **LLM 接入** | LangChain ChatModel | 多模型适配（GPT/Claude/国产） | `app/core/settings.py` |
| **ORM** | SQLAlchemy 2.x 异步 | 异步数据库访问 | `app/core/database.py` |
| **DB** | MySQL | 对话/消息/压缩记录持久化 | `app/entities/chat.py` |
| **缓存/令牌** | Redis | WebSocket 临时令牌（GETDEL 消费） | `app/repositories/websocket_token_repo.py` |
| **HTTP 客户端** | httpx 异步单例 | 调 auth / data-agent | `app/core/http_client.py` |
| **MCP** | MultiServerMCPClient | 4 种传输协议外部工具 | `app/agent/mcp.py` |
| **前端** | React + Vite + TS | 流式渲染 + WebSocket 客户端 | `web/` |
| **可观测** | loguru | JSONL 日志 + 链路 trace_id | `app/core/log_setup.py` |

### 7.4 八道常问问题

> 整理自大模型应用开发岗 / Agent 工程师岗的真实面试题，按出现频率排序。

#### Q1：为什么选 deepagents 而不是 LangChain AgentExecutor / 直接 Function Calling？

**参考答案**：
- AgentExecutor 太"扁"，没有工作区概念；多步取数 + 中间产物落盘 + 用户后续查看产物，它搞不定
- 纯 Function Calling 每一步都要手写 OpenAI API，状态管理、tool 路由、历史消息维护全是手写
- deepagents 提供 `LocalShellBackend` / 自定义后端，天然支持"工作区 = 落盘目录"；中间产物（CSV/JSON）直接落给后续工具用
- 还有 `SummarizationMiddleware` 等中间件机制，长对话压缩开箱即用

#### Q2：归因分析和你直接用 LangChain 写个 Agent 比，有什么本质区别？

**参考答案**：
- 归因分析**不是 LLM 问题**，是"取数 + 多维拆解 + 异常识别 + 报告生成"的业务流程，LLM 只是其中一环
- insight-agent 把流程拆成 5 步：加载 Skill → 多步 `db_query` 取数 → 落 CSV 到工作区 → 多维拆解 → 调 `render_report` 生成 HTML
- 每一步都有**可追溯的中间产物**，错了能定位到具体一步；纯 Agent 黑盒跑一遍，错在哪都不知道
- 业务流程沉淀在 `insight/SKILL.md` 里，运营可改；纯 Agent 改 prompt 又得重新跑

#### Q3：怎么防止 LLM 幻觉 / 编造 SQL / 答错业务事实？

**参考答案**（这是高频追问）：
- **数据查询层**：data-agent 有 Schema 召回 + SQL 校验，不在白名单的表直接拒答
- **归因层**：SQL 必须先调 `db_query` 真跑，**不允许 LLM 直接报数**；所有指标数字有 CSV 落盘证据
- **结论层**：业务结论必须基于多维拆解结果，不允许"我猜"
- **人工兜底**：所有报告生成后走一遍"小流量灰度"，运营先看一遍

#### Q4：WebSocket 流式 + 用户取消怎么做的？为什么不直接 kill 协程？

**参考答案**（必问）：
- 用 `asyncio.Event` 作取消信号，`_TurnStream` 包 LangGraph `astream`
- 每推一个 chunk 检查一次 Event，触发了就 `await generator.aclose()` 优雅退出
- **不能 kill 协程的原因**：kill 会导致 LangGraph 内部状态半提交 + 数据库事务未回滚，下次同会话继续会出现"上一轮说到一半的内容"
- 取消后**已经持久化的 message 保留**，靠 message_id 幂等去重；前端展示时标记"该 message 是中断的"

#### Q5：长对话上下文超限怎么处理？

**参考答案**：
- L1：滑动窗口（只保留最近 N 轮）—— 简单但丢信息
- L2：`SummarizationMiddleware` 自动摘要（**我们用的**）—— 保留语义，丢细节
- L3：知识图谱 / RAG —— 重，成本高
- 选 L2 的理由：归因分析每一步都要历史对话做"上下文关联"，摘要能保留"之前问过什么、结论是什么"，丢了细节不影响后续追问

#### Q6：MCP 是什么？为什么用 MCP？

**参考答案**：
- MCP（Model Context Protocol）是 Anthropic 推的"工具接入标准协议"，类似 LSP（Language Server Protocol）之于编辑器
- 用 MCP 的好处：外部工具一次开发、多 Agent 复用；不用每个 Agent 自己接
- 我们用 `MultiServerMCPClient` 统一接 HTTP/SSE/WebSocket/stdio 四种传输，配置声明式
- 难点是不同协议连接生命周期管理 + 失败重试 backoff

#### Q7：这个项目怎么部署的？怎么保证可用性？

**参考答案**：
- Docker Compose：4 个服务（auth / data-agent / dbmock / insight-agent）+ MySQL + Redis
- insight-agent 多实例部署，前端用 Nginx 负载均衡
- WebSocket 长连接走 sticky session（基于 `user_id` 哈希）
- 配置热更新：`POST /api/reload` 不重启
- 可观测：loguru JSONL 日志 + trace_id 链路 + Prometheus 指标（业务自定义）

#### Q8：如果让你重做一遍这个项目，你会改什么？

**参考答案**（面试官考察反思能力）：

- 用 **LangGraph 的 checkpointer** 替代当前的"手动管理 conversation_id + message 列表"——更标准
- 归因 Skill 改成 **声明式 DAG**（类似 DAGster），让运营能可视化编排流程，而不是写一堆 prompt
- 加 **observability**（LangSmith / Phoenix），把 LangGraph 内部的 token 用量、tool 调用时长全打点
- `db_query` 改成 **异步回调**而不是 SSE 长连接（性能更好，但实现复杂）

### 7.5 90 秒自我介绍模板

> 面试自我介绍环节 90 秒版本。按"业务 → 技术 → 数据 → 亮点"四段式结构。

> ---
>
> **【业务背景 · 15 秒】**
> 这个项目叫"归因分析平台"，解决的是电商场景里**指标异常时快速定位根因**的问题。比如 GMV 突然跌 20%，商家要快速知道是哪个渠道、哪个品类、哪个价格段出了问题——传统做法是数据分析师写 SQL + 做报表，慢且贵。
>
> **【解决方案 · 25 秒】**
> 我们做了一个对话式归因分析产品，商家直接问"我店铺 6 月 GMV 为什么跌"，Agent 自动调工具取数 + 多维拆解 + 产出 HTML 报告。整个流程不需要人参与，30 秒出结果。报告里每个数字都能追溯到具体的 SQL 和 CSV 落盘文件，错了能定位到哪一步。
>
> **【技术架构 · 30 秒】**
> 4 大模块：auth 统一认证、data-agent 负责 NL2SQL 取数、dbmock 模拟电商数仓、insight-agent 是核心。insight-agent 用 deepagents + LangGraph 框架，关键设计包括 WebSocket 流式推送 + 协作式取消、长对话上下文自动摘要、三层消息格式转换、Skill 动态热更新。
>
> **【亮点 + 数据 · 20 秒】**
> 核心亮点是"归因 = 问数 + 推理"的清晰分层——取数和推理解耦，可独立替换 NL2SQL 服务。整套系统在 2 人小团队下 4 个月落地（按 §5.2 估算），支持业务场景的 6 个电商典型场景（产品目录优化、客户行为分析、智能库存、评论反馈、市场表现、退款模式）。
>
> ---

**📌 自我介绍后必被追问的点**（提前准备）：
1. "具体怎么做的归因？" → 答 insight Skill 工作流（取数 → 拆解 → 异常 → 报告）
2. "为什么用 deepagents？" → 答 Q1
3. "WebSocket 怎么取消？" → 答 Q4
4. "怎么防幻觉？" → 答 Q3
5. "如果你重做怎么改？" → 答 Q8

---

## 八、小结

| 你想知道 | 看哪里 |
| --- | --- |
| 术语看不懂（GMV/DAU/SKU/ROI…） | §零"术语速查" |
| 归因分析是什么、为什么用电商 | §一 |
| 项目架构和模块关系 | §二（含 4 模块架构图） |
| 6 大电商场景的具体分析例子 | §三（重点 ①④⑤） |
| **3 大亮点** | §四.1 ~ §四.3 |
| **5 大难点** | §四.4 ~ §四.8 |
| 源码树（每个文件干嘛） | §四.9 |
| 项目周期（按团队规模） | §五（1 人 31 周 / 2 人 17 周 / 4 人 10 周） |
| 与现有项目结合（电商场景 + 跨行业） | §六 |
| 商家版客服场景的深度结合 | §六.3（重点） |
| 面试常问问题（带参考答案） | §七.4（Q1 ~ Q8） |
| 90 秒自我介绍模板 | §七.5 |

> 📌 **一句话总结这个项目**：
> 归因分析是"业务指标异常时拆解根因"的方法论，电商场景是天然的最佳落地战场；本项目把这个方法论产品化（LLM Agent + Skill + 工作区 + 协作式取消 + 三向消息转换），既可以独立使用，也可以作为业务分析中台引擎。**`data-agent` 就是问数系统（db_query）的服务端实现**——归因分析 = 问数 + 推理，两者是"上游-下游"关系。在面向 B 端商家的客服系统（淘宝商家版风格）里，本系统作为"经营诊断引擎"被调度，让每个商家都能拥有 24h AI 数据助理。
