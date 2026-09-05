#!/usr/bin/env bash
# Check 01: .easignore exists AND excludes build-critical paths
# Prevents: 2.1GB archive uploads (TaskOwl Sprint 2 pain point #1)

# Required excludes — anything missing from this list is a WARN
REQUIRED_EXCLUDES=(
  "node_modules"
  ".expo"
  ".git"
  "ios/build"
  "android/build"
  "android/.gradle"
  "android/app/build"
  "ios/Pods"
)

name=".easignore exists and excludes build dirs"
easignore="$PROJECT_DIR/.easignore"

if [[ ! -f "$easignore" ]]; then
  msg="No .easignore file found. Archive will include node_modules (likely >500MB)."
  fix="Run with --fix to write canonical template, or copy from $TEMPLATES_DIR/.easignore"

  if [[ "${FIX_MODE:-0}" -eq 1 ]]; then
    if [[ -f "$TEMPLATES_DIR/.easignore" ]]; then
      cp "$TEMPLATES_DIR/.easignore" "$easignore"
      record_result "$name" "PASS" "Wrote .easignore from template ($(wc -l < "$easignore") lines)" ""
    else
      record_result "$name" "FAIL" "$msg (template missing at $TEMPLATES_DIR/.easignore)" "$fix"
    fi
  else
    record_result "$name" "FAIL" "$msg" "$fix"
  fi
  return 0
fi

# .easignore exists — verify it covers required excludes.
# A pattern is considered covered if EITHER:
#   (a) the exact top-level dir is excluded (e.g., `/android/` or `android/` covers `android/build`)
#   (b) the full nested path is explicitly excluded (e.g., `android/build/`)

# Strip comments/blanks, normalize leading/trailing slashes → set of excluded paths
# (Using array append loop because `mapfile` is unavailable in bash 3.2 on macOS.)
easignore_lines=()
while IFS= read -r line; do
  [[ -n "$line" ]] && easignore_lines+=("$line")
done < <(
  grep -vE '^[[:space:]]*(#|$)' "$easignore" 2>/dev/null \
    | sed -E 's|^[[:space:]]+||; s|[[:space:]]+$||; s|^/||; s|/$||'
)

is_covered() {
  local target="$1"
  # Walk up the target's parent chain — if any ancestor is in the excluded set, it's covered.
  local check="$target"
  while [[ -n "$check" ]]; do
    for line in "${easignore_lines[@]}"; do
      [[ "$line" == "$check" ]] && return 0
    done
    if [[ "$check" == *"/"* ]]; then
      check="${check%/*}"
    else
      check=""
    fi
  done
  return 1
}

missing=()
for pattern in "${REQUIRED_EXCLUDES[@]}"; do
  if ! is_covered "$pattern"; then
    missing+=("$pattern")
  fi
done

if [[ "${#missing[@]}" -eq 0 ]]; then
  record_result "$name" "PASS" ".easignore covers all required excludes" ""
else
  msg=".easignore exists but missing excludes: ${missing[*]}"
  fix="Add missing patterns to .easignore, or --fix to overwrite with canonical template"
  record_result "$name" "WARN" "$msg" "$fix"
fi

return 0
