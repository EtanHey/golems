#!/bin/bash
# Sourced by ../stream-helpers.sh; keep the public entry as the source path.

# stalker_file_mtime — epoch mtime, or 0 for a file that is not there. Kept
# lenient because its callers poll a file that may not exist yet; the dialect
# split moved to portable_stat, which is probed from the binary rather than
# from `uname` (coreutils on macOS, busybox on Linux both broke the old check)
# and which still complains on stderr when a file that DOES exist cannot be
# read.
stalker_file_mtime() {
    local file="$1"
    [ -f "$file" ] || { echo 0; return 0; }
    portable_stat mtime "$file" || echo 0
}

stalker_terminate_process_tree() {
    local pid="$1"
    local kill_after="${2:-10}"

    [[ "$pid" =~ ^[0-9]+$ ]] || return 2
    kill -0 "$pid" 2>/dev/null || return 0

    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
    sleep "$kill_after"

    if kill -0 "$pid" 2>/dev/null; then
        pkill -KILL -P "$pid" 2>/dev/null || true
        kill -KILL "$pid" 2>/dev/null || true
    fi
}

stalker_watch_file_growth() {
    local file="$1"
    local recorder_pid="$2"
    local hang_timeout="${3:-${VIDEO_HANG_TIMEOUT:-300}}"
    local log_file="${4:-}"
    local interval="${STALKER_WATCHDOG_INTERVAL:-60}"
    local kill_after="${STALKER_WATCHDOG_KILL_AFTER:-10}"

    [[ "$recorder_pid" =~ ^[0-9]+$ ]] || return 2
    [[ "$hang_timeout" =~ ^[0-9]+$ ]] || return 2
    [[ "$interval" =~ ^[0-9]+$ ]] || return 2
    [[ "$kill_after" =~ ^[0-9]+$ ]] || return 2

    local last_mtime now last_growth current_mtime
    last_mtime=$(stalker_file_mtime "$file")
    last_growth=$(date +%s)

    while kill -0 "$recorder_pid" 2>/dev/null; do
        sleep "$interval"
        now=$(date +%s)
        current_mtime=$(stalker_file_mtime "$file")

        if [ "$current_mtime" -gt "$last_mtime" ]; then
            last_mtime="$current_mtime"
            last_growth="$now"
            continue
        fi

        if [ $((now - last_growth)) -ge "$hang_timeout" ]; then
            if [ -n "$log_file" ]; then
                printf '[watchdog %s] No file growth for %ss; terminating recorder pid %s for %s\n' \
                    "$(date '+%H:%M:%S')" "$hang_timeout" "$recorder_pid" "$file" >> "$log_file"
            fi
            stalker_terminate_process_tree "$recorder_pid" "$kill_after"
            return 0
        fi
    done

    return 0
}

# stalker_terminate_scorer_tree — stop a scorer worker and its CLI descendants.
# The scorer CLIs run as foreground children of background worker shells. Killing
# only the worker can orphan those children, so snapshot descendants before
# terminating the root and recurse through the owned tree. This intentionally
# stays separate from stalker_terminate_process_tree, whose grace period protects
# recorder output during yt-dlp/ffmpeg shutdown.
stalker_terminate_scorer_tree() {
    local root_pid="${1:-}"
    local child_pid children

    [[ "$root_pid" =~ ^[0-9]+$ ]] || return 2
    [ "$root_pid" -gt 1 ] || return 2
    children=$(ps -eo pid=,ppid= 2>/dev/null \
        | awk -v parent="$root_pid" '$2 == parent { print $1 }') || children=""

    kill -TERM "$root_pid" 2>/dev/null || true
    for child_pid in $children; do
        stalker_terminate_scorer_tree "$child_pid" || true
    done
    if kill -0 "$root_pid" 2>/dev/null; then
        kill -KILL "$root_pid" 2>/dev/null || true
    fi
}

stalker_process_start_identity() {
    local pid="${1:-}"
    local process_start
    [[ "$pid" =~ ^[0-9]+$ ]] || return 2
    process_start="$(LC_ALL=C ps -p "$pid" -o lstart= 2>/dev/null \
        | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' \
        | head -n 1)" || return 1
    [ -n "$process_start" ] || return 1
    printf '%s\n' "$process_start"
}

# Select the chronologically newest timestamped recording directory. Directory
# mtime is deliberately irrelevant: detached post-processing mutates completed
# runs and must never make one look like the active recording.
stalker_latest_stamped_stream_dir() {
    local root="${1:-}"
    local channel="${2:-}"
    local dir base

    [ -d "$root" ] || return 0
    [[ "$channel" =~ ^[a-zA-Z0-9_]+$ ]] || return 2

    for dir in "$root"/"$channel"-20??-??-??-??????; do
        [ -d "$dir" ] || continue
        base="${dir##*/}"
        [[ "$base" =~ ^${channel}-20[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{6}$ ]] || continue
        printf '%s\n' "$dir"
    done | LC_ALL=C sort | tail -n 1
}
