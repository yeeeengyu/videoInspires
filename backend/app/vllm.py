from collections.abc import AsyncIterator
import hashlib
import json
import math
import re
from typing import Any

import httpx

from .config import Settings
from .schemas import ChatMessage


LOCAL_EMBEDDING_DIMENSIONS = 512


class VllmClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.base_url = settings.vllm_base_url.rstrip("/")

    @property
    def headers(self) -> dict[str, str]:
        headers = {"ngrok-skip-browser-warning": "true"}
        if not self.settings.vllm_api_key:
            return headers
        headers["Authorization"] = f"Bearer {self.settings.vllm_api_key}"
        return headers

    def _raise_api_error(self, data: Any) -> None:
        if not isinstance(data, dict):
            return

        error = data.get("error")
        if not isinstance(error, dict):
            return

        message = error.get("message") or "vLLM returned an error."
        code = error.get("code")
        if code:
            raise RuntimeError(f"vLLM error {code}: {message}")
        raise RuntimeError(f"vLLM error: {message}")

    async def _json_response(self, response: httpx.Response) -> Any:
        response.raise_for_status()
        try:
            data = response.json()
        except json.JSONDecodeError as exc:
            preview = response.text[:200].replace("\n", " ")
            raise RuntimeError(f"vLLM returned a non-JSON response: {preview}") from exc

        self._raise_api_error(data)
        return data

    async def _resolve_model(self, configured_model: str) -> str:
        async with httpx.AsyncClient(timeout=10, headers=self.headers) as client:
            response = await client.get(f"{self.base_url}/models")
            data = await self._json_response(response)

        models = data.get("data", [])
        if not models:
            raise RuntimeError("vLLM /models response did not include any model ids.")
        model_id = models[0].get("id")
        if not model_id:
            raise RuntimeError("vLLM model entry did not include an id.")

        if configured_model:
            configured_model = configured_model.strip()
            model_ids = [model.get("id") for model in models if model.get("id")]
            if configured_model in model_ids:
                return configured_model
            if len(model_ids) == 1:
                return model_id
            raise RuntimeError(
                f"Configured vLLM model `{configured_model}` is not available. "
                f"Available models: {', '.join(model_ids)}"
            )

        return model_id

    async def chat_model(self) -> str:
        return await self._resolve_model(self.settings.vllm_chat_model)

    async def embed_model(self) -> str:
        if not self.settings.vllm_embed_model:
            return "local-hash-embedding"
        return await self._resolve_model(self.settings.vllm_embed_model)

    def _local_embed(self, text: str) -> list[float]:
        tokens = re.findall(r"[0-9A-Za-z가-힣]+", text.lower())
        features: list[str] = []

        for token in tokens:
            features.append(token)
            if len(token) >= 3:
                features.extend(token[index : index + 3] for index in range(len(token) - 2))

        if not features:
            features = [text.strip() or "empty"]

        vector = [0.0] * LOCAL_EMBEDDING_DIMENSIONS
        for feature in features:
            digest = hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest()
            bucket = int.from_bytes(digest[:4], "big") % LOCAL_EMBEDDING_DIMENSIONS
            sign = 1.0 if digest[4] % 2 == 0 else -1.0
            vector[bucket] += sign

        norm = math.sqrt(sum(value * value for value in vector))
        if not norm:
            return vector
        return [value / norm for value in vector]

    async def embed(self, text: str) -> list[float]:
        if not self.settings.vllm_embed_model:
            return self._local_embed(text)

        payload = {"model": await self.embed_model(), "input": text}
        async with httpx.AsyncClient(timeout=60, headers=self.headers) as client:
            response = await client.post(f"{self.base_url}/embeddings", json=payload)
            try:
                data = await self._json_response(response)
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 404:
                    return self._local_embed(text)
                raise

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
                content_type = response.headers.get("content-type", "")
                if "text/event-stream" not in content_type:
                    body = await response.aread()
                    try:
                        data = json.loads(body)
                    except json.JSONDecodeError as exc:
                        preview = body.decode("utf-8", errors="replace")[:200].replace("\n", " ")
                        raise RuntimeError(f"vLLM returned a non-stream response: {preview}") from exc
                    self._raise_api_error(data)
                    raise RuntimeError("vLLM returned a non-stream response.")

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
