#!/usr/bin/env bash
set -euo pipefail

die() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }
note() { echo "==> $*"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

require_file() {
  [[ -f "$1" ]] || die "required file not found: $1"
}

env_present() {
  local file="$1" key="$2"
  python3 - "$file" "$key" <<'PY'
from pathlib import Path
import sys
p, key = Path(sys.argv[1]), sys.argv[2]
found = False
for line in p.read_text().splitlines():
    s=line.strip()
    if not s or s.startswith("#") or "=" not in s:
        continue
    k,v=s.split("=",1)
    if k.strip()==key and v!="":
        found=True
        break
raise SystemExit(0 if found else 1)
PY
}

sha256_file() {
  sha256sum "$1" | awk '{print $1}'
}

image_repo_from_ref() {
  printf '%s\n' "${1%:*}"
}

container_env_has() {
  local container="$1" key="$2"
  docker inspect "$container" | python3 -c '
import json,sys
key=sys.argv[1]
d=json.load(sys.stdin)[0]
names={x.split("=",1)[0] for x in (d.get("Config",{}).get("Env",[]) or [])}
raise SystemExit(0 if key in names else 1)
' "$key"
}

json_get() {
  local json="$1" expr="$2"
  python3 - "$expr" <<'PY' <<<"$json"
import json,sys
expr=sys.argv[1].split(".")
obj=json.load(sys.stdin)
for part in expr:
    if not part:
        continue
    obj=obj[part]
if isinstance(obj,(dict,list)):
    print(json.dumps(obj))
else:
    print(obj)
PY
}
