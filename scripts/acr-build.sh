#!/usr/bin/env bash
set -euo pipefail

REGISTRY="${ACR_REGISTRY:-seeds}"
IMAGE="${ACR_IMAGE:-aischolarhub-custom}"
CTX="/tmp/aischolarhub-acr-context"

echo "============================================================"
echo " AI SCHOLAR HUB - COMMIT + ACR BUILD + DEV DEPLOY"
echo "============================================================"

# ------------------------------------------------------------
# 1. Commit current source changes, if any
# ------------------------------------------------------------

echo
echo "===== 1. GIT SOURCE CHECKPOINT ====="

if [ -n "$(git status --porcelain)" ]; then
    git add -A

    COMMIT_MESSAGE="${COMMIT_MESSAGE:-DEV automated build checkpoint $(date '+%Y-%m-%d %H:%M:%S')}"

    git commit -m "$COMMIT_MESSAGE"
    echo "Created Git commit."
else
    echo "Working tree already clean; using existing HEAD."
fi

SHORT_SHA="$(git rev-parse --short=9 HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
STAMP="$(date +%Y%m%d-%H%M%S)"

# Optional explicit tag argument still supported.
TAG="${1:-dev-${STAMP}-${SHORT_SHA}}"

FULL_IMAGE="${REGISTRY}.azurecr.io/${IMAGE}:${TAG}"

echo
echo "Branch: $BRANCH"
echo "Commit: $SHORT_SHA"
echo "Tag:    $TAG"
echo "Image:  $FULL_IMAGE"


# ------------------------------------------------------------
# 2. Prevent accidental duplicate Git tag
# ------------------------------------------------------------

echo
echo "===== 2. VERIFY TAG ====="

if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo "ERROR: Git tag already exists: $TAG"
    exit 1
fi

echo "Tag is available."


# ------------------------------------------------------------
# 3. Prepare clean ACR build context
# ------------------------------------------------------------

echo
echo "===== 3. PREPARE CLEAN BUILD CONTEXT ====="

rm -rf "$CTX"
mkdir -p "$CTX"

rsync -a \
  --delete \
  --exclude='ollama_data/' \
  --exclude='data-node/' \
  --exclude='uploads/' \
  --exclude='logs/' \
  --exclude='checkpoints/' \
  --exclude='.git/' \
  --exclude='node_modules/' \
  ./ "$CTX/"

echo "Build context prepared."


# ------------------------------------------------------------
# 4. Remote ACR build
# ------------------------------------------------------------

echo
echo "===== 4. ACR REMOTE BUILD ====="

az acr build \
  --registry "$REGISTRY" \
  --image "${IMAGE}:${TAG}" \
  "$CTX"


# ------------------------------------------------------------
# 5. Authenticate local Docker to ACR
# ------------------------------------------------------------

echo
echo "===== 5. ACR LOGIN ====="

az acr login --name "$REGISTRY"


# ------------------------------------------------------------
# 6. Pull exact built image
# ------------------------------------------------------------

echo
echo "===== 6. PULL IMAGE ====="

docker pull "$FULL_IMAGE"


# ------------------------------------------------------------
# 7. Update DEV Compose image
# ------------------------------------------------------------

echo
echo "===== 7. UPDATE DEV COMPOSE ====="

python3 - "$FULL_IMAGE" <<'PY'
from pathlib import Path
import re
import sys

image = sys.argv[1]
p = Path("docker-compose.override.yaml")
s = p.read_text()

pattern = r'(?m)^(\s*image:\s*)(?:seeds\.azurecr\.io/)?aischolarhub-custom:[^\s]+'

match = re.search(pattern, s)

if not match:
    raise SystemExit(
        "ERROR: Could not locate the API aischolarhub-custom image line"
    )

replacement = match.group(1) + image
s = s[:match.start()] + replacement + s[match.end():]

p.write_text(s)

print("Compose API image set to:")
print(image)
PY

grep -n 'image:.*aischolarhub-custom' docker-compose.override.yaml


# ------------------------------------------------------------
# 8. Recreate API only
# ------------------------------------------------------------

echo
echo "===== 8. RECREATE API ONLY ====="

docker compose up -d --no-deps --force-recreate api


# ------------------------------------------------------------
# 9. Verify container/image
# ------------------------------------------------------------

echo
echo "===== 9. VERIFY CONTAINER ====="

docker compose ps api

RUNNING_IMAGE="$(
  docker inspect AI_Scholar_Hub --format '{{.Config.Image}}'
)"

echo "Running image: $RUNNING_IMAGE"

if [ "$RUNNING_IMAGE" != "$FULL_IMAGE" ]; then
    echo "ERROR: Running image does not match requested deployment."
    echo "Expected: $FULL_IMAGE"
    echo "Actual:   $RUNNING_IMAGE"
    exit 1
fi


# ------------------------------------------------------------
# 10. Readiness check
# ------------------------------------------------------------

echo
echo "===== 10. VERIFY STARTUP ====="

READY=0

for attempt in $(seq 1 30); do
    STATUS="$(
      docker inspect AI_Scholar_Hub \
        --format '{{.State.Status}}' 2>/dev/null || true
    )"

    if [ "$STATUS" != "running" ]; then
        echo "Attempt $attempt: container status=$STATUS"
        sleep 2
        continue
    fi

    if docker logs --since 5m AI_Scholar_Hub 2>&1 | \
       grep -q 'Server readiness checks passing'; then
        READY=1
        break
    fi

    echo "Attempt $attempt: waiting for readiness..."
    sleep 2
done

if [ "$READY" -ne 1 ]; then
    echo
    echo "ERROR: API did not become ready."
    echo
    echo "===== RECENT API LOGS ====="
    docker logs --since 5m AI_Scholar_Hub 2>&1 | tail -150
    exit 1
fi

echo "API readiness confirmed."


# ------------------------------------------------------------
# 11. Create matching Git deployment tag
# ------------------------------------------------------------

echo
echo "===== 11. CREATE GIT DEPLOYMENT TAG ====="

git tag -a "$TAG" \
  -m "AI Scholar Hub DEV deployment
Image: $FULL_IMAGE
Branch: $BRANCH
Commit: $(git rev-parse HEAD)"

echo "Created Git tag: $TAG"


# ------------------------------------------------------------
# 12. Final verification
# ------------------------------------------------------------

echo
echo "===== 12. FINAL DEPLOYMENT RECORD ====="

echo "Git branch : $BRANCH"
echo "Git commit : $(git rev-parse HEAD)"
echo "Git tag    : $TAG"
echo "ACR image  : $FULL_IMAGE"
echo

docker inspect AI_Scholar_Hub \
  --format 'Container={{.Name}} Image={{.Config.Image}} ID={{.Image}} Status={{.State.Status}}'

echo
echo "============================================================"
echo " DEV DEPLOYMENT SUCCESSFUL"
echo "============================================================"
