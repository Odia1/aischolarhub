#!/usr/bin/env bash

# Run this file as a subprocess. Sourcing it is deliberately rejected so
# strict-mode failures can never close or alter an interactive xterm.
if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  echo "Run: bash scripts/checkpoint-release.sh <release-name>"
  return 2
fi

set -Eeuo pipefail
trap 'echo "FAIL at line $LINENO: $BASH_COMMAND" >&2' ERR

fail() { echo "FAIL: $*" >&2; exit 1; }

RELEASE="${1:-}"
[[ "$RELEASE" =~ ^[A-Za-z0-9._-]+$ ]] || {
  echo "Usage: bash scripts/checkpoint-release.sh <release-name>"
  exit 2
}

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

BRANCH="$(git branch --show-current)"
SHA="$(git rev-parse HEAD)"
SHORT_SHA="$(git rev-parse --short=9 HEAD)"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
CHECKPOINT_DIR="checkpoints/${RELEASE}-${STAMP}-${SHORT_SHA}"
TEST_IMAGE="aih-release-c-test-deps:20260908"

echo "===== AI SCHOLAR HUB DEV RELEASE CHECKPOINT ====="
echo "Release: $RELEASE"
echo "Branch:  $BRANCH"
echo "SHA:     $SHA"

echo
echo "===== GIT AND COMPOSE ====="
[[ -z "$(git status --porcelain)" ]] || {
  git status --short
  fail "working tree is not clean"
}
git diff --check HEAD^ HEAD
docker compose config --quiet

for file in docker-compose.yml docker-compose.override.yaml librechat.yaml; do
  [[ -f "$file" ]] || fail "missing $file"
done

EFFECTIVE_API_IMAGE="$(docker compose config --images | grep '^seeds\.azurecr\.io/aischolarhub-custom:' | head -1)"
BASE_API_IMAGE="$(sed -n 's/^[[:space:]]*image:[[:space:]]*\(seeds\.azurecr\.io\/aischolarhub-custom:.*\)$/\1/p' docker-compose.yml | head -1)"
OVERRIDE_API_IMAGE="$(sed -n 's/^[[:space:]]*image:[[:space:]]*\(seeds\.azurecr\.io\/aischolarhub-custom:.*\)$/\1/p' docker-compose.override.yaml | head -1)"

[[ -n "$EFFECTIVE_API_IMAGE" ]] || fail "effective API image missing"
[[ "$BASE_API_IMAGE" == "$EFFECTIVE_API_IMAGE" ]] || fail "base API image differs from effective image"
[[ "$OVERRIDE_API_IMAGE" == "$EFFECTIVE_API_IMAGE" ]] || fail "override API image differs from effective image"
echo "PASS: Git clean; base, override, and effective images agree"

echo
echo "===== REQUIRED DEV SERVICES ====="
for service in api rag_api mongodb vectordb model-router searxng admin-ui admin-panel ollama; do
  [[ -n "$(docker compose ps -q "$service")" ]] || fail "$service is not running"
  echo "PASS: $service"
done

echo
echo "===== IMMUTABLE API ====="
API_CID="$(docker compose ps -q api)"
RUNNING_TAG="$(docker inspect "$API_CID" --format '{{.Config.Image}}')"
RUNNING_ID="$(docker inspect "$API_CID" --format '{{.Image}}')"
LOCAL_ID="$(docker image inspect "$EFFECTIVE_API_IMAGE" --format '{{.Id}}')"
[[ "$RUNNING_TAG" == "$EFFECTIVE_API_IMAGE" ]] || fail "running API tag mismatch"
[[ "$RUNNING_ID" == "$LOCAL_ID" ]] || fail "running API image ID mismatch"

for file in \
  api/server/services/ToolService.js \
  api/app/clients/tools/util/fileSearch.js \
  api/server/services/AcademicIntelligence/knowledgeScope.js
do
  HOST_HASH="$(sha256sum "$file" | awk '{print $1}')"
  IMAGE_HASH="$(docker compose exec -T api sha256sum "/app/$file" | awk '{print $1}')"
  [[ "$HOST_HASH" == "$IMAGE_HASH" ]] || fail "image source mismatch: $file"
done
echo "PASS: immutable image and reviewed source"

echo
echo "===== STATIC AND REGRESSION TESTS ====="
docker compose exec -T api node --check /app/api/server/services/ToolService.js
docker compose exec -T api node --check /app/api/app/clients/tools/util/fileSearch.js
docker compose exec -T api node --check /app/api/server/services/AcademicIntelligence/knowledgeScope.js
docker compose exec -T admin-ui node --check /app/server.js
docker compose exec -T admin-ui node --check /app/rag-policy.js
python3 - <<'PYCODE'
from pathlib import Path

for filename in (
    "runtime-patches/rag_api/app/scope.py",
    "runtime-patches/rag_api/app/routes/document_routes.py",
    "runtime-patches/rag_api/app/services/rag_authorization.py",
):
    source = Path(filename).read_text()
    compile(source, filename, "exec")
PYCODE

docker image inspect "$TEST_IMAGE" >/dev/null || fail "test image unavailable: $TEST_IMAGE"
docker run --rm --network none \
  --env NODE_ENV=test --env NODE_PATH=/app/node_modules \
  --volume "$ROOT:/workspace:ro" --workdir /workspace/api \
  "$TEST_IMAGE" /app/node_modules/.bin/jest \
  --config /workspace/api/jest.config.js --runInBand \
  test/services/AcademicIntelligence/knowledgeScope.test.js \
  test/app/clients/tools/util/fileSearch.test.js
docker compose exec -T admin-ui node --test /app/rag-policy.test.js
echo "PASS: syntax and Release C regressions"

echo
echo "===== PRODUCTION DEPENDENCY AUDIT ====="
docker run --rm "$EFFECTIVE_API_IMAGE" npm audit --omit=dev --audit-level=low
echo "PASS: zero production vulnerabilities"

echo
echo "===== HEALTH MATRIX ====="
[[ "$(curl -fsS http://127.0.0.1:3080/readyz)" == "OK" ]] || fail "API readiness"
curl -fsS http://127.0.0.1:3081/ >/dev/null || fail "admin panel"
curl -fsS http://127.0.0.1:3090/ >/dev/null || fail "admin UI"

docker compose exec -T rag_api python -c \
  'import json,urllib.request; d=json.load(urllib.request.urlopen("http://127.0.0.1:8000/health",timeout=5)); assert d.get("status")=="UP"'
docker compose exec -T model-router python -c \
  'import json,urllib.request; d=json.load(urllib.request.urlopen("http://127.0.0.1:8000/health",timeout=5)); assert d.get("status")=="ok" and d.get("enabled") is True'
[[ "$(docker compose exec -T searxng python -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8080/healthz",timeout=5).read().decode())')" == "OK" ]] || fail "SearXNG"

echo "Warming nomic-embed-text..."
docker compose exec -T rag_api python - <<'PYCODE'
import json
import urllib.request

request = urllib.request.Request(
    "http://ollama:11434/api/embed",
    data=json.dumps({
        "model": "nomic-embed-text",
        "input": ["AI Scholar Hub embedding readiness"],
        "keep_alive": -1,
    }).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)

with urllib.request.urlopen(request, timeout=120) as response:
    body = json.load(response)

if not body.get("embeddings"):
    raise SystemExit("Ollama warm-up returned no embedding")
PYCODE

OLLAMA_STATUS="$(docker compose exec -T ollama ollama ps)"
grep -q 'nomic-embed-text' <<<"$OLLAMA_STATUS" || fail "embedding model is not resident"
grep -q 'Forever' <<<"$OLLAMA_STATUS" || fail "embedding model keep-alive is not indefinite"

for file in /app/app/scope.py /app/app/routes/document_routes.py /app/app/services/rag_authorization.py; do
  docker compose exec -T rag_api test -f "$file" || fail "missing RAG runtime file: $file"
done
echo "PASS: API, RAG, router, SearXNG, admin interfaces, Ollama"

mkdir -p "$CHECKPOINT_DIR"

echo
echo "===== MONGODB CHECKPOINT ====="
# The URI travels only through this pipe. It is never printed or stored.
docker compose exec -T api sh -lc 'printf "%s\n" "$MONGO_URI"' |
docker compose exec -T mongodb sh -lc '
  IFS= read -r MONGO_URI
  test -n "$MONGO_URI"
  mongodump --uri "$MONGO_URI" --db LibreChat --archive --gzip
' > "$CHECKPOINT_DIR/mongodb.archive"
[[ -s "$CHECKPOINT_DIR/mongodb.archive" ]] || fail "Mongo archive is empty"
sha256sum "$CHECKPOINT_DIR/mongodb.archive" > "$CHECKPOINT_DIR/mongodb.archive.sha256"
echo "PASS: MongoDB"

echo
echo "===== SAFE CHECKPOINT MANIFEST ====="
cp docker-compose.yml docker-compose.override.yaml librechat.yaml "$CHECKPOINT_DIR/"
sha256sum "$CHECKPOINT_DIR"/docker-compose.yml \
  "$CHECKPOINT_DIR"/docker-compose.override.yaml \
  "$CHECKPOINT_DIR"/librechat.yaml > "$CHECKPOINT_DIR/config.sha256"

RAG_CID="$(docker compose ps -q rag_api)"
RAG_TAG="$(docker inspect "$RAG_CID" --format '{{.Config.Image}}')"
RAG_ID="$(docker inspect "$RAG_CID" --format '{{.Image}}')"

{
  echo "release=$RELEASE"
  echo "timestamp_utc=$STAMP"
  echo "branch=$BRANCH"
  echo "git_sha=$SHA"
  echo "api_image=$EFFECTIVE_API_IMAGE"
  echo "api_image_id=$RUNNING_ID"
  echo "rag_image=$RAG_TAG"
  echo "rag_image_id=$RAG_ID"
  echo "health_matrix=PASS"
  echo "regressions=PASS"
  echo "production_audit=PASS"
  echo "mongodb_backup=PASS"
  echo "git_clean=PASS"
} > "$CHECKPOINT_DIR/manifest.txt"

git log -10 --oneline > "$CHECKPOINT_DIR/git-log.txt"
docker compose ps > "$CHECKPOINT_DIR/docker-compose-ps.txt"

echo
echo "===== CHECKPOINT COMPLETE ====="
echo "Release:    $RELEASE"
echo "Git SHA:    $SHORT_SHA"
echo "API:        PASS"
echo "RAG:        PASS"
echo "Router:     PASS"
echo "SearXNG:    PASS"
echo "Admin:      PASS"
echo "Tests:      PASS"
echo "Audit:      PASS"
echo "MongoDB:    PASS"
echo "Git clean:  PASS"
echo "Checkpoint: $CHECKPOINT_DIR"
