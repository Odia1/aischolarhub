#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-source}"
IMAGE="${2:-}"

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

echo "===== RELEASE ASSET VALIDATION ====="

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

python3 >"$TMP" <<'PY'
import re
import subprocess
import sys

try:
    text = subprocess.check_output(
        ["git", "show", "HEAD:librechat.yaml"],
        text=True,
        stderr=subprocess.STDOUT,
    )
except subprocess.CalledProcessError as e:
    print(e.output, file=sys.stderr)
    raise SystemExit("FAIL: unable to read librechat.yaml from committed HEAD")

seen = set()

pattern = re.compile(r'''iconURL:\s*["'](/images/[^"']+)["']''')

for line in text.splitlines():
    stripped = line.lstrip()

    if stripped.startswith("#"):
        continue

    m = pattern.search(line)
    if not m:
        continue

    path = m.group(1)

    if path not in seen:
        seen.add(path)
        print(path)
PY

mapfile -t ASSETS < "$TMP"

if [ "${#ASSETS[@]}" -eq 0 ]; then
    echo "PASS: no active /images icon references found"
    exit 0
fi

echo "Configured assets:"
printf '  %s\n' "${ASSETS[@]}"

for url in "${ASSETS[@]}"; do
    rel="${url#/images/}"
    git_path="client/public/images/$rel"

    echo
    echo "Checking: $url"

    if ! git cat-file -e "HEAD:$git_path" 2>/dev/null; then
        echo "FAIL: configured asset is not committed in Git HEAD:"
        echo "      $git_path"
        exit 1
    fi

    echo "PASS: tracked in Git HEAD"

    if [ "$MODE" = "image" ]; then
        if [ -z "$IMAGE" ]; then
            echo "FAIL: image mode requires an image argument"
            exit 1
        fi

        if ! docker run --rm --entrypoint sh "$IMAGE" -c \
          "test -f '/app/client/public/images/$rel' &&
           test -f '/app/client/dist/images/$rel'"; then
            echo "FAIL: asset not packaged correctly in image:"
            echo "      $url"
            exit 1
        fi

        echo "PASS: packaged in application image"
    fi
done

echo
echo "PASS: all configured release assets validated"
