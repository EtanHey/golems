# shellcheck shell=bash
# Capture ownership before start detaches; foreground watches also reject PPID 1.
OWNER_PID=''
OWNER_STARTED=''

set_owner_pid() {
  case "$1" in
    ''|0*|*[!0-9]*) die "invalid --owner-pid: $1" ;;
  esac
  OWNER_PID="$1"
}

initialize_owner() {
  local ancestor="$PPID" parent executable command_line
  if [[ -z "$OWNER_PID" ]]; then
    OWNER_PID="$PPID"
    while [[ "$ancestor" -gt 1 ]]; do
      executable="$(ps -p "$ancestor" -o comm= 2>/dev/null || true)"
      command_line="$(ps -p "$ancestor" -o command= 2>/dev/null || true)"
      command_line="${command_line%% *}"
      case "${executable##*/}:${command_line##*/}" in
        claude:*|codex:*|*:claude|*:codex) OWNER_PID="$ancestor"; break ;;
      esac
      parent="$(ps -p "$ancestor" -o ppid= 2>/dev/null | tr -d '[:space:]')"
      case "$parent" in ''|*[!0-9]*) break ;; esac
      [[ "$parent" != "$ancestor" ]] || break
      ancestor="$parent"
    done
  fi
  read -r OWNER_STARTED <<< "$(ps -p "$OWNER_PID" -o lstart= 2>/dev/null || true)"
  [[ -n "$OWNER_STARTED" ]] || die "owner is not running: $OWNER_PID"
}

owner_alive() {
  local current_parent current_started owner_state
  kill -0 "$OWNER_PID" 2>/dev/null || return 1
  read -r owner_state current_started <<< "$(ps -p "$OWNER_PID" -o stat=,lstart= 2>/dev/null || true)"
  case "$owner_state" in ''|Z*) return 1 ;; esac
  [[ "$current_started" == "$OWNER_STARTED" ]] || return 1
  # Only the packaged managed producer intentionally detaches from its parent.
  if [[ "${COLLAB_MONITOR_MANAGED:-0}" != '1' ]]; then
    current_parent="$(ps -p "$$" -o ppid= 2>/dev/null | tr -d '[:space:]')"
    [[ -n "$current_parent" && "$current_parent" != '1' ]] || return 1
  fi
}

require_owner() {
  owner_alive || exit 0
}
