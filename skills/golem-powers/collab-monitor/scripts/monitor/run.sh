# Source-only event extraction and polling loop.

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
