"""Initialize meta database schema."""

from __future__ import annotations

import asyncio
from pathlib import Path

import asyncmy
from loguru import logger

from app.conf.app_config import app_config

CURRENT_DIR = Path(__file__).resolve().parent
META_SQL_PATH = CURRENT_DIR / "meta.sql"


def _split_sql_statements(sql: str) -> list[str]:
    return [statement.strip() for statement in sql.split(";") if statement.strip()]


async def init_db(sql_file_path: Path = META_SQL_PATH) -> None:
    db_config = app_config.db_meta
    statements = _split_sql_statements(sql_file_path.read_text(encoding="utf-8"))
    if not statements:
        raise ValueError(f"No SQL statements found in {sql_file_path}")

    conn = await asyncmy.connect(
        host=db_config.host,
        port=db_config.port,
        user=db_config.user,
        password=db_config.password,
        autocommit=True,
    )
    try:
        async with conn.cursor() as cursor:
            for statement in statements:
                await cursor.execute(statement)
    finally:
        conn.close()

    logger.info("Initialized meta database using {}", sql_file_path)


if __name__ == "__main__":
    asyncio.run(init_db())
