#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-}"
PROJECT="${2:-}"
shift 2 || true

[[ -n "$ROOT" && -n "$PROJECT" ]] || {
  echo "Usage: $0 <project-root> <compose-project> <docker-compose-args...>" >&2
  exit 2
}
[[ -f "$ROOT/.env" ]] || {
  echo "FAIL: $ROOT/.env not found" >&2
  exit 1
}
[[ "$#" -gt 0 ]] || {
  echo "FAIL: docker compose arguments are required" >&2
  exit 1
}

(
  unset MONGO_URI ATLAS_MONGO_DB_URI \
        MONGO_INITDB_ROOT_USERNAME MONGO_INITDB_ROOT_PASSWORD

  eval "$(
    python3 - "$ROOT/.env" <<'PY'
from pathlib import Path
import shlex, sys
p=Path(sys.argv[1])
wanted={"MONGO_INITDB_ROOT_USERNAME","MONGO_INITDB_ROOT_PASSWORD"}
values={}
for raw in p.read_text().splitlines():
    s=raw.strip()
    if not s or s.startswith("#") or "=" not in s:
        continue
    k,v=s.split("=",1)
    k=k.strip()
    if k not in wanted:
        continue
    v=v.strip()
    if len(v)>=2 and v[0]==v[-1] and v[0] in "\"'":
        v=v[1:-1]
    values[k]=v
for key in sorted(wanted):
    if not values.get(key):
        raise SystemExit(f"FAIL: {key} missing from {p}")
    print(f"export {key}={shlex.quote(values[key])}")
PY
  )"

  cd "$ROOT"
  exec docker compose --env-file "$ROOT/.env" -p "$PROJECT" "$@"
)
