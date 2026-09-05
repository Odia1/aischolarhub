#!/usr/bin/env bash
set -euo pipefail

RELEASE="${1:-}"
if [[ -z "$RELEASE" ]]; then
  echo "Usage: $0 <release-name>"
  exit 2
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

echo "===== AI SCHOLAR HUB CHECKPOINT ====="
echo "Release: $RELEASE"

echo
echo "===== CLEAN GENERATED FILES ====="
find runtime-patches -type d -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null || true
find runtime-patches -type f -name '*.pyc' -delete 2>/dev/null || true

echo
echo "===== GIT STATE ====="
if [[ -n "$(git status --porcelain)" ]]; then
  echo "FAIL: working tree is not clean"
  git status --short
  exit 1
fi

BRANCH="$(git branch --show-current)"
SHA="$(git rev-parse HEAD)"
SHORT_SHA="$(git rev-parse --short=9 HEAD)"

echo "Branch: $BRANCH"
echo "SHA:    $SHA"

echo
echo "===== STATIC CHECKS ====="
git diff --check HEAD^

python3 -m py_compile \
  runtime-patches/rag_api/app/scope.py \
  runtime-patches/rag_api/app/routes/document_routes.py \
  runtime-patches/rag_api/app/services/rag_authorization.py

echo "PASS: Python runtime patches"

echo
echo "===== DEPLOYED SERVICES ====="
docker compose ps

echo
echo "===== API READINESS ====="
curl -fsS http://127.0.0.1:3080/api/health >/dev/null
echo "PASS: API"

echo
echo "===== RAG HEALTH ====="
RAG_HEALTH="$(
  docker exec rag_api python -c \
  'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=5).read().decode())'
)"
echo "$RAG_HEALTH"
grep -q '"UP"' <<<"$RAG_HEALTH"
echo "PASS: RAG"

echo
echo "===== DEPLOYED IMAGE IDS ====="
API_IMAGE="$(docker inspect AI_Scholar_Hub --format '{{.Config.Image}}')"
RAG_IMAGE="$(docker inspect rag_api --format '{{.Config.Image}}')"

API_IMAGE_ID="$(docker inspect AI_Scholar_Hub --format '{{.Image}}')"
RAG_IMAGE_ID="$(docker inspect rag_api --format '{{.Image}}')"

echo "API: $API_IMAGE"
echo "RAG: $RAG_IMAGE"

echo
echo "===== RAG BUILD CONTENT CHECK ====="
for f in \
  /app/app/scope.py \
  /app/app/routes/document_routes.py \
  /app/app/services/rag_authorization.py
do
  docker exec rag_api test -f "$f" || {
    echo "FAIL: missing runtime file $f"
    exit 1
  }
done
echo "PASS: required RAG runtime files"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
CHECKPOINT_DIR="checkpoints/${RELEASE}-${STAMP}-${SHORT_SHA}"
mkdir -p "$CHECKPOINT_DIR"

echo
echo "===== DATABASE CHECKPOINT ====="
if docker compose ps --services --status running | grep -qx mongodb; then
  docker exec chat-mongodb sh -lc '
    test -n "$MONGO_INITDB_ROOT_USERNAME"
    test -n "$MONGO_INITDB_ROOT_PASSWORD"

    mongodump \
      --username "$MONGO_INITDB_ROOT_USERNAME" \
      --password "$MONGO_INITDB_ROOT_PASSWORD" \
      --authenticationDatabase admin \
      --archive="/tmp/checkpoint.archive" \
      --gzip
  ' >/dev/null

  docker cp \
    "chat-mongodb:/tmp/checkpoint.archive" \
    "$CHECKPOINT_DIR/mongodb.archive"

  docker exec chat-mongodb rm -f /tmp/checkpoint.archive

  test -s "$CHECKPOINT_DIR/mongodb.archive"

  sha256sum "$CHECKPOINT_DIR/mongodb.archive" \
    > "$CHECKPOINT_DIR/mongodb.archive.sha256"

  echo "PASS: MongoDB"
else
  echo "FAIL: mongodb service is not running"
  exit 1
fi

echo
echo "===== CONFIG SNAPSHOT ====="
cp docker-compose.yml "$CHECKPOINT_DIR/" 2>/dev/null || true
cp docker-compose.override.yaml "$CHECKPOINT_DIR/"
cp librechat.yaml "$CHECKPOINT_DIR/"

sha256sum \
  "$CHECKPOINT_DIR/docker-compose.override.yaml" \
  "$CHECKPOINT_DIR/librechat.yaml" \
  > "$CHECKPOINT_DIR/config.sha256"

docker compose config \
  | sed -E \
      -e 's/(API_KEY|PASSWORD|SECRET|TOKEN|CLIENT_SECRET): .*/\1: REDACTED/g' \
      -e 's/(key|password|secret|token): .*/\1: REDACTED/g' \
  > "$CHECKPOINT_DIR/compose.rendered.redacted.yaml"

echo
echo "===== MANIFEST ====="
cat > "$CHECKPOINT_DIR/manifest.txt" <<EOF
release=$RELEASE
timestamp_utc=$STAMP
branch=$BRANCH
git_sha=$SHA
api_image=$API_IMAGE
api_image_id=$API_IMAGE_ID
rag_image=$RAG_IMAGE
rag_image_id=$RAG_IMAGE_ID
api_health=PASS
rag_health=PASS
git_clean=PASS
runtime_files=PASS
mongodb_backup=PASS
EOF

git log -10 --oneline > "$CHECKPOINT_DIR/git-log.txt"
docker compose ps > "$CHECKPOINT_DIR/docker-compose-ps.txt"

echo
echo "===== CHECKPOINT COMPLETE ====="
echo "Release:    $RELEASE"
echo "Git SHA:    $SHORT_SHA"
echo "API:        PASS"
echo "RAG:        PASS"
echo "MongoDB:    PASS"
echo "Git clean:  PASS"
echo "Checkpoint: $CHECKPOINT_DIR"
