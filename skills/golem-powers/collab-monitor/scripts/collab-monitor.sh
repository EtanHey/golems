#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")"
STATE_ROOT="${MONITOR_STATE_DIR:-${HOME:?HOME is required}/.local/state/collab-monitor}"
POLL_SECONDS="${POLL_SECONDS-25}"
START_TIMEOUT_SECONDS="${START_TIMEOUT_SECONDS-30}"
ACTIVE_RUN_LOCK=''
ACTIVE_PID_FILE=''
ACTIVE_READY_FILE=''
ACTIVE_READY_INSTANCE_FILE=''
ACTIVE_INSTANCE_FILE=''
ACTIVE_INSTANCE_TOKEN=''
ACTIVE_START_LOCK=''
ACTIVE_START_CHILD_PID=''
ACTIVE_START_CHILD_SETTLED=0
ACTIVE_START_PUBLISHED=0
ACTIVE_SLEEP_PID=''
ACTIVE_TAIL_PID=''
INCLUDE_SELF="${COLLAB_MONITOR_INCLUDE_SELF:-0}"
ALIASES="${COLLAB_MONITOR_ALIASES:-}"

source "$SCRIPT_DIR/monitor/options.sh"

source "$SCRIPT_DIR/monitor/state.sh"

source "$SCRIPT_DIR/monitor/locks.sh"

source "$SCRIPT_DIR/monitor/run.sh"

source "$SCRIPT_DIR/monitor/lifecycle.sh"

command="${1:-}"
[[ -n "$command" ]] || {
  usage
  exit 2
}
shift

if [[ "$command" == 'start' ]]; then
  while [[ "$#" -gt 0 ]]; do
    case "${1:-}" in
      --include-self)
        INCLUDE_SELF=1
        shift
        ;;
      --alias)
        [[ "$#" -ge 2 ]] || die 'missing --alias value'
        add_alias "$2"
        shift 2
        ;;
      *) break ;;
    esac
  done
fi

case "$command" in
  run) run_monitor "$@" ;;
  start) start_monitor "$@" ;;
  follow) follow_monitor "$@" ;;
  stop) stop_monitor "$@" ;;
  status) status_monitor "$@" ;;
  *) usage; exit 2 ;;
esac
