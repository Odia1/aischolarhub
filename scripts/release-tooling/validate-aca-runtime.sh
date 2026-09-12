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
IMAGE="${ACA_IMAGE:-}"
HEALTH_PATH="${ACA_HEALTH_PATH:-/health}"
ICON_PATH="${ACA_ICON_PATH:-/images/favicon-16x16.png}"

[[ -n "$RG" ]] || die "ACA_RESOURCE_GROUP is required"
require_file "$CONFIG"
az account show >/dev/null 2>&1 || die "Azure CLI is not authenticated"

note "ACA user-runtime preflight"

APP_JSON="$(az containerapp show -g "$RG" -n "$APP" -o json)"
ENV_ID="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["properties"]["managedEnvironmentId"])' <<<"$APP_JSON")"
[[ -n "$ENV_ID" ]] || die "could not determine ACA environment"

MAIN_IMAGE="$(python3 -c '
import json,sys
j=json.load(sys.stdin)
cs=j.get("properties",{}).get("template",{}).get("containers",[]) or []
print(cs[0].get("image","") if cs else "")
' <<<"$APP_JSON")"

if [[ -n "$IMAGE" && "$MAIN_IMAGE" != "$IMAGE" ]]; then
  echo "INFO: current ACA image differs from requested promotion image"
fi

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

SAME_ENV_APPS="$(az containerapp list -g "$RG" -o json | python3 - "$ENV_ID" <<'PY'
import json,sys
env_id=sys.argv[1]
apps=json.load(sys.stdin)
for a in apps:
    if (a.get("properties") or {}).get("managedEnvironmentId")==env_id:
        print(a.get("name",""))
PY
)"

WEB_ENV="$(python3 -c '
import json,sys
j=json.load(sys.stdin)
cs=j.get("properties",{}).get("template",{}).get("containers",[]) or []
for e in (cs[0].get("env",[]) if cs else []):
    name=e.get("name","")
    value=e.get("value")
    if value is not None:
        print(f"{name}\t{value}")
    elif e.get("secretRef"):
        print(f"{name}\tsecretref:{e.get(\"secretRef\")}")
' <<<"$APP_JSON")"

env_value() {
  local key="$1"
  awk -F '\t' -v k="$key" '$1==k {print substr($0,index($0,$2)); exit}' <<<"$WEB_ENV"
}

check_url_mapping() {
  local label="$1" value="$2"
  [[ -n "$value" ]] || die "$label is missing from ACA ash-web environment"

  python3 - "$label" "$value" "$CONTAINER_NAMES" "$SAME_ENV_APPS" <<'PY'
import sys
from urllib.parse import urlparse

label,value,containers,apps=sys.argv[1:]
u=urlparse(value)
host=(u.hostname or "").lower()
if not host:
    raise SystemExit(f"FAIL: {label} is not a valid absolute URL")

docker_hosts={"model-router","gemini-proxy","searxng","academic-research-mcp",
              "mongodb","meilisearch","rag_api","vectordb","ollama"}
containers=set(filter(None,containers.splitlines()))
apps=set(filter(None,apps.splitlines()))

if host in {"127.0.0.1","localhost"}:
    if len(containers) < 2:
        raise SystemExit(f"FAIL: {label} uses localhost but ash-web has no runtime sidecar containers")
elif host in docker_hosts:
    if host not in apps:
        raise SystemExit(
            f"FAIL: {label} points to Compose-style host '{host}', "
            f"but no same-environment ACA app named '{host}' exists"
        )
print(f"PASS: {label} -> {value}")
PY
}

MODEL_ROUTER_URL="$(env_value MODEL_ROUTER_BASE_URL || true)"
GEMINI_PROXY_URL="$(env_value GEMINI_PROXY_BASE_URL || true)"
SEARXNG_URL="$(env_value SEARXNG_INSTANCE_URL || true)"

check_url_mapping "MODEL_ROUTER_BASE_URL" "$MODEL_ROUTER_URL"
check_url_mapping "GEMINI_PROXY_BASE_URL" "$GEMINI_PROXY_URL"
check_url_mapping "SEARXNG_INSTANCE_URL" "$SEARXNG_URL"

MCP_URL="$(python3 - "$CONFIG" <<'PY'
import re,sys
text=open(sys.argv[1],encoding="utf-8").read()
m=re.search(r'(?ms)^\s*academic-research:\s*\n(?:.*\n){0,5}?\s*url:\s*["'\'']?([^"'\''\s]+)',text)
print(m.group(1) if m else "")
PY
)"
[[ -n "$MCP_URL" ]] || die "academic-research MCP URL not found in librechat.yaml"
[[ "$MCP_URL" != *'${'* ]] || die "MCP URL must be concrete; LibreChat domain validation does not safely resolve this placeholder"

check_url_mapping "academic-research MCP URL" "$MCP_URL"

if [[ "${ACA_REQUIRE_RUNTIME_APPS:-1}" == "1" ]]; then
  for dep in model-router gemini-proxy searxng academic-research-mcp; do
    grep -qx "$dep" <<<"$SAME_ENV_APPS" || die "required ACA runtime app missing from same environment: $dep"
    state="$(az containerapp show -g "$RG" -n "$dep" --query properties.provisioningState -o tsv)"
    [[ "$state" == "Succeeded" ]] || die "$dep provisioning state is $state"
  done
  pass "all required ACA runtime apps exist in the same environment"
fi

if [[ "${ACA_POST_DEPLOY_VERIFY:-0}" == "1" ]]; then
  FQDN="$(python3 -c '
import json,sys
print(json.load(sys.stdin)["properties"].get("configuration",{}).get("ingress",{}).get("fqdn",""))
' <<<"$APP_JSON")"
  [[ -n "$FQDN" ]] || die "ACA FQDN missing"

  code="$(curl -L -sS -o /dev/null -w '%{http_code}' --max-time 20 "https://${FQDN}${HEALTH_PATH}" || true)"
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
