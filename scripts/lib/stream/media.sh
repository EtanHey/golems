#!/bin/bash
# Sourced by ../stream-helpers.sh; keep the public entry as the source path.

# parse_silence_timestamps — read ffmpeg silencedetect stderr from stdin,
# emit one numeric timestamp per line. Filters out any non-numeric junk that
# leaks through when ffmpeg's progress reporter interleaves with the filter
# output (the elapsed=0:00:01 bug we hit on 2026-05-03 and 2026-04-18).
parse_silence_timestamps() {
    # The final grep `|| true` matters when the caller uses `set -o pipefail`
    # — without it, a recording with no detected silences (or no input)
    # would propagate exit 1 and abort the caller.
    { grep "silence_end" || true; } \
      | awk '{print $5}' \
      | { grep -E '^[0-9]+(\.[0-9]+)?$' || true; }
}

# count_chat_lines — return line count of a chat log, or 0 if file is missing
# or unreadable. Replaces `wc -l < "$f"` which dies with a shell redirection
# error when the file doesn't exist (silently emitting 0 from `|| echo 0`
# does not work because the failure is at the redirect, before wc runs).
count_chat_lines() {
    local file="$1"
    if [ -n "$file" ] && [ -f "$file" ]; then
        wc -l < "$file" | tr -d ' '
    else
        echo 0
    fi
}

# compress_video_h264 — re-encode a video with libx264 CRF 23 (visually
# lossless for streaming sources), preset medium, audio stream copied.
# Outputs to <input>-compressed.mp4 sibling, never overwrites.
# Returns 0 on success, non-zero on failure.
compress_video_h264() {
    local input="$1"
    local output="$2"
    local crf="${3:-23}"
    local preset="${4:-medium}"

    [ -z "$input" ] || [ -z "$output" ] && { echo "compress_video_h264: input + output required" >&2; return 2; }
    [ ! -f "$input" ] && { echo "compress_video_h264: input not found: $input" >&2; return 3; }
    [ -f "$output" ] && { echo "compress_video_h264: output exists: $output" >&2; return 4; }

    ffmpeg -nostdin -y -i "$input" \
      -c:v libx264 -crf "$crf" -preset "$preset" \
      -c:a copy -movflags +faststart \
      "$output" 2>&1
}

# video_duration_seconds — print integer duration of a video, or empty
# string on failure. Used to verify compressed video matches original.
video_duration_seconds() {
    local file="$1"
    [ ! -f "$file" ] && return 1
    ffprobe -v error -show_entries format=duration -of csv=p=0 "$file" 2>/dev/null \
      | cut -d. -f1
}

stalker_stream_start_epoch() {
    local dir="$1"
    local name date_part time_part hour minute second epoch
    name="$(basename "$dir")"

    if [[ ! "$name" =~ -([0-9]{4}-[0-9]{2}-[0-9]{2})-([0-9]{6})$ ]]; then
        return 1
    fi

    date_part="${BASH_REMATCH[1]}"
    time_part="${BASH_REMATCH[2]}"
    hour="${time_part:0:2}"
    minute="${time_part:2:2}"
    second="${time_part:4:2}"

    if epoch=$(date -j -f "%Y-%m-%d %H:%M:%S" "$date_part $hour:$minute:$second" "+%s" 2>/dev/null); then
        printf '%s\n' "$epoch"
        return 0
    fi

    if epoch=$(date -d "$date_part $hour:$minute:$second" "+%s" 2>/dev/null); then
        printf '%s\n' "$epoch"
        return 0
    fi

    return 1
}

stalker_stream_duration_seconds() {
    local dir="$1"
    local media duration
    for media in "$dir/video.ts" "$dir/video.mp4"; do
        if [ -f "$media" ]; then
            duration=$(video_duration_seconds "$media" || true)
            if [[ "$duration" =~ ^[0-9]+$ ]]; then
                printf '%s\n' "$duration"
                return 0
            fi
        fi
    done
    return 1
}

stalker_abs_dir() {
    local dir="$1"
    (cd "$dir" 2>/dev/null && pwd -P) || printf '%s\n' "$dir"
}

stalker_orphan_tail_reason() {
    local stream_dir="$1"
    local channel="$2"
    local source_duration="$3"
    local started_epoch="${4:-0}"
    local tail_threshold="${STALKER_ORPHAN_TAIL_MAX_SECONDS:-120}"
    local adjacency_seconds="${STALKER_ORPHAN_TAIL_ADJACENCY_SECONDS:-900}"
    local overlap_seconds="${STALKER_ORPHAN_TAIL_OVERLAP_SECONDS:-300}"

    [[ "$source_duration" =~ ^[0-9]+$ ]] || return 1
    [[ "$tail_threshold" =~ ^[0-9]+$ ]] || return 1
    [[ "$adjacency_seconds" =~ ^[0-9]+$ ]] || return 1
    [[ "$overlap_seconds" =~ ^[0-9]+$ ]] || return 1
    [ "$source_duration" -lt "$tail_threshold" ] || return 1

    local current_start
    if [[ "$started_epoch" =~ ^[0-9]+$ ]] && [ "$started_epoch" -gt 0 ]; then
        current_start="$started_epoch"
    else
        current_start=$(stalker_stream_start_epoch "$stream_dir" || true)
    fi
    [[ "$current_start" =~ ^[0-9]+$ ]] || return 1

    local base_dir current_abs candidate candidate_abs candidate_start candidate_duration
    local candidate_end gap abs_gap best_abs_gap best_gap best_dir best_duration
    base_dir="$(dirname "$stream_dir")"
    current_abs="$(stalker_abs_dir "$stream_dir")"

    for candidate in "$base_dir/$channel"-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]; do
        [ -d "$candidate" ] || continue
        candidate_abs="$(stalker_abs_dir "$candidate")"
        [ "$candidate_abs" != "$current_abs" ] || continue

        candidate_start=$(stalker_stream_start_epoch "$candidate" || true)
        [[ "$candidate_start" =~ ^[0-9]+$ ]] || continue
        [ "$candidate_start" -lt "$current_start" ] || continue

        candidate_duration=$(stalker_stream_duration_seconds "$candidate" || true)
        [[ "$candidate_duration" =~ ^[0-9]+$ ]] || continue
        [ "$candidate_duration" -ge "$tail_threshold" ] || continue

        candidate_end=$((candidate_start + candidate_duration))
        gap=$((current_start - candidate_end))
        [ "$gap" -ge "$((-overlap_seconds))" ] || continue
        [ "$gap" -le "$adjacency_seconds" ] || continue

        abs_gap="$gap"
        [ "$abs_gap" -lt 0 ] && abs_gap=$((-abs_gap))
        if [ -z "${best_abs_gap:-}" ] || [ "$abs_gap" -lt "$best_abs_gap" ]; then
            best_abs_gap="$abs_gap"
            best_gap="$gap"
            best_dir="$candidate"
            best_duration="$candidate_duration"
        fi
    done

    [ -n "${best_dir:-}" ] || return 1
    printf 'reason=adjacent_tiny_tail source_duration_seconds=%s threshold_seconds=%s adjacent_dir=%s adjacent_duration_seconds=%s gap_seconds=%s\n' \
        "$source_duration" "$tail_threshold" "$best_dir" "$best_duration" "$best_gap"
}

# file_size_bytes — portable byte size of a file. macOS uses `stat -f%z`,
# Linux uses `stat -c%s`; `wc -c < file` is POSIX and works on both.
# Prints 0 if file missing or unreadable (so callers can compare numerically).
file_size_bytes() {
    local file="$1"
    if [ -n "$file" ] && [ -f "$file" ]; then
        wc -c < "$file" | tr -d ' '
    else
        echo 0
    fi
}

stalker_format_duration() {
    local seconds="${1:-0}"
    [[ "$seconds" =~ ^[0-9]+$ ]] || seconds=0
    local hours=$((seconds / 3600))
    local minutes=$(((seconds % 3600) / 60))
    local secs=$((seconds % 60))
    if [ "$hours" -gt 0 ]; then
        printf '%dh%02dm%02ds\n' "$hours" "$minutes" "$secs"
    else
        printf '%dm%02ds\n' "$minutes" "$secs"
    fi
}

stalker_ytdlp_record_args() {
    local quality="$1"
    local output="$2"
    local url="$3"

    [ -z "$quality" ] || [ -z "$output" ] || [ -z "$url" ] && {
        echo "stalker_ytdlp_record_args: quality + output + url required" >&2
        return 2
    }

    printf '%s\n' \
        --hls-use-mpegts \
        --downloader native \
        --socket-timeout 30 \
        --retries infinite \
        --fragment-retries infinite \
        --retry-sleep fragment:exp=1:20 \
        --abort-on-unavailable-fragment \
        --no-part \
        --concurrent-fragments 1 \
        --no-continue \
        -f "$quality" \
        -o "$output" \
        "$url"
}

# durations_match — exit 0 if two durations are within tolerance (default 2s).
# Use after compress_video_h264 to ensure encode didn't drop frames.
# Rejects empty / non-integer input — ffprobe returns "N/A" when a container
# lacks duration metadata, which would otherwise crash the bash arithmetic.
durations_match() {
    local a="$1"
    local b="$2"
    local tolerance="${3:-2}"
    [[ ! "$a" =~ ^[0-9]+$ ]] && return 1
    [[ ! "$b" =~ ^[0-9]+$ ]] && return 1
    [[ ! "$tolerance" =~ ^[0-9]+$ ]] && return 1
    local diff=$((a - b))
    [ $diff -lt 0 ] && diff=$((-diff))
    [ $diff -le "$tolerance" ]
}
