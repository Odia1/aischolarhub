#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/release-lib.sh"

MANIFEST="${1:-}"
[[ -n "$MANIFEST" ]] || die "usage: $0 /path/to/release.env"
require_file "$MANIFEST"

# shellcheck disable=SC1090
source "$MANIFEST"

: "${RELEASE_NAME:?}"
: "${DEV_ROOT:=/opt/aischolarhub}"
: "${PROD_ROOT:=/opt/scholarhub}"
: "${EXPECTED_API_IMAGE:?}"
: "${PROD_API_CONTAINER:=aih-prod-api}"
: "${API_SERVICE:=api}"
: "${PROMOTE_LIBRECHAT:=0}"
: "${PROMOTE_COMPOSE:=0}"
: "${MIGRATIONS_DIR:=$DEV_ROOT/release-migrations/$RELEASE_NAME}"

require_cmd docker
require_cmd python3
require_cmd curl
require_cmd sha256sum
require_cmd flock

LOCK="/tmp/aih-release-promotion.lock"
exec 9>"$LOCK"
flock -n 9 || die "another AIH promotion is already running"

cd "$PROD_ROOT"
docker compose config --quiet
pass "current PROD Compose validates"

mkdir -p release-checkpoints
BACKUP="release-checkpoints/pre-${RELEASE_NAME}-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP"
cp -a docker-compose.yml librechat.yaml "$BACKUP/"
[[ -f .env ]] && cp -a .env "$BACKUP/.env"
chmod 700 "$BACKUP"
[[ -f "$BACKUP/.env" ]] && chmod 600 "$BACKUP/.env"
pass "mutable PROD configuration checkpointed"

note "Pulling exact release image"
docker pull "$EXPECTED_API_IMAGE"

if [[ -n "${EXPECTED_API_DIGEST:-}" ]]; then
  digest="$(docker image inspect "$EXPECTED_API_IMAGE" --format '{{index .RepoDigests 0}}' 2>/dev/null || true)"
  [[ "$digest" == *@"$EXPECTED_API_DIGEST" ]] || die "image digest mismatch: $digest"
  pass "image digest"
fi

if [[ "$PROMOTE_LIBRECHAT" == "1" ]]; then
  : "${LIBRECHAT_SOURCE:=$DEV_ROOT/librechat.yaml}"
  require_file "$LIBRECHAT_SOURCE"
  cp -a "$LIBRECHAT_SOURCE" "$PROD_ROOT/librechat.yaml"
  pass "librechat.yaml promoted"
fi

if [[ "$PROMOTE_COMPOSE" == "1" ]]; then
  : "${COMPOSE_SOURCE:=$DEV_ROOT/docker-compose.yml}"
  require_file "$COMPOSE_SOURCE"
  cp -a "$COMPOSE_SOURCE" "$PROD_ROOT/docker-compose.yml"
  pass "Compose promoted"
fi

# Set the API image deterministically without touching other service definitions.
python3 - "$EXPECTED_API_IMAGE" <<'PY'
from pathlib import Path
import re,sys
image=sys.argv[1]
p=Path("docker-compose.yml")
s=p.read_text()
pat=re.compile(r'(^  api:\n(?:.*\n)*?^\s+image:\s*)(\S+)', re.M)
m=pat.search(s)
if not m:
    raise SystemExit("FAIL: api.image not found")
s=s[:m.start(2)] + image + s[m.end(2):]
p.write_text(s)
PY

docker compose config --quiet
pass "candidate PROD Compose validates"

# Ensure runtime services that are release dependencies are Compose-managed.
for service in model-router searxng; do
  if ! docker compose config --services | grep -qx "$service"; then
    die "$service is not Compose-managed; refusing fragile promotion"
  fi
done
pass "required runtime services are Compose-managed"

# Required env names are checked only for presence; values are never printed.
IFS=',' read -ra REQUIRED <<<"${REQUIRED_PROD_ENV_KEYS:-SEARXNG_INSTANCE_URL,ASH_MODEL_ROUTER_ENABLED,ASH_GOOGLE_API_KEYS,ASH_GROQ_API_KEYS,ASH_OPENROUTER_API_KEYS,ASH_CLOUDFLARE_ACCOUNT_IDS,ASH_CLOUDFLARE_API_TOKENS}"
for key in "${REQUIRED[@]}"; do
  key="${key// /}"
  [[ -z "$key" ]] && continue
  if env_present "$PROD_ROOT/.env" "$key" || grep -qE "^[[:space:]]+$key:" docker-compose.yml; then
    :
  else
    die "required PROD env key missing: $key"
  fi
done
pass "required PROD environment wiring present"

# Release-specific migrations must be idempotent.
if [[ -d "$MIGRATIONS_DIR" ]]; then
  note "Running release migrations"
  shopt -s nullglob
  for m in "$MIGRATIONS_DIR"/*.sh; do
    echo "MIGRATION: $(basename "$m")"
    bash "$m"
  done
  shopt -u nullglob
fi

note "Deploying managed runtime dependencies"
docker compose up -d --no-deps --force-recreate model-router searxng

note "Deploying API"
docker compose up -d --no-deps --force-recreate "$API_SERVICE"

"$SCRIPT_DIR/verify-release.sh" "$MANIFEST"

pass "$RELEASE_NAME promoted and verified"
echo "Rollback checkpoint: $BACKUP"
