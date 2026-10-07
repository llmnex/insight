from langgraph.runtime import Runtime

from app.agent.context import DataAgentContext
from app.agent.state import DataAgentState
from app.core.log import logger


async def execute_sql(state: DataAgentState, runtime: Runtime[DataAgentContext]):
    writer = runtime.stream_writer
    writer({"type": "progress", "step": "执行SQL", "status": "running"})

    sql = state["sql"]

    dw_mysql_repository = runtime.context["dw_mysql_repository"]

    try:
        result = await dw_mysql_repository.execute_sql(sql)

        writer({"type": "progress", "step": "执行SQL", "status": "success"})
        writer({"type": "result", "data": result})
        logger.info("执行SQL成功")

    except Exception as e:
        writer({"type": "progress", "step": "执行SQL", "status": "error"})
        # === 2026-06-08 修复：异常时 emit 独立的 type=error chunk 给前端 SSE 流
        # 原因：原代码 raise 但没 emit error 类型 → 前端 WebSocket 永远等不到
        #       result chunk（前端逻辑是"等 result 才算结束"）→ 表现为"卡住"
        # 协议：SSE 流有 3 种类型：progress / result / error
        #       正常完成用 result+data，异常用 error+error_msg
        # === 配套：insight-agent app/agent/tools/db_query.py 同步加 type=error 解析
        writer({"type": "error", "step": "执行SQL", "error": f"{type(e).__name__}: {e!r}"})
        logger.error(f"执行SQL失败:{str(e)}")
        raise
