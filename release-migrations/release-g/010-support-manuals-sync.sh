#!/usr/bin/env bash
set -euo pipefail

DEV_ROOT="${DEV_ROOT:-/opt/aischolarhub}"
PROD_API_CONTAINER="${PROD_API_CONTAINER:-aih-prod-api}"

SYNC_SRC="$DEV_ROOT/scripts/support-manuals-sync.mjs"
JSON_SRC="$DEV_ROOT/scripts/support/support-manuals.json"

SYNC_DST="/app/scripts/_release_g_support_manuals_sync.mjs"
JSON_DST="/app/scripts/_release_g_support_manuals.json"

echo "===== RELEASE G DATA/BOOTSTRAP MIGRATION ====="
echo "Environment/config: NONE"
echo "Mongo/index migration: NONE"
echo "Data/bootstrap: Support Knowledge canonical manual synchronization"
echo "Storage migration: NONE"

test -s "$SYNC_SRC"
test -s "$JSON_SRC"

test "$(docker inspect -f '{{.State.Running}}' "$PROD_API_CONTAINER")" = "true"

cleanup() {
  docker exec "$PROD_API_CONTAINER" \
    rm -f "$SYNC_DST" "$JSON_DST" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker cp "$SYNC_SRC" "$PROD_API_CONTAINER:$SYNC_DST"
docker cp "$JSON_SRC" "$PROD_API_CONTAINER:$JSON_DST"

docker exec "$PROD_API_CONTAINER" \
  node "$SYNC_DST" apply "$JSON_DST"

echo
echo "===== VERIFY PROD MANUAL SYNCHRONIZATION ====="
docker exec "$PROD_API_CONTAINER" \
  node "$SYNC_DST" check "$JSON_DST"

echo "SUPPORT_MANUAL_PROD_SYNC_COMPLETE"
