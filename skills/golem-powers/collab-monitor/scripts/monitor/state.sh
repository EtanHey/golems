# Source-only content hashes, canonical paths, and durable watermark state.

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
    if [[ "$record_kind" == 'SELF' && "$INCLUDE_SELF" -eq 1 ]]; then
      printf 'SELF-POST-%s file=%s hash=%s :: %s\n' "$listen_name" "$watched_file" "$content_hash" "$event_line"
    elif [[ "$record_kind" != 'SELF' ]]; then
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
