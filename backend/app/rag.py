from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import faiss
import numpy as np

from .config import Settings
from .vllm import VllmClient


@dataclass
class RetrievedChunk:
    id: str
    title: str
    source: str | None
    content: str
    distance: float | None


def chunk_text(text: str, chunk_size: int = 900, overlap: int = 120) -> list[str]:
    normalized = re.sub(r"\s+", " ", text).strip()
    if not normalized:
        return []

    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        end = min(start + chunk_size, len(normalized))
        chunk = normalized[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(normalized):
            break
        start = max(end - overlap, start + 1)
    return chunks


class RagStore:
    def __init__(self, settings: Settings, vllm: VllmClient) -> None:
        self.settings = settings
        self.vllm = vllm
        self.path = Path(settings.faiss_path)
        self.path.mkdir(parents=True, exist_ok=True)
        self.index_path = self.path / "index.faiss"
        self.metadata_path = self.path / "metadata.json"
        self.metadata = self._load_metadata()
        self.index = self._load_index()

    def _load_metadata(self) -> list[dict[str, Any]]:
        if not self.metadata_path.exists():
            return []
        return json.loads(self.metadata_path.read_text(encoding="utf-8"))

    def _load_index(self) -> faiss.Index:
        if self.index_path.exists():
            return faiss.read_index(str(self.index_path))
        return faiss.IndexFlatIP(0)

    def _persist(self) -> None:
        faiss.write_index(self.index, str(self.index_path))
        self.metadata_path.write_text(json.dumps(self.metadata, ensure_ascii=False, indent=2), encoding="utf-8")

    def _rebuild_index(self, embeddings: list[list[float]]) -> None:
        if not embeddings:
            self.index = faiss.IndexFlatIP(0)
            self._persist()
            return

        vectors = np.array(embeddings, dtype="float32")
        faiss.normalize_L2(vectors)
        self.index = faiss.IndexFlatIP(vectors.shape[1])
        self.index.add(vectors)
        self._persist()

    async def ingest_text(self, title: str, text: str, source: str | None = None) -> int:
        chunks = chunk_text(text)
        if not chunks:
            return 0

        embeddings: list[list[float]] = []
        new_metadata: list[dict[str, Any]] = []

        document_hash = hashlib.sha1(f"{title}:{source or ''}:{text}".encode("utf-8")).hexdigest()[:12]
        for index, chunk in enumerate(chunks):
            embeddings.append(await self.vllm.embed(chunk))
            new_metadata.append(
                {
                    "id": f"{document_hash}-{index}",
                    "document_id": document_hash,
                    "title": title,
                    "source": source or "",
                    "chunk_index": index,
                    "content": chunk,
                    "preview": chunk[:220],
                }
            )

        existing = [item for item in self.metadata if item.get("document_id") != document_hash]
        existing_embeddings = [item["embedding"] for item in existing]
        for item, embedding in zip(new_metadata, embeddings, strict=True):
            item["embedding"] = embedding

        self.metadata = [*existing, *new_metadata]
        self._rebuild_index([*existing_embeddings, *embeddings])
        return len(chunks)

    async def search(self, query: str, top_k: int) -> list[RetrievedChunk]:
        if not self.metadata or self.index.ntotal == 0:
            return []

        query_embedding = await self.vllm.embed(query)
        query_vector = np.array([query_embedding], dtype="float32")
        faiss.normalize_L2(query_vector)
        distances, indices = self.index.search(query_vector, min(top_k, self.index.ntotal))

        chunks: list[RetrievedChunk] = []
        for distance, index in zip(distances[0], indices[0], strict=False):
            if index < 0:
                continue
            item = self.metadata[index]
            chunks.append(
                RetrievedChunk(
                    id=item["id"],
                    title=item.get("title", "Untitled"),
                    source=item.get("source") or None,
                    content=item.get("content", ""),
                    distance=float(distance),
                )
            )
        return chunks

    def list_documents(self) -> list[dict[str, str | None]]:
        summaries: dict[str, dict[str, str | None]] = {}

        for item in self.metadata:
            document_id = item.get("document_id", item["id"].rsplit("-", 1)[0])
            if document_id in summaries:
                continue
            summaries[document_id] = {
                "id": document_id,
                "title": item.get("title", "Untitled"),
                "source": item.get("source") or None,
                "preview": (item.get("preview") or item.get("content") or "")[:220],
            }

        return list(summaries.values())

    def clear(self) -> None:
        self.metadata = []
        self.index = faiss.IndexFlatIP(0)
        self._persist()
