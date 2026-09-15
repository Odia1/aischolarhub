#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

BASELINE="scripts/release-tooling/ui-theme-baseline.txt"
CURRENT="$(mktemp)"
NEW="$(mktemp)"

cleanup() {
  rm -f "$CURRENT" "$NEW"
}
trap cleanup EXIT

scan_theme() {
  grep -RHiE \
    '\b(text|bg)-(black|white)\b|\b(text|bg|border)-\[#([0-9a-fA-F]{3,8})\]' \
    client/src admin-ui/public \
    --include='*.tsx' \
    --include='*.ts' \
    --include='*.jsx' \
    --include='*.js' \
    --include='*.html' \
    --include='*.css' \
    --exclude='*.spec.*' \
    --exclude='*.test.*' \
    2>/dev/null \
    | sort -u
}

if [ "${1:-}" = "--update-baseline" ]; then
  scan_theme > "$BASELINE" || true
  echo "UI_THEME_BASELINE_UPDATED=$(wc -l < "$BASELINE")"
  exit 0
fi

scan_theme > "$CURRENT" || true

if [ ! -f "$BASELINE" ]; then
  echo "FAIL: theme baseline missing"
  echo "Run: $0 --update-baseline"
  exit 2
fi

comm -13 \
  <(sort -u "$BASELINE") \
  <(sort -u "$CURRENT") \
  > "$NEW"

if [ -s "$NEW" ]; then
  echo "FAIL: new hard-coded UI theme violations detected"
  sed -n '1,30p' "$NEW"
  echo
  echo "Use semantic theme tokens or explicitly review/update the baseline."
  exit 1
fi

echo "UI_THEME_COMPLIANCE_PASSED"
echo "BASELINE_ENTRIES=$(wc -l < "$BASELINE")"
