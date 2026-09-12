#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/release-lib.sh"

require_cmd az
require_cmd python3

RG="${ACA_RESOURCE_GROUP:-}"
ANCHOR_APP="${ACA_APP_NAME:-ash-web}"

MODEL_ROUTER_APP="${ACA_MODEL_ROUTER_APP:-model-router}"
GEMINI_PROXY_APP="${ACA_GEMINI_PROXY_APP:-gemini-proxy}"
MCP_APP="${ACA_MCP_APP:-academic-research-mcp}"
SEARXNG_APP="${ACA_SEARXNG_APP:-searxng}"

MODEL_ROUTER_IMAGE="${ACA_MODEL_ROUTER_IMAGE:-}"
GEMINI_PROXY_IMAGE="${ACA_GEMINI_PROXY_IMAGE:-${ACA_GEMINI_IMAGE:-}}"
MCP_IMAGE="${ACA_MCP_IMAGE:-}"
SEARXNG_IMAGE="${ACA_SEARXNG_IMAGE:-}"

GEMINI_ENV_FILE="${ACA_GEMINI_ENV_FILE:-.gemini-proxy.env}"

[[ -n "$RG" ]] || die "ACA_RESOURCE_GROUP is required"
[[ -n "$MODEL_ROUTER_IMAGE" ]] || die "ACA_MODEL_ROUTER_IMAGE is required"
[[ -n "$GEMINI_PROXY_IMAGE" ]] || die "ACA_GEMINI_PROXY_IMAGE (or ACA_GEMINI_IMAGE) is required"
[[ -n "$MCP_IMAGE" ]] || die "ACA_MCP_IMAGE is required"
[[ -n "$SEARXNG_IMAGE" ]] || die "ACA_SEARXNG_IMAGE is required"

az account show >/dev/null 2>&1 || die "Azure CLI is not authenticated"

note "ACA runtime reconciliation"
echo "Anchor app: $ANCHOR_APP"
echo "Resource group: $RG"

ANCHOR_JSON="$(az containerapp show -g "$RG" -n "$ANCHOR_APP" -o json)"
ENV_ID="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["properties"]["managedEnvironmentId"])' <<<"$ANCHOR_JSON")"
[[ -n "$ENV_ID" ]] || die "could not determine ACA environment"
ENV_NAME="${ENV_ID##*/}"

IDENTITY_ID="$(python3 -c '
import json,sys
j=json.load(sys.stdin)
ids=(j.get("identity") or {}).get("userAssignedIdentities") or {}
print(next(iter(ids.keys()),""))
' <<<"$ANCHOR_JSON")"
[[ -n "$IDENTITY_ID" ]] || die "anchor app has no user-assigned managed identity"

REGISTRY_SERVER="$(python3 -c '
import json,sys
j=json.load(sys.stdin)
regs=j.get("properties",{}).get("configuration",{}).get("registries",[]) or []
print(regs[0].get("server","") if regs else "")
' <<<"$ANCHOR_JSON")"
[[ -n "$REGISTRY_SERVER" ]] || die "could not determine registry server from anchor app"

pass "discovered environment, identity and registry from $ANCHOR_APP"

anchor_env_value() {
  local key="$1"
  python3 - "$key" <<'PY' <<<"$ANCHOR_JSON"
import json,sys
key=sys.argv[1]
j=json.load(sys.stdin)
cs=j.get("properties",{}).get("template",{}).get("containers",[]) or []
for e in (cs[0].get("env",[]) if cs else []):
    if e.get("name")==key:
        if e.get("value") is not None:
            print(e.get("value"))
        raise SystemExit(0)
raise SystemExit(1)
PY
}

anchor_secret_value() {
  local name="$1"
  az containerapp secret list -g "$RG" -n "$ANCHOR_APP" --show-values \
    --query "[?name=='$name'].value | [0]" -o tsv
}

copy_anchor_secret() {
  local src="$1" dst="$2"
  local value
  value="$(anchor_secret_value "$src")"
  [[ -n "$value" ]] || die "anchor secret missing: $src"
  printf '%s' "$value"
}

MONGO_URI="$(anchor_env_value MONGO_URI || anchor_env_value ATLAS_MONGO_DB_URI || true)"
CF_IDS="$(anchor_env_value ASH_CLOUDFLARE_ACCOUNT_IDS || true)"
ROUTER_ENABLED="$(anchor_env_value ASH_MODEL_ROUTER_ENABLED || true)"
[[ -n "$MONGO_URI" ]] || die "MONGO_URI/ATLAS_MONGO_DB_URI missing on anchor app"
[[ -n "$CF_IDS" ]] || die "ASH_CLOUDFLARE_ACCOUNT_IDS missing on anchor app"
[[ -n "$ROUTER_ENABLED" ]] || ROUTER_ENABLED=true

GP_KEY="$(copy_anchor_secret gemini-proxy-api-key gemini-proxy-api-key)"
GOOGLE_KEYS="$(copy_anchor_secret ash-google-api-keys ash-google-api-keys)"
GROQ_KEYS="$(copy_anchor_secret ash-groq-api-keys ash-groq-api-keys)"
OPENROUTER_KEYS="$(copy_anchor_secret ash-openrouter-api-keys ash-openrouter-api-keys)"
CF_TOKENS="$(copy_anchor_secret ash-cloudflare-api-tokens ash-cloudflare-api-tokens)"
S2_KEY="$(copy_anchor_secret semantic-scholar-api-key semantic-scholar-api-key)"
SX_SECRET="$(copy_anchor_secret searxng-secret searxng-secret)"

ensure_app() {
  local name="$1" image="$2"
  if az containerapp show -g "$RG" -n "$name" >/dev/null 2>&1; then
    note "Updating $name"
    az containerapp update -g "$RG" -n "$name" --image "$image" >/dev/null
  else
    note "Creating $name"
    az containerapp create \
      -g "$RG" -n "$name" \
      --environment "$ENV_NAME" \
      --image "$image" \
      --user-assigned "$IDENTITY_ID" \
      --registry-server "$REGISTRY_SERVER" \
      --registry-identity "$IDENTITY_ID" \
      --min-replicas 1 --max-replicas 1 \
      --output none
  fi
}

ensure_internal_tcp() {
  local name="$1" port="$2"
  az containerapp ingress enable \
    -g "$RG" -n "$name" \
    --type internal \
    --transport tcp \
    --target-port "$port" \
    --exposed-port "$port" \
    --output none
}

ensure_app "$MODEL_ROUTER_APP" "$MODEL_ROUTER_IMAGE"
az containerapp secret set -g "$RG" -n "$MODEL_ROUTER_APP" --secrets \
  mongo-uri="$MONGO_URI" \
  router-api-key="$GP_KEY" \
  google-keys="$GOOGLE_KEYS" \
  groq-keys="$GROQ_KEYS" \
  openrouter-keys="$OPENROUTER_KEYS" \
  cloudflare-tokens="$CF_TOKENS" >/dev/null
az containerapp update -g "$RG" -n "$MODEL_ROUTER_APP" --set-env-vars \
  MONGO_URI=secretref:mongo-uri \
  ASH_MODEL_ROUTER_ENABLED="$ROUTER_ENABLED" \
  ASH_MODEL_ROUTER_API_KEY=secretref:router-api-key \
  GEMINI_PROXY_API_KEY=secretref:router-api-key \
  ASH_GOOGLE_API_KEYS=secretref:google-keys \
  ASH_GROQ_API_KEYS=secretref:groq-keys \
  ASH_OPENROUTER_API_KEYS=secretref:openrouter-keys \
  ASH_CLOUDFLARE_ACCOUNT_IDS="$CF_IDS" \
  ASH_CLOUDFLARE_API_TOKENS=secretref:cloudflare-tokens >/dev/null
ensure_internal_tcp "$MODEL_ROUTER_APP" 8000
pass "$MODEL_ROUTER_APP reconciled"

[[ -f "$GEMINI_ENV_FILE" ]] || die "Gemini env file not found: $GEMINI_ENV_FILE"
mapfile -t GEMINI_NAMES < <(
  grep -E '^GEMINI_KEY_[0-9]+=' "$GEMINI_ENV_FILE" | cut -d= -f1 | sort -V
)
[[ "${#GEMINI_NAMES[@]}" -gt 0 ]] || die "no GEMINI_KEY_n variables found in $GEMINI_ENV_FILE"

ensure_app "$GEMINI_PROXY_APP" "$GEMINI_PROXY_IMAGE"
GP_SECRET_ARGS=("gemini-proxy-api-key=$GP_KEY")
GP_ENV_ARGS=("GEMINI_PROXY_API_KEY=secretref:gemini-proxy-api-key")
for name in "${GEMINI_NAMES[@]}"; do
  value="$(grep -m1 "^${name}=" "$GEMINI_ENV_FILE" | cut -d= -f2-)"
  [[ -n "$value" ]] || die "empty Gemini key: $name"
  secret_name="$(tr '[:upper:]_' '[:lower:]-' <<<"$name")"
  GP_SECRET_ARGS+=("${secret_name}=${value}")
  GP_ENV_ARGS+=("${name}=secretref:${secret_name}")
done
az containerapp secret set -g "$RG" -n "$GEMINI_PROXY_APP" --secrets "${GP_SECRET_ARGS[@]}" >/dev/null
az containerapp update -g "$RG" -n "$GEMINI_PROXY_APP" --set-env-vars "${GP_ENV_ARGS[@]}" >/dev/null
ensure_internal_tcp "$GEMINI_PROXY_APP" 8000
pass "$GEMINI_PROXY_APP reconciled"

ensure_app "$MCP_APP" "$MCP_IMAGE"
az containerapp secret set -g "$RG" -n "$MCP_APP" --secrets semantic-scholar-api-key="$S2_KEY" >/dev/null
az containerapp update -g "$RG" -n "$MCP_APP" --set-env-vars \
  SEMANTIC_SCHOLAR_API_KEY=secretref:semantic-scholar-api-key \
  HOST=0.0.0.0 PORT=8000 >/dev/null
ensure_internal_tcp "$MCP_APP" 8000
pass "$MCP_APP reconciled"

ensure_app "$SEARXNG_APP" "$SEARXNG_IMAGE"
az containerapp secret set -g "$RG" -n "$SEARXNG_APP" --secrets searxng-secret="$SX_SECRET" >/dev/null
az containerapp update -g "$RG" -n "$SEARXNG_APP" --set-env-vars \
  SEARXNG_SECRET=secretref:searxng-secret >/dev/null
ensure_internal_tcp "$SEARXNG_APP" 8080
pass "$SEARXNG_APP reconciled"

# Keep anchor URLs stable and release-independent.
az containerapp update -g "$RG" -n "$ANCHOR_APP" --set-env-vars \
  MODEL_ROUTER_BASE_URL="http://${MODEL_ROUTER_APP}:8000/v1/" \
  GEMINI_PROXY_BASE_URL="http://${GEMINI_PROXY_APP}:8000/v1/" \
  SEARXNG_INSTANCE_URL="http://${SEARXNG_APP}:8080" >/dev/null

export ACA_RESOURCE_GROUP="$RG"
export ACA_APP_NAME="$ANCHOR_APP"
export ACA_REQUIRED_RUNTIME_APPS="${MODEL_ROUTER_APP},${GEMINI_PROXY_APP},${MCP_APP},${SEARXNG_APP}"

"$SCRIPT_DIR/validate-aca-runtime.sh"

pass "ACA runtime reconciliation complete"
