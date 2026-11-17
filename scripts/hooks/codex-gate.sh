#!/bin/sh
# Keep the chosen interpreter isolated; Codex needs stderr with exit 2.
gate=$1
python=$2
adapter=${0%/*}/$3
shift 3
if output=$("$python" -I -B "$adapter" "$gate" "$@" 2>/dev/null); then
  printf '%s\n' "$output"
else
  if [ "$gate" = permission-request ]; then
    # PermissionRequest must deny even if Python or the adapter cannot start.
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"Blocked: this command needs a person and this session runs unattended. Delete one named file at a time, or leave scratch and list it for your lead. A safety check could not run; ask the lead to reinstall the hooks."}}}'
    exit 0
  fi
  printf '%s\n' "Blocked: a golems safety check couldn't run. Ask the lead to reinstall the hooks." >&2
  exit 2
fi
