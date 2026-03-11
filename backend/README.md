# Backend (No Vector DB)

This backend serves a low-cost RAG-style chat API over `data/page-index.json`.

## What it does
- No external vector DB
- Local hybrid retrieval (BM25-style lexical + hashed embedding cosine)
- Cached embedding index at `data/page-index-cache.json`
- Trust policy for low-confidence retrieval and sentence grounding

## Run locally

```bash
cd /Users/ilkinisler/Development/ilkinisler.github.io
python3 -m venv .venv_backend
source .venv_backend/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```

Health check:

```bash
curl http://localhost:8000/health
```

Chat:

```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"question":"How much can you deadlift?"}'
```

## Environment variables
- `PAGE_INDEX_PATH` (default: `data/page-index.json`)
- `RETRIEVAL_CACHE_PATH` (default: `data/page-index-cache.json`)
- `FRONTEND_BASE_URL` (default: `https://ilkinisler.com`)
- `ALLOWED_ORIGIN` (default: `*`; set to `https://ilkinisler.com` in production)
- `EMBEDDING_DIMS` (default: `640`)
- `REBUILD_RETRIEVAL_CACHE=true` to force cache rebuild at startup
- `OPENAI_API_KEY` (required for LLM answers; keep in backend only)
- `OPENAI_MODEL` (default: `gpt-5-nano`)
- `OPENAI_ENDPOINT` (default: `https://api.openai.com/v1/chat/completions`)
- `LLM_TEMPERATURE` (default: `0.15`)
- `LLM_MAX_TOKENS` (default: `520`)
- `RATE_LIMIT_MAX_REQUESTS` (default: `12`)
- `RATE_LIMIT_WINDOW_SECONDS` (default: `60`)
- `RATE_LIMIT_BLOCK_SECONDS` (default: `120`)

Example `backend/.env`:

```env
OPENAI_API_KEY=YOUR_NEW_KEY
OPENAI_MODEL=gpt-5-nano
ALLOWED_ORIGIN=https://ilkinisler.com
RATE_LIMIT_MAX_REQUESTS=12
RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_BLOCK_SECONDS=120
```

## Production notes
- Deploy this service to a host like Render as `api.ilkinisler.com`
- Keep frontend on GitHub Pages (`ilkinisler.com`)
- Point frontend chat config to `https://api.ilkinisler.com/chat`
