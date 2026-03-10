#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.rag import LocalPageIndexRAG

PAGE_INDEX_PATH = ROOT / "data" / "page-index.json"
CACHE_PATH = ROOT / "data" / "page-index-cache.json"


def main() -> None:
    rag = LocalPageIndexRAG(
        page_index_path=PAGE_INDEX_PATH,
        cache_path=CACHE_PATH,
        rebuild_cache=True,
    )
    print(f"Wrote retrieval cache: {CACHE_PATH}")
    print(f"Chunks indexed: {rag.chunk_count}")


if __name__ == "__main__":
    main()
