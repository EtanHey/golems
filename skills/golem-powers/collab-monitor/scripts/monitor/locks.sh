# shellcheck shell=bash
# Source-only monitor ownership, PID identity, and lock helpers.

valid_instance_token() {
  local instance_token="$1"

  [[ "${#instance_token}" -eq 64 ]] || return 1
  case "$instance_token" in
    *[!0-9a-f]*) return 1 ;;
    *) return 0 ;;
  esac
}

process_is_monitor() {
  local pid="$1"
  local listen_name="$2"
  local instance_token="${3:-}"
  local command_line

  case "$pid" in
    ''|*[!0-9]*) return 1 ;;
  esac
  kill -0 "$pid" 2>/dev/null || return 1
  process_is_zombie "$pid" && return 1
  command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  if [[ -n "$instance_token" ]]; then
    valid_instance_token "$instance_token" || return 1
    case "$command_line" in
      *"/collab-monitor.sh"*" run --instance $instance_token $listen_name "*|*"/collab-monitor.sh"*" run --instance $instance_token --owner-pid "*" $listen_name "*) return 0 ;;
      *) return 1 ;;
    esac
  fi
  case "$command_line" in
    *"/collab-monitor.sh"*" run "*"$listen_name "*) return 0 ;;
    *) return 1 ;;
  esac
}

process_is_zombie() {
  local pid="$1"
  local process_state

  process_state="$(ps -p "$pid" -o stat= 2>/dev/null | awk '{ print $1 }')"
  case "$process_state" in
    Z*) return 0 ;;
    *) return 1 ;;
  esac
}

acquire_directory_lock() {
  local lock_dir="$1"
  local listen_name="$2"
  local instance_token="${3:-}"
  local owner_file="$lock_dir/owner.pid"
  local owner_instance_file="$lock_dir/owner.instance"
  local owner_pid='' owner_instance=''

  if mkdir "$lock_dir" 2>/dev/null; then
    if ! atomic_write_line "$owner_file" "$$"; then
      rm -rf "$lock_dir"
      return 1
    fi
    if [[ -n "$instance_token" ]]; then
      if ! atomic_write_line "$owner_instance_file" "$instance_token"; then
        rm -rf "$lock_dir"
        return 1
      fi
    fi
    return 0
  fi

  if [[ -f "$owner_file" ]]; then
    owner_pid="$(sed -n '1p' "$owner_file")"
  fi
  if [[ -f "$owner_instance_file" ]]; then
    owner_instance="$(sed -n '1p' "$owner_instance_file")"
  fi
  if process_is_monitor "$owner_pid" "$listen_name" "$owner_instance"; then
    return 1
  fi

  rm -rf "$lock_dir"
  if mkdir "$lock_dir" 2>/dev/null; then
    if ! atomic_write_line "$owner_file" "$$"; then
      rm -rf "$lock_dir"
      return 1
    fi
    if [[ -n "$instance_token" ]]; then
      if ! atomic_write_line "$owner_instance_file" "$instance_token"; then
        rm -rf "$lock_dir"
        return 1
      fi
    fi
    return 0
  fi
  return 1
}

acquire_start_lock() {
  local lock_dir="$1"
  local owner_file="$lock_dir/owner.pid"
  local owner_pid=''

  if mkdir "$lock_dir" 2>/dev/null; then
    if ! atomic_write_line "$owner_file" "$$"; then
      rm -rf "$lock_dir"
      return 1
    fi
    return 0
  fi
  # An ownerless start lock may be between mkdir and PID publication.
  # Preserve unknown ownership rather than racing its creator.
  [[ -f "$owner_file" ]] || return 1
  owner_pid="$(sed -n '1p' "$owner_file")"
  case "$owner_pid" in
    ''|*[!0-9]*) ;;
    *) kill -0 "$owner_pid" 2>/dev/null && return 1 ;;
  esac

  rm -rf "$lock_dir"
  if mkdir "$lock_dir" 2>/dev/null; then
    if ! atomic_write_line "$owner_file" "$$"; then
      rm -rf "$lock_dir"
      return 1
    fi
    return 0
  fi
  return 1
}

release_directory_lock() {
  local lock_dir="$1"
  local owner_file="$lock_dir/owner.pid"
  local owner_pid=''

  if [[ -f "$owner_file" ]]; then
    owner_pid="$(sed -n '1p' "$owner_file")"
  fi
  if [[ "$owner_pid" == "$$" ]]; then
    rm -rf "$lock_dir"
  fi
}

cleanup_run_lock() {
  local pid_value='' ready_value='' instance_value='' ready_instance_value=''

  if [[ -n "$ACTIVE_SLEEP_PID" ]]; then
    kill "$ACTIVE_SLEEP_PID" 2>/dev/null || true
    wait "$ACTIVE_SLEEP_PID" 2>/dev/null || true
    ACTIVE_SLEEP_PID=''
  fi
  if [[ -n "$ACTIVE_RUN_LOCK" ]]; then
    release_directory_lock "$ACTIVE_RUN_LOCK"
  fi
  if [[ "${COLLAB_MONITOR_MANAGED:-0}" == '1' && -n "$ACTIVE_PID_FILE" && -f "$ACTIVE_PID_FILE" ]]; then
    pid_value="$(sed -n '1p' "$ACTIVE_PID_FILE")"
    [[ "$pid_value" != "$$" ]] || rm -f "$ACTIVE_PID_FILE"
  fi
  if [[ "${COLLAB_MONITOR_MANAGED:-0}" == '1' && -n "$ACTIVE_INSTANCE_FILE" && -f "$ACTIVE_INSTANCE_FILE" ]]; then
    instance_value="$(sed -n '1p' "$ACTIVE_INSTANCE_FILE")"
    [[ "$instance_value" != "$ACTIVE_INSTANCE_TOKEN" ]] || rm -f "$ACTIVE_INSTANCE_FILE" "${ACTIVE_INSTANCE_FILE%.instance}.owner"
  fi
  if [[ -n "$ACTIVE_READY_FILE" && -f "$ACTIVE_READY_FILE" ]]; then
    ready_value="$(sed -n '1p' "$ACTIVE_READY_FILE")"
    [[ "$ready_value" != "$$" ]] || rm -f "$ACTIVE_READY_FILE"
  fi
  if [[ -n "$ACTIVE_READY_INSTANCE_FILE" && -f "$ACTIVE_READY_INSTANCE_FILE" ]]; then
    ready_instance_value="$(sed -n '1p' "$ACTIVE_READY_INSTANCE_FILE")"
    [[ "$ready_instance_value" != "$ACTIVE_INSTANCE_TOKEN" ]] || rm -f "$ACTIVE_READY_INSTANCE_FILE"
  fi
}

cleanup_start_lock() {
  local unpublished_child_pid="$ACTIVE_START_CHILD_PID"

  if [[ "$ACTIVE_START_PUBLISHED" -ne 1 && "$ACTIVE_START_CHILD_SETTLED" -ne 1 ]]; then
    if [[ -z "$unpublished_child_pid" ]]; then
      set +u
      unpublished_child_pid="$!"
      set -u
    fi
  fi
  if [[ "$ACTIVE_START_PUBLISHED" -ne 1 && "$ACTIVE_START_CHILD_SETTLED" -ne 1 && -n "$unpublished_child_pid" ]]; then
    kill "$unpublished_child_pid" 2>/dev/null || true
    wait "$unpublished_child_pid" 2>/dev/null || true
    ACTIVE_START_CHILD_PID=''
    ACTIVE_START_CHILD_SETTLED=1
  fi
  if [[ -n "$ACTIVE_START_LOCK" ]]; then
    release_directory_lock "$ACTIVE_START_LOCK"
  fi
}

# Call only while holding this state's start lock. Foreground run uses the
# same lock for acquisition; detached run is protected by its starter.
prune_inactive_state() {
  local state_dir="$1" listen_name="$2" record pid token event_file event_pid
  for record in monitor run.lock/owner ready; do
    pid=''
    token=''
    [[ ! -f "$state_dir/$record.pid" ]] || pid="$(sed -n '1p' "$state_dir/$record.pid")"
    [[ ! -f "$state_dir/$record.instance" ]] || token="$(sed -n '1p' "$state_dir/$record.instance")"
    # Token match proves the recorded instance. A monitor with a conflicting
    # token is ambiguous live state, so preserve it too; never signal here.
    if process_is_monitor "$pid" "$listen_name" "$token" || process_is_monitor "$pid" "$listen_name" || process_is_monitor "$pid" "${listen_name#@}"; then
      return 0
    fi
  done
  rm -f "$state_dir/monitor.pid" "$state_dir/monitor.instance" "$state_dir/monitor.owner" \
    "$state_dir/ready.pid" "$state_dir/ready.instance"
  for event_file in "$state_dir"/events.* "$state_dir"/seen.sha256.events.*; do
    event_pid="${event_file##*.}"
    case "$event_pid" in ''|*[!0-9]*) continue ;; esac
    rm -f "$event_file"
  done
  rm -rf "$state_dir/run.lock"
}

prune_state_root() {
  local state_dir bare_name
  for state_dir in "$STATE_ROOT"/*; do
    [[ -d "$state_dir" && ! -L "$state_dir" ]] || continue
    bare_name="${state_dir##*/}"
    # A concurrent start (including its unpublished child) owns all its state.
    if acquire_start_lock "$state_dir/start.lock"; then
      prune_inactive_state "$state_dir" "@$bare_name"
      release_directory_lock "$state_dir/start.lock"
    fi
  done
}
