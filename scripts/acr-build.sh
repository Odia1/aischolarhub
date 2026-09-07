#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# AI SCHOLAR HUB
# Clean ACR build + DEV API deployment
#
# IMPORTANT:
#   - Builds committed Git HEAD only.
#   - Never auto-commits source.
#   - Never traverses runtime data directories.
#   - Creates Git deployment tag only after successful deploy.
#
# Usage:
#   ./scripts/acr-build.sh release-b
#   ./scripts/acr-build.sh release-c
#
# Optional:
#   ACR_REGISTRY=seeds
#   ACR_IMAGE=aischolarhub-custom
# ============================================================

REGISTRY="${ACR_REGISTRY:-seeds}"
IMAGE="${ACR_IMAGE:-aischolarhub-custom}"
RELEASE_LABEL="${1:-}"

if [[ -z "$RELEASE_LABEL" ]]; then
    echo "Usage: $0 <release-label>"
    echo "Example: $0 release-b"
    exit 1
fi

# Docker/Git tag-safe label.
RELEASE_LABEL="$(
    printf '%s' "$RELEASE_LABEL" |
    tr '[:upper:]' '[:lower:]' |
    tr -cs 'a-z0-9._-' '-'
)"
RELEASE_LABEL="${RELEASE_LABEL#-}"
RELEASE_LABEL="${RELEASE_LABEL%-}"

if [[ -z "$RELEASE_LABEL" ]]; then
    echo "ERROR: Invalid release label."
    exit 1
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    echo "ERROR: Not inside a Git repository."
    exit 1
}

cd "$ROOT"

echo "============================================================"
echo " AI SCHOLAR HUB - CLEAN ACR BUILD + DEV DEPLOY"
echo "============================================================"

# ------------------------------------------------------------
# 1. Validate source state
# ------------------------------------------------------------

echo
echo "===== 1. VERIFY SOURCE ====="

if [[ -n "$(git status --porcelain)" ]]; then
    echo "ERROR: Working tree is not clean."
    echo
    git status --short
    echo
    echo "Commit or discard changes before deployment."
    exit 1
fi

BRANCH="$(git branch --show-current)"
COMMIT="$(git rev-parse HEAD)"
SHORT_SHA="$(git rev-parse --short=9 HEAD)"
STAMP="$(date -u +%Y%m%d)"

TAG="dev-${STAMP}-${SHORT_SHA}-${RELEASE_LABEL}"
FULL_IMAGE="${REGISTRY}.azurecr.io/${IMAGE}:${TAG}"

echo "Branch : $BRANCH"
echo "Commit : $COMMIT"
echo "Tag    : $TAG"
echo "Image  : $FULL_IMAGE"

if [[ ! -f Dockerfile ]]; then
    echo "ERROR: Dockerfile not found at repository root."
    exit 1
fi

if ! command -v az >/dev/null 2>&1; then
    echo "ERROR: Azure CLI is not installed."
    exit 1
fi

if ! az account show >/dev/null 2>&1; then
    echo "ERROR: Azure CLI is not authenticated."
    exit 1
fi

if git rev-parse "refs/tags/$TAG" >/dev/null 2>&1; then
    echo "ERROR: Git deployment tag already exists: $TAG"
    exit 1
fi

# ------------------------------------------------------------
# 2. Create immutable clean build context
# ------------------------------------------------------------

echo
echo "===== 2. PREPARE CLEAN BUILD CONTEXT ====="

CTX="$(mktemp -d /tmp/aischolarhub-acr.XXXXXX)"

cleanup() {
    rm -rf "$CTX"
}
trap cleanup EXIT INT TERM

# This is deliberately NOT rsync.
# git archive exports only committed files in HEAD.
git archive --format=tar HEAD | tar -xf - -C "$CTX"

if [[ ! -f "$CTX/Dockerfile" ]]; then
    echo "ERROR: Dockerfile is not present in committed HEAD."
    exit 1
fi

echo "Context prepared from committed Git HEAD only:"
du -sh "$CTX"

# ------------------------------------------------------------
# 3. Remote ACR build
# ------------------------------------------------------------

echo
echo "===== 3. ACR REMOTE BUILD ====="

az acr build \
    --registry "$REGISTRY" \
    --image "${IMAGE}:${TAG}" \
    --file Dockerfile \
    "$CTX"

# ------------------------------------------------------------
# 4. Pull exact image
# ------------------------------------------------------------

echo
echo "===== 4. ACR LOGIN / PULL ====="

az acr login --name "$REGISTRY"
docker pull "$FULL_IMAGE"

# ------------------------------------------------------------
# 5. Update DEV Compose API image
# ------------------------------------------------------------

echo
echo "===== 5. UPDATE DEV COMPOSE ====="

python3 - "$FULL_IMAGE" <<'PY2'
from pathlib import Path
import re
import sys

image = sys.argv[1]
p = Path("docker-compose.override.yaml")

if not p.exists():
    p.write_text(
        "services:\n"
        "  api:\n"
        f"    image: {image}\n"
    )
    print("Created docker-compose.override.yaml")
    print("Compose API image set to:")
    print(image)
    raise SystemExit(0)

s = p.read_text()

pattern = (
    r'(?m)^(\s*image:\s*)'
    r'(?:seeds\.azurecr\.io/)?aischolarhub-custom:[^\s]+'
)

matches = list(re.finditer(pattern, s))

if len(matches) != 1:
    raise SystemExit(
        f"ERROR: Expected exactly one aischolarhub-custom image line; "
        f"found {len(matches)}"
    )

m = matches[0]
s = s[:m.start()] + m.group(1) + image + s[m.end():]

p.write_text(s)

print("Compose API image set to:")
print(image)
PY2

grep -n 'image:.*aischolarhub-custom' docker-compose.override.yaml

# ------------------------------------------------------------
# 6. Recreate API only
# ------------------------------------------------------------

echo
echo "===== 6. RECREATE API ====="

docker compose up -d --no-deps --force-recreate api

API_CONTAINER_ID="$(docker compose ps -q api)"

if [[ -z "$API_CONTAINER_ID" ]]; then
    echo "ERROR: Compose did not return an API container ID."
    return 1 2>/dev/null || false
fi

# ------------------------------------------------------------
# 7. Verify exact image
# ------------------------------------------------------------

echo
echo "===== 7. VERIFY DEPLOYED IMAGE ====="

RUNNING_IMAGE="$(
    docker inspect "$API_CONTAINER_ID" \
        --format '{{.Config.Image}}' 2>/dev/null || true
)"

echo "Expected: $FULL_IMAGE"
echo "Running : $RUNNING_IMAGE"

if [[ "$RUNNING_IMAGE" != "$FULL_IMAGE" ]]; then
    echo "ERROR: Deployed image does not match requested image."
    exit 1
fi

# ------------------------------------------------------------
# 8. Wait for API readiness
# ------------------------------------------------------------

echo
echo "===== 8. VERIFY API READINESS ====="

READY=0

for attempt in $(seq 1 45); do
    STATUS="$(
        docker inspect "$API_CONTAINER_ID" \
            --format '{{.State.Status}}' 2>/dev/null || true
    )"

    if [[ "$STATUS" == "running" ]] &&
       docker logs --since 5m "$API_CONTAINER_ID" 2>&1 |
           grep -q 'Server readiness checks passing'; then
        READY=1
        break
    fi

    echo "Attempt $attempt: status=${STATUS:-unknown}; waiting..."
    sleep 2
done

if [[ "$READY" -ne 1 ]]; then
    echo
    echo "ERROR: API did not become ready."
    echo
    echo "===== RECENT API LOGS ====="
    docker logs --since 5m "$API_CONTAINER_ID" 2>&1 | tail -150
    exit 1
fi

echo "API readiness confirmed."

# ------------------------------------------------------------
# 9. Record successful deployment
# ------------------------------------------------------------

echo
echo "===== 9. CREATE DEPLOYMENT TAG ====="

git tag -a "$TAG" \
    -m "AI Scholar Hub DEV deployment

Image: $FULL_IMAGE
Branch: $BRANCH
Commit: $COMMIT"

echo "Created Git tag: $TAG"

# ------------------------------------------------------------
# 10. Final record
# ------------------------------------------------------------

echo
echo "============================================================"
echo " DEPLOYMENT SUCCESSFUL"
echo "============================================================"
echo "Git branch : $BRANCH"
echo "Git commit : $COMMIT"
echo "Git tag    : $TAG"
echo "ACR image  : $FULL_IMAGE"
echo

docker compose ps api

echo
echo "To push the deployment tag to the remote repository:"
echo "  git push origin \"$TAG\""
