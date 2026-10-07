from __future__ import annotations

from typing import Any, Optional, Protocol

import httpx

from app.conf.app_config import EmbeddingConfig, app_config


class EmbeddingClient(Protocol):
    async def aembed_documents(self, texts: list[str]) -> list[list[float]]: ...

    async def aembed_query(self, text: str) -> list[float]: ...

    async def aclose(self) -> None: ...


class RemoteEmbeddingClient:
    """OpenAI-compatible remote embedding client.

    The public return values match LangChain embeddings:
    - aembed_documents -> list[list[float]]
    - aembed_query -> list[float]
    """

    def __init__(self, config: EmbeddingConfig):
        self.config = config
        self._client = httpx.AsyncClient(
            base_url=config.base_url.rstrip("/"),
            timeout=config.timeout,
            headers=self._build_headers(config.api_key),
        )

    @staticmethod
    def _build_headers(api_key: str | None) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        return headers

    async def aembed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        payload = {
            "model": self.config.model,
            "input": texts,
        }
        response = await self._client.post("/embeddings", json=payload)
        response.raise_for_status()
        return self._parse_embeddings(response.json(), expected_count=len(texts))

    async def aembed_query(self, text: str) -> list[float]:
        embeddings = await self.aembed_documents([text])
        return embeddings[0]

    async def aclose(self) -> None:
        await self._client.aclose()

    @staticmethod
    def _parse_embeddings(
        payload: dict[str, Any], expected_count: int
    ) -> list[list[float]]:
        data = payload.get("data")
        if not isinstance(data, list):
            raise ValueError("Embedding response missing data list")

        if data and all(isinstance(item, dict) and "index" in item for item in data):
            data = sorted(data, key=lambda item: item["index"])

        embeddings: list[list[float]] = []
        for item in data:
            if not isinstance(item, dict):
                raise ValueError("Embedding response data item must be an object")
            embedding = item.get("embedding")
            if not isinstance(embedding, list):
                raise ValueError("Embedding response data item missing embedding list")
            embeddings.append([float(value) for value in embedding])

        if len(embeddings) != expected_count:
            raise ValueError(
                "Embedding response count mismatch: "
                f"expected {expected_count}, got {len(embeddings)}"
            )
        return embeddings


class EmbeddingClientManager:
    def __init__(self, config: EmbeddingConfig):
        self.client: Optional[EmbeddingClient] = None
        self.config = config

    def init(self):
        self.client = RemoteEmbeddingClient(self.config)

    def get_client(self) -> EmbeddingClient:
        if self.client is None:
            raise RuntimeError("Embedding client manager is not initialized")
        return self.client

    async def close(self):
        if self.client:
            await self.client.aclose()
        self.client = None


embedding_client_manager = EmbeddingClientManager(app_config.embedding)
