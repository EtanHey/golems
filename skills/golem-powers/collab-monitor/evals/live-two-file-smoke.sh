#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
MONITOR="$SKILL_DIR/scripts/collab-monitor.sh"
EVENT_FIXTURE="$SCRIPT_DIR/fixtures/addressed-event.md"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT INT TERM

STATE_DIR="$TMP_ROOT/state"
FILE_ONE="$TMP_ROOT/one.md"
FILE_TWO="$TMP_ROOT/two.md"
SEED_OUTPUT="$TMP_ROOT/seed.out"
FIRST_OUTPUT="$TMP_ROOT/first.out"
SECOND_OUTPUT="$TMP_ROOT/second.out"

: > "$FILE_ONE"
: > "$FILE_TWO"

MONITOR_STATE_DIR="$STATE_DIR" /bin/bash "$MONITOR" run --once '@skillcreator' "$FILE_ONE" "$FILE_TWO" > "$SEED_OUTPUT"
awk '{ print }' "$EVENT_FIXTURE" >> "$FILE_ONE"
MONITOR_STATE_DIR="$STATE_DIR" /bin/bash "$MONITOR" run --once '@skillcreator' "$FILE_ONE" "$FILE_TWO" > "$FIRST_OUTPUT"
awk '{ print }' "$EVENT_FIXTURE" >> "$FILE_TWO"
MONITOR_STATE_DIR="$STATE_DIR" /bin/bash "$MONITOR" run --once '@skillcreator' "$FILE_ONE" "$FILE_TWO" > "$SECOND_OUTPUT"

first_alerts="$(grep -c '^NEW-FOR-' "$FIRST_OUTPUT" 2>/dev/null || true)"
duplicate_alerts="$(grep -c '^NEW-FOR-' "$SECOND_OUTPUT" 2>/dev/null || true)"

printf 'SMOKE_RUNTIME requested=bash effective=%s effort=deterministic source=/bin/bash\n' "$(/bin/bash --version | sed -n '1s/.*version \([^ ]*\).*/bash-\1/p')"
printf 'SMOKE first_append_alerts=%s expected=1\n' "$first_alerts"
printf 'SMOKE duplicate_append_alerts=%s expected=0\n' "$duplicate_alerts"

if [[ "$first_alerts" != '1' || "$duplicate_alerts" != '0' ]]; then
  printf '%s\n' 'SMOKE FAIL'
  exit 1
fi

printf '%s\n' 'SMOKE PASS'
