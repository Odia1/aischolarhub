#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/release-lib.sh"

require_cmd az
require_cmd python3
require_cmd curl

RG="${ACA_RESOURCE_GROUP:-}"
APP="${ACA_APP_NAME:-ash-web}"
CONFIG="${ACA_SOURCE_CONFIG:-$SCRIPT_DIR/../../librechat.yaml}"
HEALTH_PATH="${ACA_HEALTH_PATH:-/health}"
ICON_PATH="${ACA_ICON_PATH:-/images/favicon-16x16.png}"
REQUIRED_APPS="${ACA_REQUIRED_RUNTIME_APPS:-model-router,gemini-proxy,academic-research-mcp,searxng}"

[[ -n "$RG" ]] || die "ACA_RESOURCE_GROUP is required"
require_file "$CONFIG"
az account show >/dev/null 2>&1 || die "Azure CLI is not authenticated"

note "ACA user-runtime preflight"

APP_JSON="$(az containerapp show -g "$RG" -n "$APP" -o json)"
ENV_ID="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["properties"]["managedEnvironmentId"])' <<<"$APP_JSON")"
[[ -n "$ENV_ID" ]] || die "could not determine ACA environment for $APP"

CONTAINER_NAMES="$(python3 -c '
import json,sys
j=json.load(sys.stdin)
for c in j.get("properties",{}).get("template",{}).get("containers",[]) or []:
    print(c.get("name",""))
' <<<"$APP_JSON")"

if grep -Eiq '(^|[-_])(admin-ui|admin-panel)($|[-_])' <<<"$CONTAINER_NAMES"; then
  die "admin-ui/admin-panel must remain DEV-only and must not be present in the ACA user app"
fi
pass "ACA user app contains no admin interfaces"

WEB_ENV="$(python3 -c '
import json,sys
j=json.load(sys.stdin)
cs=j.get("properties",{}).get("template",{}).get("containers",[]) or []
for e in (cs[0].get("env",[]) if cs else []):
    name=e.get("name","")
    value=e.get("value")
    if value is not None:
        print(name+"\t"+str(value))
    elif e.get("secretRef"):
        print(name+"\tsecretref:"+str(e.get("secretRef")))
' <<<"$APP_JSON")"

env_value() {
  local key="$1"
  awk -F '\t' -v k="$key" '$1==k {print substr($0,index($0,$2)); exit}' <<<"$WEB_ENV"
}

same_env_app() {
  local name="$1"
  local dep_env
  dep_env="$(timeout 20 az containerapp show -g "$RG" -n "$name" \
    --query properties.managedEnvironmentId -o tsv 2>/dev/null || true)"
  [[ -n "$dep_env" && "$dep_env" == "$ENV_ID" ]]
}

check_url_mapping() {
  local label="$1" value="$2"
  local host

  [[ -n "$value" ]] || die "$label is missing from ACA $APP environment"

  host="$(python3 -c '
import sys
from urllib.parse import urlparse
u=urlparse(sys.argv[1])
print((u.hostname or "").lower())
' "$value")"

  [[ -n "$host" ]] || die "$label is not a valid absolute URL: $value"

  if [[ "$host" == "127.0.0.1" || "$host" == "localhost" ]]; then
    local count
    count="$(grep -cve '^$' <<<"$CONTAINER_NAMES")"
    (( count >= 2 )) || die "$label uses localhost but $APP has no runtime sidecar container"
    pass "$label -> $value"
    return
  fi

  # A single-label hostname is treated as an ACA service-discovery name.
  # Verify it directly instead of depending on az containerapp list JSON shape.
  if [[ "$host" != *.* ]]; then
    same_env_app "$host" || \
      die "$label points to service '$host', but no same-environment ACA app named '$host' exists"
  fi

  pass "$label -> $value"
}

MODEL_ROUTER_URL="$(env_value MODEL_ROUTER_BASE_URL || true)"
GEMINI_PROXY_URL="$(env_value GEMINI_PROXY_BASE_URL || true)"
SEARXNG_URL="$(env_value SEARXNG_INSTANCE_URL || true)"

check_url_mapping "MODEL_ROUTER_BASE_URL" "$MODEL_ROUTER_URL"
check_url_mapping "GEMINI_PROXY_BASE_URL" "$GEMINI_PROXY_URL"
check_url_mapping "SEARXNG_INSTANCE_URL" "$SEARXNG_URL"

MCP_URL="$(awk '
  /^[[:space:]]*academic-research:[[:space:]]*$/ {in_mcp=1; next}
  in_mcp && /^[[:space:]]*url:[[:space:]]*/ {
    sub(/^[[:space:]]*url:[[:space:]]*/, "")
    gsub(/^["'\'' ]+|["'\'' ]+$/, "")
    print
    exit
  }
  in_mcp && /^[^[:space:]]/ {exit}
' "$CONFIG")"

[[ -n "$MCP_URL" ]] || die "academic-research MCP URL not found in librechat.yaml"
[[ "$MCP_URL" != *'${'* ]] || \
  die "MCP URL must be concrete; LibreChat MCP domain validation does not safely resolve this placeholder"

check_url_mapping "academic-research MCP URL" "$MCP_URL"

IFS=',' read -r -a required <<<"$REQUIRED_APPS"
for dep in "${required[@]}"; do
  dep="${dep//[[:space:]]/}"
  [[ -n "$dep" ]] || continue
  same_env_app "$dep" || die "required ACA runtime app missing or in another environment: $dep"

  state="$(timeout 20 az containerapp show -g "$RG" -n "$dep" \
    --query properties.provisioningState -o tsv)"
  [[ "$state" == "Succeeded" ]] || die "$dep provisioning state is $state"
done
pass "required ACA runtime apps exist in the same environment"

if [[ "${ACA_POST_DEPLOY_VERIFY:-0}" == "1" ]]; then
  FQDN="$(python3 -c '
import json,sys
print(json.load(sys.stdin)["properties"].get("configuration",{}).get("ingress",{}).get("fqdn",""))
' <<<"$APP_JSON")"
  [[ -n "$FQDN" ]] || die "ACA FQDN missing"

  code="$(curl -L -sS -o /dev/null -w '%{http_code}' --max-time 20 \
    "https://${FQDN}${HEALTH_PATH}" || true)"
  case "$code" in
    2*|3*|401|403) pass "ACA health endpoint responded HTTP $code" ;;
    *) die "ACA health endpoint returned HTTP ${code:-none}" ;;
  esac

  headers="$(curl -sSI --max-time 20 "https://${FQDN}${ICON_PATH}" || true)"
  grep -qi '^HTTP/.* 200' <<<"$headers" || die "ACA icon did not return HTTP 200"
  grep -qi '^content-type: image/png' <<<"$headers" || die "ACA icon is not served as image/png"
  pass "ACA icon served as image/png"
fi

pass "ACA user-runtime gate complete"
