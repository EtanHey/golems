#!/usr/bin/env bash
# cleaner-detect-worktree-symlinks.sh — Rule 9: SoT violation — user-global symlink targets a worktree path
# Usage: ./cleaner-detect-worktree-symlinks.sh
# Output: tab-separated rows: <severity>\t<symlink-path>\t<target>\t<reason>

set -euo pipefail

# Scan user-global config dirs for symlinks targeting worktree paths
SCAN_DIRS=(
    "${HOME}/.claude"
    "${HOME}/.codex"
    "${HOME}/.cursor"
    "${HOME}/.config/superpowers"
)

found_violations=0

for dir in "${SCAN_DIRS[@]}"; do
    [ -d "$dir" ] || continue

    while IFS= read -r symlink; do
        target=$(readlink "$symlink" 2>/dev/null || true)
        [ -z "$target" ] && continue
        # Worktree indicator: target path contains "worktrees/" segment
        if [[ "$target" == *"/worktrees/"* ]]; then
            echo -e "BLOCKER\t$symlink\t$target\tuser-global symlink targets a worktree path (non-canonical); fix or merge to main first"
            found_violations=$((found_violations + 1))
        fi
    done < <(find "$dir" -type l 2>/dev/null)
done

echo "---" >&2
echo "Total SoT violations: $found_violations" >&2
exit 0
