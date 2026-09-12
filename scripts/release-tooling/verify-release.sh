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
: "${PROD_API_CONTAINER:=aih-prod-api}"
: "${PROD_MODEL_ROUTER_CONTAINER:=aih-prod-model-router}"
: "${PROD_SEARXNG_CONTAINER:=aih-prod-searxng}"
: "${API_HEALTH_URL:=http://127.0.0.1:3082/health}"
: "${EXPECTED_ACADEMIC_AGENT_COUNT:=3}"
: "${EXPECTED_WEBSEARCH_PERSONA_COUNT:=5}"
: "${MIN_CLASS_A:=1}"
: "${MIN_CLASS_B:=1}"

cd "$PROD_ROOT"

note "$RELEASE_NAME verification"

running="$(docker inspect "$PROD_API_CONTAINER" --format '{{.Config.Image}}')"
[[ "$running" == "$EXPECTED_API_IMAGE" ]] || die "wrong PROD API image: $running"
pass "exact API image"

curl -fsS --max-time 5 "$API_HEALTH_URL" >/dev/null
pass "API health"

container_env_has "$PROD_API_CONTAINER" "SEARXNG_INSTANCE_URL" || die "SEARXNG_INSTANCE_URL missing from API"
pass "SearXNG environment"

docker exec -i "$PROD_API_CONTAINER" node - <<'NODE'
const http=require('http');
function get(url){return new Promise((resolve,reject)=>{const r=http.get(url,{timeout:5000},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>resolve({status:res.statusCode,body:b}));});r.on('timeout',()=>{r.destroy();reject(new Error('timeout'))});r.on('error',reject);});}
(async()=>{
 const s=await get('http://searxng:8080/search?q=OpenAI&format=json');
 if(s.status!==200) throw new Error(`SearXNG HTTP ${s.status}`);
 console.log('PASS: API -> SearXNG');
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1)});
NODE

ROUTER_JSON="$(
  docker exec "$PROD_MODEL_ROUTER_CONTAINER" \
    python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=5).read().decode())"
)"
echo "MODEL ROUTER: $ROUTER_JSON"

python3 -c '
import json,sys
a,b=int(sys.argv[1]),int(sys.argv[2])
h=json.loads(sys.argv[3])
assert h.get("enabled") is True, "router disabled"
assert h.get("classes",{}).get("class-a",0) >= a, "class-a below minimum"
assert h.get("classes",{}).get("class-b",0) >= b, "class-b below minimum"
assert sum(h.get("credentials",{}).values()) > 0, "no router credentials"
' "$MIN_CLASS_A" "$MIN_CLASS_B" "$ROUTER_JSON"
pass "model-router active"

docker exec -i -w /app "$PROD_API_CONTAINER" node - "$EXPECTED_ACADEMIC_AGENT_COUNT" <<'NODE'
const {MongoClient}=require('mongodb');
const expected=Number(process.argv[2]);
(async()=>{
 const uri=process.env.MONGO_URI||process.env.MONGODB_URI;
 if(!uri) throw new Error('Mongo URI missing');
 const c=new MongoClient(uri); await c.connect();
 const docs=await c.db('LibreChat').collection('academicAgents').find({
   tenantId:'SEEDS',
   agentId:{$in:['EVIDENCE_OF_LEARNING','RESEARCH_CLAIM_AUDITOR','CURRICULUM_COHERENCE']}
 },{projection:{_id:0,agentId:1,enabled:1}}).toArray();
 if(docs.length!==expected) throw new Error(`expected ${expected} Academic Agents, found ${docs.length}`);
 if(docs.some(x=>x.enabled!==true)) throw new Error('one or more Academic Agents disabled');
 console.log(`PASS: ${docs.length} Academic Agents enabled`);
 await c.close();
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1)});
NODE

count="$(
  grep -A4 -E \
    'name: "(Undergrad Socratic Tutor|School Teaching Assistant|Instructor Assistant|PhD & Post-Doc Research|K-12 Socratic Tutor)"' \
    librechat.yaml | grep -c 'webSearch: true'
)"
[[ "$count" -eq "$EXPECTED_WEBSEARCH_PERSONA_COUNT" ]] || \
  die "expected webSearch on $EXPECTED_WEBSEARCH_PERSONA_COUNT personas; found $count"
pass "Web Search enabled on expected personas"

for c in "$PROD_MODEL_ROUTER_CONTAINER" "$PROD_SEARXNG_CONTAINER"; do
  [[ "$(docker inspect -f '{{.State.Running}}' "$c")" == "true" ]] || die "$c not running"
done
pass "required runtime services running"

if docker compose ps --format json >/tmp/aih-compose-ps.$$ 2>/dev/null; then
  :
fi
rm -f /tmp/aih-compose-ps.$$ || true

MANIFEST_SHA="$(sha256_file "$MANIFEST")"
STAMP_DIR="$PROD_ROOT/release-checkpoints"
mkdir -p "$STAMP_DIR"
STAMP="$STAMP_DIR/${RELEASE_NAME}-VERIFIED.txt"

{
  echo "release=$RELEASE_NAME"
  echo "verified_at=$(date -Is)"
  echo "manifest_sha256=$MANIFEST_SHA"
  echo "api_image=$EXPECTED_API_IMAGE"
  [[ -n "${EXPECTED_API_DIGEST:-}" ]] && echo "api_digest=$EXPECTED_API_DIGEST"
  echo "librechat_sha256=$(sha256_file "$PROD_ROOT/librechat.yaml")"
  echo "compose_sha256=$(sha256_file "$PROD_ROOT/docker-compose.yml")"
} > "$STAMP"

pass "$RELEASE_NAME verification complete"
echo "Verification stamp: $STAMP"
