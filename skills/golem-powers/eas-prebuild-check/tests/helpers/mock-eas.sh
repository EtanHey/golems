#!/usr/bin/env bash
set -euo pipefail

cmd="$*"
project_dir="${PROJECT_DIR:-$PWD}"
mocks_file="$project_dir/.eas-prebuild-check.mocks"

if [[ ! -f "$mocks_file" ]]; then
  echo "Missing mocks file: $mocks_file" >&2
  exit 1
fi

if ! jq -e --arg cmd "$cmd" 'has($cmd)' "$mocks_file" >/dev/null; then
  echo "No mock registered for: $cmd" >&2
  exit 1
fi

value="$(jq -r --arg cmd "$cmd" '.[$cmd]' "$mocks_file")"

printf '%s\n' "$value"
