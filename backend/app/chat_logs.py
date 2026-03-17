from __future__ import annotations

import hashlib
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class ChatLogStore:
    """Persistent SQLite storage for chat question/response logs."""

    def __init__(self, db_path: Path, hash_salt: str = "") -> None:
        self.db_path = Path(db_path)
        self.hash_salt = str(hash_salt or "")
        self._lock = threading.Lock()

        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(str(self.db_path), check_same_thread=False)

    def _initialize(self) -> None:
        with self._lock:
            with self._connect() as conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS chat_logs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        created_at TEXT NOT NULL,
                        client_hash TEXT NOT NULL,
                        question TEXT NOT NULL,
                        response_status INTEGER NOT NULL,
                        response_kind TEXT NOT NULL,
                        answer_preview TEXT NOT NULL,
                        user_agent TEXT NOT NULL,
                        request_path TEXT NOT NULL
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_chat_logs_created_at
                    ON chat_logs(created_at DESC)
                    """
                )
                conn.commit()

    def _hash_client(self, client_key: str) -> str:
        raw = f"{self.hash_salt}:{client_key}".encode("utf-8")
        return hashlib.sha256(raw).hexdigest()[:24]

    def log(
        self,
        *,
        client_key: str,
        question: str,
        response_status: int,
        response_kind: str,
        answer_preview: str,
        user_agent: str,
        request_path: str,
    ) -> None:
        created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        client_hash = self._hash_client(str(client_key or "unknown"))
        question_value = str(question or "").strip()[:2000]
        answer_value = str(answer_preview or "").strip()[:500]
        ua_value = str(user_agent or "").strip()[:300]
        path_value = str(request_path or "/chat").strip()[:120]
        kind_value = str(response_kind or "unknown").strip()[:80]

        with self._lock:
            with self._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO chat_logs (
                        created_at,
                        client_hash,
                        question,
                        response_status,
                        response_kind,
                        answer_preview,
                        user_agent,
                        request_path
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        created_at,
                        client_hash,
                        question_value,
                        int(response_status),
                        kind_value,
                        answer_value,
                        ua_value,
                        path_value,
                    ),
                )
                conn.commit()

    def recent(self, limit: int = 50) -> list[dict[str, Any]]:
        max_limit = max(1, int(limit))

        with self._lock:
            with self._connect() as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    """
                    SELECT
                        id,
                        created_at,
                        client_hash,
                        question,
                        response_status,
                        response_kind,
                        answer_preview,
                        user_agent,
                        request_path
                    FROM chat_logs
                    ORDER BY id DESC
                    LIMIT ?
                    """,
                    (max_limit,),
                ).fetchall()

        return [dict(row) for row in rows]

    def count(self) -> int:
        with self._lock:
            with self._connect() as conn:
                row = conn.execute("SELECT COUNT(*) AS total FROM chat_logs").fetchone()
                if not row:
                    return 0
                return int(row[0] or 0)
