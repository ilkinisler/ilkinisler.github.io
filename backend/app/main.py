from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .rag import LocalPageIndexRAG

ROOT = Path(__file__).resolve().parents[2]
PAGE_INDEX_PATH = Path(os.getenv("PAGE_INDEX_PATH", ROOT / "data" / "page-index.json"))
CACHE_PATH = Path(os.getenv("RETRIEVAL_CACHE_PATH", ROOT / "data" / "page-index-cache.json"))
FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "https://ilkinisler.com")
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "*")
EMBEDDING_DIMS = int(os.getenv("EMBEDDING_DIMS", "640"))
REBUILD_CACHE = os.getenv("REBUILD_RETRIEVAL_CACHE", "false").lower() == "true"
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5-nano").strip()
OPENAI_ENDPOINT = os.getenv("OPENAI_ENDPOINT", "https://api.openai.com/v1/chat/completions").strip()
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.15"))
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "520"))

rag = LocalPageIndexRAG(
    page_index_path=PAGE_INDEX_PATH,
    cache_path=CACHE_PATH,
    frontend_base_url=FRONTEND_BASE_URL,
    embedding_dims=EMBEDDING_DIMS,
    rebuild_cache=REBUILD_CACHE,
    openai_api_key=OPENAI_API_KEY,
    openai_model=OPENAI_MODEL,
    openai_endpoint=OPENAI_ENDPOINT,
    llm_temperature=LLM_TEMPERATURE,
    llm_max_tokens=LLM_MAX_TOKENS,
)

app = FastAPI(
    title="Ilkin Chat API",
    version="0.1.0",
    description="Local page-index retrieval API (no vector DB)",
)

if ALLOWED_ORIGIN == "*":
    allow_origins = ["*"]
else:
    allow_origins = [origin.strip() for origin in ALLOWED_ORIGIN.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=1200)


class HealthResponse(BaseModel):
    status: str
    chunks: int
    cache_path: str


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        chunks=rag.chunk_count,
        cache_path=str(CACHE_PATH),
    )


@app.post("/chat")
def chat(request: ChatRequest) -> dict:
    question = request.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="question is required")

    return rag.chat(question)
