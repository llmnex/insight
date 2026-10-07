from contextvars import ContextVar

request_id_ctx_var = ContextVar("request_id", default="1")

# === 2026-06-09 新增：conversation_id context var
# 用途：每个 SSE 请求里携带的 conversation_id，存到这里，
#      log.py 读这个 var 决定写到 logs/conv-{id}.log 还是 logs/app.log 兜底
# 默认 None 表示"未知 conversation"，走兜底文件
# === 新增结束 ===
conversation_id_ctx_var: ContextVar[int | None] = ContextVar(
    "conversation_id", default=None
)

