# Source-only detached start, follow, status, and stop lifecycle.

cleanup_follow() {
  if [[ -n "$ACTIVE_TAIL_PID" ]]; then
    kill "$ACTIVE_TAIL_PID" 2>/dev/null || true
    wait "$ACTIVE_TAIL_PID" 2>/dev/null || true
    ACTIVE_TAIL_PID=''
  fi
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
