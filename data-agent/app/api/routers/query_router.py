from fastapi import APIRouter
from fastapi.params import Depends
from starlette.responses import StreamingResponse

from app.api.dependencies import get_query_service
from app.api.schemas.query_schema import QuerySchema
from app.core.context import conversation_id_ctx_var
from app.services.query_service import QueryService
# === 2026-06-09 新增：导入 ensure_conv_logger 动态创建 sink
from app.core.log import ensure_conv_logger
# === 新增结束 ===

query_router = APIRouter()


@query_router.post("/api/query")
async def query(
    query: QuerySchema, query_service: QueryService = Depends(get_query_service)
):
    # === 2026-06-09 新增：把 conversation_id 存到 ctx_var + 动态创建该 conv 的日志文件
    # 之前 main.py 的 request_id 中间件只设了 request_id，没设 conversation_id
    # 现在 insight-agent 会在 POST body 里带 conversation_id，我们存起来给 logger 用
    # + 主动 ensure sink（首次见时创建 logs/conv-{id}.log）
    # === 新增结束 ===
    if query.conversation_id is not None:
        conversation_id_ctx_var.set(query.conversation_id)
        ensure_conv_logger(query.conversation_id)

    return StreamingResponse(
        query_service.query(query.query), media_type="text/event-stream"
    )
