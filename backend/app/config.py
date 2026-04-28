from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    vllm_base_url: str = Field(default="http://127.0.0.1:8080/v1", alias="VLLM_BASE_URL")
    vllm_api_key: str = Field(default="", alias="VLLM_API_KEY")
    vllm_chat_model: str = Field(default="Qwen/Qwen2.5-7B-Instruct", alias="VLLM_CHAT_MODEL")
    vllm_embed_model: str = Field(default="Qwen/Qwen2.5-7B-Instruct", alias="VLLM_EMBED_MODEL")
    faiss_path: str = Field(default="./faiss_db", alias="FAISS_PATH")
    rag_top_k: int = Field(default=4, alias="RAG_TOP_K")
    cors_origins: str = Field(
        default="http://localhost:3000,http://127.0.0.1:3000",
        alias="CORS_ORIGINS",
    )

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
