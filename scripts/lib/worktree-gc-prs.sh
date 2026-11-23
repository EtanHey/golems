# The open snapshot is shared by every branch. Only ahead-of-base branches
# need a per-branch merged-at-head proof. Raw gh stderr never enters reports.
gh_category() {
  python3 "$SCRIPT_DIR/lib/worktree-gc-prs.py" category "$1"
}
load_open_prs() {
  local url raw
  open_pr_heads=""; open_pr_failed=""; merged_prs=""; merged_pr_failed=""; pr_slug=""
  url="$(git -C "$repo_root" config --get remote.origin.url || true)"
  [[ "$url" =~ github\.com[:/]([^/]+/[^/]+)$ ]] || return 0
  pr_slug="${BASH_REMATCH[1]%.git}"
  if ! raw="$(gh pr list --repo "$pr_slug" --state open --json headRefName,number --limit 500 2>"$REPORT_JOURNAL.gh-stderr")"; then
    open_pr_failed="open PR lookup: $(gh_category "$REPORT_JOURNAL.gh-stderr")"
  elif ! open_pr_heads="$(python3 "$SCRIPT_DIR/lib/worktree-gc-prs.py" open <<< "$raw")"; then
    open_pr_failed="open PR lookup: invalid-or-incomplete-response"
  fi
  if [[ -n "$open_pr_failed" ]]; then
    python3 "$SCRIPT_DIR/lib/worktree-gc-state.py" add "$REPORT_JOURNAL" "$repo_name" "$repo_root" - ERROR "$open_pr_failed" pr-lookup
  fi
}
load_merged_proof() {
  local raw
  merged_prs=""; merged_pr_failed=""
  [[ -n "$pr_slug" ]] || return 0
  if ! raw="$(gh pr list --repo "$pr_slug" --state merged --head "$1" --limit 500 --json headRefName,headRefOid 2>"$REPORT_JOURNAL.gh-stderr")"; then
    merged_pr_failed="merged PR lookup: $(gh_category "$REPORT_JOURNAL.gh-stderr")"
  elif ! merged_prs="$(python3 "$SCRIPT_DIR/lib/worktree-gc-prs.py" merged <<< "$raw")"; then
    merged_pr_failed="merged PR lookup: invalid-or-incomplete-response"
  fi
  if [[ -n "$merged_pr_failed" ]]; then
    python3 "$SCRIPT_DIR/lib/worktree-gc-state.py" add "$REPORT_JOURNAL" "$repo_name" "$repo_root" - ERROR "$merged_pr_failed" pr-lookup
  fi
}
head_is_merged() {
  local path="$1" branch="$2" pr_branch pr_sha
  git -C "$path" merge-base --is-ancestor HEAD "$base_ref" && return 0
  [[ -n "$branch" ]] || return 1
  while IFS=$'\t' read -r pr_branch pr_sha; do
    [[ "$pr_branch" == "$branch" && "$pr_sha" =~ ^[0-9a-f]{40}$ ]] || continue
    git -C "$path" merge-base --is-ancestor HEAD "$pr_sha" 2>/dev/null && return 0
  done <<< "$merged_prs"
  return 1
}

# Read the remote's actual default (main and master may both exist).
refresh_remote_base() {
  local remote_head default_ref
  if [[ "$prune_plan" -eq 1 && "${remote_snapshot_loaded:-0}" -eq 1 ]]; then return 0; fi
  remote_snapshot_loaded=1
  local git_remote=(git)
  if [[ "$prune_plan" -eq 1 ]]; then
    git_remote=(python3 "$SCRIPT_DIR/lib/worktree-gc-remote.py" 45 git)
  fi
  base_ref=""; base_reason="cannot prove origin default branch after fresh fetch"
  if ! "${git_remote[@]}" -C "$repo_root" fetch origin --quiet --prune --no-auto-maintenance \
    '+refs/heads/*:refs/remotes/origin/*'; then
    base_reason="git fetch origin failed; refusing stale judgment"
  elif remote_head="$("${git_remote[@]}" -C "$repo_root" ls-remote --symref origin HEAD)"; then
    default_ref="$(sed -n 's/^ref: refs\/heads\/\([^[:space:]]*\)[[:space:]]HEAD$/\1/p' <<< "$remote_head")"
    if [[ -n "$default_ref" ]] && git -C "$repo_root" show-ref --verify --quiet "refs/remotes/origin/$default_ref"; then
      base_ref="origin/$default_ref"
    fi
  fi
}
