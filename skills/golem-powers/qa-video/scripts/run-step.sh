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
# Commands retain argv; the worker owns its PID and atomic exit receipt.
worker='
  receipt=$1; lock=$2; pidfile=$3; shift 3
  # Release the lock BEFORE publishing the receipt: .exit is the final write, so a
  # reader that sees .exit never also sees a stale lock.
  trap '\''status=$?; printf "%s\n" "$status" > "$receipt.tmp"; rmdir "$lock"; mv "$receipt.tmp" "$receipt"'\'' EXIT
  trap "exit 130" INT
  trap "exit 143" TERM
  printf "%s\n" "$$" > "$pidfile"
  "$@"
'
if [[ "${RUN_STEP_FOREGROUND:-0}" == 1 ]]; then
  bash -c "$worker" bash "$LOGDIR/$STEP.exit" "$LOCK" "$LOGDIR/$STEP.pid" "$@" > "$LOGDIR/$STEP.log" 2>&1 < /dev/null
else
  # nohup alone ignores HUP but leaves the worker in the caller's process group.
  # macOS has no setsid binary; exec preserves the new session leader's PID.
  nohup perl -MPOSIX -e 'defined(POSIX::setsid()) or die "setsid: $!"; exec @ARGV; die "exec: $!"' \
    bash -c "$worker" bash "$LOGDIR/$STEP.exit" "$LOCK" "$LOGDIR/$STEP.pid" "$@" > "$LOGDIR/$STEP.log" 2>&1 < /dev/null &
  launcher=$!
  # Return only after setsid + exec + receipt traps, so caller teardown cannot
  # race the detach. A failed launcher must not strand the lock.
  until [[ -s "$LOGDIR/$STEP.pid" ]]; do
    if ! kill -0 "$launcher" 2>/dev/null; then
      rmdir "$LOCK"
      echo "run-step: worker failed to start; read $LOGDIR/$STEP.log" >&2
      exit 1
    fi
    sleep 0.01
  done
fi
printf 'run-step: %s -> %s/{%s.log,%s.pid,%s.exit}\n' "$STEP" "$LOGDIR" "$STEP" "$STEP" "$STEP"
