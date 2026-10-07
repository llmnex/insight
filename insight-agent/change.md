# 项目改动与优化记录

## 2026-06-12

### 🔧 新增优化：流式输出思考指示器

**类型**：新增优化

在用户发送消息后、Agent 产出首个响应之前，显示"正在思考，请稍等..."的脉冲动效指示器，弥补等待期间的界面空白，提升交互感知。

**改动文件**：

| 文件 | 改动类型 |
|------|----------|
| `web/src/index.css` | 新增动画 |
| `web/src/pages/Chat/components/ChatMessages.tsx` | 新增逻辑 |
| `web/src/pages/Chat/index.tsx` | 传参调整 |

**改动细节**：

1. **`web/src/index.css`** — 新增 `@keyframes thinking-dot` 动画与 `.animate-thinking-dot` 工具类
   - 三颗圆点以 `1.4s` 周期脉冲缩放（scale: 0.6 → 1.0 → 0.6）配合透明度变化
   - 各圆点延时启动（0s / 0.2s / 0.4s），形成连续的"打字"式流水动效

2. **`web/src/pages/Chat/components/ChatMessages.tsx`**
   - 新增 `ThinkingIndicator` 组件：三个脉冲圆点 + "正在思考，请稍等..." 文字，左对齐样式与助手消息保持一致
   - `ChatMessagesProps` 增加 `isStreaming` 可选 prop
   - 新增 `showThinking` 计算逻辑：`isStreaming === true && messages.length > 0 && messages[messages.length - 1].role === "user"`
   - 在消息列表末尾条件渲染 `<ThinkingIndicator />`

3. **`web/src/pages/Chat/index.tsx`** — `<ChatMessages>` 组件调用处新增 `isStreaming={isStreaming}` 传参

**触发条件**：

| 阶段 | 指示器状态 |
|------|------------|
| 用户发送消息 → Agent 尚未产出任何响应 | 显示 "正在思考，请稍等..." |
| Agent 首次产出文本 / 工具调用 | 自动消失 |
| 用户点击停止 / 后端报错 / Agent 正常结束 | 自动消失 |

---

## 2026-06-09

### 🔧 新增优化：Agent 中文系统提示词

**类型**：新增优化

覆盖 deepagents 默认的英文 `base_prompt`，替换为面向国内零售/电商行业的中文业务 Agent 系统提示词。

**改动文件**：

| 文件 | 改动类型 |
|------|----------|
| `app/agent/agent.py` | 新增逻辑 |

**改动细节**：

1. **`app/agent/agent.py`**（第 72–122 行）
   - 新增全中文 `system_prompt`，包含：核心行为规范（中文回答、简洁直接、数字带单位）、专业客观原则、任务执行流程（理解→执行→验证）、工具使用优先级、常见错误规避指引、进度同步要求
   - 传递给 `create_deep_agent(system_prompt=...)`
   - 原因：业务用户中文提问，英文答复浪费 token；SKILL.md 已是中文，base prompt 中英混排易导致模型偶尔回英文

---

### 🔧 新增优化：db_query 工具传递 conversation_id

**类型**：新增优化

在 db_query 工具的请求体中追加 `conversation_id`，方便 data-agent 按对话分文件记录日志。

**改动文件**：

| 文件 | 改动类型 |
|------|----------|
| `app/agent/tools/db_query.py` | 优化改造 |

**改动细节**：

1. **`app/agent/tools/db_query.py`**（第 26–35 行）
   - `_stream_db_query()` 函数新增可选参数 `conversation_id: int | None`
   - 在 POST 请求 body 中追加 `conversation_id` 字段
   - 工作区路径解析处（第 139–142 行）新增从 `workspace_dir` 路径中提取 `conversation_id` 的逻辑（目录格式：`.../user_{user_id}/{conversation_id}/`）

---

### 🔧 新增优化：首条消息触发后台 LLM 生成对话标题

**类型**：新增优化

用户发送首条消息后，后台异步调用 LLM 总结生成 5-10 字标题，通过 WebSocket 推送至前端更新侧栏。

**改动文件**：

| 文件 | 改动类型 |
|------|----------|
| `app/services/chat_service.py` | 新增逻辑 |
| `app/routers/api/chat.py` | 新增逻辑 |
| `web/src/stores/chatStore.ts` | 新增逻辑 |
| `web/src/pages/Chat/index.tsx` | 新增事件处理 |

**改动细节**：

1. **`app/services/chat_service.py`**
   - 新增 `_title_llm` 懒加载单例（第 217–242 行）：独立 LLM 实例，30 秒超时，专用于标题生成
   - 新增 `_TITLE_SYSTEM_PROMPT`（第 245–266 行）：中文 prompt，要求输出 5-10 字简洁标题
   - 新增 `generate_conversation_title(user_message) -> str | None`（第 269–299 行）：调用 LLM 生成标题，含超时/异常保护
   - 新增 `generate_and_save_title_background()`（第 302–339 行）：生成标题后落库
   - 标题更新保护（第 326–329 行）：只有当前 title 仍为"新对话"时才更新，防止覆盖用户手动改名

2. **`app/routers/api/chat.py`**
   - 新增 `_background_title_and_notify()`（第 397–434 行）：
     - `await asyncio.sleep(3)` 延迟执行，不阻塞主 Agent 流程
     - 调用 `generate_and_save_title_background()` 生成标题
     - 通过 WebSocket 推送 `{"type": "conversation_renamed", ...}` 事件
   - 首条消息分支（第 346–363 行）：`context_seq == 0` 时触发后台 task

3. **`web/src/stores/chatStore.ts`**
   - 新增 `updateConversationTitle(conversationId, title)` store action（第 102–116 行）：接收 WS 推送的标题并更新 `conversations` 列表
   - 新增 `renameConversation` store action（第 119–160 行）：双击会话名重命名，含乐观更新 + 失败回滚

4. **`web/src/pages/Chat/index.tsx`**
   - 新增 `updateConversationTitle` store hook（第 78–79 行）
   - WebSocket `onmessage` 增加 `conversation_renamed` 事件处理（第 368–374 行）

---

### 🔧 问题修复：WebSocket 连接生命周期重构

**类型**：问题修复

修复 WebSocket 连接在会话切换、Agent 结束后被过早关闭的问题，改为"页面卸载才关闭"策略。

**改动文件**：

| 文件 | 改动类型 |
|------|----------|
| `web/src/pages/Chat/index.tsx` | 修复改造 |

**改动细节**：

1. **`web/src/pages/Chat/index.tsx`**
   - idle 超时由 5s 改为 **30 分钟**（第 120–133 行）：
     - 原 5s 太激进，Agent 结束后立刻断 socket，用户看历史消息或切侧栏会话都会断
   - 复用现有连接时不做任何事（第 321–325 行）：原代码切换离开时启动 5s idle timer 关 socket
   - 建连期间切走不再自动关（第 341–343 行）
   - Agent 结束后不启动 idle timer 关 socket（第 381–385 行）：后台会话的 socket 不应因主会话活动而断开
   - `useEffect` cleanup 不再主动关 socket（第 435–440 行）：因非 `routeConversationId` 变化的依赖项变化触发的 cleanup 不应关闭 WebSocket

---

### 🔧 问题修复：双击会话名与路由导航冲突

**类型**：问题修复

双击会话名进入编辑模式时，`<Link>` 组件的单击事件抢先触发 `navigate`，导致路由变化→WebSocket 重建→编辑中断。

**改动文件**：

| 文件 | 改动类型 |
|------|----------|
| `web/src/pages/Chat/components/ChatSidebar.tsx` | 修复改造 |
| `web/src/pages/Chat/components/ConversationTitleItem.tsx` | 修复改造 |

**改动细节**：

1. **`web/src/pages/Chat/components/ChatSidebar.tsx`**
   - 导入从 `<Link>` 改为 `useNavigate`（第 2–5 行注释）
   - 导航方式从 `<Link to={...}>` 改为 `onClick + useNavigate()`（第 39–42 行）
   - 新增条件判断：只在不是当前路由时才 navigate（第 86–90 行），避免两次单击触发两次 navigate 导致 React Router 内部 state 更新
   - 传递 `onRename` 回调（第 24–26 行）

2. **`web/src/pages/Chat/components/ConversationTitleItem.tsx`**
   - 编辑模式下阻止 input 的 click/mousedown 事件冒泡（第 115–118 行），防止冒泡触发外层导航

---

### 🔧 新增优化：前端会话重命名 API

**类型**：新增优化

新增 `POST /api/chat/update` 接口及相关前端调用链路，支持双击会话标题后持久化修改。

**改动文件**：

| 文件 | 改动类型 |
|------|----------|
| `web/src/config/settings.ts` | 新增路由 |
| `web/src/api/chat.ts` | 新增方法 |

**改动细节**：

1. **`web/src/config/settings.ts`** — 新增 `updateConversation: "/api/chat/update"` 路由配置（第 33–35 行）
2. **`web/src/api/chat.ts`** — 新增 `updateConversation(conversationId, title)` 方法（第 23–27 行），调用后端 API 持久化标题
