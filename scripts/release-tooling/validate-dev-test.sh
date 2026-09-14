#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "ERROR: Not inside a Git repository."
  exit 1
}

cd "$ROOT"

IMAGE="${AIH_DEV_TEST_IMAGE:-aih-dev-test:local}"

echo "============================================================"
echo " AI SCHOLAR HUB - DEV / TEST VALIDATION"
echo "============================================================"
echo "Image: $IMAGE"

if [[ ! -x scripts/build-dev-test-image.sh ]]; then
  echo "ERROR: scripts/build-dev-test-image.sh is missing or not executable."
  exit 1
fi

echo
echo "===== 1. BUILD / REFRESH DEV TEST IMAGE ====="

AIH_DEV_TEST_IMAGE="$IMAGE" ./scripts/build-dev-test-image.sh

echo
echo "===== 2. VERIFY REQUIRED DEV TOOLING ====="

docker run --rm "$IMAGE" sh -lc '
  set -eu

  test -x /app/node_modules/.bin/jest
  test -x /app/node_modules/.bin/tsc
  test -d /app/node_modules/babel-jest
  test -d /app/node_modules/@babel/preset-typescript

  echo "Node:       $(node --version)"
  echo "npm:        $(npm --version)"
  echo "Jest:       $(/app/node_modules/.bin/jest --version)"
  echo "TypeScript: $(/app/node_modules/.bin/tsc --version)"
'

echo
echo "===== 3. TRUST-BOUNDARY TESTS ====="

docker run --rm \
  "$IMAGE" \
  sh -lc '
    set -eu
    cd /app

    ./node_modules/.bin/jest \
      --config packages/api/jest.config.mjs \
      packages/api/src/rag/response.spec.ts \
      packages/api/src/files/context.spec.ts \
      --runInBand \
      --coverage=false
  '

echo
echo "===== 4. UPLOAD-SECURITY TESTS ====="

docker run --rm \
  -e NODE_OPTIONS="--experimental-vm-modules" \
  "$IMAGE" \
  sh -lc '
    set -eu
    cd /app

    ./node_modules/.bin/jest \
      --config api/jest.config.js \
      api/server/services/Files/uploadSecurity.spec.js \
      --runInBand \
      --coverage=false
  '

echo
echo "===== 5. FILE-PROCESSING REGRESSION TESTS ====="

docker run --rm \
  -e NODE_OPTIONS="--experimental-vm-modules" \
  "$IMAGE" \
  sh -lc '
    set -eu
    cd /app

    ./node_modules/.bin/jest \
      --config api/jest.config.js \
      api/server/services/Files/process.spec.js \
      --runInBand \
      --coverage=false
  '

echo
echo "===== 6. RELEASE SOURCE SANITY ====="

git diff --check

echo
echo "DEV_TEST_VALIDATION_PASSED"
