#!/usr/bin/env bash
set -euo pipefail
cd /opt/aischolarhub
LOG="/opt/aischolarhub/upgrade.log"

{
  echo "=== $(date) ==="
  echo "Before:"
  docker compose config | grep "image:"
} >> "$LOG"

docker compose pull
docker compose up -d

sleep 15
down=$(docker compose ps --status exited --status restarting --format '{{.Service}}' 2>/dev/null || true)

if [ -n "$down" ]; then
  echo "UNHEALTHY after pull: $down — NOT pruning, old images kept for rollback" >> "$LOG"
  exit 1
fi

echo "Healthy. Pruning now-orphaned old images." >> "$LOG"
docker image prune -af
{
  echo "After:"
  docker compose config | grep "image:"
  echo ""
} >> "$LOG"
