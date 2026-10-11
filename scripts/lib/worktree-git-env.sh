#!/usr/bin/env bash
# Clear hook-exported repository redirects before asking Git for its local set.
# Keep caller GLOBAL/SYSTEM configuration; never eval environment names.
golems_scrub_git_env() {
  local name names
  for name in GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY \
    GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_GRAFT_FILE GIT_SHALLOW_FILE GIT_REPLACE_REF_BASE \
    GIT_IMPLICIT_WORK_TREE GIT_PREFIX GIT_INTERNAL_SUPER_PREFIX GIT_CONFIG \
    GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT; do
    unset "$name" || return 2
  done
  names="$(git rev-parse --local-env-vars)" || return 2
  while IFS= read -r name; do
    [[ "$name" =~ ^GIT_[A-Z0-9_]+$ ]] || return 2
    unset "$name" || return 2
  done <<< "$names"
}
golems_scrub_git_env || { echo 'worktree-gc: cannot scrub Git local environment' >&2; exit 2; }

# Linked roots and symlink paths must not widen into their common main repo.
golems_main_repo() {
  local candidate="$1" physical logical top admin common
  physical="$(cd "$candidate" && pwd -P)" || return 2
  logical="$(cd "$candidate" && pwd -L)" || return 2
  [[ "$physical" == "$logical" && ! -L "${candidate%/}" ]] || return 2
  top="$(git -C "$physical" rev-parse --show-toplevel 2>/dev/null)" || return 2
  [[ "$physical" == "$(cd "$top" && pwd -P)" ]] || return 2
  admin="$(git -C "$physical" rev-parse --absolute-git-dir)" || return 2
  common="$(git -C "$physical" rev-parse --git-common-dir)" || return 2
  [[ "$common" == /* ]] || common="$physical/$common"
  [[ "$(cd "$admin" && pwd -P)" == "$(cd "$common" && pwd -P)" ]] || return 2
  printf '%s\n' "$physical"
}
