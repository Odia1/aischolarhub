#!/usr/bin/env bash
set -euo pipefail
DEST="/opt/aischolarhub/backups/$(date +%Y%m%d)"
mkdir -p "$DEST"
docker exec chat-mongodb mongodump --archive > "$DEST/mongo.archive"
docker exec vectordb pg_dump -U raguser ragdb > "$DEST/ragdb.sql"
find /opt/aischolarhub/backups -maxdepth 1 -type d -mtime +14 -exec rm -rf {} \;
