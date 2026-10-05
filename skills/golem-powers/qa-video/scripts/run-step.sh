#!/usr/bin/env bash
# Start ONE media step in the caller's own shell; portable agy/Claude receipts.
set -euo pipefail
[[ $# -ge 4 && "$3" == -- ]] || { echo 'usage: run-step.sh <artifact-dir> <step> -- <command> [args...]' >&2; exit 2; }
ARTIFACT="$1"; STEP="$2"; shift 3
[[ "$STEP" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]] || { echo 'run-step: invalid step name' >&2; exit 2; }
mkdir -p "$ARTIFACT/logs"
LOGDIR="$(cd "$ARTIFACT/logs" && pwd -P)"
LOCK="$LOGDIR/$STEP.lock"
mkdir "$LOCK" 2>/dev/null || { echo "run-step: already running: $STEP" >&2; exit 1; }
rm -f "$LOGDIR/$STEP.exit" "$LOGDIR/$STEP.exit.tmp" "$LOGDIR/$STEP.pid"
# nohup keeps the helper alive after run_command returns. Commands retain argv;
# no interpolated command string, terminal surface, or status-tool dependency.
nohup bash -c '
  receipt=$1; lock=$2; shift 2
  trap '\''status=$?; printf "%s\n" "$status" > "$receipt.tmp"; mv "$receipt.tmp" "$receipt"; rmdir "$lock"'\'' EXIT
  trap "exit 130" INT
  trap "exit 143" TERM
  "$@"
' bash "$LOGDIR/$STEP.exit" "$LOCK" "$@" > "$LOGDIR/$STEP.log" 2>&1 < /dev/null &
printf '%s\n' "$!" > "$LOGDIR/$STEP.pid"
printf 'run-step: %s -> %s/{%s.log,%s.pid,%s.exit}\n' "$STEP" "$LOGDIR" "$STEP" "$STEP" "$STEP"
