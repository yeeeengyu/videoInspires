from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(system|user|assistant)$")
    content: str = Field(min_length=1)


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    use_rag: bool = True
    top_k: int | None = Field(default=None, ge=1, le=10)
    temperature: float = Field(default=0.3, ge=0, le=2)


class IngestTextRequest(BaseModel):
    title: str = Field(default="Untitled")
    text: str = Field(min_length=1)
    source: str | None = None


class DocumentSummary(BaseModel):
    id: str
    title: str
    source: str | None = None
    preview: str
