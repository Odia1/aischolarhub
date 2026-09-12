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
: "${PROD_ROOT:=/opt/scholarhub}"
: "${EXPECTED_API_IMAGE:?}"
: "${ROLLBACK_API_IMAGE:=}"
: "${IMAGE_REPO:=seeds.azurecr.io/aischolarhub-custom}"

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

CURRENT_TAG="${EXPECTED_API_IMAGE##*:}"
ROLLBACK_TAG="${ROLLBACK_API_IMAGE##*:}"

mapfile -t OLD_IMAGES < <(
  docker image ls "$IMAGE_REPO" --format '{{.Repository}}:{{.Tag}}' |
  awk -v current="$CURRENT_TAG" -v rollback="$ROLLBACK_TAG" '
    $0 !~ /:<none>$/ {
      n=split($0,a,":"); tag=a[n];
      if(tag!=current && (rollback=="" || tag!=rollback)) print $0
    }'
)

if ((${#OLD_IMAGES[@]})); then
  echo
  echo "===== REMOVING OBSOLETE AIH IMAGE TAGS ====="
  printf '%s\n' "${OLD_IMAGES[@]}"
  for image in "${OLD_IMAGES[@]}"; do
    docker image rm "$image" || true
  done
  docker image prune -f
fi

echo
echo "===== STORAGE AFTER ====="
docker system df

echo
echo "========================================"
echo "CLOSED: $RELEASE_NAME / PROD ACCEPTED"
echo "========================================"
