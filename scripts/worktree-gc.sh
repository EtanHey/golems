#!/usr/bin/env bash
# AIDEV-NOTE: Bash character ranges follow locale collation. Keep every match
# and ordering decision bytewise so ambient UTF-8 locales cannot change verdicts.
export LC_ALL=C
set -euo pipefail

usage() {
  printf 'Usage: %s [--dry-run] [--repo <path>]\n' "$(basename "$0")"
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
  printf '%s\n' "$row"
  printf '%s\n' "$row" >> "$LOG_FILE"
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

  # AIDEV-NOTE: Ignored files and untracked files hidden by user configuration
  # are both local-only data. Either must force a KEEP verdict.
  git -C "$worktree_path" -c status.showUntrackedFiles=all \
    status --porcelain --ignored --untracked-files=all
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

  [[ -n "$worktree_path" ]] || return 0

  canonical_worktree="$(canonical_path "$worktree_path")"
  if [[ "$canonical_worktree" == "$repo_root" ]]; then
    return 0
  fi

  if is_tool_managed_worktree "$repo_root" "$canonical_worktree"; then
    return 0
  fi

  if [[ -n "$branch_ref" ]]; then
    branch_display="${branch_ref#refs/heads/}"
  else
    branch_display="(detached)"
  fi

  if [[ -n "$locked_reason" ]]; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "not-checked" \
      "undetermined" "KEEP-undetermined" "worktree is locked: $locked_reason"
    return 0
  fi

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
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" \
      "$ahead" "KEEP-unpushed" "$ahead commit(s) absent from $base_ref"
    found_unpushed=1
    return 0
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
  if [[ "$ahead" -ne 0 ]]; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" \
      "$ahead" "KEEP-unpushed" "$ahead commit(s) absent from freshly revalidated $base_ref"
    found_unpushed=1
    return 0
  fi

  emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" \
    "REMOVE" "eligible; report only; clean and fully represented by $base_ref"
}

process_repo() {
  local requested_repo="$1"
  local census
  local line

  if ! repo_root="$(git -C "$requested_repo" rev-parse --show-toplevel 2>/dev/null)"; then
    printf 'Not a Git repository: %s\n' "$requested_repo" >&2
    return 2
  fi
  repo_root="$(canonical_path "$repo_root")"
  repo_name="$(basename "$repo_root")"

  if ! census="$(git -C "$repo_root" worktree list --porcelain)"; then
    printf 'Could not list worktrees for %s\n' "$repo_root" >&2
    return 2
  fi

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
}

explicit_repo=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      shift
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
LOG_DIR="$SCRIPT_DIR/../docs.local"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/worktree-gc-$(date '+%Y%m%d-%H%M%S')-$$.log"

repos=()
if [[ -n "$explicit_repo" ]]; then
  repos+=("$explicit_repo")
else
  shopt -s nullglob
  for candidate in "$HOME"/Gits/*; do
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

found_unpushed=0
for repo in "${repos[@]}"; do
  process_repo "$repo"
done

if [[ "$found_unpushed" -ne 0 ]]; then
  exit 1
fi
