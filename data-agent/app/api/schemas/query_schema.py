from pydantic import BaseModel


class QuerySchema(BaseModel):
    query: str
    # === 2026-06-09 新增：可选 conversation_id
    # 用途：让 data-agent 把这个请求的日志写到 logs/conv-{id}.log
    #      （不限大小，按 conversation 分文件，跟 insight-agent 的 workspace 子目录一一对应）
    # === 新增结束 ===
    conversation_id: int | None = None
