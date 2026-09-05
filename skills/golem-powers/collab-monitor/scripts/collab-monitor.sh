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

usage() {
  printf '%s\n' \
    'usage:' \
    '  collab-monitor.sh run [--once] @listen-name file [file ...]' \
    '  collab-monitor.sh start @listen-name file [file ...]' \
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

ensure_files() {
  local watched_file
  [[ "$#" -gt 0 ]] || die 'at least one watched file is required'
  for watched_file in "$@"; do
    [[ -f "$watched_file" ]] || die "watched file does not exist: $watched_file"
  done
}

hash_stream() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{ print $1 }'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{ print $1 }'
  else
    die 'neither shasum nor sha256sum is available'
  fi
}

hash_text() {
  printf '%s\n' "$1" | hash_stream
}

hash_path() {
  printf '%s' "$1" | hash_stream
}

canonical_path() {
  local watched_file="$1"
  local watched_dir watched_base

  watched_dir="$(cd "$(dirname "$watched_file")" 2>/dev/null && pwd -P)" || return 1
  watched_base="$(basename "$watched_file")"
  printf '%s/%s\n' "$watched_dir" "$watched_base"
}

atomic_write_line() {
  local destination="$1"
  local value="$2"
  local temporary="${destination}.tmp.$$"

  if ! printf '%s\n' "$value" > "$temporary"; then
    rm -f "$temporary"
    return 1
  fi
  if ! mv "$temporary" "$destination"; then
    rm -f "$temporary"
    return 1
  fi
}

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
      *"$SCRIPT_PATH"*" run --instance $instance_token $listen_name "*) return 0 ;;
      *) return 1 ;;
    esac
  fi
  case "$command_line" in
    *"$SCRIPT_PATH"*" run "*"$listen_name "*) return 0 ;;
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
  if [[ -f "$owner_file" ]]; then
    owner_pid="$(sed -n '1p' "$owner_file")"
  fi
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
    [[ "$instance_value" != "$ACTIVE_INSTANCE_TOKEN" ]] || rm -f "$ACTIVE_INSTANCE_FILE"
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
    rm -rf "$ACTIVE_START_LOCK"
  fi
}

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

  LC_ALL=C awk -v bare="$bare_name" '
    function reset_block(    i) {
      for (i = 1; i <= event_count; i++) {
        delete events[i]
        delete event_is_heading[i]
      }
      event_count = 0
      block_self = 0
      block_has_heading = 0
      self_heading_index = 0
    }
    function trim(value) {
      sub(/^[[:space:]]+/, "", value)
      sub(/[[:space:]]+$/, "", value)
      return value
    }
    function clean_line(value) {
      gsub(/`/, "", value)
      return value
    }
    function has_exact_mention(value, token,    remaining, position, previous_char, next_char) {
      remaining = value
      while ((position = index(remaining, "@" token)) > 0) {
        previous_char = substr(remaining, position - 1, 1)
        next_char = substr(remaining, position + length(token) + 1, 1)
        if ((position == 1 || previous_char !~ /[[:alnum:]_.@-]/) && (next_char == "" || next_char !~ /[[:alnum:]_.-]/)) return 1
        remaining = substr(remaining, position + 1)
      }
      return 0
    }
    function routed_recipient(value, token,    field, em_dash, ascii_dash) {
      field = tolower(trim(clean_line(value)))
      em_dash = index(field, "—")
      ascii_dash = index(field, " - ")
      if (ascii_dash && (!em_dash || ascii_dash < em_dash)) em_dash = ascii_dash
      if (em_dash) field = substr(field, 1, em_dash - 1)
      return has_exact_mention(field, token)
    }
    function add_event(value, is_heading) {
      event_count++
      events[event_count] = value
      event_is_heading[event_count] = is_heading
    }
    function flush_block(complete,    i, record_type) {
      if (complete) {
        record_type = block_self ? "SELF" : "INBOUND"
        for (i = 1; i <= event_count; i++) {
          if (events[i] != "") print record_type "\t" events[i]
        }
      }
      reset_block()
    }
    function flush_incomplete_end(    i, record_type) {
      record_type = block_self ? "SELF" : "INBOUND"
      for (i = 1; i <= event_count; i++) {
        if (event_is_heading[i] && events[i] != "") print record_type "\t" events[i]
      }
      reset_block()
    }
    function direct_event(value, token,    lowered, rest, first, next_char) {
      lowered = tolower(trim(clean_line(value)))
      if (substr(lowered, 1, length(token) + 1) == "@" token) {
        next_char = substr(lowered, length(token) + 2, 1)
        if (next_char == "" || next_char !~ /[[:alnum:]_.-]/) {
          rest = trim(substr(lowered, length(token) + 2))
          first = substr(rest, 1, 1)
          if (first == ":" || first == "-" || substr(rest, 1, length("—")) == "—") return 1
        }
      }
      if (substr(lowered, 1, length("→")) == "→") {
        rest = trim(substr(lowered, length("→") + 1))
        if (substr(rest, 1, 1) == "@") rest = substr(rest, 2)
        if (substr(rest, 1, length(token)) == token) {
          next_char = substr(rest, length(token) + 1, 1)
          if (next_char == "" || next_char !~ /[[:alnum:]_.-]/) {
            rest = trim(substr(rest, length(token) + 1))
            first = substr(rest, 1, 1)
            if (rest == "" || first == ":" || first == "-" || substr(rest, 1, length("—")) == "—") return 1
          }
        }
      }
      return 0
    }
    function signature_name(value,    lowered, rest) {
      lowered = tolower(trim(clean_line(value)))
      if (substr(lowered, 1, length("—")) == "—") {
        rest = trim(substr(lowered, length("—") + 1))
      } else if (substr(lowered, 1, 2) == "--") {
        rest = trim(substr(lowered, 3))
      } else {
        return ""
      }
      if (rest ~ /^@[[:alnum:]_.-]+$/) return substr(rest, 2)
      return ""
    }
    function list_marker(value,    stripped, count) {
      stripped = value
      count = 0
      while (count < 3 && substr(stripped, 1, 1) == " ") {
        stripped = substr(stripped, 2)
        count++
      }
      return stripped ~ /^[-+*][[:space:]]+/ || stripped ~ /^[0-9]+[.)][[:space:]]+/
    }
    function list_content(value,    stripped, count) {
      stripped = value
      count = 0
      while (count < 3 && substr(stripped, 1, 1) == " ") {
        stripped = substr(stripped, 2)
        count++
      }
      if (stripped ~ /^[-+*][[:space:]]+/) {
        sub(/^[-+*][[:space:]]+/, "", stripped)
      } else {
        sub(/^[0-9]+[.)][[:space:]]+/, "", stripped)
      }
      return stripped
    }
    BEGIN {
      token = tolower(bare)
      in_fence = 0
      fence_character = ""
      fence_length = 0
      in_list_item = 0
      reset_block()
    }
    {
      original = $0
      indent_spaces = 0
      while (substr(original, indent_spaces + 1, 1) == " ") indent_spaces++
      starts_with_tab = substr(original, 1, 1) == "\t"
      is_indented = starts_with_tab || indent_spaces >= 4
      is_list_marker = list_marker(original)
      if (is_list_marker) {
        in_list_item = 1
      } else if (original !~ /^[[:space:]]*$/ && !is_indented) {
        in_list_item = 0
      }
      fence_text = original
      if (is_list_marker) fence_text = list_content(original)
      leading_spaces = 0
      while (leading_spaces < 3 && substr(fence_text, 1, 1) == " ") {
        fence_text = substr(fence_text, 2)
        leading_spaces++
      }
      if (in_list_item && leading_spaces == 3 && substr(fence_text, 1, 1) == " ") {
        fence_text = substr(fence_text, 2)
        leading_spaces++
      }
      marker_character = substr(fence_text, 1, 1)
      marker_length = 0
      if (marker_character == "`" || marker_character == "~") {
        while (substr(fence_text, marker_length + 1, 1) == marker_character) marker_length++
      }
      marker_remainder = substr(fence_text, marker_length + 1)
      if (marker_length >= 3) {
        if (in_fence && marker_character == fence_character && marker_length >= fence_length && marker_remainder ~ /^[[:space:]]*$/) {
          in_fence = 0
          fence_character = ""
          fence_length = 0
          next
        }
        if (!in_fence && !(marker_character == "`" && marker_remainder ~ /`/)) {
          in_fence = 1
          fence_character = marker_character
          fence_length = marker_length
          next
        }
      }
      if (in_fence || (is_indented && !(in_list_item && !starts_with_tab && indent_spaces == 4))) next

      cleaned = clean_line(original)
      lowered = tolower(cleaned)
      is_heading = cleaned ~ /^[[:space:]]*#+[[:space:]]/

      if (is_heading && (event_count > 0 || block_has_heading)) flush_block(1)
      if (is_heading) {
        block_has_heading = 1
        arrow = index(cleaned, "→")
        arrow_length = length("→")
        if (!arrow) {
          arrow = index(cleaned, "->")
          arrow_length = 2
        }
        if (arrow) {
          before_arrow = tolower(substr(cleaned, 1, arrow - 1))
          after_arrow = tolower(substr(cleaned, arrow + arrow_length))
          heading_added = 0
          if (has_exact_mention(before_arrow, token)) {
            block_self = 1
            add_event(original, 1)
            self_heading_index = event_count
            heading_added = 1
          }
          if (routed_recipient(after_arrow, token) && !heading_added) add_event(original, 1)
        }
      } else if (direct_event(original, token)) {
        add_event(original, 0)
      }

      author = signature_name(original)
      if (author != "") {
        block_self = author == token
        if (!block_self && self_heading_index > 0) events[self_heading_index] = ""
        flush_block(1)
      }
    }
    END {
      if (in_fence) exit 3
      if (event_count > 0 || block_has_heading) flush_incomplete_end()
    }
  ' "$watched_file"
}

persist_seen_hash() {
  local seen_file="$1"
  local content_hash="$2"
  local temporary="${seen_file}.tmp.$$"
  local seen_status=0

  seen_hash_status "$seen_file" "$content_hash" || seen_status=$?
  case "$seen_status" in
    0) return 0 ;;
    1) ;;
    *) return 1 ;;
  esac
  if ! {
    awk '{ print }' "$seen_file"
    printf '%s\n' "$content_hash"
  } > "$temporary"; then
    rm -f "$temporary"
    return 1
  fi
  if ! mv "$temporary" "$seen_file"; then
    rm -f "$temporary"
    return 1
  fi
}

seen_hash_status() {
  local seen_file="$1"
  local content_hash="$2"
  local grep_status

  if grep -Fqx "$content_hash" "$seen_file" 2>/dev/null; then
    return 0
  else
    grep_status=$?
  fi
  [[ "$grep_status" -eq 1 ]] && return 1
  return 2
}

seed_file() {
  local watched_file="$1"
  local bare_name="$2"
  local seen_file="$3"
  local event_record event_line content_hash event_file="${seen_file}.events.$$" extract_status=0 hash_failed=0 state_failed=0

  extract_events "$watched_file" "$bare_name" > "$event_file" || extract_status=$?
  if [[ "$extract_status" -ne 0 ]]; then
    rm -f "$event_file"
    return "$extract_status"
  fi
  while IFS= read -r event_record; do
    event_line="${event_record#*$'\t'}"
    if ! content_hash="$(hash_text "$event_line")"; then
      hash_failed=1
      break
    fi
    if ! persist_seen_hash "$seen_file" "$content_hash"; then
      state_failed=1
      break
    fi
  done < "$event_file"
  rm -f "$event_file"
  [[ "$hash_failed" -eq 0 ]] || return 4
  [[ "$state_failed" -eq 0 ]] || return 5
}

scan_file() {
  local watched_file="$1"
  local requested_file="$1"
  local listen_name="$2"
  local bare_name="$3"
  local state_dir="$4"
  local seen_file="$5"
  local size_dir="$state_dir/sizes"
  local path_hash size_file current_size previous_size shrink_delta event_record record_kind event_line content_hash event_file seed_status extract_status hash_failed state_failed seen_status

  if ! watched_file="$(canonical_path "$watched_file" 2>/dev/null)"; then
    printf 'WATCH-WARN file=%s reason=temporarily-absent action=retry\n' "$requested_file" >&2
    return 1
  fi
  [[ -f "$watched_file" ]] || {
    printf 'WATCH-WARN file=%s reason=temporarily-absent action=retry\n' "$watched_file" >&2
    return 1
  }

  if ! path_hash="$(hash_path "$watched_file")"; then
    printf 'WATCH-WARN file=%s reason=hash-failed action=retry\n' "$watched_file" >&2
    return 1
  fi
  size_file="$size_dir/${path_hash}.size"
  if ! current_size="$(wc -c 2>/dev/null < "$watched_file" | tr -d '[:space:]')"; then
    printf 'WATCH-WARN file=%s reason=read-failed action=retry\n' "$watched_file" >&2
    return 1
  fi

  if [[ ! -f "$size_file" ]]; then
    seed_status=0
    seed_file "$watched_file" "$bare_name" "$seen_file" || seed_status=$?
    if [[ "$seed_status" -ne 0 ]]; then
      case "$seed_status" in
        3) printf 'WATCH-WARN file=%s reason=unclosed-fence action=retry\n' "$watched_file" >&2 ;;
        4) printf 'WATCH-WARN file=%s reason=hash-failed action=retry\n' "$watched_file" >&2 ;;
        5) printf 'WATCH-WARN file=%s reason=state-failed action=retry\n' "$watched_file" >&2 ;;
        *) printf 'WATCH-WARN file=%s reason=read-failed action=retry\n' "$watched_file" >&2 ;;
      esac
      return 1
    fi
    if ! atomic_write_line "$size_file" "$current_size"; then
      printf 'WATCH-WARN file=%s reason=state-failed action=retry\n' "$watched_file" >&2
      return 1
    fi
    return 0
  fi

  previous_size="$(sed -n '1p' "$size_file")"
  case "$previous_size" in
    ''|*[!0-9]*) die "invalid size state for $watched_file" ;;
  esac
  [[ "$current_size" != "$previous_size" ]] || return 0

  if [[ "$current_size" -lt "$previous_size" ]]; then
    shrink_delta=$((previous_size - current_size))
    printf 'SHRINK file=%s old_bytes=%s new_bytes=%s delta_bytes=%s\n' "$watched_file" "$previous_size" "$current_size" "$shrink_delta"
  fi

  event_file="$state_dir/events.$$"
  extract_status=0
  extract_events "$watched_file" "$bare_name" > "$event_file" || extract_status=$?
  if [[ "$extract_status" -ne 0 ]]; then
    rm -f "$event_file"
    case "$extract_status" in
      3) printf 'WATCH-WARN file=%s reason=unclosed-fence action=retry\n' "$watched_file" >&2 ;;
      *) printf 'WATCH-WARN file=%s reason=read-failed action=retry\n' "$watched_file" >&2 ;;
    esac
    return 1
  fi
  hash_failed=0
  state_failed=0
  while IFS= read -r event_record; do
    record_kind="${event_record%%$'\t'*}"
    event_line="${event_record#*$'\t'}"
    if ! content_hash="$(hash_text "$event_line")"; then
      hash_failed=1
      break
    fi
    seen_status=0
    seen_hash_status "$seen_file" "$content_hash" || seen_status=$?
    case "$seen_status" in
      0) continue ;;
      1) ;;
      *)
        state_failed=1
        break
        ;;
    esac
    if [[ "$record_kind" == 'SELF' ]]; then
      printf 'SELF-POST-%s file=%s hash=%s :: %s\n' "$listen_name" "$watched_file" "$content_hash" "$event_line"
    else
      printf 'NEW-FOR-%s file=%s hash=%s :: %s\n' "$listen_name" "$watched_file" "$content_hash" "$event_line"
    fi
    if ! persist_seen_hash "$seen_file" "$content_hash"; then
      state_failed=1
      break
    fi
  done < "$event_file"
  rm -f "$event_file"
  if [[ "$hash_failed" -ne 0 ]]; then
    printf 'WATCH-WARN file=%s reason=hash-failed action=retry\n' "$watched_file" >&2
    return 1
  fi
  if [[ "$state_failed" -ne 0 ]]; then
    printf 'WATCH-WARN file=%s reason=state-failed action=retry\n' "$watched_file" >&2
    return 1
  fi

  if ! atomic_write_line "$size_file" "$current_size"; then
    printf 'WATCH-WARN file=%s reason=state-failed action=retry\n' "$watched_file" >&2
    return 1
  fi
}

print_contract() {
  local listen_name="$1"
  local state_dir="$2"
  local file_count="$3"

  printf 'MONITOR-ARMED name=%s files=%s state=%s\n' "$listen_name" "$file_count" "$state_dir"
  printf '%s\n' 'WILL-NOT-CATCH :: same-size rewrites; growth rewrites may look like appends; events outside anchored tag routing; an unclosed trailing direct message is held until a signature or later heading; inbound direct mail nested in a self-authored block remains self-classified unless a recognized foreign signature closes it; process death without a supervisor; worker completion visible only in an agent registry'
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

  nohup env MONITOR_STATE_DIR="$STATE_ROOT" POLL_SECONDS="$POLL_SECONDS" COLLAB_MONITOR_MANAGED=1 /bin/bash "$SCRIPT_PATH" run --instance "$instance_token" "$listen_name" "$@" >> "$log_file" 2>&1 < /dev/null &
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

case "$command" in
  run) run_monitor "$@" ;;
  start) start_monitor "$@" ;;
  follow) follow_monitor "$@" ;;
  stop) stop_monitor "$@" ;;
  status) status_monitor "$@" ;;
  *) usage; exit 2 ;;
esac
