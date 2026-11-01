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
source "$HERE/../../lib/worktree-git-env.sh"
GC="$HERE/../../worktree-gc.sh"
IDLE="${WORKTREE_GC_IDLE_HOURS:-6}"

[[ "$FLOOR_GB" =~ ^[0-9]+$ && "$CEILING" =~ ^[0-9]+$ ]] || { echo "invalid disk thresholds" >&2; exit 2; }
free_kb="$(df -Pk "$GITS" | awk 'NR==2 {print $4}')"
[[ "$free_kb" =~ ^[0-9]+$ ]] || { echo "cannot measure free disk" >&2; exit 2; }
free_gb=$((free_kb / 1048576))

# Keep each concurrent GC's output private; never publish a partial measurement.
scratch_root="$HERE/../../../docs.local"
mkdir -p "$scratch_root"
scratch="$(mktemp -d "$scratch_root/disk-floor.XXXXXXXX")"
pids=()
trap 'for pid in ${pids[@]+"${pids[@]}"}; do wait "$pid" || true; done; rm -rf "$scratch"' EXIT

collect_plan() {
  local repo="$1" index="$2" rc=0 plan
  plan="$("$GC" --prune-plan --idle-hours "$IDLE" --repo "$repo")" || rc=$?
  if [[ "$rc" -ne 0 && "$rc" -ne 3 ]]; then
    echo "cannot produce prune plan for $repo (exit $rc): $plan" >&2
    return "$rc"
  fi
  printf '%s\n' "$plan" | awk -F ' · ' '$6 == "REMOVE" {n++} END {print n+0}' > "$scratch/$index.count"
}

wait_batch() {
  local pid rc=0
  for pid in ${pids[@]+"${pids[@]}"}; do
    wait "$pid" || rc=$?
  done
  pids=()
  [[ "$rc" -eq 0 ]] || return "$rc"
}

merged=0
index=0
repos=()
: > "$scratch/order"
shopt -s nullglob
for repo in "$GITS"/*; do
  # A symlinked repo is the same set twice.
  [[ -d "$repo/.git" && ! -L "$repo" ]] || continue
  census="$(git -C "$repo" worktree list --porcelain)" || {
    echo "cannot list worktrees for $repo" >&2
    exit 2
  }
  # No linked worktrees means no REMOVE plans; avoid all remote lookups.
  count="$(printf '%s\n' "$census" | awk '/^worktree / {n++} END {print n+0}')"
  [[ "$count" -ge 1 ]] || { echo "empty worktree census for $repo" >&2; exit 2; }
  [[ "$count" -gt 1 ]] || continue
  repos+=("$repo")
  printf '%s %s\n' "$count" "$index" >> "$scratch/order"
  index=$((index + 1))
done
# Put the largest plans together instead of serializing them across batches.
sort -nr "$scratch/order" > "$scratch/sorted"
while read -r count index; do
  collect_plan "${repos[$index]}" "$index" &
  pids+=("$!")
  if [[ "${#pids[@]}" -eq 4 ]]; then wait_batch; fi
done < "$scratch/sorted"
wait_batch
for count_file in "$scratch"/*.count; do
  read -r count < "$count_file"
  merged=$((merged + count))
done

echo "free_gb=$free_gb floor=$FLOOR_GB merged_worktrees=$merged ceiling=$CEILING"
health=false
if [[ "$free_gb" -ge "$FLOOR_GB" && "$merged" -le "$CEILING" ]]; then health=true; fi
printf '{"free_gb":%s,"floor":%s,"merged_worktrees":%s,"ceiling":%s,"health":%s}\n' "$free_gb" "$FLOOR_GB" "$merged" "$CEILING" "$health"
[[ "$health" == true ]]
