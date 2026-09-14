#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

IMAGE="${AIH_DEV_TEST_IMAGE:-aih-dev-test:local}"

echo "============================================================"
echo " AI SCHOLAR HUB - DEV TEST IMAGE"
echo "============================================================"
echo "Image: $IMAGE"

docker build \
  --network=host \
  --target dev-test \
  -t "$IMAGE" \
  .

echo
echo "===== VERIFY DEV TOOLING ====="

docker run --rm "$IMAGE" sh -lc '
  echo "Node:       $(node --version)"
  echo "npm:        $(npm --version)"
  echo "Jest:       $(./node_modules/.bin/jest --version)"
  echo "TypeScript: $(./node_modules/.bin/tsc --version)"

  test -x ./node_modules/.bin/jest
  test -d ./node_modules/babel-jest
  test -d ./node_modules/@babel/preset-typescript
'

echo
echo "DEV_TEST_IMAGE_READY=$IMAGE"
