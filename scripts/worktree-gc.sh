#!/usr/bin/env bash
# AIDEV-NOTE: Bash character ranges follow locale collation. Keep every match
# and ordering decision bytewise so ambient UTF-8 locales cannot change verdicts.
export LC_ALL=C
# AIDEV-NOTE: status must never rewrite a worktree index: --apply judges
# activity by the index mtime, and the scan itself must not look like activity.
export GIT_OPTIONAL_LOCKS=0
set -euo pipefail

usage() {
  printf 'Usage: %s [--dry-run] [--apply] [--idle-hours <n>] [--repo <path> | --path <worktree>]\n' \
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

  # AIDEV-NOTE: Untracked files hidden by user configuration are local-only
  # data and force KEEP. Ignored files do not (Etan 2026-10-06, superseding
  # #664): they are rebuildable caches (node_modules, .venv, .build) or
  # 1Password-materialized secrets, and docs.local is archived before removal.
  git -C "$worktree_path" -c status.showUntrackedFiles=all \
    status --porcelain --untracked-files=all
}

# --- --apply (lane close + nightly prune) -----------------------------------
# AIDEV-NOTE: #664 (f68dc738) retired --apply; Etan's 2026-10-06 21:50 ruling
# ("nightly prune") revived it. #664's revival bar is met above (fresh fetch via
# an explicit refspec, ls-files -v hidden flags, submodule refusal, fail closed)
# and the runtime guards below also fail closed: a check that cannot run KEEPs.

refresh_live_cwds() {
  local out

  live_cwds=""
  if ! command -v lsof >/dev/null 2>&1; then
    live_reason="lsof unavailable; cannot prove no process uses the worktree"
    return 1
  fi
  # lsof exits 1 when it cannot inspect some processes; the rows it did read stand.
  out="$(lsof -a -d cwd -Fn 2>/dev/null || true)"
  live_cwds="$(printf '%s\n' "$out" | sed -n 's/^n//p')"
  if [[ -z "$live_cwds" ]]; then
    live_reason="lsof listed no process cwd; refusing to treat that as idle"
    return 1
  fi
}

path_has_live_cwd() {
  local worktree_path="$1"
  local cwd

  while IFS= read -r cwd; do
    [[ "$cwd" == "$worktree_path" || "$cwd" == "$worktree_path/"* ]] && return 0
  done <<< "$live_cwds"
  return 1
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

# Prints "<files> <bytes>" for a tree; symlinks count as entries, never followed.
tree_stats() {
  perl -MFile::Find -e '
    my ($n, $b) = (0, 0);
    find({ no_chdir => 1, wanted => sub {
      my @s = lstat($_) or die "lstat $_: $!\n";
      return if -d _;
      $n++; $b += $s[7];
    } }, $ARGV[0]);
    print "$n $b\n";' "$1"
}

archive_docs_local() {
  local worktree_path="$1"
  local head_sha="$2"
  local src="$worktree_path/docs.local"
  local dest
  local src_stats
  local dest_stats

  archive_dest=""
  archive_reason=""
  [[ -d "$src" && ! -L "$src" ]] || return 0
  dest="$repo_root/docs.local/worktree-archive/$(basename "$worktree_path")"
  [[ -e "$dest" ]] && dest="$dest-${head_sha:0:12}"
  if [[ -e "$dest" ]]; then
    archive_reason="docs.local archive destination already exists: $dest"
    return 1
  fi
  if ! mkdir -p "$(dirname "$dest")"; then
    archive_reason="cannot create $(dirname "$dest")"
    return 1
  fi
  # cp -c clones on APFS (no extra space); GNU cp has no -c.
  local -a cp_flags=(-Rp)
  [[ "$(uname -s)" == Darwin ]] && cp_flags=(-cRp)
  if ! cp "${cp_flags[@]}" "$src" "$dest"; then
    archive_reason="docs.local copy to $dest failed"
    return 1
  fi
  if ! src_stats="$(tree_stats "$src")" || ! dest_stats="$(tree_stats "$dest")" ||
    [[ "$src_stats" != "$dest_stats" ]]; then
    archive_reason="docs.local copy unverified (source ${src_stats:-?}, copy ${dest_stats:-?}) at $dest"
    return 1
  fi
  archive_dest="$dest (${dest_stats% *} files, ${dest_stats#* } bytes)"
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
  if path_has_live_cwd "$worktree_path"; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" \
      "KEEP-live" "a running process has its cwd inside the worktree"
    return 0
  fi
  if ! head_sha="$(git -C "$worktree_path" rev-parse HEAD)"; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" \
      "KEEP-undetermined" "cannot resolve HEAD"
    return 0
  fi
  if ! archive_docs_local "$worktree_path" "$head_sha"; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" \
      "KEEP-undetermined" "$archive_reason"
    return 0
  fi
  # Never --force: git itself refuses a tree that became unclean meanwhile.
  if ! git -C "$repo_root" worktree remove "$worktree_path"; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "0" "0" \
      "KEEP-undetermined" "git worktree remove refused"
    return 0
  fi
  removed_detail="clean and fully represented by $base_ref"
  [[ -n "$archive_dest" ]] && removed_detail="$removed_detail; docs.local archived to $archive_dest"
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

  [[ -n "$worktree_path" ]] || return 0

  canonical_worktree="$(canonical_path "$worktree_path")"
  if [[ "$canonical_worktree" == "$main_root" || "$canonical_worktree" == "$repo_root" ]]; then
    return 0
  fi
  if [[ -n "$only_worktree" && "$canonical_worktree" != "$only_worktree" ]]; then
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

  # AIDEV-NOTE: hooks-live is the pinned source of every wired hook; removing it
  # dangles them all. Kept even if someone unlocked it.
  if [[ "$canonical_worktree" == "$repo_root/.worktrees/hooks-live" ]]; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "not-checked" \
      "not-checked" "KEEP-pinned" "hook source pinned by scripts/hooks/install-hooks.sh"
    return 0
  fi

  if [[ "$canonical_worktree/" == *"/.claude/worktrees/"* ]]; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "not-checked" \
      "not-checked" "KEEP-pinned" "Claude Code manages .claude/worktrees itself"
    return 0
  fi

  if [[ -n "$locked_reason" ]]; then
    emit_row "$repo_name" "$worktree_path" "$branch_display" "not-checked" \
      "undetermined" "KEEP-undetermined" "worktree is locked: $locked_reason"
    return 0
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

  if [[ "$apply" -eq 1 ]]; then
    apply_removal "$worktree_path" "$branch_display"
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

  if ! census="$(git -C "$repo_root" worktree list --porcelain)"; then
    printf 'Could not list worktrees for %s\n' "$repo_root" >&2
    return 2
  fi
  # The first census block is always the main working tree, even when the
  # request named a linked worktree. Archives and removals anchor on it.
  main_root="$(canonical_path "$(sed -n '1s/^worktree //p' <<< "$census")")"
  repo_root="$main_root"
  repo_name="$(basename "$repo_root")"
  census_paths="$(sed -n 's/^worktree //p' <<< "$census")"

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
  if [[ "$apply" -eq 1 ]]; then
    git -C "$repo_root" worktree prune || true
  fi
}

explicit_repo=""
only_worktree=""
apply=0
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
      only_worktree="$(canonical_path "$2")"
      explicit_repo="$2"
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/portable-stat.sh
source "$SCRIPT_DIR/lib/portable-stat.sh"
idle_seconds=$((idle_hours * 3600))
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
