#!/bin/sh
# Keep the chosen interpreter isolated; Codex needs stderr with exit 2.
gate=$1
python=$2
adapter=${0%/*}/$3
shift 3
if output=$("$python" -I -B "$adapter" "$gate" "$@" 2>/dev/null); then
  printf '%s\n' "$output"
else
  printf '%s\n' "Blocked: a golems safety check couldn't run. Ask the lead to reinstall the hooks." >&2
  exit 2
fi
