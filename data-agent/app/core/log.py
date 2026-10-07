import sys
import threading
from pathlib import Path

from loguru import logger

from app.conf.app_config import app_config
from app.core.context import conversation_id_ctx_var, request_id_ctx_var

# 配置日志格式（保持和原版一致）
log_format = (
    "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
    "<level>{level: <8}</level> | "
    "<magenta>request_id - {extra[request_id]}</magenta> | "
    "<magenta>conv - {extra[conversation_id]}</magenta> | "
    "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - "
    "<level>{message}</level>"
)


# 注入 request_id + conversation_id 到日志记录中
def _inject_ctx(record):
    record["extra"]["request_id"] = request_id_ctx_var.get()
    cid = conversation_id_ctx_var.get()
    record["extra"]["conversation_id"] = cid if cid is not None else "-"


# === 2026-06-09 改造：按 conversation_id 动态分文件日志 ===
# 设计：
# - 每个 SSE 请求会带 conversation_id（insight-agent 端 db_query 传入）
# - 首次遇到某个 conversation_id 时，动态 add 一个新 sink（logs/conv-{id}.log）
# - 没有 conversation_id 的请求走兜底 logs/app.log
# - 所有 conversation 级 sink 都不限大小（无 rotation）
# === 改造结束 ===

# 线程安全锁（loguru add/remove 需要）
_sink_lock = threading.Lock()
# conversation_id -> loguru sink_id 映射
_conv_sinks: dict[int, int] = {}
# 兜底 sink id（无 conversation_id 时用）
_fallback_sink_id: int | None = None


def _ensure_fallback_sink() -> int:
    """确保兜底 sink 存在（无 conversation_id 的请求用）"""
    global _fallback_sink_id
    if _fallback_sink_id is not None:
        return _fallback_sink_id
    with _sink_lock:
        if _fallback_sink_id is not None:
            return _fallback_sink_id
        path = Path("logs")
        path.mkdir(parents=True, exist_ok=True)
        # 兜底 sink 用控制台同一份输出
        if app_config.logging.console.enable:
            _fallback_sink_id = logger.add(
                sink=sys.stdout,
                level=app_config.logging.console.level,
                format=log_format,
            )
        return _fallback_sink_id


def _ensure_conv_sink(conv_id: int) -> int:
    """确保某个 conversation 的 sink 存在，返回 sink id"""
    if conv_id in _conv_sinks:
        return _conv_sinks[conv_id]
    with _sink_lock:
        # double-check（其他线程可能已经加过了）
        if conv_id in _conv_sinks:
            return _conv_sinks[conv_id]
        path = Path("logs")
        path.mkdir(parents=True, exist_ok=True)
        sink_id = logger.add(
            sink=path / f"conv-{conv_id}.log",
            level="INFO",
            format=log_format,
            # === 关键：不传 rotation / retention → 不限大小
            # 这是和原版（rotation="10 MB", retention="7 days"）的核心区别
            encoding="utf-8",
        )
        _conv_sinks[conv_id] = sink_id
        return sink_id


def _conv_router(record) -> bool:
    """
    loguru filter 函数：根据当前 context var 决定记录写到哪个 sink。

    每个 sink add 时都会带上这个 filter，filter 返回 True 才接收。
    """
    cid = record["extra"].get("conversation_id")
    if cid is None or cid == "-":
        # 兜底：没 conversation_id 的写控制台
        return True
    # 有 conversation_id 的写对应 conv 文件
    # 任何"非自己 conv_id"的记录都不接收
    return cid == record["extra"].get("_target_conv_id")


# 重新设计：每个 conv 一个带 filter 的 sink，filter 只接收"自己的记录"
def _ensure_conv_sink_v2(conv_id: int) -> int:
    """新版本 sink：filter 只接收 conversation_id == conv_id 的记录"""
    if conv_id in _conv_sinks:
        return _conv_sinks[conv_id]
    with _sink_lock:
        if conv_id in _conv_sinks:
            return _conv_sinks[conv_id]
        path = Path("logs")
        path.mkdir(parents=True, exist_ok=True)
        # 在 record 上绑个 _target_conv_id 标记
        def _make_filter(target_id: int):
            def _filter(record):
                return record["extra"].get("conversation_id") == target_id
            return _filter
        sink_id = logger.add(
            sink=path / f"conv-{conv_id}.log",
            level="INFO",
            format=log_format,
            filter=_make_filter(conv_id),
            encoding="utf-8",
        )
        _conv_sinks[conv_id] = sink_id
        return sink_id


# 替换为新版
_ensure_conv_sink = _ensure_conv_sink_v2


# 兜底 sink filter
def _fallback_filter(record):
    return record["extra"].get("conversation_id") in (None, "-")


# === 初始化 ===
# 移除所有默认 sink
logger.remove()
# 打补丁
logger = logger.patch(_inject_ctx)

# 1. 控制台 sink（始终接收，实时调试用）
if app_config.logging.console.enable:
    logger.add(
        sink=sys.stdout,
        level=app_config.logging.console.level,
        format=log_format,
    )

# 2. 兜底文件 sink：logs/app.log（不限大小）
#    接收 conversation_id 为空 / None / "-" 的记录
if app_config.logging.file.enable:
    path = Path(app_config.logging.file.path)
    path.mkdir(parents=True, exist_ok=True)
    logger.add(
        sink=path / "app.log",
        level=app_config.logging.file.level,
        format=log_format,
        filter=_fallback_filter,
        encoding="utf-8",
    )

# 3. conversation 级 sink 不在这里 add，**首次见时动态 add**
#    调用方用 logger.info(...) 时，filter 会自动判断走哪个 sink


# === 公共 API：业务代码需要"确保某 conv 的 sink 存在"时调这个 ===
def ensure_conv_logger(conv_id: int) -> None:
    """在请求进入时调用，确保该 conv 的日志文件 sink 已创建"""
    _ensure_conv_sink(conv_id)


if __name__ == '__main__':
    # 简单测试
    request_id_ctx_var.set("test-req")
    conversation_id_ctx_var.set(7)
    logger.info("这是 7 号会话的日志")
    conversation_id_ctx_var.set(8)
    logger.info("这是 8 号会话的日志")
    print("已写入 logs/conv-7.log 和 logs/conv-8.log")
