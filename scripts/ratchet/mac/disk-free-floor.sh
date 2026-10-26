#!/usr/bin/env bash
# Measure the Available-space floor and the prune's own guarded REMOVE plans.
# No removal or archival. GC refreshes remotes and writes its normal audit log.
export LC_ALL=C
export GIT_OPTIONAL_LOCKS=0
set -euo pipefail

FLOOR_GB="${DISK_FREE_FLOOR_GB:-60}"
CEILING="${MERGED_WORKTREE_CEILING:-25}"
GITS="${RATCHET_GITS_ROOT:-$HOME/Gits}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$HERE/../../lib/worktree-git-env.sh"
GC="$HERE/../../worktree-gc.sh"
IDLE="${WORKTREE_GC_IDLE_HOURS:-6}"

[[ "$FLOOR_GB" =~ ^[0-9]+$ && "$CEILING" =~ ^[0-9]+$ ]] || { echo "invalid disk thresholds" >&2; exit 2; }
measurement="$(python3 "$HERE/../../repogolem/worktree-disk-floor.py" --measure "$GITS")" || exit 2
IFS=$'\t' read -r available_bytes free_now_bytes purgeable_bytes <<< "$measurement"
space_description="${measurement#*$'\n'}"
free_gb=$((free_now_bytes / 1073741824))
available_gb=$((available_bytes / 1073741824))
echo "$space_description"
measurement_source=brainlayer
[[ "$purgeable_bytes" != null ]] || measurement_source=free_now_only

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

echo "available_gb=$available_gb free_gb=$free_gb floor=$FLOOR_GB merged_worktrees=$merged ceiling=$CEILING"
health=false
if [[ "$available_gb" -ge "$FLOOR_GB" && "$merged" -le "$CEILING" ]]; then health=true; fi
printf '{"source":"%s","available_bytes":%s,"free_now_bytes":%s,"purgeable_bytes":%s,"free_gb":%s,"floor":%s,"merged_worktrees":%s,"ceiling":%s,"health":%s}\n' "$measurement_source" "$available_bytes" "$free_now_bytes" "$purgeable_bytes" "$free_gb" "$FLOOR_GB" "$merged" "$CEILING" "$health"
[[ "$health" == true ]]
