#!/usr/bin/env bash
# eas-prebuild-check — validate Expo iOS/Android sync before first EAS build
# Prevents the 9 failure modes from TaskOwl Sprint 2 (April 8, 2026)
#
# Usage:
#   check.sh [--platform ios|android|both] [--profile preview|production]
#            [--fix] [--json]
#
# Exit codes:
#   0 — all pass (or only WARN/INFO)
#   1 — at least one FAIL (do NOT run `eas build`)
#   2 — script error (missing eas-cli, not in an Expo project)

set -euo pipefail

# ──────────────────────────────────────────────────────────────
# Path detection (BASH_SOURCE pattern for portability)
# ──────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
CHECKS_DIR="$SCRIPT_DIR/checks"
TEMPLATES_DIR="$SKILL_DIR/templates"
PROJECT_DIR="$PWD"

# ──────────────────────────────────────────────────────────────
# Argument parsing
# ──────────────────────────────────────────────────────────────
PLATFORM="both"
PROFILE="preview"
FIX_MODE=0
JSON_MODE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)
      PLATFORM="$2"
      shift 2
      ;;
    --platform=*)
      PLATFORM="${1#*=}"
      shift
      ;;
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --profile=*)
      PROFILE="${1#*=}"
      shift
      ;;
    --fix)
      FIX_MODE=1
      shift
      ;;
    --json)
      JSON_MODE=1
      shift
      ;;
    --help|-h)
      sed -n '2,/^# Exit codes:/p' "${BASH_SOURCE[0]}" | sed 's/^# //; s/^#$//'
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

case "$PLATFORM" in
  ios|android|both) ;;
  *) echo "Invalid --platform: $PLATFORM (use ios|android|both)" >&2; exit 2 ;;
esac

case "$PROFILE" in
  preview|production|development) ;;
  *) echo "Invalid --profile: $PROFILE (use preview|production|development)" >&2; exit 2 ;;
esac

# ──────────────────────────────────────────────────────────────
# Preconditions
# ──────────────────────────────────────────────────────────────
if [[ ! -f "$PROJECT_DIR/app.json" && ! -f "$PROJECT_DIR/app.config.js" && ! -f "$PROJECT_DIR/app.config.ts" ]]; then
  echo "Not an Expo project (no app.json / app.config.js / app.config.ts in $PROJECT_DIR)" >&2
  exit 2
fi

if ! command -v eas >/dev/null 2>&1; then
  echo "eas-cli not installed. Run: npm install -g eas-cli" >&2
  exit 2
fi

# ──────────────────────────────────────────────────────────────
# Result accumulation
# ──────────────────────────────────────────────────────────────
declare -a CHECK_NAMES=()
declare -a CHECK_STATUSES=()  # PASS | FAIL | WARN | SKIP | INFO
declare -a CHECK_MESSAGES=()
declare -a CHECK_FIXES=()

record_result() {
  local name="$1"
  local status="$2"
  local message="$3"
  local fix="${4:-}"
  CHECK_NAMES+=("$name")
  CHECK_STATUSES+=("$status")
  CHECK_MESSAGES+=("$message")
  CHECK_FIXES+=("$fix")
}

# shellcheck disable=SC2329
run_with_timeout() {
  local seconds="$1"
  shift

  if command -v timeout >/dev/null 2>&1; then
    timeout "$seconds" "$@"
    return $?
  fi

  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$seconds" "$@"
    return $?
  fi

  "$@"
}

# shellcheck disable=SC2329
json_path_get() {
  local file="$1"
  local path="$2"
  local kind="${3:-string}"

  python3 - "$file" "$path" "$kind" <<'PY'
import json
import sys

file_path, dotted_path, kind = sys.argv[1:4]

with open(file_path, "r", encoding="utf-8") as handle:
    value = json.load(handle)

for part in dotted_path.split("."):
    if not isinstance(value, dict) or part not in value:
        sys.exit(0)
    value = value[part]

if value is None:
    sys.exit(0)

if kind == "number":
    if isinstance(value, (int, float)):
        print(value)
    sys.exit(0)

if isinstance(value, str):
    print(value)
PY
}

# Export for check scripts to call
export -f record_result
export -f run_with_timeout
export -f json_path_get
export PROJECT_DIR SKILL_DIR TEMPLATES_DIR FIX_MODE PLATFORM PROFILE

# ──────────────────────────────────────────────────────────────
# Run checks in order
# ──────────────────────────────────────────────────────────────
run_check() {
  local script="$1"
  if [[ -f "$CHECKS_DIR/$script" ]]; then
    # shellcheck source=/dev/null
    if ! source "$CHECKS_DIR/$script"; then
      record_result "$script" "FAIL" "Check script crashed: $script" "Inspect script output and re-run"
    fi
  else
    record_result "$script" "SKIP" "Check script not found: $script" ""
  fi
}

run_check "01-easignore.sh"
run_check "02-archive-size.sh"
run_check "03-eas-cli-version.sh"
run_check "04-bundle-id.sh"
run_check "05-version-sync.sh"
if [[ "$PLATFORM" == "ios" || "$PLATFORM" == "both" ]]; then
  run_check "06-ios-devices.sh"
  run_check "07-ios-credentials.sh"
fi
if [[ "$PLATFORM" == "android" || "$PLATFORM" == "both" ]]; then
  run_check "08-android-keystore.sh"
fi
run_check "09-concurrency.sh"

# ──────────────────────────────────────────────────────────────
# Output
# ──────────────────────────────────────────────────────────────
project_name="$(basename "$PROJECT_DIR")"
# eas whoami prints username on first line, then "Accounts:" block — take first line only
active_account="$(run_with_timeout 10 eas whoami 2>/dev/null | head -1 || echo 'unknown')"
[[ -z "$active_account" ]] && active_account="unknown"

pass_count=0
fail_count=0
warn_count=0
skip_count=0
info_count=0

for status in "${CHECK_STATUSES[@]}"; do
  case "$status" in
    PASS) pass_count=$((pass_count + 1)) ;;
    FAIL) fail_count=$((fail_count + 1)) ;;
    WARN) warn_count=$((warn_count + 1)) ;;
    SKIP) skip_count=$((skip_count + 1)) ;;
    INFO) info_count=$((info_count + 1)) ;;
  esac
done

if [[ "$JSON_MODE" -eq 1 ]]; then
  if ! command -v jq >/dev/null 2>&1; then
    echo "--json requires jq to be installed" >&2
    exit 2
  fi

  checks_json='[]'
  for i in "${!CHECK_NAMES[@]}"; do
    checks_json="$(
      jq -cn \
        --argjson checks "$checks_json" \
        --arg name "${CHECK_NAMES[$i]}" \
        --arg status "${CHECK_STATUSES[$i]}" \
        --arg message "${CHECK_MESSAGES[$i]}" \
        --arg fix "${CHECK_FIXES[$i]}" \
        '$checks + [{name: $name, status: $status, message: $message, fix: $fix}]'
    )"
  done

  jq -cn \
    --arg project "$project_name" \
    --arg account "$active_account" \
    --arg platform "$PLATFORM" \
    --arg profile "$PROFILE" \
    --argjson checks "$checks_json" \
    --argjson pass "$pass_count" \
    --argjson fail "$fail_count" \
    --argjson warn "$warn_count" \
    --argjson skip "$skip_count" \
    --argjson info "$info_count" \
    '{
      project: $project,
      account: $account,
      platform: $platform,
      profile: $profile,
      checks: $checks,
      summary: {
        pass: $pass,
        fail: $fail,
        warn: $warn,
        skip: $skip,
        info: $info
      }
    }'
else
  # Human-readable output
  printf '# EAS Prebuild Check — %s\n' "$project_name"
  printf 'Profile: %s | Platform: %s | Account: %s\n\n' "$PROFILE" "$PLATFORM" "$active_account"

  for i in "${!CHECK_NAMES[@]}"; do
    idx=$((i + 1))
    total="${#CHECK_NAMES[@]}"
    status="${CHECK_STATUSES[$i]}"
    name="${CHECK_NAMES[$i]}"
    msg="${CHECK_MESSAGES[$i]}"
    fix="${CHECK_FIXES[$i]}"

    case "$status" in
      PASS) icon="✓" ;;
      FAIL) icon="✗" ;;
      WARN) icon="⚠" ;;
      SKIP) icon="⊘" ;;
      INFO) icon="ℹ" ;;
      *)    icon="?" ;;
    esac

    display_status="$status"
    [[ "$status" == "SKIP" ]] && display_status="SKIPPED"

    printf '[%d/%d] %-40s %s %s\n' "$idx" "$total" "$name" "$icon" "$display_status"
    if [[ -n "$msg" ]]; then
      printf '      %s\n' "$msg"
    fi
    if [[ -n "$fix" ]]; then
      printf '      Fix: %s\n' "$fix"
    fi
    printf '\n'
  done

  printf '## Summary\n'
  printf '  ✓ Passed: %d   ⚠ Warnings: %d   ✗ Failed: %d   ⊘ Skipped: %d   ℹ Info: %d\n\n' \
    "$pass_count" "$warn_count" "$fail_count" "$skip_count" "$info_count"

  if [[ "$fail_count" -gt 0 || "$warn_count" -gt 0 ]]; then
    printf '## Recommended order\n'
    if [[ "$FIX_MODE" -eq 0 ]]; then
      printf '  1. Re-run with --fix for safe automatic fixes.\n'
    fi
    printf '  2. Resolve remaining FAIL items in the order shown above.\n'
    printf '  3. Re-run eas-prebuild-check before starting eas build.\n\n'
  fi

  if [[ "$fail_count" -gt 0 ]]; then
    # shellcheck disable=SC2016  # Literal backticks are intentional in output
    printf '  **DO NOT run `eas build` until all FAIL items are resolved.**\n'
  elif [[ "$warn_count" -gt 0 ]]; then
    printf '  Warnings present — review before building.\n'
  else
    # shellcheck disable=SC2016  # Literal backticks are intentional in output
    printf '  All critical checks passed. You can run `eas build`.\n'
  fi
fi

# ──────────────────────────────────────────────────────────────
# Exit
# ──────────────────────────────────────────────────────────────
if [[ "$fail_count" -gt 0 ]]; then
  exit 1
fi
exit 0
