#!/usr/bin/env bash

set -u

readonly PASS_REASON="instruction-file shape conforms"
readonly IMPORT_LINE="@AGENTS.md"

usage() {
  printf 'Usage: %s [--repo <path> | <path> ...]\n' "${0##*/}" >&2
}

fail_row() {
  local repo="$1"
  local reason="$2"

  printf 'FAIL %s — %s\n' "$repo" "$reason"
  return 1
}

check_repo() {
  local requested_repo="$1"
  local repo
  local first_nonblank

  if ! repo="$(git -C "$requested_repo" rev-parse --show-toplevel 2>/dev/null)"; then
    fail_row "$requested_repo" "not a Git repository"
    return
  fi

  if [ -L "$repo/AGENTS.md" ]; then
    fail_row "$repo" "AGENTS.md is a symlink"
    return
  fi

  if [ ! -e "$repo/AGENTS.md" ]; then
    fail_row "$repo" "AGENTS.md is missing"
    return
  fi

  if [ ! -f "$repo/AGENTS.md" ]; then
    fail_row "$repo" "AGENTS.md is not a regular file"
    return
  fi

  if ! awk 'NF { found = 1; exit } END { exit !found }' "$repo/AGENTS.md"; then
    fail_row "$repo" "AGENTS.md is empty"
    return
  fi

  if ! git -C "$repo" ls-files --error-unmatch -- AGENTS.md >/dev/null 2>&1; then
    fail_row "$repo" "AGENTS.md is untracked"
    return
  fi

  if git -C "$repo" check-ignore --no-index -q -- AGENTS.md; then
    fail_row "$repo" "AGENTS.md is gitignored"
    return
  fi

  if [ -L "$repo/CLAUDE.md" ]; then
    fail_row "$repo" "CLAUDE.md is a symlink"
    return
  fi

  if [ -e "$repo/CLAUDE.md" ]; then
    first_nonblank="$(awk 'NF { print; exit }' "$repo/CLAUDE.md")"
    if [ "$first_nonblank" != "$IMPORT_LINE" ]; then
      fail_row "$repo" "CLAUDE.md first nonblank line must be exactly @AGENTS.md"
      return
    fi
  fi

  printf 'PASS %s — %s\n' "$repo" "$PASS_REASON"
}

discover_repos() {
  local gits_root="$HOME/Gits"
  local candidate
  local repo
  local seen_repos=$'\n'

  [ -d "$gits_root" ] || return 0

  while IFS= read -r candidate; do
    repo="$(git -C "$candidate" rev-parse --show-toplevel 2>/dev/null)" || continue
    case "$seen_repos" in
      *$'\n'"$repo"$'\n'*) continue ;;
    esac
    printf '%s\n' "$repo"
    seen_repos="${seen_repos}${repo}"$'\n'
  done < <(find "$gits_root" -mindepth 1 -maxdepth 1 -type d -print | LC_ALL=C sort)
}

main() {
  local -a repos=()
  local repo
  local repo_count=0
  local status=0

  if [ "$#" -eq 0 ]; then
    while IFS= read -r repo; do
      repos+=("$repo")
      repo_count=$((repo_count + 1))
    done < <(discover_repos)
  else
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --repo)
          if [ "$#" -lt 2 ]; then
            usage
            return 2
          fi
          repos+=("$2")
          repo_count=$((repo_count + 1))
          shift 2
          ;;
        --*)
          usage
          return 2
          ;;
        *)
          repos+=("$1")
          repo_count=$((repo_count + 1))
          shift
          ;;
      esac
    done
  fi

  if [ "$repo_count" -eq 0 ]; then
    printf 'No Git repositories found under %s\n' "$HOME/Gits" >&2
    return 2
  fi

  for repo in "${repos[@]}"; do
    if ! check_repo "$repo"; then
      status=1
    fi
  done

  return "$status"
}

main "$@"
