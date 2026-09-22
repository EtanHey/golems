#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
monitor="$script_dir/../scripts/collab-monitor.sh"
case_dir="$(mktemp -d)"
pid=''
cleanup() {
  if [[ -n "$pid" ]]; then
    kill "$pid" 2>/dev/null || true
  fi
  rm -rf "$case_dir"
}
trap cleanup EXIT

: > "$case_dir/collab.md"
printf 'set -m\n' > "$case_dir/bash-env"
MONITOR_STATE_DIR="$case_dir/state" POLL_SECONDS=1 /bin/sh -c '
  BASH_ENV="$5" MONITOR_STATE_DIR="$1" POLL_SECONDS=1 /bin/bash "$2" start @detach "$3" > "$4" 2>&1
' sh "$case_dir/state" "$monitor" "$case_dir/collab.md" "$case_dir/start.out" "$case_dir/bash-env"

pid="$(sed -n '1p' "$case_dir/state/detach/monitor.pid")"
[[ "$pid" =~ ^[0-9]+$ ]] || { cat "$case_dir/start.out"; exit 1; }
MONITOR_STATE_DIR="$case_dir/state" /bin/bash "$monitor" status @detach > "$case_dir/status.out"
pgid="$(ps -p "$pid" -o pgid= | tr -d '[:space:]')"
[[ "$pgid" == "$pid" ]] || {
  printf 'monitor remained in launching shell process group: pid=%s pgid=%s\n' "$pid" "$pgid" >&2
  exit 1
}
MONITOR_STATE_DIR="$case_dir/state" /bin/bash "$monitor" stop @detach > "$case_dir/stop.out"
pid=''
printf 'ok detached monitor survives launching shell exit with own process group\n'
