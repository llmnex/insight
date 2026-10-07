# insight-agent Quick Start（Windows）

> 目标：在一台 Windows 电脑上，从零把 `insight-agent` 跑起来并完成一次归因分析。
> 适用仓库：`insight-agent` + `auth` + `data-agent` + `dbmock` 四模块联调。

---

## 0. TL;DR（最短路径）

```powershell
# ① 基础设施（MySQL + Redis + Qdrant + Elasticsearch）
#    ⚠️ 必须是 data-agent\docker；insight-agent\docker 那份只有 MySQL + Redis
cd G:\tearcher_code\insight\data-agent\docker
docker compose up -d

# ② 业务数据（~10w 订单，耗时几分钟）
cd G:\tearcher_code\insight\dbmock
uv sync
uv run core/init_db.py
uv run -m core.generators.main

# ③ data-agent 元数据（表/列/指标 向量化，依赖 ② 的数据）
cd G:\tearcher_code\insight\data-agent
uv sync
uv run -m app.scripts.init_db
uv run -m app.scripts.build_meta_knowledge -c conf/meta_config.yaml

# ④ 三个服务（各开一个终端）
cd G:\tearcher_code\insight\auth
uv sync
uv run -m app.main     # :7100
cd G:\tearcher_code\insight\data-agent
uv run main.py                  # :8000
cd G:\tearcher_code\insight\insight-agent 
uv sync
uv run app/init_db.py
uv run -m app.main   # :7300
```

浏览器打开 **http://localhost:7300** ，用 `admin@123.com` / `123123` 登录。

---

## 1. 环境要求

| 项 | 要求 | 说明 |
|---|---|---|
| OS | Windows 10/11 | — |
| Python | 3.12（`uv` 会自动下载，无需手动装） | — |
| uv | ≥ 0.5 | 实测 0.11.21 ✅ |
| Docker Desktop | 必须**先启动**（MySQL/Qdrant/ES/Redis 都跑在容器里） | 未启动会报 `failed to connect to the docker API ... dockerDesktopLinuxEngine` |
| Node.js | 仅改前端时需要（前端产物已预构建） | 实测 22.22.2 ✅ |

### 端口占用表

| 端口 | 服务 | 来源 |
|---|---|---|
| 3306 | MySQL | Docker（`data-agent/docker`） |
| 6379 | Redis | Docker（`data-agent/docker`）；若本机已有原生 redis 也可直接用 |
| 6333 / 6334 | Qdrant | Docker（`data-agent/docker`） |
| 9200 | Elasticsearch | Docker（`data-agent/docker`，首次需 build 带 IK 分词器的镜像） |
| 7100 | auth 认证中心 | 本地 uv |
| 8000 | data-agent（NL2SQL） | 本地 uv |
| 7300 | **insight-agent**（后端 + 前端 SPA） | 本地 uv |
| 7301 | Vite 前端 dev server | 可选，仅改前端时用 |

> 🔴 **`insight-agent/docker` 与 `data-agent/docker` 只差两个服务，是这套系统最常见的坑。**
> 前者只有 MySQL + Redis，后者才有 Qdrant + Elasticsearch；两个目录名相同、MySQL/Redis 定义相同，
> 起错了**不会立刻报错**，要等到 `build_meta_knowledge`（连 6333/9200）或实际取数时才失败。
> 一律使用 `data-agent/docker`。

---

## 2. Step 1 — 启动基础设施

> 🔴 **必须用 `data-agent\docker` 这一份 compose，不要用 `insight-agent\docker`。**
> 两个目录都叫 `docker`，两份 compose 里的 MySQL/Redis 服务定义**完全一样**，命令跑起来都不会报错 —— 但
> `insight-agent/docker/docker-compose.yaml` **只有 MySQL + Redis，没有 Qdrant 和 Elasticsearch**。
> 起错了会一路跑到 `build_meta_knowledge` 才炸（连不上 6333 / 9200）。
> 判断方法：`docker ps -a` 里看不到 `qdrant`、`elasticsearch` 就是起错了。

```powershell
cd G:\tearcher_code\insight\data-agent\docker
docker compose up -d
docker compose ps
```

首次启动会 `build` Elasticsearch 镜像（安装 `elasticsearch-analysis-ik-8.19.10` 中文分词插件），需要几分钟。

预期结果：`mysql-server` / `qdrant` / `elasticsearch` 三个容器 `Up`。

如果已经误在 `insight-agent\docker` 起过（MySQL/Redis 已在跑），补救命令 —— 只补起缺的两个，不动已有数据：

```powershell
cd G:\tearcher_code\insight\data-agent\docker
docker compose up -d qdrant elasticsearch
```

> 不会丢数据：两个目录名都是 `docker`，Compose 项目名相同（都是 `docker`），MySQL 用的还是同一个数据卷 `docker_mysql-data`。

验证（四个都必须通）：

```powershell
docker exec mysql-server mysql -uroot -p123321 -e "show databases;"   # MySQL
docker exec redis-server redis-cli ping                                # Redis → PONG
curl http://localhost:9200                                             # ES
curl http://localhost:6333/collections                                 # Qdrant
```

如果你机器上确实没有 Redis，才补一个（**已有就跳过**，否则 6379 撞端口）：

```powershell
docker run -d --name insight-redis -p 6379:6379 redis:7-alpine
```

---

## 3. Step 2 — 生成电商数仓业务数据（dbmock）

```powershell
cd G:\tearcher_code\insight\dbmock
uv sync
uv run core/init_db.py          # 建 warehouse 库 + 5 层数仓表结构
uv run -m core.generators.main  # 生成数据（批次 1~5，串并行执行）
```

数据库连接配置写死在 `dbmock/core/init_db.py` 的 `__main__`（`127.0.0.1:3306 / root / 123321`），与 Docker Compose 一致，无需修改。

数据规模由 `dbmock/core/generators/settings.py` 控制，想要快速验证可以把 `ORDER_DETAIL_TARGET_COUNT` 从 `100_000` 调小（例如 `5_000`），能省几分钟。

验证：

```powershell
docker exec mysql-server mysql -uroot -p123321 -e "select count(*) from warehouse.dwd_fact_trade_order_detail_di;"
```

---

## 4. Step 3 — 构建 data-agent 元数据索引

> 🛑 **前置硬约束：必须先把 Step 2 的数据跑完。**
> `build_meta_knowledge` 会从 `warehouse` 里 `SELECT DISTINCT` 抽取列的真实取值（`sync: true` 的列）写进 Elasticsearch，做**值召回**。
> warehouse 是空表时这一步**不会报错**，但索引里一条取值都没有 → NL2SQL 认不出 `'退款成功'`、`ALIPAY` 这类枚举值，取数质量会明显下降。
> 先确认 Step 2 的验证命令返回的行数不是 0。

```powershell
cd G:\tearcher_code\insight\data-agent
uv sync
uv run -m app.scripts.init_db                                  # 建 meta 库（表/列/指标 4 张表）
uv run -m app.scripts.build_meta_knowledge -c conf/meta_config.yaml   # 写入 MySQL + Qdrant + ES
```

> 💡 `init_db` 的输出里如果有 `Unknown table 'meta.table_info'` / `column_info` / `metric_info` / `column_metric` 这四行，**是正常现象不是报错**。
> 来源是 `meta.sql` 里的 `DROP TABLE IF EXISTS`：表本来就不存在，MySQL 会抛 warning 1051 并回显。判断成功的依据是最后一行 `INFO ... Initialized meta database using ...meta.sql`。

配置在 `data-agent/conf/app_config.yaml`（MySQL `meta`/`warehouse`、Qdrant 6333、ES 9200、Embedding 走硅基流动），密钥在 `data-agent/conf/.env`，仓库里已填好。

> ⚠️ 这一步会调用**外部 Embedding API**（硅基流动），必须联网；失败就重跑本步。

验证（三条都要有数，不是空集合）：

```powershell
# ① meta 库 4 张表 + 录入条数（column_info 应该有几百行）
docker exec mysql-server mysql -uroot -p123321 -e "select count(*) from meta.column_info;"

# ② ES 值索引（index 名固定为 data-agent-value，不是 config 里的 data_agent）
curl "http://localhost:9200/data-agent-value/_count"

# ③ Qdrant 两个向量集合（名字带连字符，固定）
curl "http://localhost:6333/collections/data-agent-column"
curl "http://localhost:6333/collections/data-agent-metric"
```

正常量级参考（24 张表 / 46 万列值）：

| 项 | 期望值 |
|---|---|
| `meta.table_info` | 24 |
| `meta.column_info` | 461 |
| `meta.metric_info` | 21 |
| `meta.column_metric` | 24 |
| ES `data-agent-value` | ~76 万 docs |
| Qdrant `data-agent-column` | ~2700 points |
| Qdrant `data-agent-metric` | ~80 points |

> ⚠️ **构建耗时约 7 分钟**（大量 `SELECT DISTINCT` + embedding）。构建**未完成时**调用 db_query 会报
> `Collection 'data-agent-metric' doesn't exist` —— 这是"还没建完"，不是配置错误，等构建结束再试。
> 若 `meta.column_info` 是 0，说明构建中途失败、事务回滚了，看控制台报错重跑。

> 🔴 **`build_meta_knowledge` 不能重复执行。**
> `meta_mysql_repository` 的 4 个保存方法都是 `session.add_all()`（纯 INSERT，无 upsert、无清表），
> 对已构建过的库再跑一次必然报：
> ```
> sqlalchemy.exc.IntegrityError
> (1062, "Duplicate entry '...' for key 'column_metric.PRIMARY'")
> ```
> **重建必须先进两步**：
> ```powershell
> cd G:\tearcher_code\insight\data-agent
> uv run -m app.scripts.init_db                                    # meta.sql 里是 DROP TABLE IF EXISTS，先清空
> uv run -m app.scripts.build_meta_knowledge -c conf/meta_config.yaml
> ```
> 另外**不要并发跑两个构建**，会撞同样的 PK。
>
> 各存储的幂等性不一样，重跑后果不同：
>
> | 存储 | 重跑 | 原因 |
> |---|---|---|
> | `meta` MySQL | ❌ 报 IntegrityError | 纯 INSERT |
> | ES `data-agent-value` | ✅ 安全 | 文档 id = `{column_id}.{value}`，覆盖写 |
> | Qdrant `data-agent-column` | ⚠️ 会新增重复点 | 点 id 用 `uuid.uuid4()` |


集合/index 不需要手动建：`ColumnQdrantRepository.ensure_collection()`、`ValueESRepository.ensure_index()` 会自动创建。

---

## 5. Step 4 — 启动 auth 认证中心

```powershell
cd G:\tearcher_code\insight\auth
uv sync
uv run -m app.main
```

- 地址：http://localhost:7100
- 存储：**SQLite**（`auth/data/auth.db`），首次启动自动建库、自动创建管理员
- 默认管理员：`admin@123.com` / `123123`（在 `auth/configs/.env` 中配置）
- auth 自带前端（`app/static/dist`），登录页/授权页都由它直接提供

验证：

```powershell
curl -X POST http://127.0.0.1:7100/api/introspection
# 期望 {"active":false}
```

---

## 6. Step 5 — 启动 data-agent（NL2SQL）

```powershell
cd G:\tearcher_code\insight\data-agent
uv run main.py
```

- 地址：http://localhost:8000
- 端点：`POST /api/query`，SSE 流式返回

验证（直接问一句业务问题）：

```powershell
curl -N -X POST http://127.0.0.1:8000/api/query `
  -H "Content-Type: application/json" `
  -d "{\"query\":\"各支付渠道的支付成功订单数\"}"
```

期望看到 `data: {"type": ...}` 的 SSE 流，最后有一帧 `type: result`。

---

## 7. Step 6 — 初始化并启动 insight-agent

```powershell
cd G:\tearcher_code\insight\insight-agent
uv sync
uv run app/init_db.py   # 建 chat 库 + SQL 建表 + sqlacodegen 反射生成 ORM
uv run -m app.main      # 启动，监听 7300
```

> ⚠️ **极易踩的坑：两个项目的建库命令不一样，别串台**
>
> | 目录 | 建库命令 |
> |---|---|
> | `insight-agent` | `uv run app/init_db.py` |
> | `data-agent` | `uv run -m app.scripts.init_db` |
>
> 在 insight-agent 里跑 `uv run -m app.scripts.init_db` 会报
> `ModuleNotFoundError: No module named 'app.scripts'`——因为 insight-agent **没有** `app/scripts/` 目录，它的建库脚本是 `app/init_db.py`。
>
> 另外：`app/init_db.py` 是「**已存在则 DROP 重建**」的破坏性操作，重复执行会清空 `chat` 库里的历史对话。

配置：
- `configs/.env` — 敏感信息（MySQL 账号、Redis 密码、`DEEPSEEK_API_KEY`、`TAVILY_API_KEY`），仓库里已填好可直接跑
- `configs/config.yml` — 模型、`data_agent.base_url`、`auth_service.base_url`、`redis`、`port: 7300`

**前端不用构建**：`app/static/dist` 已有构建产物，FastAPI 直接托管。
只有改了 `web/` 下的代码才需要：

```powershell
cd web
npm install
npm run build     # 产物输出到 ../app/static/dist
```

验证：浏览器打开 http://localhost:7300 ，应自动跳转 `localhost:7100` 登录页。若返回 404 `Frontend build not found`，说明 `app/static/dist/index.html` 缺失，执行上面的 `npm run build`。

---

## 8. 启动顺序速查（重启时照这个来）

```
Docker Desktop 启动
      ↓
docker compose up -d（data-agent/docker）  →  MySQL / Qdrant / ES
      ↓
Redis（本机已有，确认 6379 在监听）
      ↓
auth :7100  →  data-agent :8000  →  insight-agent :7300
```

前三个服务之间没有启动依赖，但 **insight-agent 必须在 auth + data-agent 之后**：前者登录要用 auth 内省接口，后者取数要用 data-agent SSE。

---

## 9. 操作手册

### 9.1 登录

1. 打开 http://localhost:7300 → 无令牌时自动跳到认证中心授权页
2. 未登录 → 认证中心 `/login` 页面，输入 `admin@123.com` / `123123`
3. 登录成功后回跳 `http://localhost:7300/auth/callback`，令牌写入 `localStorage`（key：`insight-agent:access-token`），落地到 `/chat`

> 令牌有效期 7 天（`auth/configs/config.yml` 的 `access_token_expire_days`）。过期后前端自动重新发起授权。

### 9.2 界面操作

| 操作 | 位置 | 说明 |
|---|---|---|
| 新建对话 | 左侧栏「新对话」 | 首条消息前是草稿对话，此时可先传附件 |
| 上传附件 | 输入框左侧回形针 | 支持 xlsx / csv / pdf / docx / 图片；落盘到当前对话工作区 |
| 发送消息 | 输入框回车 / 右侧按钮 | 走 WebSocket，逐帧流式渲染 |
| 停止生成 | 流式时右侧按钮变「停止」 | 发 `{"type":"cancel"}`，协作式取消，**不断开连接**，已生成内容保留 |
| 查看推理过程 | 消息流内 | `tool_call` / `tool_result` 分块展示（能看到 `db_query` 查了什么、返回几行） |
| 下载报告/附件 | 消息气泡上的附件卡片 | Agent 调 `return_file` 后出现，走 `/api/chat/attachment/get` |
| 改会话标题 | 双击侧栏会话名 | 首条消息后 3 秒内后台 LLM 自动生成标题 |
| 删会话 | 侧栏 hover 删除 | 逻辑删除，同时清理工作区目录与压缩记录 |
| 重新登录 | 右上角头像 → 退出 | 撤销令牌并清本地 |

### 9.3 工作区（分析产物的落盘位置）

```
insight-agent/.deepagents/workspaces/user_{user_id}/{conversation_id}/
├── raw/        db_query 落盘的 CSV/JSON
├── analysis/   清洗结果、汇总表、chart_data.json、report_payload.json
└── outputs/    最终 HTML 报告
```

工作区是**懒创建**的：第一次访问文件系统（上传附件 / Agent 执行）时才生成。

排查问题时可以直接进这个目录看中间产物——归因链路的每一步都有文件证据。

### 9.4 db_query 的耗时与超时（重要）

`db_query` 客户端超时是 **300 秒**（`app/core/http_client.py`），不是默认 5 秒。

data-agent 一次 `/api/query` 会走 11 个 LLM 节点，**正常耗时 80~150 秒**，偶发会因某个 LLM 节点卡住而超过 300 秒 → 前端看到 `db_query failed: ReadTimeout`。

> 判断是不是真卡住：`data-agent/logs/conv-{conversation_id}.log` 会逐节点打日志。
> 如果最后一条日志停在某个节点且几分钟没动，就是该节点的 LLM 调用长尾了——**Agent 自己重试通常就能过**（实测重试 82 秒跑通）。

**降低耗时/超时的四条（按性价比）**：

1. **一次 db_query 只问一件事**。别把「月度汇总」+「最大日期」塞进同一次调用
2. **优先单表口径**。例如「支付成功订单」直接用 `order_pay_time IS NOT NULL`，不要去 join 支付表判 `pay_status`
3. **枚举值写对**。写错值（如 `pay_status='支付成功'`，真实值是 `'成功'`）会让 data-agent 花好几轮 LLM 去纠错
4. 还不够就把 `http_client.py` 的 `timeout=300.0` 调到 `600.0`

### 9.5 热更新（免重启）

改了 `configs/config.yml` 或 `.deepagents/skills/insight/SKILL.md` 后：

```powershell
curl -X POST http://127.0.0.1:7300/api/reload -H "Authorization: Bearer <access_token>"
```

会重读配置 + 清掉 Agent 单例，下一次请求按新配置/新 Skill 重建。

> `SKILL.md` 是运行时读文件，实际上**改完直接生效**，不用 reload；改配置才需要。

> ⚠️ **`/api/reload` 只覆盖一半配置，改 `.env` 后请直接重启进程。**
> `reload_config()` 只是把 `settings.cfg` 这个模块属性重绑到新对象，所以：
>
> | 是否生效 | 位置 | 说明 |
> |---|---|---|
> | ✅ | `agent/agent.py` | LLM 模型/密钥（配合 `reset_agent()` 重建 agent） |
> | ✅ | `agent/mcp.py` | MCP 配置 |
> | ❌ | `core/redis.py` | Redis host/port/password 仍是旧的 |
> | ❌ | `core/database.py` | 数据库连接 |
> | ❌ | `core/middlewares/auth.py` | `auth_service.base_url` |
> | ❌ | `agent/tools/db_query.py` | `DB_QUERY_URL` 是模块级常量，完全不生效 |
>
> 原因是这些模块写的是 `from app.core.settings import cfg`（导入时已绑定旧对象），
> 而生效的那些写的是 `settings.cfg.xxx`（属性访问，能拿到新对象）。
>
> 附带坑：标题生成用的 `chat_service._title_llm` 是**独立单例、没有 reset 入口**，
> 即使 reload 也仍用旧 key（只影响会话标题，不影响对话）。

---

## 10. 测试 Demo

### Demo 前置自检（30 秒，先做这个）

Agent 的失败信息高度概括（「聊天连接初始化失败」「模型调用失败，请稍后重试。」），光看前端看不出原因。跑 Demo 前先自查三样：

```powershell
# ① Redis：6379 只能有一个监听者（Docker 容器），多一个就会 NOAUTH 500
netstat -ano | findstr ":6379" | findstr LISTENING

# ② LLM：key 必须有效（data-agent 也用同一个 key）
cd G:\tearcher_code\insight\insight-agent
uv run python -c "import openai,os;from dotenv import load_dotenv;load_dotenv('configs/.env');c=openai.OpenAI(api_key=os.environ['DEEPSEEK_API_KEY'],base_url='https://api.deepseek.com/v1');print(c.chat.completions.create(model='deepseek-v4-flash',messages=[{'role':'user','content':'ping'}],max_tokens=5).choices[0].message.content)"

# ③ Tavily MCP（可选，仅网页搜索用）
curl -s -X POST "https://mcp.tavily.com/mcp/?tavilyApiKey=<TAVILY_API_KEY>" -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"clientInfo\":{\"name\":\"probe\",\"version\":\"0\"}}}"
```

**症状 → 真实原因对照**（真实原因一律在 `insight-agent/logs/YYYY-MM-DD.jsonl` 里）：

| 前端提示 | 真实原因 | 查日志关键字 |
|---|---|---|
| 聊天连接初始化失败 | `/api/chat/ws-token` 500，几乎都是 Redis 连不上/要密码 | `"path": "/api/chat/ws-token"` |
| 模型调用失败，请稍后重试。 | LLM 调用抛异常（key 无效、余额、网络） | `agent failed` / `AuthenticationError` |
| 数据查询失败 / 取数为空 | data-agent 未启动、元数据未构建、key 无效 | `db_query failed` |

> 💡 **重发失败的提问会污染上下文。** 一轮失败时**用户消息已经入库**（`_add_message` 先落库再调模型），所以在同一对话里重发同一条问题，历史里就会有两条内容相同、`context_seq` 不同的 HumanMessage，一起喂给模型 → 可能重复回答、浪费 token。
> **失败后请新开一个对话再试**，别在出错的会话里反复重发。
> `context_seq` 从 0 开始（空对话 `cur_context_seq = -1`，首条消息 `+1` 得 0），之后递增。

### Demo A：单指标查数（~15 秒，验证全链路连通）

在新对话里输入：

```
统计最近 3 个月支付成功的订单数和支付金额（元）
```

**预期**：1 次 `db_query` 工具调用 → 返回 `pay_month / paid_amount_yuan / total_orders` 三列 → Agent 用中文带单位回答，并说明时间口径。

> 验收点：能看到 `tool_call db_query` 的展开，说明 `insight-agent → data-agent → MySQL` 通了。

### Demo B：退款归因（主推，2~4 分钟，复现完整归因）

```
帮我做一次最近 3 个月的退款归因分析：退款金额有多少、集中在哪些退款原因和渠道，
再拆一下地域，最后输出一份 HTML 报告给我。
```

**预期执行链**：

1. 加载 `insight` Skill（`read_file /skills/insight/SKILL.md`）
2. 多次 `db_query`：
   - 退款明细按 `refund_month × refund_reason_desc × province_name × payment_channel_code` 聚合
   - 支付总额（算退款率分母，做对账）
   - 省份维度下钻
3. 用 pandas 写 `analysis/*.csv` + `analysis/report_payload.json`
4. 调 `render_report.py` 渲染 → `outputs/xxx.html`
5. `return_file` 把 HTML 作为附件返回 → 消息里出现可下载的报告卡片

**结论长什么样**（真实跑过的产物参考 `insight-agent/outputs/refund_analysis_report.html`）：

- 按月退款金额趋势（2026-03 ~ 2026-06，6 月因 618 大幅抬升）
- 退款原因 Top5：「不想要了」「商品破损」「尺寸/规格不符」…
- 渠道 × 原因交叉表，定位哪个支付渠道的哪类退款最集中
- 附录里标注：时间口径（`refund_success_time`）、状态过滤（`refund_status='退款成功'`）、金额单位（分 → 元 `*0.01`）

> 验收点：`outputs/` 下出现 HTML 文件，且消息里能下载。

### Demo C：追问（验证上下文 + 一致性）

在 Demo B 的同一个对话里继续：

```
把上面退款原因 Top3 再拆到省份，看是否集中在某些地区
```

**预期**：Agent 不会重新问「哪 3 个原因」，直接复用上一轮的结论继续下钻；中间产物追加到同一个工作区。

### Demo D（可选）：附件驱动

上传一个 Excel/CSV，然后说：

```
结合我上传的文件，和我库里的订单数据做个对比分析
```

验证 `_process_attachments()` 把附件路径注入上下文、Agent 能同时读工作区文件和查库。

### Demo E（可选）：后端直连（不依赖浏览器）

见 §11。

### 验收清单

- [ ] `docker compose ps` 三个容器 Up
- [ ] `warehouse.dwd_fact_trade_order_detail_di` 行数 ≈ 10w
- [ ] `meta.table_info` 非空
- [ ] `localhost:7300` 能打开并完成登录
- [ ] Demo A 出现 `db_query` 工具调用并给出带单位的数字
- [ ] Demo B 在 `outputs/` 生成 HTML 且消息里可下载
- [ ] Demo C 能继承上下文继续下钻

---

## 11. 后端直连 Demo（脚本，不依赖前端）

用于排查「前端没问题但 WS 有问题」或做自动化冒烟。放在 `insight-agent/demo_client.py`：

```python
"""insight-agent 后端直连 Demo：OAuth(PKCE) 登录 → 建会话 → WebSocket 流式提问"""

import asyncio
import base64
import hashlib
import json
import secrets
import sys

import httpx
import websockets

AUTH = "http://127.0.0.1:7100"
APP = "http://127.0.0.1:7300"
CLIENT_ID = "insight-agent"
REDIRECT_URI = "http://localhost:7300/auth/callback"
EMAIL, PASSWORD = "admin@123.com", "123123"
QUESTION = sys.argv[1] if len(sys.argv) > 1 else "统计最近 3 个月支付成功的订单数和支付金额（元）"


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def build_pkce() -> tuple[str, str]:
    verifier = b64url(secrets.token_bytes(32))
    challenge = b64url(hashlib.sha256(verifier.encode()).digest())
    return verifier, challenge


def get_access_token() -> str:
    """完整走一遍 OAuth2 + PKCE：登录 → 授权码 → 换令牌"""
    state = b64url(secrets.token_bytes(32))
    verifier, challenge = build_pkce()

    with httpx.Client(follow_redirects=False) as client:
        resp = client.post(f"{AUTH}/api/login", json={"email": EMAIL, "password": PASSWORD})
        resp.raise_for_status()

        resp = client.get(
            f"{AUTH}/api/authorize",
            params={
                "response_type": "code",
                "client_id": CLIENT_ID,
                "redirect_uri": REDIRECT_URI,
                "state": state,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            },
        )
        resp.raise_for_status()
        code = dict(httpx.URL(resp.headers["location"]).params)["code"]

        resp = client.post(
            f"{AUTH}/api/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": CLIENT_ID,
                "redirect_uri": REDIRECT_URI,
                "code_verifier": verifier,
            },
        )
        resp.raise_for_status()
        return resp.json()["access_token"]


async def main() -> None:
    headers = {"Authorization": f"Bearer {get_access_token()}"}
    async with httpx.AsyncClient(headers=headers) as client:
        conv = (await client.post(f"{APP}/api/chat/create", json={"is_draft": 0})).json()
        conversation_id = conv["conversation_id"]
        ws_token = (await client.post(f"{APP}/api/chat/ws-token")).json()["websocket_token"]

    print(f"conversation_id = {conversation_id}")
    print(f"Q: {QUESTION}\n")

    url = (
        f"ws://127.0.0.1:7300/api/chat/ws/chat"
        f"?websocket_token={ws_token}&conversation_id={conversation_id}"
    )
    async with websockets.connect(url, max_size=None) as ws:
        await ws.send(
            json.dumps(
                {"message": {"role": "user", "parts": [{"type": "text", "text": QUESTION}]}},
                ensure_ascii=False,
            )
        )
        while True:
            frame = json.loads(await ws.recv())
            if frame.get("type") == "error":
                print("\nERROR:", frame)
                break
            if frame.get("type") == "conversation_renamed":
                print(f"\n[会话改名为] {frame.get('title')}")
                continue

            message = frame.get("message", {})
            for part in message.get("parts", []):
                kind = part.get("type")
                if kind == "text":
                    print(part["text"], end="", flush=True)
                elif kind == "tool_call":
                    print(f"\n[tool_call] {part.get('name')} {json.dumps(part.get('args'), ensure_ascii=False)}")
                elif kind == "tool_result":
                    print(f"\n[tool_result] {str(part.get('content'))[:400]}")
            if message.get("attachments"):
                print(f"\n[attachment] {message['attachments']}")
            if message.get("finish_reason") == "stop":
                print("\n---- done ----")
                break


asyncio.run(main())
```

运行（`uv run --with` 临时装依赖，不污染项目环境）：

```powershell
cd G:\tearcher_code\insight\insight-agent
uv run --with httpx --with websockets python demo_client.py "统计最近 3 个月支付成功的订单数和支付金额（元）"
```

> 想中断生成：在同一次会话里另发一帧 `{"type": "cancel"}`；想复现取消逻辑，把 `websockets.connect` 后加个定时任务发这两行即可。

---

## 12. 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `failed to connect to the docker API` | Docker Desktop 未启动 | 启动 Docker Desktop 后重试 |
| `No module named 'app.scripts'` | 用错目录：该命令属于 data-agent | insight-agent 用 `uv run app/init_db.py`；data-agent 用 `uv run -m app.scripts.init_db` |
| `build_meta_knowledge` 报连接失败 / 超时 | 在 `insight-agent\docker` 起的 compose，**没有 Qdrant 和 ES** | `cd data-agent\docker; docker compose up -d qdrant elasticsearch`，再用 `docker ps -a` 确认两个容器存在 |
| `Unknown table 'meta.table_info'` 等 4 行 | `meta.sql` 里 `DROP TABLE IF EXISTS` 的 warning，表尚不存在时必然出现 | **无需处理**，以最后一行 `Initialized meta database` 为准 |
| 取数查不到枚举值（如「退款成功」识别不了） | warehouse 是空表就跑 `build_meta_knowledge`，ES 值召回为空 | 先跑完 dbmock 数据生成，再重跑 `build_meta_knowledge`（会自动覆盖索引） |
| 6379 端口被占用 / redis 起不来 | 本机已有 `redis-server` | 直接用本机 Redis，别再起 Docker 版 |
| 打开 7300 返回 404 `Frontend build not found` | `app/static/dist` 缺失 | `cd web && npm install && npm run build` |
| 登录后卡在认证中心 | auth 未启动 / `base_url` 配错 | 检查 `configs/config.yml` 的 `auth_service.base_url` 与 `localhost:7100` 一致 |
| 前端 401，反复跳登录 | 令牌过期或 auth 侧用户被禁用 | 清 `localStorage` 里 `insight-agent:access-token` 重新登录 |
| `db_query failed: ConnectError` | data-agent 未启动 | 启动 `data-agent`（:8000），确认 `data_agent.base_url` 一致 |
| `db_query failed: ReadTimeout` | data-agent 某次调用超过 300 秒（LLM 节点长尾） | 看 `data-agent/logs/conv-{id}.log` 停在哪一步；拆分 query、改单表口径、或把 `http_client.py` 超时调到 600s |
| 取数 SQL 用 `pay_status='支付成功'` 返回 0 行 | 真实枚举只有 `'成功'`；且 `pay_status` 在**支付表**不在订单表 | 用 `order_pay_time IS NOT NULL` 或 `pay_status='成功'` |
| **前端提示「聊天连接初始化失败」** | `/api/chat/ws-token` 返回 500。最常见原因：**6379 上有两个 Redis 在抢端口** —— 一个 Docker 容器（无密码），一个本机 native（带 `requirepass`）。应用连到后者就报 `NOAUTH Authentication required.` | `netstat -ano \| findstr ":6379" \| findstr LISTENING`，**只留 Docker 容器那一个**，关掉 native redis 即可 |
| 日志里 `exc_type: AuthenticationError` / `detail: Authentication required.` | 同上，这是 Redis 的 `NOAUTH Authentication required.` 被 redis-py 映射后的消息，**不是 LLM key 问题** | 同上 |
| **前端提示「模型调用失败，请稍后重试。」** | `/api/chat/ws/chat` 里 Agent 抛异常被兜底。真实原因看日志：`AuthenticationError: Error code: 401 - ... 'api key: ****xxxx is invalid'` 就是 LLM key 无效 | 换 `DEEPSEEK_API_KEY`，**要改两处**：`insight-agent/configs/.env` 和 `data-agent/conf/.env`（同一把 key） |
| `data query API finished without result` | 元数据未构建 / data-agent 内部报错 | 重跑 `build_meta_knowledge`，看 data-agent 控制台日志 |
| 取数结果字段名对不上（如 `refund_reason` 不存在） | 表字段名与常见写法不同 | 正常现象，SKILL.md 已写死约束（`refund_reason_desc` / 金额单位是分） |
| Agent 用 `uv run python` 报找不到文件 | SKILL.md 里的示例路径是 Linux 绝对路径 | 让 Agent 用相对工作区的路径：`../../../skills/insight/scripts/render_report.py` |
| 报告 HTML 打开无图 | ECharts 走 CDN | 需要外网；内网环境可把 `echarts` 改为本地文件 |
| MCP（tavily）初始化失败导致 Agent 起不来 | MCP 客户端是**串行加载**、失败不降级 | 检查 `configs/.env` 的 `TAVILY_API_KEY`，或先注释掉 `config.yml` 的 `mcp.tavily` |
| WebSocket 连上就被关（4401 / 4404） | 令牌一次性、30 秒过期 / 会话不属于当前用户 | 每次连接前重新调 `/api/chat/ws-token`；确认 `conversation_id` 归属 |
| 想彻底重置数据 | 建库脚本会 DROP 重建 | `uv run app/init_db.py` 会删掉并重建 `chat` 库，工作区目录需手动删 `.deepagents/workspaces/` |

---

## 13. 附录

### 13.1 insight-agent 关键配置（`configs/config.yml`）

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `port` | `7300` | 服务端口 |
| `db.configs.mysql.*` | 来自 `.env` | MySQL 连接 |
| `redis.host/port` | `127.0.0.1:6379` | WS 临时令牌存储 |
| `lm_config.active` | `deepseek-v4-flash` | 当前生效模型；`profile.max_input_tokens` 决定压缩阈值（85% 触发） |
| `mcp.tavily` | 已配置 | 唯一的外部 MCP 工具（`streamable_http`） |
| `auth_service.base_url` | `http://localhost:7100` | 认证中心 |
| `data_agent.base_url` | `http://localhost:8000` | NL2SQL 服务 |
| `cors_origins` | `[]` | 跨域白名单，前端同源托管时留空即可 |

`configs/.env` 需要填的项：`DB_*`、`REDIS_PASSWORD`、`DEEPSEEK_API_KEY`、`TAVILY_API_KEY`。

> ⚠️ `DEEPSEEK_API_KEY` 必须和 `data-agent/conf/.env` 里的一致/同样有效 —— data-agent 也用它做 NL2SQL。只改一边会出现「对话正常但取数失败」。
> `REDIS_PASSWORD` 留空即可（容器 Redis 无密码）；**不要**为了让报错消失而随便填一个密码，那只会把问题掩盖成另一种连接失败。

### 13.2 常用 API 速查

| 接口 | 说明 |
|---|---|
| `POST /api/chat/create` | 建会话（`is_draft=1` 建草稿，可先传附件） |
| `POST /api/chat/delete` | 逻辑删除会话（含消息、压缩记录、工作区） |
| `POST /api/chat/update` | 改会话标题 |
| `GET /api/chat/ls` | 会话列表（按更新时间倒序） |
| `GET /api/chat/ls/{conversation_id}` | 历史消息 |
| `POST /api/chat/ws-token` | 拿一次性 WS 令牌（30 秒有效） |
| `WS /api/chat/ws/chat?websocket_token=..&conversation_id=..` | 流式对话，发 `{"type":"cancel"}` 可中断 |
| `POST /api/chat/attachment/upload` | 上传附件 |
| `GET /api/chat/attachment/get` | 下载附件/报告 |
| `POST /api/chat/attachment/delete` | 删除附件 |
| `POST /api/reload` | 热重载配置 + 重建 Agent 单例 |

除 WebSocket 外，所有 `/api/*` 都需要 `Authorization: Bearer <access_token>`。

### 13.3 目录速查

```
insight-agent/
├── app/
│   ├── main.py                     # 应用入口（lifespan + 中间件 + 异常 + 路由）
│   ├── init_db.py                  # 建库 + 建表 + 反射生成 ORM
│   ├── agent/agent.py              # Agent 组装（模型 / 工具 / 工作区 / Skill / 中文 prompt）
│   ├── agent/tools/db_query.py     # SSE 调 data-agent，结果落 CSV/JSON
│   ├── agent/tools/return_file.py  # 把工作区文件回传成附件
│   ├── services/chat_service.py    # 上下文加载 + run_agent_turn（重试 / 压缩 / 双写）
│   ├── routers/api/chat.py         # 对话接口 + WebSocket + _TurnStream（协作式取消）
│   ├── mappers/message_mapper.py   # Entity ↔ Schema ↔ LangChain 三向转换
│   └── static/dist/                # 前端构建产物（已预构建）
├── .deepagents/
│   ├── skills/insight/SKILL.md     # ⭐ 归因分析方法论（改完直接生效）
│   └── workspaces/user_{id}/{cid}/ # 对话工作区：raw / analysis / outputs
├── configs/config.yml + .env
├── docker/docker-compose.yaml      # MySQL + Redis（仅单跑 insight-agent 时用）
└── sql/mysql/chat.sql              # 建表脚本
```

### 13.4 一次请求的完整链路（排查时对照）

```
浏览器 WS 消息
  → trace 中间件（注入 request_id / trace_id）
  → auth 中间件（调 :7100 introspection 校验 Bearer）
  → chat.py  _validate_and_accept（Redis GETDEL 一次性消费 WS 令牌）
  → chat_service.load_conversation_context（全量历史 + 应用最新压缩摘要）
  → chat_service.run_agent_turn
      → agent.astream（deepagents + LangGraph）
      → db_query 工具 → SSE → data-agent :8000 → MySQL warehouse
      → message_mapper 把 chunk 转 MessageSchema
      → message_repo 双写（DB + 内存 ctx.messages）
  → 逐条 yield 给 WebSocket → 前端实时渲染
```
