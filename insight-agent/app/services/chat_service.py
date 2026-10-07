import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.agent import get_agent, get_workspace_dir
from app.core.database import get_db_session
from app.entities.chat import ContextCompaction
from app.mappers import message_mapper
from app.repositories import context_compaction_repo, conversation_repo, message_repo
from app.schemas import chat_schema


@dataclass
class ConversationContext:
    """WebSocket 会话的对话状态"""

    messages: list[dict]
    context_seq: int
    is_draft: bool


async def load_conversation_context(
    conversation_id: int, user_id: int
) -> ConversationContext | None:
    """
    加载对话初始上下文：校验对话归属、加载历史消息、应用压缩上下文。

    对话不存在或不属于当前用户时返回 None。
    """
    async with get_db_session() as db_session:
        # ========= 检查对话归属 =========
        # 检查对话是否存在且属于当前用户
        conversation = await conversation_repo.get_by_id(db_session, conversation_id)
        if conversation is None or conversation.user_id != user_id:
            return None
        # 标记是否为草稿对话
        is_draft = conversation.is_draft == 1

        # ========= 加载历史消息 =========
        # 从数据库加载历史消息
        message_entities = await message_repo.ls(db_session, conversation_id)
        # 获取最后一个消息的 context_seq；若没有历史消息，则将 context_seq 设置为 -1
        cur_context_seq = message_entities[-1].context_seq if message_entities else -1
        # 将历史消息转换为 LangChain Message
        messages = [
            message_mapper.schema_to_langchain_message(
                message_mapper.entity_to_schema(i),
                user_id=user_id,
                conversation_id=conversation_id,
            )
            for i in message_entities
        ]

        # ======== 应用压缩上下文 =========
        # 从数据库加载最新压缩上下文
        context_compaction_entity = await context_compaction_repo.get_latest_by_conversation_id(
            db_session, conversation_id
        )
        # 如果存在压缩上下文，则替换历史消息前缀
        if context_compaction_entity:
            messages[: context_compaction_entity.end_seq] = [
                {"role": "user", "content": context_compaction_entity.summary_message}
            ]

    return ConversationContext(
        messages=messages,
        context_seq=cur_context_seq,
        is_draft=is_draft,
    )


async def _add_message(
    db_session: AsyncSession,
    user_id: int,
    conversation_id: int,
    messages: list[dict],
    message: chat_schema.MessageSchema,
):
    """将消息写入数据库与消息列表，并同步刷新对话更新时间"""
    # 消息入库
    message_entity = message_mapper.schema_to_entity(message, conversation_id)
    await message_repo.create(db_session, message_entity)
    # 追加内存消息列表
    messages.append(
        message_mapper.schema_to_langchain_message(
            message, user_id=user_id, conversation_id=conversation_id
        )
    )
    # 刷新对话更新时间
    await conversation_repo.touch_update_at(db_session, conversation_id)


async def _execute_agent(
    messages: list[dict],
    user_id: int,
    conversation_id: int,
) -> AsyncIterator[dict]:
    """执行 Agent 并流式返回原始 chunk"""
    # 获取并确保用户会话工作区目录存在
    workspace_dir = get_workspace_dir(user_id, conversation_id)
    # 创建 Agent 运行配置
    config = RunnableConfig(configurable={"workspace_dir": str(workspace_dir)})
    # 获取 Agent 实例
    agent = await get_agent()

    async for chunk in agent.astream(input={"messages": messages}, config=config):
        yield chunk


def _extract_compaction(
    chunk: dict, seq_offset: int, conversation_id: int
) -> tuple[int, str, ContextCompaction] | None:
    """从 agent chunk 中提取上下文压缩事件，返回 (cutoff_index, summary, compaction)。"""
    if "model" not in chunk or "_summarization_event" not in chunk["model"]:
        return None
    event = chunk["model"]["_summarization_event"]
    cutoff_index = event["cutoff_index"]
    summary_payload = event["summary_message"]
    summary = (
        summary_payload.content if hasattr(summary_payload, "content") else str(summary_payload)
    )
    logger.info(f"{conversation_id=}: {summary=}")
    # seq_offset: context_seq 与 messages 索引之间的偏移量
    # end_seq = seq_offset + cutoff_index 得出压缩范围 [0, end_seq)
    #
    # 例1（无压缩前文）: messages=[0,1,2,3,4,5], cur_context_seq=5, len=6
    # → seq_offset=0, cutoff_index=3 → end_seq=3, 结束后 messages=[summary,3,4,5]
    #
    # 例2（已有压缩前文）: messages=[summary,3,4,5,6,7], cur_context_seq=7, len=6
    # → seq_offset=2, cutoff_index=3 → end_seq=5 (context_seq 0..4 被摘要)
    end_seq = seq_offset + cutoff_index
    compaction = ContextCompaction(
        conversation_id=conversation_id,
        end_seq=end_seq,
        summary_message=summary,
    )
    return cutoff_index, summary, compaction


async def run_agent_turn(
    db_session: AsyncSession,
    user_id: int,
    conversation_id: int,
    messages: list[dict],
    user_message: chat_schema.MessageSchema,
    cancel: asyncio.Event,
) -> AsyncIterator[chat_schema.MessageSchema]:
    """
    执行一轮 Agent 对话并流式返回响应。

    当 Agent 因无工具调用而退出但 finish_reason != "stop" 时
    （如模型被截断或未正常结束），自动将消息重新输入 Agent 继续。
    """
    logger.info(f"{conversation_id=}: {user_message=}")

    # 消息入库，同时追加到内存消息列表
    await _add_message(db_session, user_id, conversation_id, messages, user_message)

    # 获取最新消息的 context_seq
    cur_context_seq = user_message.context_seq or 0

    while True:
        # 计算消息列表中消息的 context_seq 与消息索引之间的偏移量
        seq_offset = cur_context_seq - len(messages) + 1
        last_finish_reason: str | None = None  # 最后一条消息的 finish_reason
        last_cutoff_index: int | None = None  # 最后一次压缩事件的截断位置
        last_summary: str | None = None  # 最后一次压缩事件的摘要内容
        pending_compaction: ContextCompaction | None = None  # 待写入数据库的压缩上下文

        async for chunk in _execute_agent(messages, user_id, conversation_id):
            # 收到取消信号则跳出循环
            if cancel.is_set():
                logger.info(f"{conversation_id=}: agent cancelled")
                break

            logger.info(f"{conversation_id=}: agent_response={chunk}")

            # 处理上下文压缩
            if compaction := _extract_compaction(chunk, seq_offset, conversation_id):
                last_cutoff_index, last_summary, pending_compaction = compaction

            # 将 agent 输出的消息转换为 MessageSchema
            responses = message_mapper.agent_chunk_to_schemas(chunk)
            if responses:
                for response in responses:
                    cur_context_seq += 1  # 递增 context_seq
                    response.context_seq = cur_context_seq
                    # 消息入库，同时追加到内存消息列表
                    await _add_message(db_session, user_id, conversation_id, messages, response)
                    # 记录模型最后一条消息的 finish_reason
                    last_finish_reason = response.finish_reason
                    yield response

            # 写入压缩记录
            if pending_compaction is not None:
                await context_compaction_repo.create(db_session, pending_compaction)
                pending_compaction = None

        # 应用最后一次压缩到消息列表
        if last_cutoff_index is not None and last_summary is not None:
            messages[:last_cutoff_index] = [{"role": "user", "content": last_summary}]

        # 模型正常结束或用户取消则退出循环
        if last_finish_reason == "stop" or cancel.is_set():
            break

    logger.info(f"{conversation_id=}: agent finished")


# === 会话标题生成（基于用户首个问题 LLM 总结） ===

_title_llm = None
_title_llm_lock = asyncio.Lock()


async def _get_title_llm():
    global _title_llm
    if _title_llm is not None:
        return _title_llm
    async with _title_llm_lock:
        if _title_llm is not None:
            return _title_llm
        from langchain.chat_models import init_chat_model
        from app.core import settings

        cfg = settings.cfg.lm_config
        model_cfg = cfg.models[cfg.active]
        _title_llm = init_chat_model(
            model_provider="openai",
            model=model_cfg.model,
            base_url=model_cfg.base_url,
            api_key=model_cfg.api_key,
            profile=dict(model_cfg.profile),
            request_timeout=30,
            max_retries=1,
        )
        return _title_llm


_TITLE_SYSTEM_PROMPT = """你是一个会话标题生成助手。你的任务是根据用户的首个问题，生成一个**5 到 10 个汉字**的简短对话标题。

要求：
- 用中文，简洁明了
- 直接反映用户想问什么
- 不要加标点符号（除非必要）
- 不要用"关于..."等套话开头
- 不要用引号包裹
- 只输出标题本身，不要任何解释

示例：
用户问题：最近 3 个月的退款归因分析
标题：3个月退款归因

用户问题：帮我查一下订单总金额和退款金额
标题：订单与退款金额

用户问题：今天天气怎么样
标题：天气查询

用户问题：上周的销量下降了，是什么原因
标题：上周销量下滑分析"""


async def generate_conversation_title(user_message: str) -> str | None:
    if not user_message or not user_message.strip():
        return None
    try:
        logger.info(f"[title-gen] 开始生成标题，用户消息前30字: {user_message[:30]!r}")
        llm = await _get_title_llm()
        logger.info(f"[title-gen] LLM 实例已获取，开始调用 ainvoke")
        resp = await asyncio.wait_for(
            llm.ainvoke(
                [
                    SystemMessage(content=_TITLE_SYSTEM_PROMPT),
                    HumanMessage(content=user_message[:500]),
                ]
            ),
            timeout=30,
        )
        title = (resp.content or "").strip()
        title = title.strip('"\'"').strip()
        if len(title) > 30:
            title = title[:30]
        if not title:
            logger.warning("[title-gen] LLM 返回空标题")
            return None
        logger.info(f"[title-gen] 生成成功: {title!r}")
        return title
    except asyncio.TimeoutError:
        logger.warning("[title-gen] 调用超时（30s），跳过")
        return None
    except Exception as e:
        logger.warning(f"[title-gen] 失败: {type(e).__name__}: {e!r}")
        return None


async def generate_and_save_title_background(
    conversation_id: int,
    user_id: int,
    user_message: str,
) -> str | None:
    """后台异步任务：生成标题 + 落库

    为什么不放在主流程：
    - LLM 调用 1-3 秒，会阻塞首条消息响应
    - 失败时不能影响主 Agent 流程
    - 标题可以"迟一点"显示（用户已经在看 Agent 回复了）
    """
    title = await generate_conversation_title(user_message)
    if not title:
        return None
    try:
        # 独立 DB session（主流程的 session 可能已经关闭）
        async with get_db_session() as db_session:
            conversation = await conversation_repo.get_by_id(db_session, conversation_id)
            if conversation is None or conversation.user_id != user_id:
                logger.warning(
                    f"{conversation_id=}: 对话不存在或不属于用户，跳过标题更新"
                )
                return None
            # 2026-06-09 改动：只有当前 title 还是"新对话"才更新
            # 防止用户已经手动改过标题后被覆盖
            if conversation.title and conversation.title != "新对话":
                logger.info(
                    f"{conversation_id=}: 标题已被改过 ({conversation.title!r})，跳过"
                )
                return None
            await conversation_repo.update(db_session, conversation, title=title)
            await db_session.commit()
            logger.info(f"{conversation_id=}: 标题已更新为 {title!r}")
            return title
    except Exception as e:
        logger.warning(f"{conversation_id=}: 保存标题失败: {type(e).__name__}: {e!r}")
        return None
