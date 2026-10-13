# Backend (No Vector DB)

This backend serves a low-cost RAG-style chat API over `data/page-index.json`.

## What it does
- No external vector DB
- Local hybrid retrieval (BM25-style lexical + hashed embedding cosine)
- Cached embedding index at `data/page-index-cache.json`
- Trust policy for low-confidence retrieval and sentence grounding
- Persistent SQLite question logs (`backend/data/chat_logs.sqlite3`)

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
- `CHAT_LOG_DB_PATH` (default: `backend/data/chat_logs.sqlite3`)
- `CHAT_LOG_HASH_SALT` (recommended for stable anonymous hashing)
- `CHAT_LOG_ADMIN_KEY` (required to read logs remotely from `/logs`)
- `CHAT_LOG_DEFAULT_LIMIT` (default: `50`)
- `CHAT_LOG_MAX_LIMIT` (default: `500`)

Example `backend/.env`:

```env
OPENAI_API_KEY=YOUR_NEW_KEY
OPENAI_MODEL=gpt-5-nano
ALLOWED_ORIGIN=https://ilkinisler.com
RATE_LIMIT_MAX_REQUESTS=12
RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_BLOCK_SECONDS=120
CHAT_LOG_HASH_SALT=change-this-salt
CHAT_LOG_ADMIN_KEY=change-this-admin-key
```

## Question logs

Every `/chat` request is logged with:
- timestamp (UTC)
- anonymous client hash (not raw IP)
- question text
- response status + response kind
- answer preview
- user-agent

Read recent logs:

```bash
curl "http://localhost:8000/logs?limit=50"
```

Read logs remotely (when `CHAT_LOG_ADMIN_KEY` is set):

```bash
curl "https://api.ilkinisler.com/logs?limit=100" \
  -H "x-admin-key: YOUR_ADMIN_KEY"
```

## Groundedness scoring (Vectara HHEM)

Each LLM-written answer is scored by [Vectara HHEM-2.1-Open](https://huggingface.co/vectara/hallucination_evaluation_model)
(Apache-2.0): premise = the retrieved passages, hypothesis = the answer. Scores at or above
`GROUNDEDNESS_THRESHOLD` (default `0.5`) are shown with the answer; below it the assistant says it isn't sure.
The model revision is pinned in `app/groundedness.py`.

- `HHEM_ENABLED` (default `true`)
- `HHEM_PRELOAD` (default `false`; the Docker image sets `true` so cold starts load the model before serving)
- `GROUNDEDNESS_THRESHOLD` (default `0.5`)

## Production (Google Cloud Run)

The frontend stays on GitHub Pages; the API runs on Cloud Run and scales to zero.

```bash
gcloud auth login
PROJECT_ID=<your-project> scripts/deploy_api.sh setup   # enable APIs, store OPENAI_API_KEY in Secret Manager
PROJECT_ID=<your-project> scripts/deploy_api.sh         # remote build from backend/Dockerfile + deploy
```

Then set `productionEndpoint` in `js/chat-config.js` to `<service-url>/chat`.

Chat logs use SQLite on the container's disk, which Cloud Run discards when an instance stops; request logs are
also in Cloud Logging.
