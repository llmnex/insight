from asyncio import Lock
from pathlib import Path
from typing import Any

from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, FilesystemBackend, LocalShellBackend
from langchain.chat_models import init_chat_model
from langgraph.config import get_config
from langgraph.graph.state import CompiledStateGraph

from app.agent.mcp import get_mcp_tools
from app.agent.tools import db_query, return_file
from app.core import settings

CURRENT_DIR = Path(__file__).parent
ROOT_DIR = CURRENT_DIR.parent.parent
DEEPAGENTS_ROOT = ROOT_DIR / ".deepagents"
SKILLS_DIR = DEEPAGENTS_ROOT / "skills"
WORKSPACES_DIR = DEEPAGENTS_ROOT / "workspaces"

_agent: CompiledStateGraph | None = None
_agent_lock = Lock()


def get_workspace_dir(user_id: int, conversation_id: int) -> Path:
    """获取并确保用户会话工作区目录存在"""
    workspace_dir = WORKSPACES_DIR / f"user_{user_id}" / str(conversation_id)
    workspace_dir.mkdir(parents=True, exist_ok=True)
    return workspace_dir


def _backend_factory(rt: Any) -> CompositeBackend:
    """根据运行时配置动态创建工作区后端"""
    # 从 LangGraph 运行时配置中获取工作区目录
    workspace_dir = get_config().get("configurable", {}).get("workspace_dir")
    if workspace_dir is None:
        raise ValueError("workspace_dir not found in config")

    # 工作区文件系统后端
    workspace_backend = LocalShellBackend(
        root_dir=Path(workspace_dir), virtual_mode=True, inherit_env=True
    )

    # 技能文件系统后端
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    skills_backend = FilesystemBackend(root_dir=SKILLS_DIR, virtual_mode=True)

    # CompositeBackend 将多个后端合并为一个统一视图，对 Agent 透明：
    # - default: 工作区后端（LocalShellBackend），处理除 /skills/ 外的所有路径
    # - routes["/skills/"]: 命中此前缀时，剥离前缀后将剩余路径转发到 skills_backend
    #   例如 Agent 请求 /skills/insight/SKILL.md → skills_backend 收到 insight/SKILL.md
    return CompositeBackend(default=workspace_backend, routes={"/skills/": skills_backend})


async def _build_agent() -> CompiledStateGraph:
    model_cfg = settings.cfg.lm_config.models[settings.cfg.lm_config.active]
    model = init_chat_model(
        model_provider="openai",
        model=model_cfg.model,
        base_url=model_cfg.base_url,
        api_key=model_cfg.api_key,
        profile=model_cfg.profile,
        request_timeout=180,
        max_retries=2,
        **model_cfg.params,
    )

    # 加载工具
    mcp_tools = await get_mcp_tools()
    tools = [db_query, return_file, *mcp_tools]

    # === 2026-06-09 新增：中文 system_prompt（覆盖 deepagents 默认英文 base_prompt）
    # 原因：
    #   1. 业务用户用中文提问，LLM 用英文回复会"翻译一遍"才说人话，浪费 token
    #   2. SKILL.md 已经是中文，base prompt 是英文 → prompt 内中英混排容易让 LLM 偶尔回英文
    #   3. 用户(讲师)明确要求"全部换成中文"
    # 注意：deepagents 会自动在 system_prompt 后追加 BASE_AGENT_PROMPT（英文），
    #       中文在前占主导地位，英文 base prompt 仍保留（包含 tool usage 等不可省略的行为约束）
    system_prompt = """\
你是一个业务数据分析专家 Agent，服务对象是国内零售/电商行业的运营、运营经理、店长、老板等非技术用户。

【核心行为】
- 用中文回答，技术术语保留英文（如 pandas、DataFrame、SQL）
- 简洁直接，不要客套话（"好的，我来帮您……"），直接说结论
- 数字结论要带单位（"元"、"万元"、"笔"），不要只给 raw 数字
- 时间、金额、状态值写明口径（如"2026-03-01 ~ 2026-06-08 的退款成功金额"）

【专业客观】
- 数据有疑义时主动质疑用户假设，不要顺着用户错
- 出现多个解读时先列出来再给建议
- 不知道的不要编，标注"待确认"并给出查证路径

【任务执行】
- 任务分 3 步：理解 → 执行 → 验证
- 数据获取**只能**通过 db_query 工具（**绝对不要**直接 exec python 读 MySQL，db_query 是 data-agent SSE 通道，绕开会丢失元数据召回 + 字段别名支持）
- 中间结果写文件（CSV / JSON / chart_data.json），最终 HTML 走 outputs/
- 长任务每 3-5 步 emit 一次 progress 提示用户当前在做什么

【工具使用优先级】
1. 业务数据查询 → db_query（必须）
2. 文件读写 → read_file / write_file / edit_file（优先于 shell cat/sed/echo）
3. 数据分析 → uv run python -c "..."  (pandas / numpy / sklearn)
4. 兜底 → uv run python -m xxx
- 多个独立操作并行调用，不要串行

【避免的常见错误】
- 不要用 echo "..." > file.py 写大段代码 → 改用 write_file
- 不要在 python -c 里写超过 5 行代码 → 改用 write_file 写文件再 uv run python script.py
- 不要在 Windows 用 .bat / .ps1 / cmd 跨平台命令 → 统一用 uv run python
- 不要在 prompt 里假设字段名（如 refund_reason 不存在，应该是 refund_reason_code / refund_reason_desc）→ 用 db_query 让 data-agent 帮你识别

【文件读取】
- 读大文件先 read_file(path, limit=100) 看结构，再 offset/limit 精读
- **本项目 SKILL.md 必读完整**：调用 `read_file(path="/skills/insight/SKILL.md", limit=2000)` 一次性读完全部内容
  - **不要**用默认 limit=100，否则会丢后半段（退款归因专题、HTML 渲染、pandas 规则都在后半）
- 多个文件要读时**并行**调用，不要串行

【进度同步】
- 长任务每完成一个里程碑，简短一句"已完成 X，接下来 Y"
- 任务结束给用户 1 段总结：业务问题 / 用到的数据 / 核心结论 / 文件路径
"""
    # === 中文 system_prompt 结束 ===

    agent = create_deep_agent(
        model=model,
        tools=tools,
        system_prompt=system_prompt,  # 2026-06-09 新增：传中文 system_prompt
        backend=_backend_factory,  # 根据运行时配置动态创建工作区后端
        skills=["/skills/"],  # 声明 Agent 可用的 Skill 前缀路径
    )

    return agent


async def get_agent() -> CompiledStateGraph:
    """获取全局复用的 Agent 实例，不存在时按需创建"""
    global _agent
    if _agent is not None:
        return _agent

    async with _agent_lock:
        if _agent is None:
            _agent = await _build_agent()
        return _agent


async def reset_agent() -> None:
    global _agent
    async with _agent_lock:
        _agent = None
