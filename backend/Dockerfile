# Chat API for ilkinisler.com: hybrid retrieval + LLM answer + Vectara HHEM groundedness.
# Build context is the repo root (see scripts/deploy_api.sh).
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/opt/hf

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
# CPU-only torch keeps the image far smaller than the default CUDA build.
RUN pip install --no-cache-dir torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r backend/requirements.txt

# Bake the pinned, reviewed HHEM revision (and its flan-t5 tokenizer) into the image so
# cold starts never download from Hugging Face.
RUN python -c "from transformers import AutoModelForSequenceClassification as M; \
M.from_pretrained('vectara/hallucination_evaluation_model', revision='de9a5e6ba9ba49531a022dba17e35ffeb2a6fad8', trust_remote_code=True)"

ENV HF_HUB_OFFLINE=1 \
    HHEM_PRELOAD=true

COPY backend/ backend/
COPY data/ data/

CMD exec uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8080}
