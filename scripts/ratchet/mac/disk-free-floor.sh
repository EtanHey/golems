#!/usr/bin/env bash
# Measure the REAL free-space floor and the prune's own guarded REMOVE plans.
# No removal or archival. GC refreshes remotes and writes its normal audit log.
export LC_ALL=C
export GIT_OPTIONAL_LOCKS=0
set -euo pipefail

FLOOR_GB="${DISK_FREE_FLOOR_GB:-60}"
CEILING="${MERGED_WORKTREE_CEILING:-25}"
GITS="${RATCHET_GITS_ROOT:-$HOME/Gits}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
GC="$HERE/../../worktree-gc.sh"
IDLE="${WORKTREE_GC_IDLE_HOURS:-6}"

free_kb="$(df -Pk "$GITS" | awk 'NR==2 {print $4}')"
[[ "$free_kb" =~ ^[0-9]+$ ]] || { echo "cannot measure free disk" >&2; exit 2; }
free_gb=$((free_kb / 1048576))

merged=0
shopt -s nullglob
for repo in "$GITS"/*; do
  # A symlinked repo is the same set twice.
  [[ -d "$repo/.git" && ! -L "$repo" ]] || continue
  rc=0
  plan="$("$GC" --prune-plan --idle-hours "$IDLE" --repo "$repo")" || rc=$?
  if [[ "$rc" -ne 0 && "$rc" -ne 3 ]]; then
    echo "cannot produce prune plan for $repo (exit $rc): $plan" >&2
    exit "$rc"
  fi
  count="$(printf '%s\n' "$plan" | awk -F ' · ' '$6 == "REMOVE" {n++} END {print n+0}')"
  merged=$((merged + count))
done

echo "free_gb=$free_gb floor=$FLOOR_GB merged_worktrees=$merged ceiling=$CEILING"
[[ "$free_gb" -ge "$FLOOR_GB" && "$merged" -le "$CEILING" ]]
