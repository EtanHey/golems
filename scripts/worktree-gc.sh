#!/usr/bin/env bash
# AIDEV-NOTE: Bash character ranges follow locale collation. Keep every match
# and ordering decision bytewise so ambient UTF-8 locales cannot change verdicts.
export LC_ALL=C
# AIDEV-NOTE: status must never rewrite a worktree index: --apply judges
# activity by the index mtime, and the scan itself must not look like activity.
export GIT_OPTIONAL_LOCKS=0
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$SCRIPT_DIR/lib/worktree-git-env.sh"
# T3 Code reaps its own worktrees (storageCleanup.ts); this script covers non-T3 checkouts and merged branches.
# Pins: ~/.config/golems/worktree-gc-pins.txt (one absolute path or branch per line).
# Owner queue: docs.local/worktree-gc/latest.{json,md}; age is reporting only.
# Every scan, including failures: docs.local/worktree-gc/last-run.{json,md}.
# Test adapters: WORKTREE_GC_T3_DB, WORKTREE_GC_REPORT_DIR, WORKTREE_GC_PINS_FILE.
# WORKTREE_GC_T3_ROOTS adds newline-separated managed roots (canonicalized).

usage() {
  printf 'Usage: %s [--dry-run | --prune-plan | --apply] [--idle-hours <n>] [--repo <path> | --path <worktree>]\n' \
    "$(basename "$0")"
}

canonical_path() {
  local candidate="$1"

  if [[ -d "$candidate" ]]; then
    (cd "$candidate" && pwd -P)
  else
    printf '%s\n' "$candidate"
  fi
}

normalize_reason() {
  local reason="$1"

  reason="${reason//$'\n'/; }"
  printf '%s\n' "$reason"
}

emit_row() {
  local repo_name="$1"
  local worktree_path="$2"
  local branch="$3"
  local dirty="$4"
  local ahead="$5"
  local verdict="$6"
  local reason="$7"
  local row

  reason="$(normalize_reason "$reason")"
  row="$repo_name · $worktree_path · $branch · dirty=$dirty · ahead=$ahead · $verdict · $reason"
  printf '%s\n' "$row" >> "$LOG_FILE"
  printf '%s\n' "$row"
  case "$verdict" in
    KEEP-dirty|KEEP-unmerged|KEEP-unpushed|KEEP-live|KEEP-detached|KEEP-reflog|KEEP-undetermined)
      local report_detail
      report_detail="$(python3 "$SCRIPT_DIR/lib/worktree-gc-state.py" add "$REPORT_JOURNAL" \
        "$repo_name" "$worktree_path" "$branch" "$verdict" "$reason" 2>&1)" ||
        report_detail="report row failed: $worktree_path; $report_detail"
      if [[ -n "$report_detail" ]]; then
        printf '%s\n' "$report_detail" >> "$LOG_FILE" || true
        printf '%s\n' "$report_detail" || true
      fi ;;
  esac
}

is_tool_managed_worktree() {
  local repo_root="$1"
  local worktree_path="$2"
  local canonical_home
  local repo_cmux_prefix="$repo_root/.cmux/worktrees/"
  local codex_workflows_prefix

  canonical_home="$(canonical_path "$HOME")"
  codex_workflows_prefix="$canonical_home/Gits/worktrees/.codex-workflows/"

  [[ "$worktree_path/" == "$repo_cmux_prefix"* ]] ||
    [[ "$worktree_path/" == "$codex_workflows_prefix"* ]]
}

refresh_remote_base() {
  base_ref=""
  base_reason="no origin/main or origin/master after fresh fetch"

  if ! git -C "$repo_root" fetch origin --quiet --prune --no-auto-maintenance \
    '+refs/heads/*:refs/remotes/origin/*'; then
    base_reason="git fetch origin failed; refusing stale judgment"
  elif git -C "$repo_root" show-ref --verify --quiet refs/remotes/origin/main; then
    base_ref="origin/main"
  elif git -C "$repo_root" show-ref --verify --quiet refs/remotes/origin/master; then
    base_ref="origin/master"
  fi
}

read_worktree_status() {
  local worktree_path="$1"

  # AIDEV-NOTE: Untracked files hidden by user configuration are local-only
  # data and force KEEP. Ignored files do not block (Etan 2026-10-06,
  # superseding #664), but --apply archives every ignored path that is not a
  # regenerable cache (scripts/lib/worktree-archive.py REGENERABLE) first.
  git -C "$worktree_path" -c status.showUntrackedFiles=all \
    status --porcelain --untracked-files=all
}

# --- --apply (lane close + nightly prune) -----------------------------------
# AIDEV-NOTE: #664 (f68dc738) retired --apply; Etan's 2026-10-06 21:50 ruling
# ("nightly prune") revived it. #664's revival bar is met above (fresh fetch via
# an explicit refspec, ls-files -v hidden flags, submodule refusal, fail closed)
# and the runtime guards below also fail closed: a check that cannot run KEEPs.

# AIDEV-NOTE: in-use = any of this user's processes has its cwd inside (lsof),
# or a cmux-registered agent whose pid is alive was launched inside. A partial
# view is not proof: lsof exiting non-zero, or an unreadable registry, KEEPs.
refresh_live_cwds() {
  local out
  local rc=0

  live_cwds=""
  agent_cwds=""
  if ! command -v lsof >/dev/null 2>&1; then
    live_reason="lsof unavailable; cannot prove no process uses the worktree"
    return 1
  fi
  local ps_pids
  local ps_count=0
  local lsof_count=0
  local line
  if ! ps_pids="$(ps -o pid= -u "$(id -u)" 2>/dev/null)"; then
    live_reason="ps failed; cannot cross-check lsof coverage"
    return 1
  fi
  out="$(lsof -a -u "$(id -u)" -d cwd -Fpn 2>/dev/null)" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    live_reason="lsof exited $rc (partial view); refusing to treat that as idle"
    return 1
  fi
  while IFS= read -r line; do
    case "$line" in
      p*) lsof_count=$((lsof_count + 1)) ;;
      n*) live_cwds+="${line#n}"$'\n' ;;
    esac
  done <<< "$out"
  while IFS= read -r line; do
    [[ -n "${line// /}" ]] && ps_count=$((ps_count + 1))
  done <<< "$ps_pids"
  if [[ -z "$live_cwds" ]]; then
    live_reason="lsof listed no process cwd; refusing to treat that as idle"
    return 1
  fi
  # A sandboxed or blind lsof exits 0 yet sees almost nothing (#703 R1 3i).
  if (( lsof_count * 10 < ps_count * 9 )); then
    live_reason="lsof saw $lsof_count of $ps_count processes (partial view); refusing to treat that as idle"
    return 1
  fi
  if [[ "$registry_required" -eq 1 || -e "$cmux_registry" || -L "$cmux_registry" ]]; then
    if [[ ! -f "$cmux_registry" || ! -r "$cmux_registry" ]] ||
        ! agent_cwds="$(python3 "$SCRIPT_DIR/lib/worktree-registry-cwds.py" "$cmux_registry")"; then
      live_reason="cmux registry missing, unreadable or invalid: $cmux_registry"
      return 1
    fi
  fi
}

# Exact line membership without grep (a missing grep must not fail open).
line_in() {
  local needle="$1"
  local haystack="$2"
  local line

  while IFS= read -r line; do
    [[ "$line" == "$needle" ]] && return 0
  done <<< "$haystack"
  return 1
}

path_has_cwd_in() {
  local worktree_path="$1"
  local cwds="$2"
  local cwd

  while IFS= read -r cwd; do
    [[ -n "$cwd" ]] || continue
    [[ "$cwd" == "$worktree_path" || "$cwd" == "$worktree_path/"* ]] && return 0
  done <<< "$cwds"
  return 1
}

# Lists open branches and merged PR SHAs once per repo. An origin whose PRs cannot
# be listed makes every branch worktree KEEP-undetermined.
load_open_prs() {
  local url
  local slug

  open_pr_heads=""
  open_pr_failed=""
  merged_prs="[]"
  merged_pr_failed=""
  # The configured URL, not `remote get-url` (which applies insteadOf rewrites).
  url="$(git -C "$repo_root" config --get remote.origin.url || true)"
  [[ "$url" =~ github\.com[:/]([^/]+/[^/]+)$ ]] || return 0
  slug="${BASH_REMATCH[1]%.git}"
  if ! open_pr_heads="$(gh pr list --repo "$slug" --state open --limit 1000 \
    --json headRefName --jq '.[].headRefName' 2>/dev/null)"; then
    open_pr_failed="cannot list open PRs for $slug (gh failed)"
  fi
  if ! merged_prs="$(gh pr list --repo "$slug" --state merged --limit 10000 \
      --json headRefName,headRefOid 2>/dev/null)" ||
      ! merged_prs="$(python3 -c 'import json,sys
rows=json.load(sys.stdin)
if not isinstance(rows,list) or len(rows)>=10000: raise ValueError("incomplete PR list")
for r in rows:
 if not isinstance(r["headRefName"],str) or len(r["headRefOid"])!=40: raise ValueError("invalid PR head")
print("\n".join(r["headRefName"]+"\t"+r["headRefOid"] for r in rows))' <<< "$merged_prs")"; then
    merged_pr_failed="cannot list merged PR heads for $slug (gh failed or incomplete)"
  fi
}

# A name is only a lookup key: the local HEAD must be covered by the PR SHA.
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

check_owner_guards() {
  local path="$1" branch="$2" pins detail rc=0
  local pin_file="${WORKTREE_GC_PINS_FILE:-$HOME/.config/golems/worktree-gc-pins.txt}"
  detail="$(python3 "$SCRIPT_DIR/lib/worktree-gc-state.py" live-symlink "$path" 2>&1)" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    local verdict=KEEP-undetermined
    [[ "$rc" -eq 3 ]] && verdict=KEEP-live
    emit_row "$repo_name" "$path" "$branch" not-checked not-checked "$verdict" "${detail:-live symlink scan failed}"
    return 1
  fi
  if [[ -e "$pin_file" || -L "$pin_file" ]]; then
    if ! pins="$(python3 "$SCRIPT_DIR/lib/worktree-gc-state.py" pins "$pin_file")"; then
      emit_row "$repo_name" "$path" "$branch" not-checked undetermined KEEP-undetermined "cannot read pins"
      return 1
    fi
    if line_in "$(canonical_path "$path")" "$pins" || line_in "$branch" "$pins"; then
      emit_row "$repo_name" "$path" "$branch" not-checked not-checked KEEP-pinned "optional pin file"
      return 1
    fi
  fi
  detail="$(python3 "$SCRIPT_DIR/lib/worktree-gc-state.py" t3 "$path" 2>/dev/null)" || rc=$?
  if [[ "$rc" -eq 3 ]]; then
    emit_row "$repo_name" "$path" "$branch" not-checked undetermined KEEP-live "$detail"
    return 1
  fi
}

# Prints the newest of the admin dir's HEAD/index/COMMIT_EDITMSG mtimes.
last_activity_epoch() {
  local worktree_path="$1"
  local admin newest=0 mtime f

  admin="$(git -C "$worktree_path" rev-parse --absolute-git-dir)" || return 1
  mtime="$(portable_stat mtime "$admin/HEAD")" || return 1
  newest="$mtime"
  for f in index COMMIT_EDITMSG; do
    [[ -e "$admin/$f" ]] || continue
    mtime="$(portable_stat mtime "$admin/$f")" || return 1
    (( mtime > newest )) && newest="$mtime"
  done
  printf '%s\n' "$newest"
}

archive_ignored() {
  local worktree_path="$1"
  local head_sha="$2"
  local dest

  dest="$repo_root/docs.local/worktree-archive/$(basename "$worktree_path")"
  archive_detail="$(python3 "$SCRIPT_DIR/lib/worktree-archive.py" archive "$worktree_path" \
    "$dest" "$dest-${head_sha:0:12}")"
}

apply_removal() {
  local worktree_path="$1"
  local branch_display="$2"
  local head_sha
  local last
  local now
  local removed_detail

  if (( idle_seconds > 0 )); then
    if ! last="$(last_activity_epoch "$worktree_path")"; then
      emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" \
        "KEEP-undetermined" "cannot read worktree activity times"
      return 0
    fi
    now="$(date +%s)"
    if (( now - last < idle_seconds )); then
      emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" \
        "KEEP-active" "HEAD/index/commit activity within ${idle_hours}h"
      return 0
    fi
  fi
  if ! refresh_live_cwds; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" \
      "KEEP-undetermined" "$live_reason"
    return 0
  fi
  if path_has_cwd_in "$worktree_path" "$live_cwds"; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" \
      "KEEP-live" "a running process has its cwd inside the worktree"
    return 0
  fi
  if path_has_cwd_in "$worktree_path" "$agent_cwds"; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" \
      "KEEP-live" "a live cmux-registered agent was launched inside the worktree"
    return 0
  fi
  if ! head_sha="$(git -C "$worktree_path" rev-parse HEAD)"; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" \
      "KEEP-undetermined" "cannot resolve HEAD"
    return 0
  fi
  local nested
  local nested_rc=0
  nested="$(python3 "$SCRIPT_DIR/lib/worktree-archive.py" nested-git "$worktree_path")" || nested_rc=$?
  if [[ "$nested_rc" -ne 0 ]]; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" \
      "KEEP-undetermined" "nested git repository or unscannable tree: ${nested:-scan failed}"
    return 0
  fi
  local protection_detail
  if ! protection_detail="$(python3 "$SCRIPT_DIR/lib/worktree-delete-check.py" "$worktree_path")"; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" \
      "KEEP-undetermined" "${protection_detail:-deletion permission scan failed}"
    return 0
  fi
  if [[ "$apply" -eq 0 ]]; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" \
      "REMOVE" "eligible prune plan; archive verification required before removal"
    return 0
  fi
  if ! archive_ignored "$worktree_path" "$head_sha"; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" \
      "KEEP-undetermined" "${archive_detail:-ignored-data archive failed}"
    return 0
  fi
  check_owner_guards "$worktree_path" "$branch_display" || return 0
  # A durable intent must succeed before the destructive call (nightly crash evidence).
  emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" "REMOVING" "$archive_detail"
  # Never --force: git itself refuses a tree that became unclean meanwhile.
  if ! git -C "$repo_root" worktree remove "$worktree_path"; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" \
      "KEEP-undetermined" "git worktree remove refused"
    return 0
  fi
  removed_detail="clean; represented by $base_ref or a SHA-qualified merged PR; $archive_detail"
  emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" "REMOVED" "$removed_detail"
}

has_hidden_index_flags() {
  local index_flags="$1"
  local index_line

  while IFS= read -r index_line; do
    case "$index_line" in
      [a-z]\ *|S\ *) return 0 ;;
    esac
  done <<< "$index_flags"

  return 1
}

process_worktree_block() {
  local worktree_path="$block_worktree"
  local branch_ref="$block_branch"
  local locked_reason="$block_locked"
  local branch_display
  local canonical_worktree
  local dirty_output
  local index_entries
  local index_flags
  local remote_contains
  local ahead
  local t3_root

  [[ -n "$worktree_path" ]] || return 0

  canonical_worktree="$(canonical_path "$worktree_path")"
  if [[ "$canonical_worktree" == "$main_root" || "$canonical_worktree" == "$repo_root" ]]; then
    return 0
  fi
  if [[ -n "$only_worktree" && "$canonical_worktree" != "$only_worktree" ]]; then
    return 0
  fi
  only_seen=1

  if [[ -n "$branch_ref" ]]; then
    branch_display="${branch_ref#refs/heads/}"
  else
    branch_display="(detached)"
  fi

  while IFS= read -r t3_root; do
    if [[ "$canonical_worktree" == "$t3_root" || "$canonical_worktree" == "$t3_root/"* ]]; then
      t3_skip_count=$((t3_skip_count + 1))
      emit_row "$repo_name" "$worktree_path" "$branch_display" not-checked not-checked \
        skip "t3-managed (T3 storageCleanup owns it)" >/dev/null
      return 0
    fi
  done <<< "$t3_roots"

  if is_tool_managed_worktree "$repo_root" "$canonical_worktree"; then
    return 0
  fi

  # AIDEV-NOTE: hooks-live is the pinned source of every wired hook; removing it
  # dangles them all. Kept even if someone unlocked it.
  if [[ "$canonical_worktree" == "$repo_root/.worktrees/hooks-live" ]]; then
    check_owner_guards "$worktree_path" "$branch_display" || return 0
    emit_row "$repo_name" "$worktree_path" "$branch_display" "not-checked" \
      "not-checked" "KEEP-pinned" "hook source pinned by scripts/hooks/install-hooks.sh"
    return 0
  fi

  if [[ "$canonical_worktree/" == *"/.claude/worktrees/"* ]]; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "not-checked" \
      "not-checked" "KEEP-pinned" "Claude Code manages .claude/worktrees itself"
    return 0
  fi

  local scope_name="${canonical_worktree#"$main_root/.worktrees/"}"
  if [[ "$canonical_worktree" != "$main_root/.worktrees/"?* || "$scope_name" == */* ]]; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "not-checked" \
      "not-checked" "KEEP-out-of-scope" "not under $main_root/.worktrees/"
    return 0
  fi
  check_owner_guards "$worktree_path" "$branch_display" || return 0

  if [[ -n "$locked_reason" ]]; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "not-checked" \
      "undetermined" "KEEP-undetermined" "worktree is locked: $locked_reason"
    return 0
  fi

  if [[ -n "$branch_ref" ]]; then
    if [[ -n "$open_pr_failed" ]]; then
      emit_row "$repo_name" "$worktree_path" "$branch_display" "not-checked" \
        "undetermined" "KEEP-undetermined" "$open_pr_failed"
      return 0
    fi
    if line_in "$branch_display" "$open_pr_heads"; then
      emit_row "$repo_name" "$worktree_path" "$branch_display" "not-checked" \
        "not-checked" "KEEP-open-pr" "branch has an open PR (live lane, parked or not)"
      return 0
    fi
  fi

  local other
  while IFS= read -r other; do
    if [[ -n "$other" && "$other" != "$worktree_path" && "$other" == "$worktree_path/"* ]]; then
      emit_row "$repo_name" "$worktree_path" "$branch_display" "not-checked" \
        "undetermined" "KEEP-undetermined" "another worktree is nested inside: $other"
      return 0
    fi
  done <<< "$census_paths"

  if [[ -z "$base_ref" ]]; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "not-checked" \
      "undetermined" "KEEP-undetermined" "$base_reason"
    return 0
  fi

  if ! index_entries="$(git -C "$worktree_path" ls-files --stage)"; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "undetermined" \
      "undetermined" "KEEP-undetermined" "git index scan failed"
    return 0
  fi
  if [[ "$index_entries" == 160000\ * || "$index_entries" == *$'\n160000 '* ]]; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "not-checked" \
      "undetermined" "KEEP-undetermined" \
      "contains submodule; local-only submodule data cannot be fully classified"
    return 0
  fi
  if ! index_flags="$(git -C "$worktree_path" ls-files -v)"; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "undetermined" \
      "undetermined" "KEEP-undetermined" "git index flag scan failed"
    return 0
  fi
  # AIDEV-NOTE: assume-unchanged and skip-worktree deliberately hide tracked
  # paths from porcelain, so a clean status cannot prove absence of local data.
  if has_hidden_index_flags "$index_flags"; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "not-checked" \
      "undetermined" "KEEP-undetermined" \
      "tracked paths use an assume-unchanged or skip-worktree index flag"
    return 0
  fi

  if ! dirty_output="$(read_worktree_status "$worktree_path")"; then
    # AIDEV-NOTE: A temporarily unavailable worktree is the normal state of a
    # tree on an unmounted volume or a machine resuming from sleep.
    emit_row "$repo_name" "$worktree_path" "$branch_display" "undetermined" \
      "undetermined" "KEEP-undetermined" "git status failed"
    return 0
  fi
  if [[ -n "$dirty_output" ]]; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "1" \
      "not-checked" "KEEP-dirty" "uncommitted files"
    return 0
  fi

  if [[ -z "$branch_ref" ]]; then
    if ! remote_contains="$(git -C "$worktree_path" branch -r --contains HEAD)"; then
      emit_row "$repo_name" "$worktree_path" "$branch_display" "0" \
        "undetermined" "KEEP-detached" "remote containment check failed"
      return 0
    fi
    if [[ -z "$remote_contains" ]]; then
      emit_row "$repo_name" "$worktree_path" "$branch_display" "0" \
        "not-checked" "KEEP-detached" "HEAD is not contained by a remote branch"
      return 0
    fi
  fi

  if ! ahead="$(git -C "$worktree_path" rev-list --count "${base_ref}..HEAD")"; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" \
      "unresolvable" "KEEP-unpushed" "cannot resolve commits against $base_ref"
    found_unpushed=1
    return 0
  fi
  if [[ "$ahead" -ne 0 ]]; then
    if [[ -n "$merged_pr_failed" ]]; then
      emit_row "$repo_name" "$worktree_path" "$branch_display" 0 undetermined KEEP-undetermined "$merged_pr_failed"
      return 0
    fi
    if ! head_is_merged "$worktree_path" "$branch_display"; then
      emit_row "$repo_name" "$worktree_path" "$branch_display" "0" \
        "$ahead" "KEEP-unpushed" "$ahead commit(s) absent from $base_ref and merged PR heads"
      found_unpushed=1
      return 0
    fi
  fi

  refresh_remote_base
  if [[ -z "$base_ref" ]]; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" \
      "undetermined" "KEEP-undetermined" "$base_reason"
    return 0
  fi

  if ! index_entries="$(git -C "$worktree_path" ls-files --stage)"; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "undetermined" \
      "undetermined" "KEEP-undetermined" "git index scan failed during final verdict recheck"
    return 0
  fi
  if [[ "$index_entries" == 160000\ * || "$index_entries" == *$'\n160000 '* ]]; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "not-checked" \
      "undetermined" "KEEP-undetermined" \
      "contains submodule; local-only submodule data cannot be fully classified"
    return 0
  fi
  if ! index_flags="$(git -C "$worktree_path" ls-files -v)"; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "undetermined" \
      "undetermined" "KEEP-undetermined" \
      "git index flag scan failed during final verdict recheck"
    return 0
  fi
  if has_hidden_index_flags "$index_flags"; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "not-checked" \
      "undetermined" "KEEP-undetermined" \
      "tracked paths use an assume-unchanged or skip-worktree index flag"
    return 0
  fi

  if ! dirty_output="$(read_worktree_status "$worktree_path")"; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "undetermined" \
      "undetermined" "KEEP-undetermined" "git status failed during final verdict recheck"
    return 0
  fi
  if [[ -n "$dirty_output" ]]; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "1" \
      "not-checked" "KEEP-dirty" "became dirty before final verdict"
    return 0
  fi

  if [[ -z "$branch_ref" ]]; then
    if ! remote_contains="$(git -C "$worktree_path" branch -r --contains HEAD)"; then
      emit_row "$repo_name" "$worktree_path" "$branch_display" "0" \
        "undetermined" "KEEP-detached" "remote containment recheck failed"
      return 0
    fi
    if [[ -z "$remote_contains" ]]; then
      emit_row "$repo_name" "$worktree_path" "$branch_display" "0" \
        "not-checked" "KEEP-detached" "HEAD lost remote containment before final verdict"
      return 0
    fi
  fi

  if ! ahead="$(git -C "$worktree_path" rev-list --count "${base_ref}..HEAD")"; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" \
      "unresolvable" "KEEP-unpushed" "cannot re-resolve commits against $base_ref"
    found_unpushed=1
    return 0
  fi
  if [[ "$ahead" -ne 0 ]] && ! head_is_merged "$worktree_path" "$branch_display"; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" \
      "$ahead" "KEEP-unpushed" "$ahead commit(s) absent from freshly revalidated $base_ref"
    found_unpushed=1
    return 0
  fi

  local reflog_only
  if ! reflog_only="$(git -C "$worktree_path" log -g --format=%H HEAD |
      git -C "$worktree_path" rev-list --stdin --not --branches --remotes --tags)"; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" \
      "KEEP-undetermined" "cannot classify HEAD reflog history"
    return 0
  fi
  if [[ -n "$reflog_only" ]]; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" \
      "KEEP-reflog" "HEAD reflog contains commits unreachable from branches, remotes or tags"
    return 0
  fi

  local private_refs
  if ! private_refs="$(git -C "$worktree_path" for-each-ref --format='%(refname)' refs/worktree refs/bisect refs/rewritten)"; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" \
      "KEEP-undetermined" "cannot enumerate per-worktree refs"
    return 0
  fi
  if [[ -n "$private_refs" ]]; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" \
      "KEEP-worktree-refs" "per-worktree refs protect local history or operation state"
    return 0
  fi

  if [[ "$apply" -eq 1 || "$prune_plan" -eq 1 ]]; then
    apply_removal "$worktree_path" "$branch_display"
    return 0
  fi
  emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" \
    "REMOVE" "eligible; report only; clean and fully represented by $base_ref"
}

process_repo() {
  local requested_repo="$1"
  local census
  local t3_skip_count=0
  local line

  if ! repo_root="$(golems_main_repo "$requested_repo")"; then
    printf 'Refusing --repo: must be the main repository toplevel: %s\n' "$requested_repo" >&2
    return 2
  fi

  if ! census="$(git -C "$repo_root" worktree list --porcelain)"; then
    printf 'Could not list worktrees for %s\n' "$repo_root" >&2
    return 2
  fi
  # Independently verify the census agrees with the validated main root.
  main_root="$(canonical_path "$(sed -n '1s/^worktree //p' <<< "$census")")"
  [[ "$main_root" == "$repo_root" ]] || { echo "Main census root mismatch" >&2; return 2; }
  repo_name="$(basename "$repo_root")"
  census_paths="$(sed -n 's/^worktree //p' <<< "$census")"
  load_open_prs

  refresh_remote_base

  block_worktree=""
  block_branch=""
  block_locked=""
  while IFS= read -r line; do
    if [[ -z "$line" ]]; then
      process_worktree_block
      block_worktree=""
      block_branch=""
      block_locked=""
      continue
    fi

    case "$line" in
      worktree\ *) block_worktree="${line#worktree }" ;;
      branch\ *) block_branch="${line#branch }" ;;
      locked) block_locked="locked" ;;
      locked\ *) block_locked="${line#locked }" ;;
    esac
  done <<< "$census"
  process_worktree_block
  if (( t3_skip_count > 0 )); then
    printf '%s · t3-managed (T3 storageCleanup owns it): %s skip\n' "$repo_name" "$t3_skip_count" | tee -a "$LOG_FILE"
    python3 "$SCRIPT_DIR/lib/worktree-gc-state.py" t3-summary "$REPORT_JOURNAL" "$repo_name" "$t3_skip_count"
  fi
  # AIDEV-NOTE: never `git worktree prune` here (#703 R1 M1): it drops the
  # registration of a KEEP worktree that is only temporarily away, orphaning
  # its commits. `git worktree remove` already deletes its own admin entry.
}

explicit_repo=""
only_worktree=""
only_seen=0
registry_required=0
[[ "${WORKTREE_GC_CMUX_REGISTRY+x}" == x ]] && registry_required=1
cmux_registry="${WORKTREE_GC_CMUX_REGISTRY-$HOME/.cmuxlayer/session-registry.jsonl}"
apply=0
prune_plan=0
idle_hours=6
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      shift
      ;;
    --apply)
      apply=1
      shift
      ;;
    --prune-plan)
      prune_plan=1
      shift
      ;;
    --idle-hours)
      if [[ $# -lt 2 || ! "$2" =~ ^[0-9]+$ ]]; then
        usage >&2
        exit 2
      fi
      idle_hours="$2"
      shift 2
      ;;
    --path)
      if [[ $# -lt 2 || ! -d "$2" ]]; then
        printf 'Not a worktree directory: %s\n' "${2:-}" >&2
        exit 2
      fi
      # A symlink (or a path through one) could resolve into another repo.
      if [[ -L "${2%/}" || "$(cd "$2" && pwd -P)" != "$(cd "$2" && pwd -L)" ]]; then
        printf 'Refusing --path through a symlink: %s\n' "$2" >&2
        exit 2
      fi
      only_worktree="$(canonical_path "$2")"
      shift 2
      ;;
    --repo)
      if [[ $# -lt 2 ]]; then
        usage >&2
        exit 2
      fi
      explicit_repo="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$apply" -eq 1 && "$prune_plan" -eq 1 ]]; then
  printf 'Choose --apply or --prune-plan\n' >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/portable-stat.sh
source "$SCRIPT_DIR/lib/portable-stat.sh"
idle_seconds=$((idle_hours * 3600))
LOG_DIR="$SCRIPT_DIR/../docs.local"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/worktree-gc-$(date '+%Y%m%d-%H%M%S')-$$.log"
REPORT_JOURNAL="$LOG_FILE.rows.jsonl"
: > "$REPORT_JOURNAL"
REPORT_DIR="${WORKTREE_GC_REPORT_DIR:-$LOG_DIR/worktree-gc}"
publish_report=0
[[ -z "$explicit_repo" && -z "$only_worktree" && "$prune_plan" -eq 0 ]] && publish_report=1
finish_run() {
  local rc=$?
  rm -f "$LOG_FILE.repo-state" "$LOG_FILE.repo-stderr" ||
    printf 'scratch cleanup failed\n' >> "$LOG_FILE"
  python3 "$SCRIPT_DIR/lib/worktree-gc-state.py" finish "$REPORT_JOURNAL" "$REPORT_DIR" "$rc" "$publish_report" ||
    printf 'report finish failed\n' >> "$LOG_FILE"
}
trap finish_run EXIT

# A path-only lane close discovers its main root read-only, then validates it.
# An explicit --repo is never replaced by --path, regardless of argument order.
if [[ -n "$only_worktree" && -z "$explicit_repo" ]]; then
  path_census="$(git -C "$only_worktree" worktree list --porcelain)" || exit 2
  explicit_repo="$(sed -n '1s/^worktree //p' <<< "$path_census")"
fi
repos=()
if [[ -n "$explicit_repo" ]]; then
  repos+=("$explicit_repo")
else
  shopt -s nullglob
  for candidate in "$HOME"/Gits/*; do
    [[ -L "$candidate" ]] && continue # Alias targets are enumerated once by their real root.
    if [[ -d "$candidate/.git" ]]; then
      repos+=("$candidate")
    fi
  done
  shopt -u nullglob
fi

if [[ "${#repos[@]}" -eq 0 ]]; then
  printf 'No Git repositories found under %s/Gits\n' "$HOME" >&2
  exit 2
fi

t3_roots="$(python3 "$SCRIPT_DIR/lib/worktree-gc-state.py" roots)"
found_unpushed=0
repo_error=0
for repo in "${repos[@]}"; do
  repo_name="$(basename "$repo")"
  # Do not put process_repo in an if/||: Bash would disable errexit inside
  # every removal gate. A subshell keeps it enabled and isolates repo state.
  repo_state="$LOG_FILE.repo-state"
  repo_stderr="$LOG_FILE.repo-stderr"
  set +e
  (
    set -e
    trap 'printf "%s %s\n" "$found_unpushed" "$only_seen" > "$repo_state"' EXIT
    process_repo "$repo"
  ) 2> "$repo_stderr"
  repo_rc=$?
  set -e
  read -r found_unpushed only_seen < "$repo_state"
  cat "$repo_stderr" >&2
  if [[ "$repo_rc" -ne 0 ]]; then
    repo_error=2
    reason="$(normalize_reason "$(cat "$repo_stderr")")"
    reason="exit $repo_rc: ${reason:-repository processing failed}"
    printf 'ERROR %s %s\n' "$repo" "$reason" | tee -a "$LOG_FILE" >&2
    python3 "$SCRIPT_DIR/lib/worktree-gc-state.py" add "$REPORT_JOURNAL" \
      "$(basename "$repo")" "$repo" "-" ERROR "$reason" ||
      printf 'ERROR report row failed: %s\n' "$repo" | tee -a "$LOG_FILE" >&2
  fi
done

[[ "$repo_error" -eq 0 ]] || exit "$repo_error"

# A lane close pastes this row into its receipt; a silent no-op would hide a wrong path.
if [[ -n "$only_worktree" && "$only_seen" -eq 0 ]]; then
  emit_row "${repo_name:-unknown}" "$only_worktree" "-" "not-checked" "not-checked" \
    "KEEP-not-a-worktree" "not a linked worktree of its repository (main checkout or subdirectory)"
  exit 2
fi

if [[ "$found_unpushed" -ne 0 ]]; then
  # 3 means a completed scan with KEEP-unpushed; any repo error exits 2 above.
  exit 3
fi
