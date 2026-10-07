import asyncio
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.conf.app_config import DBConfig, app_config


class MysqlClientManager:
    def __init__(self, db_config: DBConfig):
        self.db_config = db_config
        self.engine: Optional[AsyncEngine] = None
        self.session_factory: Optional[async_sessionmaker[AsyncSession]] = None

    def _get_url(self):
        return f"mysql+asyncmy://{self.db_config.user}:{self.db_config.password}@{self.db_config.host}:{self.db_config.port}/{self.db_config.database}?charset=utf8mb4"

    def init(self):
        self.engine = create_async_engine(
            url=self._get_url(), pool_size=10, pool_pre_ping=True
        )
        self.session_factory = async_sessionmaker(
            self.engine, autoflush=True, expire_on_commit=False, autobegin=True
        )

    def get_session_factory(self) -> async_sessionmaker[AsyncSession]:
        if self.session_factory is None:
            raise RuntimeError("MySQL client manager is not initialized")
        return self.session_factory

    async def close(self):
        if self.engine is not None:
            await self.engine.dispose()
        self.engine = None
        self.session_factory = None


dw_mysql_client_manager = MysqlClientManager(app_config.db_dw)
meta_mysql_client_manager = MysqlClientManager(app_config.db_meta)

if __name__ == "__main__":
    meta_mysql_client_manager.init()

    async def test():
        async with meta_mysql_client_manager.get_session_factory()() as session:
            result = await session.execute(text("select * from table_info limit 10"))
            rows = result.fetchall()
            print(rows)

    asyncio.run(test())
