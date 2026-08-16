#!/usr/bin/env bash
set -euo pipefail
cd /opt/aischolarhub

echo "Current image references, resolved to exact digests:"
echo "(paste these into docker-compose.yml in place of the :latest/:vX.Y tags)"
echo ""

for service in api mongodb meilisearch vectordb rag_api admin-panel ollama; do
  container=$(docker compose ps -q "$service" 2>/dev/null || true)
  if [ -z "$container" ]; then
    echo "$service: not running, skip"
    continue
  fi
  image_id=$(docker inspect --format='{{.Image}}' "$container")
  digest=$(docker inspect --format='{{index .RepoDigests 0}}' "$image_id" 2>/dev/null || echo "no repo digest available")
  echo "$service: $digest"
done
