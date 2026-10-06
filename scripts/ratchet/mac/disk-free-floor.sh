#!/usr/bin/env bash
# disk-free-floor row (pass): the REAL Mac has at least DISK_FREE_FLOOR_GB free on the data volume
# AND at most MERGED_WORKTREE_CEILING merged worktrees the prune should already have removed.
# Read-only: no fetch, no removal. Counted = HEAD is an ancestor of the local origin/main|master,
# the tree is clean (ignored files allowed, as worktree-gc --apply treats them), idle longer than
# the prune's window (HEAD/index/COMMIT_EDITMSG mtime), and not the main checkout, locked,
# hooks-live or under .claude/worktrees (the prune never removes those).
# Specimen (2026-10-06 21:50 IDT): 14 GB free, 1,770 registered worktrees, ~858 merged+clean;
# the last cleanup was re-filled within a week because no lane close removed its worktree.
export LC_ALL=C
export GIT_OPTIONAL_LOCKS=0
set -euo pipefail

FLOOR_GB="${DISK_FREE_FLOOR_GB:-60}"
CEILING="${MERGED_WORKTREE_CEILING:-25}"
GITS="${RATCHET_GITS_ROOT:-$HOME/Gits}"
IDLE_S=$(( ${WORKTREE_GC_IDLE_HOURS:-6} * 3600 ))
now="$(date +%s)"

idle() {
  local admin newest=0 f m
  admin="$(git -C "$1" rev-parse --absolute-git-dir 2>/dev/null)" || return 1
  for f in HEAD index COMMIT_EDITMSG; do
    [[ -e "$admin/$f" ]] || continue
    m="$(stat -f %m "$admin/$f")" || return 1
    (( m > newest )) && newest="$m"
  done
  (( now - newest >= IDLE_S ))
}

free_kb="$(df -k "$GITS" | awk 'NR==2 {print $4}')"
free_gb=$((free_kb / 1048576))

merged=0
shopt -s nullglob
for repo in "$GITS"/*; do
  # A symlinked repo dir (cmux-mcp-standalone -> cmuxlayer) is the same worktree set twice.
  [[ -d "$repo/.git" && ! -L "$repo" ]] || continue
  base=""
  for ref in origin/main origin/master; do
    if git -C "$repo" rev-parse --verify --quiet "$ref" >/dev/null; then base="$ref"; break; fi
  done
  [[ -n "$base" ]] || continue
  main_path="" path="" head="" locked=0
  while IFS= read -r line; do
    case "$line" in
      worktree\ *) path="${line#worktree }" ;;
      HEAD\ *) head="${line#HEAD }" ;;
      locked*) locked=1 ;;
      "")
        if [[ -z "$main_path" ]]; then
          main_path="$path"
        elif [[ -d "$path" && "$locked" == 0 && "$path" != */.worktrees/hooks-live \
          && "$path" != */.claude/worktrees/* ]] \
          && git -C "$repo" merge-base --is-ancestor "$head" "$base" 2>/dev/null \
          && idle "$path" \
          && [[ -z "$(git -C "$path" status --porcelain --untracked-files=normal 2>/dev/null || echo status-failed)" ]]; then
          merged=$((merged + 1))
        fi
        path="" head="" locked=0
        ;;
    esac
  done < <(git -C "$repo" worktree list --porcelain; echo)
done

echo "free_gb=$free_gb floor=$FLOOR_GB merged_worktrees=$merged ceiling=$CEILING"
[[ "$free_gb" -ge "$FLOOR_GB" && "$merged" -le "$CEILING" ]]
