#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/release-lib.sh"

require_cmd az
require_cmd python3
require_cmd curl

IMAGE="${ACA_IMAGE:-seeds.azurecr.io/aischolarhub-custom:dev-20260912-c33a0b62c-release-d-uat-v3}"
IMAGE_REPO="${ACA_IMAGE_REPO:-seeds.azurecr.io/aischolarhub-custom}"
RG="${ACA_RESOURCE_GROUP:-}"
APP="${ACA_APP_NAME:-}"
HEALTH_PATH="${ACA_HEALTH_PATH:-/}"
ALLOW_AUTO_DISCOVERY="${ACA_ALLOW_AUTO_DISCOVERY:-1}"

note "ACA UI promotion"
echo "Image: $IMAGE"

az account show >/dev/null 2>&1 || die "Azure CLI is not authenticated"

if [[ -z "$RG" || -z "$APP" ]]; then
  [[ "$ALLOW_AUTO_DISCOVERY" == "1" ]] || die "ACA_RESOURCE_GROUP and ACA_APP_NAME are required"

  mapfile -t MATCHES < <(
    az containerapp list -o json |
    python3 -c '
import json,sys
repo=sys.argv[1]
apps=json.load(sys.stdin)
for a in apps:
    rg=a.get("resourceGroup","")
    name=a.get("name","")
    containers=((a.get("properties") or {}).get("template") or {}).get("containers") or []
    images=[c.get("image","") for c in containers]
    if any(i.startswith(repo+":") or i.startswith(repo+"@") for i in images):
        print(f"{rg}\t{name}")
' "$IMAGE_REPO"
  )

  [[ "${#MATCHES[@]}" -eq 1 ]] || {
    printf 'Candidate matches:\n%s\n' "${MATCHES[*]:-(none)}" >&2
    die "ACA discovery expected exactly one app; set ACA_RESOURCE_GROUP and ACA_APP_NAME explicitly"
  }

  RG="${MATCHES[0]%%$'\t'*}"
  APP="${MATCHES[0]#*$'\t'}"
fi

echo "Resource group: $RG"
echo "Container app:  $APP"

OLD_IMAGE="$(
  az containerapp show -g "$RG" -n "$APP" \
    --query 'properties.template.containers[0].image' -o tsv
)"
[[ -n "$OLD_IMAGE" ]] || die "could not read current ACA image"

echo "Previous image: $OLD_IMAGE"

if [[ "$OLD_IMAGE" == "$IMAGE" ]]; then
  pass "ACA already points to requested image"
else
  note "Updating ACA to exact DEV-tested image"
  az containerapp update -g "$RG" -n "$APP" --image "$IMAGE" >/dev/null
fi

NEW_IMAGE="$(
  az containerapp show -g "$RG" -n "$APP" \
    --query 'properties.template.containers[0].image' -o tsv
)"
[[ "$NEW_IMAGE" == "$IMAGE" ]] || die "ACA image mismatch after update: $NEW_IMAGE"
pass "ACA image promoted"

STATE="$(az containerapp show -g "$RG" -n "$APP" --query 'properties.provisioningState' -o tsv)"
[[ "$STATE" == "Succeeded" ]] || die "ACA provisioning state is $STATE"
pass "ACA provisioning succeeded"

FQDN="$(az containerapp show -g "$RG" -n "$APP" --query 'properties.configuration.ingress.fqdn' -o tsv)"
if [[ -n "$FQDN" ]]; then
  CODE="$(curl -L -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://${FQDN}${HEALTH_PATH}" || true)"
  case "$CODE" in
    2*|3*|401|403) pass "ACA ingress responded HTTP $CODE" ;;
    *) echo "WARN: ACA ingress health returned HTTP ${CODE:-none}; image/provisioning checks passed" ;;
  esac
fi

STAMP="${ACA_PROMOTION_STAMP:-$SCRIPT_DIR/../../release-checkpoints/ACA-UI-LAST-PROMOTION.txt}"
mkdir -p "$(dirname "$STAMP")"
{
  echo "timestamp=$(date -Is)"
  echo "resource_group=$RG"
  echo "container_app=$APP"
  echo "previous_image=$OLD_IMAGE"
  echo "promoted_image=$NEW_IMAGE"
  echo "provisioning_state=$STATE"
  [[ -n "${FQDN:-}" ]] && echo "fqdn=$FQDN"
} > "$STAMP"
pass "ACA promotion checkpoint written: $STAMP"
