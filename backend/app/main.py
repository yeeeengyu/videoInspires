from __future__ import annotations

import json
from collections.abc import AsyncIterator

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .config import Settings, get_settings
from .rag import RagStore, RetrievedChunk
from .schemas import ChatMessage, ChatRequest, DocumentSummary, IngestTextRequest
from .vllm import VllmClient


app = FastAPI(title="vLLM RAG API", version="0.2.0")


def get_vllm(settings: Settings = Depends(get_settings)) -> VllmClient:
    return VllmClient(settings)


def get_rag(
    settings: Settings = Depends(get_settings),
    vllm: VllmClient = Depends(get_vllm),
) -> RagStore:
    return RagStore(settings, vllm)


settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def build_chat_messages(messages: list[ChatMessage], chunks: list[RetrievedChunk]) -> list[ChatMessage]:
    system_parts = [
        (
            "You are an expert educational video scenario writer for AI-related topics. "
            "Your job is to help create scripts that students can understand easily."
        ),
        (
            "Answer primarily in Korean unless the user asks for another language. "
            "Use plain words, concrete examples, and friendly explanations suitable for students."
        ),
        (
            "When the user asks for a video idea, script, scenario, or lesson content, structure the response with: "
            "1) 영상 제목, 2) 대상 학생 수준, 3) 학습 목표, 4) 오프닝 훅, "
            "5) 장면별 시나리오 with narration, visuals, captions, and timing, "
            "6) 쉬운 비유, 7) 학생 참여 질문, 8) 마무리 멘트. "
            "If details such as grade level, video length, or tone are missing, make reasonable assumptions and state them briefly."
        ),
        (
            "For AI topics, avoid unnecessary jargon. When technical terms are needed, define them in one sentence "
            "and include a student-friendly analogy."
        ),
    ]

    user_system_messages = [message.content for message in messages if message.role == "system"]
    if user_system_messages:
        system_parts.append("\n".join(user_system_messages))

    if chunks:
        context = "\n\n".join(
            f"[{index}] title={chunk.title} source={chunk.source or 'local'}\n{chunk.content}"
            for index, chunk in enumerate(chunks, start=1)
        )
        system_parts.append(
            "Use the provided RAG context when it is relevant. "
            "If the answer is not in the context, say what is uncertain and use it only as supporting material for the educational video scenario.\n\n"
            f"RAG context:\n{context}"
        )

    system = ChatMessage(role="system", content="\n\n".join(system_parts))
    conversation = [message for message in messages if message.role != "system"]
    return [system, *conversation]


@app.get("/health")
async def health(vllm: VllmClient = Depends(get_vllm)) -> dict[str, str]:
    return {
        "status": "ok",
        "provider": "vllm",
        "base_url": vllm.base_url,
        "chat_model": await vllm.chat_model(),
        "embed_model": await vllm.embed_model(),
    }


@app.post("/api/ingest/text")
async def ingest_text(
    payload: IngestTextRequest,
    rag: RagStore = Depends(get_rag),
) -> dict[str, int | str]:
    try:
        chunks = await rag.ingest_text(payload.title, payload.text, payload.source)
    except Exception as exc:  # pragma: no cover - surfaced as API detail during local setup
        raise HTTPException(status_code=502, detail=f"vLLM embedding failed: {exc}") from exc
    return {"status": "indexed", "chunks": chunks}


@app.get("/api/documents", response_model=list[DocumentSummary])
async def list_documents(rag: RagStore = Depends(get_rag)) -> list[dict[str, str | None]]:
    return rag.list_documents()


@app.delete("/api/documents")
async def clear_documents(rag: RagStore = Depends(get_rag)) -> dict[str, str]:
    rag.clear()
    return {"status": "cleared"}


@app.post("/api/chat/stream")
async def chat_stream(
    payload: ChatRequest,
    settings: Settings = Depends(get_settings),
    vllm: VllmClient = Depends(get_vllm),
    rag: RagStore = Depends(get_rag),
) -> StreamingResponse:
    async def generate() -> AsyncIterator[str]:
        chunks: list[RetrievedChunk] = []
        latest_user_message = next((message.content for message in reversed(payload.messages) if message.role == "user"), "")

        try:
            if payload.use_rag and latest_user_message:
                chunks = await rag.search(latest_user_message, payload.top_k or settings.rag_top_k)
            yield sse(
                "context",
                [
                    {
                        "id": chunk.id,
                        "title": chunk.title,
                        "source": chunk.source,
                        "content": chunk.content,
                        "distance": chunk.distance,
                    }
                    for chunk in chunks
                ],
            )

            chat_messages = build_chat_messages(payload.messages, chunks)
            async for token in vllm.stream_chat(chat_messages, payload.temperature):
                yield sse("token", {"content": token})
            yield sse("done", {"ok": True})
        except Exception as exc:
            yield sse("error", {"message": str(exc)})

    return StreamingResponse(generate(), media_type="text/event-stream")
