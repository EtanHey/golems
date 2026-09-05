#!/usr/bin/env bash
# Check 02: Archive upload size estimate < 100MB
# Depends on check 01 being resolved — otherwise skips
# Prevents: slow uploads, wasted concurrency, frustrated engineers

name="Archive size estimate <100MB"
easignore="$PROJECT_DIR/.easignore"
MAX_MB=100

# If .easignore missing, this check is dependent — skip
if [[ ! -f "$easignore" ]]; then
  record_result "$name" "SKIP" "Depends on check 01 (.easignore missing)" ""
  return 0
fi

# Estimate: du -sh PROJECT excluding patterns from .easignore
# Simpler: build a du --exclude list from .easignore lines
exclude_args=()
while IFS= read -r line; do
  # Strip comments and empty lines
  clean="${line%%#*}"
  clean="${clean#"${clean%%[![:space:]]*}"}"
  clean="${clean%"${clean##*[![:space:]]}"}"
  [[ -z "$clean" ]] && continue
  # Remove trailing slash, convert glob-ish to du exclude
  pattern="${clean%/}"
  pattern="${pattern#/}"
  exclude_args+=(--exclude="$pattern")
done < "$easignore"

# Run du (BSD du on macOS doesn't support --exclude; use tar -cf /dev/null approach)
if command -v gdu >/dev/null 2>&1; then
  size_bytes=$(gdu -sb "${exclude_args[@]}" "$PROJECT_DIR" 2>/dev/null | awk '{print $1}')
else
  # macOS/BSD fallback: tar -cf /dev/null with excludes, count bytes via --totals
  # Cheap heuristic: use find + wc -c on non-excluded files
  # This is approximate — real EAS tarball differs by compression.
  tmp_list=$(mktemp)
  trap 'rm -f "$tmp_list"' RETURN

  find_args=(find "$PROJECT_DIR" -type f)
  for pattern in "${exclude_args[@]}"; do
    clean="${pattern#--exclude=}"
    find_args+=(-not -path "*/$clean/*" -not -path "*/$clean")
  done
  "${find_args[@]}" 2>/dev/null > "$tmp_list"

  size_bytes=0
  while IFS= read -r f; do
    if [[ -f "$f" ]]; then
      file_size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null || echo 0)
      size_bytes=$((size_bytes + file_size))
    fi
  done < "$tmp_list"
fi

size_mb=$((size_bytes / 1024 / 1024))

if [[ "$size_mb" -lt "$MAX_MB" ]]; then
  record_result "$name" "PASS" "Estimated archive size: ${size_mb} MB (limit: ${MAX_MB} MB)" ""
elif [[ "$size_mb" -lt $((MAX_MB * 3)) ]]; then
  record_result "$name" "WARN" "Estimated archive size: ${size_mb} MB (limit: ${MAX_MB} MB)" "Review .easignore for missed paths"
else
  record_result "$name" "FAIL" "Estimated archive size: ${size_mb} MB — far above ${MAX_MB} MB limit" "Audit .easignore; likely missing node_modules or build dirs"
fi

return 0
