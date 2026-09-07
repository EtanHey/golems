#!/usr/bin/env bash

set -uo pipefail

usage() {
  printf 'Usage: %s [--skills-root DIR]\n' "${0##*/}"
}

skills_root="${HOME}/.claude/skills"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skills-root)
      [[ $# -ge 2 ]] || { printf 'ERROR: --skills-root requires a directory\n' >&2; exit 2; }
      skills_root="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'ERROR: unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! -d "$skills_root" ]]; then
  printf 'ERROR: skill catalog not found: %s\n' "$skills_root" >&2
  exit 2
fi

scan_entries() {
  local offenders=0 entry name
  while IFS= read -r -d '' entry; do
    name="${entry##*/}"
    if [[ -L "$entry" && ! -e "$entry" ]]; then
      printf 'ERROR broken symlink: %s\n' "$name" >&2
      offenders=$((offenders + 1))
    elif [[ "$name" == .* && -d "$entry" ]]; then
      printf 'ERROR dotted directory: %s\n' "$name" >&2
      offenders=$((offenders + 1))
    fi
  done

  if [[ "$offenders" -gt 0 ]]; then
    printf 'skill catalog dirty: %d invalid entries can duplicate or invalidate loaded skills and inflate every Claude Code boot\n' "$offenders" >&2
    return 1
  fi
}

find "$skills_root" -mindepth 1 -maxdepth 1 -print0 | scan_entries
scan_statuses=("${PIPESTATUS[@]}")
if [[ "${scan_statuses[0]}" -ne 0 ]]; then
  printf 'ERROR: could not inspect skill catalog: %s\n' "$skills_root" >&2
  exit 2
fi
if [[ "${scan_statuses[1]}" -ne 0 ]]; then
  exit 1
fi

printf 'skill catalog clean: %s\n' "$skills_root"
