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

cleanup_follow() {
  if [[ -n "$ACTIVE_TAIL_PID" ]]; then
    kill "$ACTIVE_TAIL_PID" 2>/dev/null || true
    wait "$ACTIVE_TAIL_PID" 2>/dev/null || true
    ACTIVE_TAIL_PID=''
  fi
}

extract_events() {
  local watched_file="$1"
  local bare_name="$2"

  # AIDEV-NOTE: bounded-filter rule (Etan, 2026-09-25). An event is (a) a word-bounded @<name> on any
  # non-signature line, (b) a heading whose arrow recipient is <name> (bare or @), (c) a DONE/BLOCKED
  # line from <name>-wN/-rN, where <name> is the listen name or an --alias; never a self-authored block.
  LC_ALL=C awk -v bare="$bare_name" -v aliases="$ALIASES" -f "$SCRIPT_DIR/monitor/routing.awk" "$watched_file"
}

print_contract() {
  local listen_name="$1"
  local state_dir="$2"
  local file_count="$3"

  printf 'MONITOR-ARMED name=%s files=%s state=%s\n' "$listen_name" "$file_count" "$state_dir"
  printf '%s\n' 'WILL-NOT-CATCH :: same-size rewrites; growth rewrites may look like appends; events outside anchored tag routing; an unclosed trailing direct message in a block without a recognizable header author is held until a signature or later heading; inbound direct mail nested in a self-authored block remains self-classified unless a recognized foreign signature closes it; a self signature under a foreign-authored header (that block was already emitted); a Codex seat on the Participation Law background tail, which drops only self blocks and is unbounded; process death without a supervisor; worker completion visible only in an agent registry'
}

interruptible_sleep() {
  sleep "$POLL_SECONDS" &
  ACTIVE_SLEEP_PID=$!
  wait "$ACTIVE_SLEEP_PID" || true
  ACTIVE_SLEEP_PID=''
}

run_monitor() {
  local once=0
  local listen_name bare_name state_dir seen_file run_lock watched_file pid_file ready_file ready_instance_file instance_file poll_failed instance_token='' existing_size_file

  validate_poll_seconds
  while [[ "$#" -gt 0 ]]; do
    case "${1:-}" in
      --once)
        once=1
        shift
        ;;
      --include-self)
        INCLUDE_SELF=1
        shift
        ;;
      --alias)
        [[ "$#" -ge 2 ]] || die 'missing --alias value'
        add_alias "$2"
        shift 2
        ;;
      --instance)
        [[ "$#" -ge 2 ]] || die 'missing --instance value'
        instance_token="$2"
        valid_instance_token "$instance_token" || die 'invalid monitor instance token'
        shift 2
        ;;
      *) break ;;
    esac
  done
  [[ "$#" -ge 2 ]] || {
    usage
    exit 2
  }
  listen_name="$1"
  shift
  bare_name="$(normalize_name "$listen_name")"
  if [[ "${COLLAB_MONITOR_MANAGED:-0}" != '1' ]]; then
    ensure_files "$@"
  elif [[ -z "$instance_token" ]]; then
    die 'managed monitor requires an instance token'
  fi

  state_dir="$STATE_ROOT/$bare_name"
  seen_file="$state_dir/seen.sha256"
  run_lock="$state_dir/run.lock"
  pid_file="$state_dir/monitor.pid"
  ready_file="$state_dir/ready.pid"
  ready_instance_file="$state_dir/ready.instance"
  instance_file="$state_dir/monitor.instance"
  umask 077
  mkdir -p "$state_dir/sizes"
  if [[ ! -e "$seen_file" ]]; then
    existing_size_file="$(find "$state_dir/sizes" -type f -name '*.size' -print -quit 2>/dev/null || true)"
    if [[ -n "$existing_size_file" ]]; then
      printf 'WATCH-WARN file=%s reason=state-failed action=retry\n' "$seen_file" >&2
      exit 1
    fi
    if ! : > "$seen_file"; then
      printf 'WATCH-WARN file=%s reason=state-failed action=retry\n' "$seen_file" >&2
      exit 1
    fi
  elif [[ ! -f "$seen_file" || ! -r "$seen_file" ]]; then
    printf 'WATCH-WARN file=%s reason=state-failed action=retry\n' "$seen_file" >&2
    exit 1
  fi

  if ! acquire_directory_lock "$run_lock" "$listen_name" "$instance_token"; then
    printf 'MONITOR-BUSY name=%s\n' "$listen_name" >&2
    exit 1
  fi
  ACTIVE_RUN_LOCK="$run_lock"
  ACTIVE_PID_FILE="$pid_file"
  ACTIVE_READY_FILE="$ready_file"
  ACTIVE_READY_INSTANCE_FILE="$ready_instance_file"
  ACTIVE_INSTANCE_FILE="$instance_file"
  ACTIVE_INSTANCE_TOKEN="$instance_token"
  trap cleanup_run_lock EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  print_contract "$listen_name" "$state_dir" "$#"
  while true; do
    poll_failed=0
    for watched_file in "$@"; do
      if ! scan_file "$watched_file" "$listen_name" "$bare_name" "$state_dir" "$seen_file"; then
        poll_failed=1
      fi
    done
    if [[ "$poll_failed" -eq 0 && "${COLLAB_MONITOR_MANAGED:-0}" == '1' && ! -f "$ready_file" ]]; then
      if ! atomic_write_line "$ready_file" "$$" || ! atomic_write_line "$ready_instance_file" "$instance_token"; then
        rm -f "$ready_file" "$ready_instance_file"
        printf 'WATCH-WARN file=%s reason=state-failed action=retry\n' "$state_dir" >&2
        poll_failed=1
      fi
    fi
    if [[ "$once" -ne 0 ]]; then
      [[ "$poll_failed" -eq 0 ]] || exit 1
      break
    fi
    if [[ "$poll_failed" -ne 0 && "${COLLAB_MONITOR_MANAGED:-0}" == '1' && ! -f "$ready_file" ]]; then
      sleep 0.1
      continue
    fi
    interruptible_sleep
  done
}

start_monitor() {
  local listen_name bare_name state_dir start_lock pid_file ready_file ready_instance_file instance_file log_file existing_pid existing_instance child_pid index lock_owner ready_owner ready_instance temporary instance_token instance_material start_wait_iterations

  validate_poll_seconds
  validate_start_timeout_seconds
  [[ "$#" -ge 2 ]] || {
    usage
    exit 2
  }
  listen_name="$1"
  shift
  bare_name="$(normalize_name "$listen_name")"
  ensure_files "$@"
  state_dir="$STATE_ROOT/$bare_name"
  start_lock="$state_dir/start.lock"
  pid_file="$state_dir/monitor.pid"
  ready_file="$state_dir/ready.pid"
  ready_instance_file="$state_dir/ready.instance"
  instance_file="$state_dir/monitor.instance"
  log_file="$state_dir/monitor.log"
  umask 077
  mkdir -p "$state_dir"

  if ! acquire_start_lock "$start_lock"; then
    printf 'START-BUSY name=%s\n' "$listen_name" >&2
    exit 1
  fi
  ACTIVE_START_LOCK="$start_lock"
  trap cleanup_start_lock EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  existing_pid=''
  existing_instance=''
  if [[ -f "$pid_file" ]]; then
    existing_pid="$(sed -n '1p' "$pid_file")"
  fi
  if [[ -f "$instance_file" ]]; then
    existing_instance="$(sed -n '1p' "$instance_file")"
  fi
  if process_is_monitor "$existing_pid" "$listen_name" "$existing_instance"; then
    printf 'ALREADY_RUNNING name=%s pid=%s\n' "$listen_name" "$existing_pid" >&2
    exit 1
  fi
  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null && ! process_is_zombie "$existing_pid"; then
    printf 'STATE_CONFLICT name=%s pid=%s action=not-started state=preserved\n' "$listen_name" "$existing_pid" >&2
    exit 1
  fi
  rm -f "$pid_file" "$ready_file" "$ready_instance_file" "$instance_file"
  : > "$log_file"

  instance_material="$STATE_ROOT/$bare_name:$$:$RANDOM:$RANDOM:$(date +%s)"
  if ! instance_token="$(hash_text "$instance_material")"; then
    printf 'START_FAILED name=%s reason=hash-failed log=%s\n' "$listen_name" "$log_file" >&2
    exit 1
  fi

  # macOS has no setsid binary. Perl starts a new session, then exec keeps $!
  # equal to the monitor PID checked and published below.
  # Disable Bash job control so the background child is not already a group
  # leader (setsid would fail with EPERM). This start script exits afterward.
  set +m
  nohup perl -MPOSIX=setsid -e 'setsid() >= 0 or die $!; exec @ARGV or die $!' env MONITOR_STATE_DIR="$STATE_ROOT" POLL_SECONDS="$POLL_SECONDS" COLLAB_MONITOR_MANAGED=1 COLLAB_MONITOR_INCLUDE_SELF="$INCLUDE_SELF" COLLAB_MONITOR_ALIASES="$ALIASES" /bin/bash "$SCRIPT_PATH" run --instance "$instance_token" "$listen_name" "$@" >> "$log_file" 2>&1 < /dev/null &
  child_pid=$!
  ACTIVE_START_CHILD_PID="$child_pid"

  start_wait_iterations=$((START_TIMEOUT_SECONDS * 10))
  index=0
  while [[ "$index" -lt "$start_wait_iterations" ]]; do
    kill -0 "$child_pid" 2>/dev/null || break
    lock_owner=''
    ready_owner=''
    ready_instance=''
    if [[ -f "$state_dir/run.lock/owner.pid" ]]; then
      lock_owner="$(sed -n '1p' "$state_dir/run.lock/owner.pid")"
    fi
    if [[ -f "$ready_file" ]]; then
      ready_owner="$(sed -n '1p' "$ready_file")"
    fi
    if [[ -f "$ready_instance_file" ]]; then
      ready_instance="$(sed -n '1p' "$ready_instance_file")"
    fi
    [[ "$lock_owner" != "$child_pid" || "$ready_owner" != "$child_pid" || "$ready_instance" != "$instance_token" ]] || break
    sleep 0.1
    index=$((index + 1))
  done

  if ! process_is_monitor "$child_pid" "$listen_name" "$instance_token" || [[ "${lock_owner:-}" != "$child_pid" ]] || [[ "${ready_owner:-}" != "$child_pid" ]] || [[ "${ready_instance:-}" != "$instance_token" ]]; then
    kill "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
    ACTIVE_START_CHILD_PID=''
    ACTIVE_START_CHILD_SETTLED=1
    rm -f "$ready_file" "$ready_instance_file"
    printf 'START_FAILED name=%s log=%s\n' "$listen_name" "$log_file" >&2
    exit 1
  fi

  temporary="${pid_file}.tmp.$$"
  atomic_write_line "$instance_file" "$instance_token"
  printf '%s\n' "$child_pid" > "$temporary"
  mv "$temporary" "$pid_file"
  ACTIVE_START_PUBLISHED=1
  ACTIVE_START_CHILD_PID=''
  ACTIVE_START_CHILD_SETTLED=1
  printf 'STARTED name=%s pid=%s log=%s\n' "$listen_name" "$child_pid" "$log_file"
}

follow_monitor() {
  local listen_name bare_name state_dir pid_file instance_file log_file pid instance_token

  [[ "$#" -eq 1 ]] || {
    usage
    exit 2
  }
  listen_name="$1"
  bare_name="$(normalize_name "$listen_name")"
  state_dir="$STATE_ROOT/$bare_name"
  pid_file="$state_dir/monitor.pid"
  instance_file="$state_dir/monitor.instance"
  log_file="$state_dir/monitor.log"
  [[ -f "$pid_file" && -f "$instance_file" && -f "$log_file" ]] || {
    printf 'NOT_RUNNING name=%s\n' "$listen_name" >&2
    exit 1
  }
  pid="$(sed -n '1p' "$pid_file")"
  instance_token="$(sed -n '1p' "$instance_file")"
  if ! process_is_monitor "$pid" "$listen_name" "$instance_token"; then
    printf 'STALE_PID name=%s pid=%s\n' "$listen_name" "$pid" >&2
    exit 1
  fi

  printf 'FOLLOWING name=%s pid=%s log=%s\n' "$listen_name" "$pid" "$log_file"
  tail -n +1 -f "$log_file" &
  ACTIVE_TAIL_PID=$!
  trap cleanup_follow EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  while process_is_monitor "$pid" "$listen_name" "$instance_token"; do
    kill -0 "$ACTIVE_TAIL_PID" 2>/dev/null || die "log follower exited: $log_file"
    sleep 1
  done
  sleep 0.2
}

status_monitor() {
  local listen_name bare_name state_dir pid_file instance_file pid instance_token

  [[ "$#" -eq 1 ]] || {
    usage
    exit 2
  }
  listen_name="$1"
  bare_name="$(normalize_name "$listen_name")"
  state_dir="$STATE_ROOT/$bare_name"
  pid_file="$state_dir/monitor.pid"
  instance_file="$state_dir/monitor.instance"
  [[ -f "$pid_file" && -f "$instance_file" ]] || {
    printf 'NOT_RUNNING name=%s\n' "$listen_name" >&2
    exit 1
  }
  pid="$(sed -n '1p' "$pid_file")"
  instance_token="$(sed -n '1p' "$instance_file")"
  if ! process_is_monitor "$pid" "$listen_name" "$instance_token"; then
    printf 'STALE_PID name=%s pid=%s\n' "$listen_name" "$pid" >&2
    exit 1
  fi
  printf 'RUNNING name=%s pid=%s\n' "$listen_name" "$pid"
}

stop_monitor() {
  local listen_name bare_name state_dir pid_file ready_file ready_instance_file instance_file pid instance_token index

  [[ "$#" -eq 1 ]] || {
    usage
    exit 2
  }
  listen_name="$1"
  bare_name="$(normalize_name "$listen_name")"
  state_dir="$STATE_ROOT/$bare_name"
  pid_file="$state_dir/monitor.pid"
  ready_file="$state_dir/ready.pid"
  ready_instance_file="$state_dir/ready.instance"
  instance_file="$state_dir/monitor.instance"
  [[ -f "$pid_file" && -f "$instance_file" ]] || {
    printf 'NOT_RUNNING name=%s\n' "$listen_name" >&2
    exit 1
  }
  pid="$(sed -n '1p' "$pid_file")"
  instance_token="$(sed -n '1p' "$instance_file")"
  if process_is_zombie "$pid"; then
    rm -f "$pid_file" "$ready_file" "$ready_instance_file" "$instance_file"
    printf 'STOPPED name=%s pid=%s state=zombie\n' "$listen_name" "$pid"
    exit 0
  fi
  if ! process_is_monitor "$pid" "$listen_name" "$instance_token"; then
    if kill -0 "$pid" 2>/dev/null; then
      printf 'STATE_CONFLICT name=%s pid=%s action=not-signaled state=preserved\n' "$listen_name" "$pid" >&2
    else
      rm -f "$pid_file" "$ready_file" "$ready_instance_file" "$instance_file"
      printf 'STALE_PID name=%s pid=%s action=not-signaled state=cleaned\n' "$listen_name" "$pid" >&2
    fi
    exit 1
  fi

  kill "$pid"
  index=0
  while kill -0 "$pid" 2>/dev/null && ! process_is_zombie "$pid" && [[ "$index" -lt 50 ]]; do
    sleep 0.1
    index=$((index + 1))
  done
  if kill -0 "$pid" 2>/dev/null && ! process_is_zombie "$pid"; then
    printf 'STOP_TIMEOUT name=%s pid=%s\n' "$listen_name" "$pid" >&2
    exit 1
  fi
  rm -f "$pid_file" "$ready_file" "$ready_instance_file" "$instance_file"
  printf 'STOPPED name=%s pid=%s\n' "$listen_name" "$pid"
}

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
