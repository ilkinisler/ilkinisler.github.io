#!/usr/bin/env bash
# Deploy the chat API (backend/) to Google Cloud Run.
#
# Prereqs (one time): gcloud auth login; a project with billing enabled; then
#   PROJECT_ID=<id> scripts/deploy_api.sh setup    # enable APIs, store the OpenAI key in Secret Manager
#   PROJECT_ID=<id> scripts/deploy_api.sh          # build remotely and deploy
#
# Cloud Build builds the image from backend/Dockerfile, so Docker isn't needed locally.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"
REGION="${REGION:-us-east1}"
SERVICE="${SERVICE:-ilkin-chat-api}"
SECRET="${SECRET:-openai-api-key}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

gcloud config set project "$PROJECT_ID" >/dev/null

if [[ "${1:-}" == "setup" ]]; then
  gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
    artifactregistry.googleapis.com secretmanager.googleapis.com

  # Read the key from backend/.env without echoing it.
  key="$(grep -E '^OPENAI_API_KEY=' "$ROOT/backend/.env" | head -1 | cut -d= -f2-)"
  [[ -n "$key" ]] || { echo "OPENAI_API_KEY missing from backend/.env" >&2; exit 1; }
  if gcloud secrets describe "$SECRET" >/dev/null 2>&1; then
    printf '%s' "$key" | gcloud secrets versions add "$SECRET" --data-file=-
  else
    printf '%s' "$key" | gcloud secrets create "$SECRET" --replication-policy=automatic --data-file=-
  fi

  number="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:${number}-compute@developer.gserviceaccount.com" \
    --role=roles/secretmanager.secretAccessor >/dev/null
  echo "Setup done."
  exit 0
fi

# Stage only what the image needs; the Dockerfile must sit at the source root.
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
cp "$ROOT/backend/Dockerfile" "$stage/Dockerfile"
mkdir -p "$stage/backend"
cp -R "$ROOT/backend/app" "$stage/backend/app"
cp "$ROOT/backend/requirements.txt" "$stage/backend/"
cp -R "$ROOT/data" "$stage/data"
find "$stage" -name '__pycache__' -prune -exec rm -rf {} +

# Scale to zero and cap instances so usage stays inside the free tier.
gcloud run deploy "$SERVICE" \
  --source "$stage" \
  --region "$REGION" \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 1 \
  --cpu-boost \
  --min-instances 0 \
  --max-instances 2 \
  --concurrency 4 \
  --timeout 60 \
  --set-secrets "OPENAI_API_KEY=${SECRET}:latest" \
  --set-env-vars "^##^ALLOWED_ORIGIN=https://ilkinisler.com,https://www.ilkinisler.com##OPENAI_MODEL=gpt-5-nano##GROUNDEDNESS_THRESHOLD=0.5"

gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)'
