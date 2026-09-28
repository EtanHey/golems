# shellcheck shell=bash
# Source-only CLI options and validation helpers.

usage() {
  printf '%s\n' \
    'usage:' \
    '  collab-monitor.sh run [--once] [--include-self] [--alias @seat-id ...] @listen-name file [file ...]' \
    '  collab-monitor.sh start [--include-self] [--alias @seat-id ...] @listen-name file [file ...]' \
    '  collab-monitor.sh follow @listen-name' \
    '  collab-monitor.sh stop @listen-name' \
    '  collab-monitor.sh status @listen-name' >&2
}

die() {
  printf 'COLLAB-MONITOR-ERROR :: %s\n' "$1" >&2
  exit 2
}

validate_poll_seconds() {
  local nonzero_digits

  case "$POLL_SECONDS" in
    ''|'.'|*[!0-9.]*|*.*.*)
      die "invalid POLL_SECONDS: $POLL_SECONDS"
      ;;
  esac
  nonzero_digits="${POLL_SECONDS//[0.]/}"
  [[ -n "$nonzero_digits" ]] || die "invalid POLL_SECONDS: $POLL_SECONDS"
}

validate_start_timeout_seconds() {
  case "$START_TIMEOUT_SECONDS" in
    ''|0*|*[!0-9]*) die "invalid START_TIMEOUT_SECONDS: $START_TIMEOUT_SECONDS" ;;
  esac
  [[ "${#START_TIMEOUT_SECONDS}" -le 5 ]] || die "invalid START_TIMEOUT_SECONDS: $START_TIMEOUT_SECONDS"
  [[ "$START_TIMEOUT_SECONDS" -le 86400 ]] || die "invalid START_TIMEOUT_SECONDS: $START_TIMEOUT_SECONDS"
}

normalize_name() {
  local listen_name="$1"
  local bare_name="${listen_name#@}"

  case "$bare_name" in
    ''|'.'|'..'|*[!A-Za-z0-9_.-]*)
      die "invalid listen name: $listen_name"
      ;;
  esac
  printf '%s\n' "$bare_name"
}

add_alias() {
  local alias_name
  alias_name="$(normalize_name "$1")"
  ALIASES="${ALIASES:+$ALIASES }$alias_name"
}

ensure_files() {
  local watched_file
  [[ "$#" -gt 0 ]] || die 'at least one watched file is required'
  for watched_file in "$@"; do
    [[ -f "$watched_file" ]] || die "watched file does not exist: $watched_file"
  done
}
