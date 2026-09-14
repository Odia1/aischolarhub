#!/usr/bin/env bash
set -euo pipefail

RG="${ACA_RESOURCE_GROUP:-AI-SCHOLAR-HUB-ACA-TEST}"
WEB="${ACA_APP_NAME:-ash-web}"
WAIT_SECONDS="${ACA_COLD_WAIT_SECONDS:-420}"

show_scale() {
  az containerapp list -g "$RG" \
    --query "[?name=='ash-web' || name=='model-router' || name=='gemini-proxy' || name=='academic-research-mcp' || name=='searxng'].{App:name,Min:properties.template.scale.minReplicas,Max:properties.template.scale.maxReplicas,State:properties.provisioningState}" \
    -o table
}

probe_one() {
  local name="$1" url="$2"
  echo "--- $name ---"
  az containerapp exec \
    -g "$RG" \
    -n "$WEB" \
    --command "node -e const{performance}=require('perf_hooks');const t=performance.now();fetch('$url').then(r=>console.log('HTTP='+r.status+' MS='+Math.round(performance.now()-t))).catch(e=>{console.error('ERROR='+e.name+' MS='+Math.round(performance.now()-t));process.exit(1)})"
}

probe_all() {
  local label="$1"
  echo
  echo "===== $label ====="
  probe_one "model-router" "http://model-router:8000/health"
  probe_one "gemini-proxy" "http://gemini-proxy:8000/"
  probe_one "academic-research-mcp" "http://academic-research-mcp:8000/mcp"
  probe_one "searxng" "http://searxng:8080/"
}

echo "===== ACA SCALE POLICY ====="
show_scale

probe_all "WARM PROBE 1"
probe_all "WARM PROBE 2"

echo
echo "===== IDLE WINDOW ====="
echo "Waiting ${WAIT_SECONDS}s so min=0 runtime services can scale down."
sleep "$WAIT_SECONDS"

echo
echo "===== REPLICA COUNTS BEFORE COLD PROBE ====="
for app in model-router gemini-proxy academic-research-mcp searxng; do
  count="$(az containerapp replica list -g "$RG" -n "$app" --query 'length(@)' -o tsv 2>/dev/null || echo '?')"
  printf '%-26s replicas=%s\n' "$app" "$count"
done

probe_all "SCALE-FROM-ZERO PROBE"
probe_all "POST-WAKE WARM PROBE"

echo
echo "===== REPLICA COUNTS AFTER WAKE ====="
for app in model-router gemini-proxy academic-research-mcp searxng; do
  count="$(az containerapp replica list -g "$RG" -n "$app" --query 'length(@)' -o tsv 2>/dev/null || echo '?')"
  printf '%-26s replicas=%s\n' "$app" "$count"
done

echo
echo "PASS: benchmark complete"
echo "Compare SCALE-FROM-ZERO MS with POST-WAKE WARM MS for each dependency."
