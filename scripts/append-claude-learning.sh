#!/usr/bin/env bash
set -euo pipefail

target=${TARGET_FILE:-}
learning_entry=${LEARNING_ENTRY:-}

[[ -n $target ]] || {
  printf 'TARGET_FILE is required\n' >&2
  exit 2
}
[[ -n $learning_entry ]] || {
  printf 'LEARNING_ENTRY is required\n' >&2
  exit 2
}

if [[ ! -f $target ]]; then
  target=CLAUDE.md
fi

if ! grep -q '## Learned Mistakes' "$target"; then
  printf '\n---\n\n## Learned Mistakes\n\n' >> "$target"
fi

printf '%s\n' "$learning_entry" >> "$target"
