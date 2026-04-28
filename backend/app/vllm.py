from collections.abc import AsyncIterator
from typing import Any

import httpx

from .config import Settings
from .schemas import ChatMessage


class VllmClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.base_url = settings.vllm_base_url.rstrip("/")

    @property
    def headers(self) -> dict[str, str]:
        if not self.settings.vllm_api_key:
            return {}
        return {"Authorization": f"Bearer {self.settings.vllm_api_key}"}

    async def _resolve_model(self, configured_model: str) -> str:
        if configured_model:
            return configured_model

        async with httpx.AsyncClient(timeout=10, headers=self.headers) as client:
            response = await client.get(f"{self.base_url}/models")
            response.raise_for_status()
            data = response.json()

        models = data.get("data", [])
        if not models:
            raise RuntimeError("vLLM /models response did not include any model ids.")
        model_id = models[0].get("id")
        if not model_id:
            raise RuntimeError("vLLM model entry did not include an id.")
        return model_id

    async def chat_model(self) -> str:
        return await self._resolve_model(self.settings.vllm_chat_model)

    async def embed_model(self) -> str:
        return await self._resolve_model(self.settings.vllm_embed_model or self.settings.vllm_chat_model)

    async def embed(self, text: str) -> list[float]:
        payload = {"model": await self.embed_model(), "input": text}
        async with httpx.AsyncClient(timeout=60, headers=self.headers) as client:
            response = await client.post(f"{self.base_url}/embeddings", json=payload)
            response.raise_for_status()
            data = response.json()

        embedding = data.get("data", [{}])[0].get("embedding")
        if not embedding:
            raise RuntimeError("vLLM embedding response did not include an embedding.")
        return embedding

    async def stream_chat(
        self,
        messages: list[ChatMessage],
        temperature: float,
    ) -> AsyncIterator[str]:
        payload: dict[str, Any] = {
            "model": await self.chat_model(),
            "messages": [message.model_dump() for message in messages],
            "stream": True,
            "temperature": temperature,
        }

        async with httpx.AsyncClient(timeout=None, headers=self.headers) as client:
            async with client.stream("POST", f"{self.base_url}/chat/completions", json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line or not line.startswith("data: "):
                        continue

                    raw_data = line.removeprefix("data: ").strip()
                    if raw_data == "[DONE]":
                        break

                    data = httpx.Response(200, content=raw_data).json()
                    choices = data.get("choices", [])
                    if not choices:
                        continue
                    token = choices[0].get("delta", {}).get("content", "")
                    if token:
                        yield token
