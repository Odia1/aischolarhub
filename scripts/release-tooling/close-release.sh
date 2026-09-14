#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/release-lib.sh"

MANIFEST="${1:-}"
[[ -n "$MANIFEST" ]] || die "usage: $0 /path/to/release.env"
require_file "$MANIFEST"

MANIFEST="$(cd "$(dirname "$MANIFEST")" && pwd)/$(basename "$MANIFEST")"

# shellcheck disable=SC1090
source "$MANIFEST"

: "${RELEASE_NAME:?}"
: "${PROD_ROOT:=/opt/scholarhub}"
: "${EXPECTED_API_IMAGE:?}"
: "${ROLLBACK_API_IMAGE:=}"
: "${IMAGE_REPO:=seeds.azurecr.io/aischolarhub-custom}"
: "${RETAIN_API_IMAGES:=}"

# Optional registry housekeeping performed only after release verification.
# Disabled by default.
: "${PURGE_ACR_IMAGES:=0}"
: "${ACR_NAME:=seeds}"
: "${ACR_REPOSITORY:=aischolarhub-custom}"
: "${ACR_DEV_RETENTION_DAYS:=45}"

cd "$PROD_ROOT"

"$SCRIPT_DIR/verify-release.sh" "$MANIFEST"

STAMP="$PROD_ROOT/release-checkpoints/${RELEASE_NAME}-VERIFIED.txt"
require_file "$STAMP"
expected_manifest_sha="$(sha256_file "$MANIFEST")"
grep -qx "manifest_sha256=$expected_manifest_sha" "$STAMP" || die "verification stamp does not match current manifest"
pass "verification checkpoint matches manifest"

FINAL="$PROD_ROOT/release-checkpoints/${RELEASE_NAME}-FINAL.txt"
{
  echo "release=$RELEASE_NAME"
  echo "closed_at=$(date -Is)"
  echo "manifest_sha256=$expected_manifest_sha"
  echo "api_image=$EXPECTED_API_IMAGE"
  [[ -n "${EXPECTED_API_DIGEST:-}" ]] && echo "api_digest=$EXPECTED_API_DIGEST"
  echo "librechat_sha256=$(sha256_file librechat.yaml)"
  echo "compose_sha256=$(sha256_file docker-compose.yml)"
  echo
  echo "services:"
  docker compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Image}}'
} > "$FINAL"
pass "final release checkpoint written"

echo
echo "===== STORAGE BEFORE ====="
docker system df

docker image prune -f
docker builder prune -af

declare -A KEEP=()

KEEP["$EXPECTED_API_IMAGE"]=1

if [[ -n "$ROLLBACK_API_IMAGE" ]]; then
  KEEP["$ROLLBACK_API_IMAGE"]=1
fi

IFS=',' read -ra EXTRA_KEEP <<<"$RETAIN_API_IMAGES"
for image in "${EXTRA_KEEP[@]}"; do
  image="${image// /}"
  [[ -n "$image" ]] && KEEP["$image"]=1
done

# Protect any image currently referenced by a running container.
while IFS= read -r image; do
  [[ -n "$image" ]] && KEEP["$image"]=1
done < <(
  docker ps -q |
  xargs -r docker inspect --format '{{.Config.Image}}' 2>/dev/null |
  sort -u
)

mapfile -t OLD_IMAGES < <(
  docker image ls "$IMAGE_REPO" --format '{{.Repository}}:{{.Tag}}' |
  grep -v ':<none>$' || true
)

if ((${#OLD_IMAGES[@]})); then
  echo
  echo "===== AIH IMAGE RETENTION REVIEW ====="

  for image in "${OLD_IMAGES[@]}"; do
    if [[ -n "${KEEP[$image]:-}" ]]; then
      echo "KEEP    $image"
    else
      echo "REMOVE  $image"
    fi
  done

  echo
  echo "===== REMOVING UNRETAINED AIH IMAGE TAGS ====="

  for image in "${OLD_IMAGES[@]}"; do
    if [[ -z "${KEEP[$image]:-}" ]]; then
      docker image rm "$image" || true
    fi
  done

  docker image prune -f
fi

echo
echo "===== STORAGE AFTER ====="
docker system df

if [[ "$PURGE_ACR_IMAGES" == "1" ]]; then
  require_cmd az

  note "Authenticating to Azure Container Registry for release cleanup"
  az account show >/dev/null 2>&1 || die "Azure CLI is not authenticated"
  az acr login --name "$ACR_NAME" >/dev/null
  pass "ACR authentication"

  note "Purging stale DEV/UAT ACR tags older than ${ACR_DEV_RETENTION_DAYS} days"

  #
  # IMPORTANT:
  # Only development/UAT-style tags are eligible here.
  # Production/accepted tags are never selected by this filter.
  #
  az acr run     --registry "$ACR_NAME"     --cmd "acr purge       --filter '${ACR_REPOSITORY}:dev-.*'       --filter '${ACR_REPOSITORY}:.*validation.*'       --ago ${ACR_DEV_RETENTION_DAYS}d       --untagged"     /dev/null

  pass "stale ACR DEV/UAT cleanup completed"
fi

echo
echo "========================================"
echo "CLOSED: $RELEASE_NAME / PROD ACCEPTED"
echo "========================================"
