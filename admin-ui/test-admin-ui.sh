#!/usr/bin/env bash
set -euo pipefail

# AI Scholar Hub Admin UI verification
# Run from /opt/aischolarhub on the host.
# Requires the existing MONGO_INITDB_ROOT_USERNAME and MONGO_INITDB_ROOT_PASSWORD
# environment variables used by the project.

BASE_URL="${BASE_URL:-http://127.0.0.1:3090}"
COOKIE_JAR="${COOKIE_JAR:-/tmp/aischolarhub-admin.cookies-test}"
TEST_EMAIL="audit-test-$(date +%s)@seedsnet.in"

cleanup() {
  rm -f "$COOKIE_JAR"
}
trap cleanup EXIT

rm -f "$COOKIE_JAR"

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

command -v curl >/dev/null || fail "curl is required"
command -v docker >/dev/null || fail "docker is required"

printf '\n=== 1. HEALTH ===\n'
health="$(curl -fsS "$BASE_URL/health")"
grep -q '"ok":true' <<<"$health" || fail "Health check failed: $health"
pass "Admin UI health endpoint"

printf '\n=== 2. ADMIN LOGIN ===\n'
if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  read -r -s -p 'Admin password: ' ADMIN_PASSWORD
  printf '\n'
fi

login="$(curl -fsS \
  -c "$COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  --data "{\"email\":\"ppatra@seedsnet.org\",\"password\":\"$ADMIN_PASSWORD\"}" \
  "$BASE_URL/api/login")"
grep -q '"ok":true' <<<"$login" || fail "Admin login failed: $login"
pass "Admin login"

printf '\n=== 3. AUTHENTICATED IDENTITY ===\n'
me="$(curl -fsS -b "$COOKIE_JAR" "$BASE_URL/api/me")"
grep -q '"role":"ADMIN"' <<<"$me" || fail "Authenticated identity is not ADMIN: $me"
grep -q '"superAdmin":true' <<<"$me" || fail "Authenticated identity is not Superadmin: $me"
pass "Authenticated Superadmin identity"

printf '\n=== 4. AUDIT API ===\n'
audit_before="$(curl -fsS -b "$COOKIE_JAR" "$BASE_URL/api/superadmin/audit?limit=20")"
grep -q '"ok":true' <<<"$audit_before" || fail "Audit API failed: $audit_before"
pass "Superadmin audit endpoint"

actions_before="$(curl -fsS -b "$COOKIE_JAR" "$BASE_URL/api/superadmin/audit/actions")"
ggrep -q '"ok":true' <<<"$actions_before" || fail "Audit actions API failed: $actions_before"
pass "Audit actions endpoint"

printf '\n=== 5. CREATE TEST USER ===\n'
create="$(curl -fsS \
  -b "$COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  --data "{\"name\":\"Audit Test User\",\"username\":\"audit-test\",\"email\":\"$TEST_EMAIL\",\"role\":\"USER\"}" \
  "$BASE_URL/api/users")"
grep -q '"ok":true' <<<"$create" || fail "Create failed: $create"
TEST_USER_ID="$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' <<<"$create")"
[[ -n "$TEST_USER_ID" ]] || fail "Could not extract created user ID: $create"
ORIGINAL_TEST_USER_ID="$TEST_USER_ID"
pass "Created test user $TEST_EMAIL"

printf '\n=== 6. VERIFY CREATE AUDIT ===\n'
audit_create="$(curl -fsS -b "$COOKIE_JAR" "$BASE_URL/api/superadmin/audit?limit=20")"
grep -q 'USER_CREATED' <<<"$audit_create" || fail "USER_CREATED event missing"
grep -q 'USER_SETUP_EMAIL_SENT' <<<"$audit_create" || fail "USER_SETUP_EMAIL_SENT event missing"
pass "Creation and setup-email audit events"

printf '\n=== 7. UPDATE TEST USER ===\n'
update="$(curl -fsS \
  -b "$COOKIE_JAR" \
  -X PATCH \
  -H 'Content-Type: application/json' \
  --data '{"username":"audit-test-updated"}' \
  "$BASE_URL/api/users/$TEST_USER_ID")"
grep -q '"ok":true' <<<"$update" || fail "Update failed: $update"
pass "Updated test user"

printf '\n=== 8. VERIFY UPDATE AUDIT ===\n'
audit_update="$(curl -fsS -b "$COOKIE_JAR" "$BASE_URL/api/superadmin/audit?limit=20")"
grep -q 'USER_UPDATED' <<<"$audit_update" || fail "USER_UPDATED event missing"
pass "Update audit event"

printf '\n=== 9. SEND PASSWORD RESET ===\n'
reset="$(curl -fsS \
  -b "$COOKIE_JAR" \
  -X POST \
  "$BASE_URL/api/users/$TEST_USER_ID/send-reset")"
grep -q '"ok":true' <<<"$reset" || fail "Password reset request failed: $reset"
pass "Administrator password-reset request"

printf '\n=== 10. VERIFY PASSWORD RESET AUDIT ===\n'
audit_reset="$(curl -fsS -b "$COOKIE_JAR" "$BASE_URL/api/superadmin/audit?limit=20")"
grep -q 'PASSWORD_RESET_SENT' <<<"$audit_reset" || fail "PASSWORD_RESET_SENT event missing"
pass "Password reset audit event"

printf '\n=== 11. DELETE TEST USER ===\n'
delete="$(curl -fsS \
  -b "$COOKIE_JAR" \
  -X DELETE \
  "$BASE_URL/api/users/$TEST_USER_ID")"
grep -q '"ok":true' <<<"$delete" || fail "Delete failed: $delete"
pass "Deleted test user"

printf '\n=== 12. VERIFY DELETE AUDIT ===\n'
audit_delete="$(curl -fsS -b "$COOKIE_JAR" "$BASE_URL/api/superadmin/audit?limit=20")"
grep -q 'USER_DELETED' <<<"$audit_delete" || fail "USER_DELETED event missing"
pass "Delete audit event"

printf '\n=== 13. VERIFY TEST USER ABSENT IN MONGODB ===\n'
if [[ -z "${MONGO_INITDB_ROOT_USERNAME:-}" || -z "${MONGO_INITDB_ROOT_PASSWORD:-}" ]]; then
  printf 'SKIP: Mongo root credentials are not exported in this shell.\n'
else
  mongo_result="$(docker exec chat-mongodb mongosh \
    --quiet \
    --authenticationDatabase admin \
    -u "$MONGO_INITDB_ROOT_USERNAME" \
    -p "$MONGO_INITDB_ROOT_PASSWORD" \
    --eval "const u=db.getSiblingDB('LibreChat').users.findOne({_id:ObjectId('$ORIGINAL_TEST_USER_ID')}); print(u ? 'FOUND' : 'NOT_FOUND');")"
  [[ "$mongo_result" == "NOT_FOUND" ]] || fail "Test user still exists in MongoDB: $mongo_result"
  pass "MongoDB confirms test user is absent"
fi

printf '\n=== 14. VERIFY AUDIT INDEXES ===\n'
indexes="$(docker exec chat-mongodb mongosh \
  --quiet \
  --authenticationDatabase admin \
  -u "$MONGO_INITDB_ROOT_USERNAME" \
  -p "$MONGO_INITDB_ROOT_PASSWORD" \
  --eval "db.getSiblingDB('LibreChat').adminAudit.getIndexes().forEach(x=>print(x.name))")"
grep -q '^audit_timestamp_desc$' <<<"$indexes" || fail "audit_timestamp_desc missing"
grep -q '^audit_action_timestamp$' <<<"$indexes" || fail "audit_action_timestamp missing"
grep -q '^audit_actor_timestamp$' <<<"$indexes" || fail "audit_actor_timestamp missing"
grep -q '^audit_target_timestamp$' <<<"$indexes" || fail "audit_target_timestamp missing"
grep -q '^audit_retention_2y$' <<<"$indexes" || fail "audit_retention_2y missing"
pass "Audit indexes and two-year TTL index"

printf '\n=== 15. CONTAINER SYNTAX ===\n'
docker exec aischolarhub-admin-ui sh -c 'node --check /app/server.js'
pass "Admin UI server.js syntax"

printf '\n=== 16. FINAL AUDIT ACTIONS ===\n'
curl -fsS -b "$COOKIE_JAR" "$BASE_URL/api/superadmin/audit/actions"
printf '\n\nALL ADMIN UI SECURITY/AUDIT TESTS PASSED.\n'
