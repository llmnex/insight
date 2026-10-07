/**
 * insight-agent · 共享场景数据
 * 4 个页面都引用此文件：
 *   - interactive-demo.html  (交互演示)
 *   - flow-scenarios.html    (场景流程图)
 *   - flow-flows.html        (关联大流程图)
 *   - file-matrix.html       (总表矩阵)
 *
 * 数据结构：
 *   MODULES          - 文件模块清单（含颜色）
 *   FILES            - 文件详情（含所属模块、描述）
 *   SCENARIOS        - 8 个离散场景，每个场景含 N 个步骤
 *                      步骤含：节点 (graphNodes) + 连线 (graphEdges) + 激活文件清单 (files)
 *   FLOWS           - 关联场景组合（每个 flow 包含多个场景，按顺序合并）
 *   CONTINUOUS      - 连续对话 9 步（独立流程）
 */

// ========== 模块（与 insight-agent 目录结构对齐）==========
const MODULES = {
  'infra':    { name: '基础设施层',  color: '#0891B2', files: ['config.py','settings.py','context.py','tracing.py','redis_client.py','auth_client.py'] },
  'schema':   { name: 'Schema/Entity', color: '#2563EB', files: ['conversation.py','message.py','context_compaction.py','agent_dto.py','tool_result.py'] },
  'repo':     { name: '数据访问层',   color: '#7C3AED', files: ['conversation_repo.py','message_repo.py','compaction_repo.py','file_repo.py'] },
  'biz':      { name: '业务编排',     color: '#DB2777', files: ['agent_mapper.py','conversation_service.py'] },
  'agent':    { name: 'Agent / Skill', color: '#EA580C', files: ['builder.py','db_query.py','return_file.py','render_report.py'] },
  'skill':    { name: 'Skill 配置',   color: '#CA8A04', files: ['.deepagents/'] },
  'router':   { name: '路由层',       color: '#16A34A', files: ['conversation.py','ws_chat.py','admin.py','file.py'] },
  'err':      { name: '异常体系',     color: '#DC2626', files: ['exceptions.py','handlers.py'] },
  'plugin':   { name: '生命周期插件', color: '#475569', files: ['auth.py'] },
};

// ========== 文件详情（路径 = module/filename）==========
const FILES = [
  // infra
  { path: 'core/config.py',                 module: 'infra',  desc: '应用配置加载' },
  { path: 'core/settings.py',               module: 'infra',  desc: 'Pydantic Settings 类型化配置' },
  { path: 'core/context.py',                module: 'infra',  desc: 'ContextVar 上下文变量（trace_id/user_id）' },
  { path: 'core/tracing.py',                module: 'infra',  desc: 'trace_id 生成与链路追踪' },
  { path: 'core/redis_client.py',           module: 'infra',  desc: 'Redis 客户端（L1 短记忆）' },
  { path: 'core/auth_client.py',            module: 'infra',  desc: 'auth 中心 OAuth2/PKCE 客户端' },
  // schema
  { path: 'entities/conversation.py',       module: 'schema', desc: '对话 ORM 实体' },
  { path: 'entities/message.py',            module: 'schema', desc: '消息 ORM 实体（含 seq 序号）' },
  { path: 'entities/context_compaction.py', module: 'schema', desc: '压缩记录 ORM 实体' },
  { path: 'schemas/agent_dto.py',           module: 'schema', desc: 'Agent 消息 DTO' },
  { path: 'schemas/tool_result.py',         module: 'schema', desc: '工具调用结果 Schema' },
  // repo
  { path: 'repositories/conversation_repo.py', module: 'repo', desc: '对话数据访问' },
  { path: 'repositories/message_repo.py',      module: 'repo', desc: '消息数据访问' },
  { path: 'repositories/compaction_repo.py',   module: 'repo', desc: '压缩记录访问' },
  { path: 'repositories/file_repo.py',         module: 'repo', desc: '文件元数据访问' },
  // biz
  { path: 'mappers/agent_mapper.py',        module: 'biz',  desc: '消息格式三向转换（DB/Agent/WS）' },
  { path: 'services/conversation_service.py', module: 'biz', desc: '业务编排核心（流式 + 重试 + 压缩 + 取消）' },
  // agent
  { path: 'agent/builder.py',               module: 'agent', desc: 'DeepAgents 装配' },
  { path: 'agent/tools/db_query.py',        module: 'agent', desc: 'db_query 工具（调用 data-agent）' },
  { path: 'agent/tools/return_file.py',     module: 'agent', desc: 'return_file 工具（产出附件）' },
  { path: 'agent/tools/render_report.py',   module: 'agent', desc: 'render_report 工具（生成 HTML 报告）' },
  // skill
  { path: '.deepagents/',                   module: 'skill', desc: 'Skill 配置 + 文档加载' },
  // router
  { path: 'routers/conversation.py',        module: 'router', desc: 'REST: 对话/消息 CRUD' },
  { path: 'routers/ws_chat.py',             module: 'router', desc: 'WebSocket: 流式对话' },
  { path: 'routers/admin.py',               module: 'router', desc: 'REST: 热更新 /api/reload' },
  { path: 'routers/file.py',                module: 'router', desc: 'REST: 附件上传下载' },
  // err
  { path: 'errors/exceptions.py',           module: 'err',   desc: '业务异常类（PathTraversal / Auth / ...）' },
  { path: 'errors/handlers.py',             module: 'err',   desc: 'FastAPI 异常处理器（problem+json）' },
  // plugin
  { path: 'plugins/lifespan/auth.py',       module: 'plugin', desc: '启动期 Token 校验' },
];

// ========== 节点类型定义 ==========
// graphNodes: [{id, label, module, file, x, y}]  -- 流程图节点
// graphEdges: [{from, to, label?, type?}]       -- 连线
// steps: [{idx, title, who, prompt, caps, files, graphNodes, graphEdges}]
//   注意：步骤可以引用部分节点/边，也可以只定义 steps 让前端自动从 files 推

// ========== 场景定义 ==========
// 每个场景包含：
//   - id, name, color, desc
//   - nodes: 流程图节点（场景级别）
//   - edges: 流程图连线
//   - steps: [{who, t, prompt, caps, files, highlightNodes, highlightEdges}]

const SCENARIOS = [
  // ============= A: 登录 + 建对话 + 上传 Excel =============
  {
    id: 'A', name: 'A · 登录 + 建对话 + 上传 Excel', color: '#FF4081',
    desc: '鉴权 / trace / ContextVar / 会话创建 / 附件上传',
    nodes: [
      { id: 'auth',    label: 'OAuth2 登录',  module: 'plugin', file: 'plugins/lifespan/auth.py' },
      { id: 'tracing', label: '生成 trace_id', module: 'infra',  file: 'core/tracing.py' },
      { id: 'context', label: 'ContextVar 设置', module: 'infra', file: 'core/context.py' },
      { id: 'redis',   label: 'L1 短记忆就绪', module: 'infra',  file: 'core/redis_client.py' },
      { id: 'rconv',   label: 'POST /api/conversations', module: 'router', file: 'routers/conversation.py' },
      { id: 'convRepo',label: '写入 conversation 表', module: 'repo', file: 'repositories/conversation_repo.py' },
      { id: 'rfile',   label: 'POST /api/files', module: 'router', file: 'routers/file.py' },
      { id: 'fileRepo',label: '写入 files 表 + 工作区', module: 'repo', file: 'repositories/file_repo.py' },
      { id: 'title',   label: '后台异步生成标题', module: 'biz', file: 'services/conversation_service.py' },
      { id: 'convEnt', label: '更新 conversation.title', module: 'schema', file: 'entities/conversation.py' },
    ],
    edges: [
      { from: 'auth', to: 'tracing', label: 'Token OK' },
      { from: 'tracing', to: 'context', label: 'trace_id' },
      { from: 'context', to: 'redis' },
      { from: 'redis', to: 'rconv', label: '用户点新建' },
      { from: 'rconv', to: 'convRepo' },
      { from: 'convRepo', to: 'rfile', label: '建完会话' },
      { from: 'rfile', to: 'fileRepo' },
      { from: 'fileRepo', to: 'title', label: '后台异步' },
      { from: 'title', to: 'convEnt' },
    ],
    steps: [
      { idx: 1, t: '00:00', who: '商家',
        prompt: '打开 insight-agent 控制台 → 自动跳转 auth 中心登录',
        caps: ['调用 plugins/lifespan/auth.py 校验 Token', 'core/tracing.py 生成 trace_id', 'core/context.py 设置 ContextVar', 'core/redis_client.py L1 短记忆准备'],
        files: ['plugins/lifespan/auth.py', 'core/tracing.py', 'core/context.py', 'core/redis_client.py'],
        highlightNodes: ['auth', 'tracing', 'context', 'redis'],
        highlightEdges: ['auth->tracing', 'tracing->context', 'context->redis'] },
      { idx: 2, t: '00:30', who: '商家',
        prompt: '新建一个对话 + 上传 6 月销售明细 Excel',
        caps: ['POST /api/conversations 建会话', 'POST /api/files 上传附件', '写入 files 表 + 工作区目录'],
        files: ['routers/conversation.py', 'routers/file.py', 'repositories/conversation_repo.py', 'repositories/file_repo.py'],
        highlightNodes: ['rconv', 'convRepo', 'rfile', 'fileRepo'],
        highlightEdges: ['redis->rconv', 'rconv->convRepo', 'convRepo->rfile', 'rfile->fileRepo'] },
      { idx: 3, t: '01:00', who: '系统',
        prompt: '后台异步生成对话标题"6 月销售明细分析"',
        caps: ['services/conversation_service.py 触发标题生成', '写入 conversation.title 字段'],
        files: ['services/conversation_service.py', 'entities/conversation.py', 'repositories/conversation_repo.py'],
        highlightNodes: ['title', 'convEnt'],
        highlightEdges: ['fileRepo->title', 'title->convEnt'] },
    ],
  },
  // ============= B: 首次提问"分析 6 月 GMV 下滑"（最核心） =============
  {
    id: 'B', name: 'B · 首次提问"分析 6 月 GMV 下滑"', color: '#FF6E40',
    desc: '★ 最核心场景 ★ WebSocket / Mapper / Agent / db_query / render_report',
    nodes: [
      { id: 'ws',      label: 'WebSocket 建连', module: 'router', file: 'routers/ws_chat.py' },
      { id: 'loadMsgs',label: '从 DB 加载历史', module: 'repo', file: 'repositories/message_repo.py' },
      { id: 'mapper',  label: 'Mapper 三向转换', module: 'biz', file: 'mappers/agent_mapper.py' },
      { id: 'agent',   label: '启动 DeepAgent', module: 'agent', file: 'agent/builder.py' },
      { id: 'skills',  label: '加载 .deepagents/ Skill', module: 'skill', file: '.deepagents/' },
      { id: 'svc',     label: '业务编排服务', module: 'biz', file: 'services/conversation_service.py' },
      { id: 'dbq',     label: 'db_query 工具', module: 'agent', file: 'agent/tools/db_query.py' },
      { id: 'data',    label: 'data-agent SSE', module: 'infra', file: 'core/redis_client.py' },
      { id: 'render',  label: 'render_report', module: 'agent', file: 'agent/tools/render_report.py' },
      { id: 'retFile', label: 'return_file', module: 'agent', file: 'agent/tools/return_file.py' },
      { id: 'push',    label: 'WS 推送流式', module: 'router', file: 'routers/ws_chat.py' },
    ],
    edges: [
      { from: 'ws', to: 'loadMsgs', label: '客户端发问' },
      { from: 'loadMsgs', to: 'mapper', label: '消息列表' },
      { from: 'mapper', to: 'agent', label: 'LLM 格式' },
      { from: 'agent', to: 'skills', label: '装配 Skill' },
      { from: 'skills', to: 'svc', label: '就绪' },
      { from: 'svc', to: 'dbq', label: 'LLM 调用工具' },
      { from: 'dbq', to: 'data', label: 'SSE 查数' },
      { from: 'data', to: 'dbq', label: '返回结果' },
      { from: 'svc', to: 'render', label: '生成报告' },
      { from: 'svc', to: 'retFile', label: '产出附件' },
      { from: 'svc', to: 'push', label: '流式文字' },
    ],
    steps: [
      { idx: 1, t: '02:00', who: '商家',
        prompt: '在对话框输入：分析一下 6 月 GMV 为什么跌了',
        caps: ['建立 WebSocket 连接', '从 DB 加载历史消息', 'mapper.agent_mapper 转 LLM 消息格式'],
        files: ['routers/ws_chat.py', 'repositories/message_repo.py', 'mappers/agent_mapper.py', 'schemas/agent_dto.py'],
        highlightNodes: ['ws', 'loadMsgs', 'mapper'],
        highlightEdges: ['ws->loadMsgs', 'loadMsgs->mapper'] },
      { idx: 2, t: '02:01', who: '系统',
        prompt: '启动 Agent（首次需要装配）',
        caps: ['agent.builder.py 创建 deepagents', '加载 .deepagents/ 下所有 Skill', '注册 db_query / return_file / render_report 工具'],
        files: ['agent/builder.py', '.deepagents/', 'agent/tools/db_query.py', 'agent/tools/return_file.py', 'agent/tools/render_report.py'],
        highlightNodes: ['agent', 'skills'],
        highlightEdges: ['mapper->agent', 'agent->skills'] },
      { idx: 3, t: '02:30', who: 'Agent',
        prompt: '思考：需要先查 GMV 趋势 → 拆解渠道 → 拆解品类',
        caps: ['LLM 调用 Skill: db_query', '调用 data-agent SSE 接口拿取数结果'],
        files: ['agent/tools/db_query.py', 'core/redis_client.py', 'services/conversation_service.py'],
        highlightNodes: ['svc', 'dbq', 'data'],
        highlightEdges: ['skills->svc', 'svc->dbq', 'dbq->data', 'data->dbq'] },
      { idx: 4, t: '03:00', who: 'Agent',
        prompt: '基于取数结果，让 render_report 生成 HTML 报告',
        caps: ['调用 render_report 工具', '写入工作区 + 数据库'],
        files: ['agent/tools/render_report.py', 'repositories/file_repo.py'],
        highlightNodes: ['render'],
        highlightEdges: ['svc->render'] },
      { idx: 5, t: '04:00', who: '商家',
        prompt: '看到流式文字 + 附件列表 + 工作区文件',
        caps: ['WebSocket 推送文字 + 文件 URL', '前端渲染对话气泡'],
        files: ['routers/ws_chat.py', 'agent/tools/return_file.py', 'services/conversation_service.py'],
        highlightNodes: ['retFile', 'push'],
        highlightEdges: ['svc->retFile', 'svc->push'] },
    ],
  },
  // ============= C: 追问"那 A 渠道呢？" =============
  {
    id: 'C', name: 'C · 追问"那 A 渠道呢？"', color: '#FFD740',
    desc: 'L1/L3 复用 / while True 自动重试',
    nodes: [
      { id: 'l1',    label: 'L1 Redis 命中', module: 'infra', file: 'core/redis_client.py' },
      { id: 'l3',    label: 'L3 DB 历史消息', module: 'repo', file: 'repositories/message_repo.py' },
      { id: 'reuse', label: '复用 Agent + Skill', module: 'agent', file: 'agent/builder.py' },
      { id: 'retry', label: 'while True 自动重试', module: 'biz', file: 'services/conversation_service.py' },
    ],
    edges: [
      { from: 'l1', to: 'l3', label: 'cache miss' },
      { from: 'l3', to: 'reuse', label: '上下文' },
      { from: 'reuse', to: 'retry', label: '调用工具' },
    ],
    steps: [
      { idx: 1, t: '09:30', who: '商家',
        prompt: '追问：那 A 渠道呢？分品类看看',
        caps: ['复用 L1 (Redis 短记忆) + L3 (DB 长记忆)', '复用已加载的 Agent + Skills', 'while True 自动重试截断'],
        files: ['core/redis_client.py', 'repositories/message_repo.py', 'agent/builder.py', 'services/conversation_service.py'],
        highlightNodes: ['l1', 'l3', 'reuse', 'retry'],
        highlightEdges: ['l1->l3', 'l3->reuse', 'reuse->retry'] },
    ],
  },
  // ============= D: 长对话触发上下文压缩 =============
  {
    id: 'D', name: 'D · 长对话触发上下文压缩', color: '#00E676',
    desc: 'L2 SummarizationMiddleware / seq_offset 换算',
    nodes: [
      { id: 'trigger', label: 'token 超限触发', module: 'biz', file: 'services/conversation_service.py' },
      { id: 'mid',     label: 'SummarizationMiddleware', module: 'biz', file: 'services/conversation_service.py' },
      { id: 'comp',    label: '写入 compaction 表', module: 'repo', file: 'repositories/compaction_repo.py' },
      { id: 'seqOff',  label: 'seq_offset 换算', module: 'biz', file: 'mappers/agent_mapper.py' },
      { id: 'reload',  label: '下次会话重载摘要', module: 'repo', file: 'repositories/message_repo.py' },
    ],
    edges: [
      { from: 'trigger', to: 'mid' },
      { from: 'mid', to: 'comp' },
      { from: 'comp', to: 'seqOff' },
      { from: 'seqOff', to: 'reload', label: '下次启动' },
    ],
    steps: [
      { idx: 1, t: '13:30', who: '商家',
        prompt: '已经聊了 20 轮，token 超限',
        caps: ['SummarizationMiddleware 触发', '压缩老消息 → 写入 context_compaction 表', '计算 seq_offset 换算消息序号'],
        files: ['entities/context_compaction.py', 'repositories/compaction_repo.py', 'services/conversation_service.py', 'mappers/agent_mapper.py'],
        highlightNodes: ['trigger', 'mid', 'comp', 'seqOff'],
        highlightEdges: ['trigger->mid', 'mid->comp', 'comp->seqOff'] },
      { idx: 2, t: '13:31', who: '商家',
        prompt: '下次会话开始 → 加载压缩上下文',
        caps: ['从 compaction 表读取摘要', '按 seq_offset 拼接新消息', 'Agent 重新看到完整上下文'],
        files: ['repositories/compaction_repo.py', 'repositories/message_repo.py', 'mappers/agent_mapper.py'],
        highlightNodes: ['reload'],
        highlightEdges: ['seqOff->reload'] },
    ],
  },
  // ============= E: 用户点"停止生成" =============
  {
    id: 'E', name: 'E · 用户点"停止生成"', color: '#40C4FF',
    desc: '_TurnStream / asyncio.Event 协作式取消',
    nodes: [
      { id: 'btn',     label: '前端发 cancel 帧', module: 'router', file: 'routers/ws_chat.py' },
      { id: 'turn',    label: '_TurnStream 设 Event', module: 'biz', file: 'services/conversation_service.py' },
      { id: 'partial', label: 'partial 消息入库', module: 'repo', file: 'repositories/message_repo.py' },
    ],
    edges: [
      { from: 'btn', to: 'turn' },
      { from: 'turn', to: 'partial', label: '协程退出' },
    ],
    steps: [
      { idx: 1, t: '12:30', who: '商家',
        prompt: '在流式输出过程中点"停止生成"按钮',
        caps: ['前端发 ws cancel 帧', '_TurnStream 设置 asyncio.Event', '当前轮次协程优雅退出'],
        files: ['routers/ws_chat.py', 'services/conversation_service.py', 'errors/exceptions.py'],
        highlightNodes: ['btn', 'turn'],
        highlightEdges: ['btn->turn'],
        warn: false },
      { idx: 2, t: '12:31', who: '系统',
        prompt: '已生成的内容全保存到 DB',
        caps: ['partial 消息入库', '前端显示"已停止"', '不影响后续对话'],
        files: ['repositories/message_repo.py', 'entities/message.py', 'errors/handlers.py'],
        highlightNodes: ['partial'],
        highlightEdges: ['turn->partial'] },
    ],
  },
  // ============= F: 运营 curl /api/reload =============
  {
    id: 'F', name: 'F · 运营 curl /api/reload', color: '#B388FF',
    desc: 'reload_config / reset_agent / 单例锁',
    nodes: [
      { id: 'admin',   label: 'POST /api/reload', module: 'router', file: 'routers/admin.py' },
      { id: 'cfg',     label: '重读 config.yml', module: 'infra', file: 'core/config.py' },
      { id: 'lock',    label: '单例锁', module: 'infra', file: 'core/settings.py' },
      { id: 'reset',   label: 'reset_agent', module: 'agent', file: 'agent/builder.py' },
      { id: 'reloadSkl',label: '重载 .deepagents/', module: 'skill', file: '.deepagents/' },
    ],
    edges: [
      { from: 'admin', to: 'cfg' },
      { from: 'cfg', to: 'lock' },
      { from: 'lock', to: 'reset' },
      { from: 'reset', to: 'reloadSkl' },
    ],
    steps: [
      { idx: 1, t: '28:30', who: '运营',
        prompt: 'curl -X POST localhost:8000/api/reload',
        caps: ['admin.py 路由触发 reload', '重读 config.yml', '获取单例锁 → reset_agent'],
        files: ['routers/admin.py', 'core/config.py', 'core/settings.py', 'agent/builder.py'],
        highlightNodes: ['admin', 'cfg', 'lock', 'reset'],
        highlightEdges: ['admin->cfg', 'cfg->lock', 'lock->reset'] },
      { idx: 2, t: '28:31', who: '系统',
        prompt: '新 Skill 配置生效',
        caps: ['重新加载 .deepagents/', '下次会话使用新配置', '旧 Agent 实例安全释放'],
        files: ['.deepagents/', 'agent/builder.py', 'services/conversation_service.py'],
        highlightNodes: ['reloadSkl'],
        highlightEdges: ['reset->reloadSkl'] },
    ],
  },
  // ============= G: 调外部搜索工具 (MCP) =============
  {
    id: 'G', name: 'G · 调外部搜索工具 (MCP)', color: '#FF80AB',
    desc: 'MultiServerMCPClient 4 种传输',
    nodes: [
      { id: 'agent',  label: 'Agent 决策', module: 'agent', file: 'agent/builder.py' },
      { id: 'mcp',    label: 'MCP 客户端', module: 'infra', file: 'core/config.py' },
      { id: 'tavily', label: 'tavily_search SSE', module: 'agent', file: 'agent/builder.py' },
      { id: 'parse',  label: '解析结果', module: 'biz', file: 'mappers/agent_mapper.py' },
    ],
    edges: [
      { from: 'agent', to: 'mcp', label: '选择 mcp__tavily__search' },
      { from: 'mcp', to: 'tavily', label: 'SSE 传输' },
      { from: 'tavily', to: 'parse' },
    ],
    steps: [
      { idx: 1, t: '11:30', who: 'Agent',
        prompt: '需要查 2026 年行业数据 → 调 tavily MCP',
        caps: ['Agent 选择 mcp__tavily__search 工具', 'MultiServerMCPClient 通过 SSE 传输', '解析返回结果'],
        files: ['agent/builder.py', 'core/config.py', 'mappers/agent_mapper.py'],
        highlightNodes: ['agent', 'mcp', 'tavily', 'parse'],
        highlightEdges: ['agent->mcp', 'mcp->tavily', 'tavily->parse'] },
    ],
  },
  // ============= H: 删除整个对话 =============
  {
    id: 'H', name: 'H · 删除整个对话', color: '#9E9E9E',
    desc: '3 层记忆级联 + 工作区物理删除',
    nodes: [
      { id: 'rconv',   label: 'DELETE /api/conversations/:id', module: 'router', file: 'routers/conversation.py' },
      { id: 'l1del',   label: 'L1 Redis 删', module: 'infra', file: 'core/redis_client.py' },
      { id: 'l3del',   label: 'L3 DB 删 conversation/message/compaction', module: 'repo', file: 'repositories/conversation_repo.py' },
      { id: 'wsDel',   label: '物理删除工作区', module: 'repo', file: 'repositories/file_repo.py' },
    ],
    edges: [
      { from: 'rconv', to: 'l1del' },
      { from: 'l1del', to: 'l3del' },
      { from: 'l3del', to: 'wsDel' },
    ],
    steps: [
      { idx: 1, t: '29:30', who: '商家',
        prompt: '点删除按钮 → 确认',
        caps: ['L1 Redis 删短记忆', 'L3 DB 删 conversation + message + context_compaction', 'L2 标记压缩记录删除', '物理删除工作区目录'],
        files: ['core/redis_client.py', 'repositories/conversation_repo.py', 'repositories/message_repo.py', 'repositories/compaction_repo.py', 'repositories/file_repo.py', 'routers/conversation.py'],
        highlightNodes: ['rconv', 'l1del', 'l3del', 'wsDel'],
        highlightEdges: ['rconv->l1del', 'l1del->l3del', 'l3del->wsDel'] },
    ],
  },
];

// ========== 关联流程图（多场景合并） ===========
// crossLinks: 跨场景的人工连接（自动合并时使用）
const CROSS_LINKS = {
  // A 的出口节点（title/convEnt）→ B 的入口（ws）
  'A->B': [{ from: 'convEnt', to: 'ws', label: '提问开始' }],
  // B 的出口（push）→ C 的入口（reuse，模块复用所以是同一个 agent）
  'B->C': [{ from: 'push', to: 'reuse', label: '复用 Agent' }],
  // C 的出口（retry）→ D 的入口（trigger，触发压缩）
  'C->D': [{ from: 'retry', to: 'trigger', label: 'token 累计' }],
  // D 的出口（reload）→ E 的入口（btn，停止生成）
  'D->E': [{ from: 'reload', to: 'btn', label: '下一轮' }],
  // B → F：直接重新加载
  'B->F': [{ from: 'push', to: 'admin', label: '运营介入' }],
  // B → G：Agent 调外部搜索
  'B->G': [{ from: 'svc', to: 'agent', label: '需要外部数据' }],
  // G → H：清理
  'G->H': [{ from: 'parse', to: 'rconv', label: '对话结束' }],
  // F → H：热更后也可能删除
  'F->H': [{ from: 'reloadSkl', to: 'rconv', label: '清理旧会话' }],
};

function getCrossLinks(fromScenarioId, toScenarioId) {
  return CROSS_LINKS[`${fromScenarioId}->${toScenarioId}`] || [];
}

const FLOWS = [
  {
    id: 'flow-onboarding', name: 'Flow · 接入流程（A → B）', color: '#FF4081',
    desc: '从登录到首次提问，跨场景连接 1 条',
    scenarioIds: ['A', 'B'],
  },
  {
    id: 'flow-conversation', name: 'Flow · 对话主流程（B → C → D → E）', color: '#FF6E40',
    desc: '核心对话 + 追问 + 压缩 + 取消，跨场景连接 3 条',
    scenarioIds: ['B', 'C', 'D', 'E'],
  },
  {
    id: 'flow-lifecycle', name: 'Flow · 完整生命周期（B → C → D → F → G → H）', color: '#7C3AED',
    desc: '从首次提问到热更新 + MCP + 删除，跨场景连接 4 条',
    scenarioIds: ['B', 'C', 'D', 'F', 'G', 'H'],
  },
];

// ========== 连续对话 9 步（独立） ===========
const CONTINUOUS_STEPS = [
  { step: 1, t: '00:00', who: '商家', scenario: 'A',
    prompt: '登录 insight-agent（OAuth2 + PKCE）',
    caps: ['Token 校验通过', 'trace_id 入 ContextVar', 'L1 Redis 准备就绪'],
    files: ['plugins/lifespan/auth.py', 'core/tracing.py', 'core/context.py', 'core/redis_client.py'] },
  { step: 2, t: '00:30', who: '商家', scenario: 'A',
    prompt: '建对话 + 上传 6 月 Excel',
    caps: ['POST /api/conversations 建会话', '上传附件到工作区', '后台异步生成标题'],
    files: ['routers/conversation.py', 'routers/file.py', 'repositories/conversation_repo.py', 'repositories/file_repo.py', 'services/conversation_service.py'] },
  { step: 3, t: '01:30', who: '商家', scenario: 'B',
    prompt: '分析一下 6 月 GMV 为什么跌了',
    caps: ['★ 核心全链路 ★', 'WS 建连 + 加载历史 + Mapper 三向', 'Agent 启动 + Skill 加载 + db_query + render_report + return_file', '流式推送文字 + 附件'],
    files: ['routers/ws_chat.py', 'repositories/message_repo.py', 'mappers/agent_mapper.py', 'schemas/agent_dto.py', 'schemas/tool_result.py', 'agent/builder.py', '.deepagents/', 'agent/tools/db_query.py', 'agent/tools/render_report.py', 'agent/tools/return_file.py', 'services/conversation_service.py'] },
  { step: 4, t: '09:30', who: '商家', scenario: 'C',
    prompt: '那 A 渠道呢？分品类看看',
    caps: ['L1/L3 复用历史', '复用 Agent + Skills', 'while True 自动重试截断'],
    files: ['core/redis_client.py', 'repositories/message_repo.py', 'agent/builder.py'] },
  { step: 5, t: '11:30', who: 'Agent', scenario: 'G',
    prompt: '需要查 2026 年行业数据 → 调 tavily MCP',
    caps: ['选择 mcp__tavily__search 工具', 'MultiServerMCPClient 通过 SSE 传输', '解析返回结果'],
    files: ['agent/builder.py', 'core/config.py', 'mappers/agent_mapper.py'] },
  { step: 6, t: '12:30', who: '商家', scenario: 'E',
    prompt: '点"停止生成"按钮',
    caps: ['_TurnStream 收到 cancel', 'asyncio.Event 协作式取消', '已生成内容全入库'],
    files: ['routers/ws_chat.py', 'services/conversation_service.py', 'errors/exceptions.py', 'repositories/message_repo.py'],
    warn: true,
    warnText: '⚠️ 异常分支：WS 异常断开时，已生成的消息全在 DB 不丢' },
  { step: 7, t: '13:30', who: '商家', scenario: 'D',
    prompt: '连续 20 轮追问细节',
    caps: ['L2 SummarizationMiddleware 触发', '压缩老消息 → context_compaction 表', 'seq_offset 换算消息序号'],
    files: ['entities/context_compaction.py', 'repositories/compaction_repo.py', 'services/conversation_service.py', 'mappers/agent_mapper.py'],
    warn: true,
    warnText: '⚠️ 异常分支：连续 3 次模型都截断 → 推送错误 + WS 不中断' },
  { step: 8, t: '28:30', who: '运营', scenario: 'F',
    prompt: 'curl -X POST localhost:8000/api/reload',
    caps: ['admin.py 触发 reload', '重读 config.yml', '单例锁 → reset_agent'],
    files: ['routers/admin.py', 'core/config.py', 'core/settings.py', 'agent/builder.py'] },
  { step: 9, t: '29:30', who: '商家', scenario: 'H',
    prompt: '删除这条对话',
    caps: ['L1 Redis 删短记忆', 'L3 DB 删 conversation + message + compaction', '物理删除工作区目录'],
    files: ['core/redis_client.py', 'repositories/conversation_repo.py', 'repositories/message_repo.py', 'repositories/compaction_repo.py', 'repositories/file_repo.py', 'routers/conversation.py'] },
];

// ========== 工具函数 ===========
function getFileInfo(path) {
  return FILES.find(f => f.path === path) || { path, module: 'infra', desc: '' };
}
function getModuleColor(modKey) {
  return (MODULES[modKey] || MODULES.infra).color;
}
function getModuleName(modKey) {
  return (MODULES[modKey] || MODULES.infra).name;
}
function getScenario(id) {
  return SCENARIOS.find(s => s.id === id);
}

// 导出（避免与 HTML 端解构重名冲突，直接挂全局函数）
if (typeof window !== 'undefined') {
  window.INSIGHT_DATA = { MODULES, FILES, SCENARIOS, FLOWS, CONTINUOUS_STEPS, CROSS_LINKS };
  window.getFileInfo = getFileInfo;
  window.getModuleColor = getModuleColor;
  window.getModuleName = getModuleName;
  window.getScenario = getScenario;
  window.getCrossLinks = getCrossLinks;
}