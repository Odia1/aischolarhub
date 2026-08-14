#!/usr/bin/env bash
# AI Scholar Hub — setup on your existing Ubuntu VM.
#
# Run this FROM the VM itself (SSH in first), from inside the project
# directory (wherever you've placed it, e.g. /opt/aischolarhub).
#
# Usage: ./deploy-vm.sh
set -euo pipefail

echo "== Installing Docker (skips cleanly if already installed) =="
if ! command -v docker &>/dev/null; then
  sudo apt update
  sudo apt install -y docker.io docker-compose-v2
  sudo systemctl enable --now docker
  sudo usermod -aG docker "$USER"
  echo ""
  echo "Docker installed. You need to log out and back in (or run 'newgrp"
  echo "docker') for group membership to take effect, THEN re-run this script."
  exit 0
else
  echo "Docker already present — good, this VM likely already serves other things."
fi

echo "== Firewall (ufw) =="
# Only 22/80/443 reachable from the internet. Port 3080 (LibreChat) and every
# backend service (Mongo/Meilisearch/Postgres/rag_api) are bound to
# 127.0.0.1 in docker-compose.yml, so they're already unreachable externally
# regardless of ufw — this is belt-and-suspenders, and also protects
# whatever else is running on this VM if it isn't already behind ufw.
if command -v ufw &>/dev/null; then
  sudo ufw allow 22/tcp
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw --force enable
  sudo ufw status
else
  echo "ufw not installed — skipping. Confirm some firewall is protecting"
  echo "this VM before going further; a fresh Azure VM with no NSG rules"
  echo "restricting inbound traffic is not something to skip past."
fi

echo "== Checking required secrets are exported =="
: "${MEILI_MASTER_KEY:?export MEILI_MASTER_KEY (scripts/generate-secrets.sh)}"
: "${JWT_SECRET:?export JWT_SECRET}"
: "${JWT_REFRESH_SECRET:?export JWT_REFRESH_SECRET}"
: "${CREDS_KEY:?export CREDS_KEY}"
: "${CREDS_IV:?export CREDS_IV}"
: "${POSTGRES_PASSWORD:?export POSTGRES_PASSWORD}"
: "${GEMINI_API_KEY:?export GEMINI_API_KEY}"

if [ ! -f .env ]; then
  echo "== Creating .env from .env.example =="
  cp .env.example .env
  sed -i \
    -e "s#MEILI_MASTER_KEY=.*#MEILI_MASTER_KEY=${MEILI_MASTER_KEY}#" \
    -e "s#JWT_SECRET=.*#JWT_SECRET=${JWT_SECRET}#" \
    -e "s#JWT_REFRESH_SECRET=.*#JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}#" \
    -e "s#CREDS_KEY=.*#CREDS_KEY=${CREDS_KEY}#" \
    -e "s#CREDS_IV=.*#CREDS_IV=${CREDS_IV}#" \
    -e "s#POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=${POSTGRES_PASSWORD}#" \
    -e "s#GEMINI_API_KEY=.*#GEMINI_API_KEY=${GEMINI_API_KEY}#" \
    .env
  echo "Created .env. STILL NEEDS MANUAL EDITING: DOMAIN_CLIENT, DOMAIN_SERVER,"
  echo "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET — open .env now and fill those in"
  echo "before continuing (they need your real domain and OAuth credentials,"
  echo "which this script has no way to know)."
  read -rp "Press Enter once .env is fully filled in to continue... "
else
  echo ".env already exists — leaving it alone. Delete it first if you want"
  echo "this script to regenerate it from .env.example."
fi

echo "== Starting the stack =="
docker compose up -d

echo ""
echo "Done. Check status with:"
echo "  docker compose ps"
echo "  docker compose logs -f api"
echo ""
echo "LibreChat is now listening on 127.0.0.1:3080 — NOT yet reachable from"
echo "the internet. Next: set up your reverse proxy (see deploy/README.md"
echo "for the Caddy or nginx path, whichever matches how this VM already"
echo "serves its other websites) before this is actually live."
