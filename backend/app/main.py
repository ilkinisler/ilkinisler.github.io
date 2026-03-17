from __future__ import annotations

import math
import os
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .chat_logs import ChatLogStore
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
RATE_LIMIT_MAX_REQUESTS = int(os.getenv("RATE_LIMIT_MAX_REQUESTS", "12"))
RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))
RATE_LIMIT_BLOCK_SECONDS = int(os.getenv("RATE_LIMIT_BLOCK_SECONDS", "120"))
CHAT_LOG_DB_PATH = Path(os.getenv("CHAT_LOG_DB_PATH", ROOT / "backend" / "data" / "chat_logs.sqlite3"))
CHAT_LOG_HASH_SALT = os.getenv("CHAT_LOG_HASH_SALT", "").strip()
CHAT_LOG_ADMIN_KEY = os.getenv("CHAT_LOG_ADMIN_KEY", "").strip()
CHAT_LOG_DEFAULT_LIMIT = int(os.getenv("CHAT_LOG_DEFAULT_LIMIT", "50"))
CHAT_LOG_MAX_LIMIT = int(os.getenv("CHAT_LOG_MAX_LIMIT", "500"))

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
chat_logs = ChatLogStore(
    db_path=CHAT_LOG_DB_PATH,
    hash_salt=CHAT_LOG_HASH_SALT,
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


class SlidingWindowRateLimiter:
    """Simple in-memory limiter for chat abuse control."""

    def __init__(self, max_requests: int, window_seconds: int, block_seconds: int) -> None:
        self.max_requests = max(1, int(max_requests))
        self.window_seconds = max(1, int(window_seconds))
        self.block_seconds = max(1, int(block_seconds))
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._blocked_until: dict[str, float] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> tuple[bool, int]:
        now = time.monotonic()

        with self._lock:
            blocked_until = self._blocked_until.get(key, 0.0)
            if blocked_until > now:
                return False, int(math.ceil(blocked_until - now))

            events = self._events[key]
            while events and (now - events[0]) > self.window_seconds:
                events.popleft()

            if len(events) >= self.max_requests:
                retry_after = self.block_seconds
                self._blocked_until[key] = now + self.block_seconds
                events.clear()
                return False, retry_after

            events.append(now)
            return True, 0


rate_limiter = SlidingWindowRateLimiter(
    max_requests=RATE_LIMIT_MAX_REQUESTS,
    window_seconds=RATE_LIMIT_WINDOW_SECONDS,
    block_seconds=RATE_LIMIT_BLOCK_SECONDS,
)


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=1200)


class HealthResponse(BaseModel):
    status: str
    chunks: int
    cache_path: str
    log_db_path: str
    log_count: int


class ChatLogEntry(BaseModel):
    id: int
    created_at: str
    client_hash: str
    question: str
    response_status: int
    response_kind: str
    answer_preview: str
    user_agent: str
    request_path: str


class ChatLogsResponse(BaseModel):
    total: int
    items: list[ChatLogEntry]


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        chunks=rag.chunk_count,
        cache_path=str(CACHE_PATH),
        log_db_path=str(CHAT_LOG_DB_PATH),
        log_count=chat_logs.count(),
    )


@app.post("/chat")
def chat(request: ChatRequest, http_request: Request) -> dict:
    client_key = _client_key(http_request)
    user_agent = http_request.headers.get("user-agent", "")
    question = request.question.strip()

    allowed, retry_after = rate_limiter.allow(client_key)
    if not allowed:
        detail = f"Rate limit exceeded. Please wait {retry_after}s and try again."
        chat_logs.log(
            client_key=client_key,
            question=question,
            response_status=429,
            response_kind="rate_limited",
            answer_preview=detail,
            user_agent=user_agent,
            request_path=http_request.url.path,
        )
        raise HTTPException(
            status_code=429,
            detail=detail,
            headers={"Retry-After": str(retry_after)},
        )

    if not question:
        chat_logs.log(
            client_key=client_key,
            question=question,
            response_status=400,
            response_kind="invalid_question",
            answer_preview="question is required",
            user_agent=user_agent,
            request_path=http_request.url.path,
        )
        raise HTTPException(status_code=400, detail="question is required")

    try:
        result = rag.chat(question)
    except Exception as error:
        chat_logs.log(
            client_key=client_key,
            question=question,
            response_status=500,
            response_kind="internal_error",
            answer_preview=f"{type(error).__name__}: {error}",
            user_agent=user_agent,
            request_path=http_request.url.path,
        )
        raise HTTPException(status_code=500, detail="Chat request failed. Please try again.") from error

    answer_preview = str(result.get("answer", "")).strip()
    response_kind = str(result.get("kind", "answer")).strip() or "answer"
    chat_logs.log(
        client_key=client_key,
        question=question,
        response_status=200,
        response_kind=response_kind,
        answer_preview=answer_preview,
        user_agent=user_agent,
        request_path=http_request.url.path,
    )
    return result


@app.get("/logs", response_model=ChatLogsResponse)
def logs(http_request: Request, limit: int = Query(default=CHAT_LOG_DEFAULT_LIMIT, ge=1, le=CHAT_LOG_MAX_LIMIT)) -> ChatLogsResponse:
    _authorize_logs_access(http_request)
    items = [ChatLogEntry(**row) for row in chat_logs.recent(limit=limit)]
    return ChatLogsResponse(total=chat_logs.count(), items=items)


def _client_key(http_request: Request) -> str:
    forwarded_for = http_request.headers.get("x-forwarded-for", "").strip()
    if forwarded_for:
        first_hop = forwarded_for.split(",")[0].strip()
        if first_hop:
            return first_hop

    if http_request.client and http_request.client.host:
        return http_request.client.host

    return "unknown"


def _authorize_logs_access(http_request: Request) -> None:
    # Require an admin key for remote access. If key is absent, allow localhost only.
    if CHAT_LOG_ADMIN_KEY:
        provided = http_request.headers.get("x-admin-key", "").strip()
        if provided != CHAT_LOG_ADMIN_KEY:
            raise HTTPException(status_code=401, detail="Unauthorized")
        return

    host = ""
    if http_request.client and http_request.client.host:
        host = http_request.client.host.strip().lower()
    if host in {"127.0.0.1", "::1", "localhost"}:
        return

    raise HTTPException(
        status_code=503,
        detail="Logs API requires CHAT_LOG_ADMIN_KEY for remote access.",
    )
