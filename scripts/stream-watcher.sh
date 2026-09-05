#!/usr/bin/env bash
# Stream Watcher — record a Twitch stream, auto-process when it ends.
# Usage: stream-watcher.sh <channel> [quality]
# Example: stream-watcher.sh theo best
#
# Records video+audio via yt-dlp, chat via tmi.js lurker.
# When stream ends (yt-dlp exits or watchdog kills it), detaches post-stream.sh.
# All files go to docs.local/stalker-golem/<channel>-<date>/ (persistent).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/stream-helpers.sh
source "$SCRIPT_DIR/lib/stream-helpers.sh"

CHANNEL="${1:?Usage: stream-watcher.sh <channel> [quality]}"
# Validate channel name — alphanumeric + underscores only (Twitch rules)
if [[ ! "$CHANNEL" =~ ^[a-zA-Z0-9_]+$ ]]; then
    echo "ERROR: Invalid channel name '$CHANNEL'. Must be alphanumeric + underscores only." >&2
    exit 1
fi
QUALITY="${2:-best}"
STREAM_STAMP=$(date +%Y-%m-%d-%H%M%S)
STREAM_DIR="$REPO_ROOT/docs.local/stalker-golem/${CHANNEL}-${STREAM_STAMP}"
SCRIPTS_DIR="$SCRIPT_DIR"
VIDEO_FILE="$STREAM_DIR/video.ts"
CHAT_FILE="$STREAM_DIR/chat.log"
LURKER_SCRIPT="$SCRIPT_DIR/dist/twitch-chat-lurker.js"
LURKER_PID=""
YTDLP_PID=""
WATCHDOG_PID=""
VIDEO_HANG_TIMEOUT="${VIDEO_HANG_TIMEOUT:-120}"

mkdir -p "$STREAM_DIR"

log() { echo "[stream-watcher $(date '+%H:%M:%S')] $1"; }

cleanup() {
    log "Cleaning up..."
    [ -n "$WATCHDOG_PID" ] && kill "$WATCHDOG_PID" 2>/dev/null || true
    [ -n "$YTDLP_PID" ] && stalker_terminate_process_tree "$YTDLP_PID" 2 || true
    [ -n "$LURKER_PID" ] && kill "$LURKER_PID" 2>/dev/null || true
    log "Cleanup done."
}
trap cleanup EXIT SIGTERM SIGINT

# --- Adaptive polling: 5 min idle -> 2 min cooldown after stream ends -> 5 min ---
POLL_IDLE=300       # 5 minutes between checks when no stream detected
POLL_COOLDOWN=120   # 2 minutes between checks after stream ends
COOLDOWN_MAX=5      # Check 5 times at 2-min intervals (= 10 min) before reverting to idle

# --- Platform URLs to check (Twitch + YouTube) ---
TWITCH_URL="https://www.twitch.tv/${CHANNEL}"
YOUTUBE_URL="https://www.youtube.com/@${CHANNEL}/live"

poll_interval=$POLL_IDLE
cooldown_count=0

# check_live: returns 0 if live on any platform, sets LIVE_URL
check_live() {
    if yt-dlp --simulate --no-download "$TWITCH_URL" 2>/dev/null; then
        LIVE_URL="$TWITCH_URL"
        LIVE_PLATFORM="twitch"
        return 0
    fi
    if yt-dlp --simulate --no-download "$YOUTUBE_URL" 2>/dev/null; then
        LIVE_URL="$YOUTUBE_URL"
        LIVE_PLATFORM="youtube"
        return 0
    fi
    return 1
}

start_chat_lurker() {
    log "Starting chat lurker..."
    TWITCH_CHANNEL="$CHANNEL" CHAT_OUTPUT="$CHAT_FILE" \
      nohup bun run "$LURKER_SCRIPT" > "$STREAM_DIR/chat-lurker.log" 2>&1 &
    LURKER_PID=$!
    disown || true
    log "Chat lurker PID: $LURKER_PID"
    stalker_require_lurker_ready "$STREAM_DIR" "$LURKER_PID" "$STREAM_DIR/chat-lurker.log" "$CHAT_FILE"
}

stop_chat_lurker() {
    if [ -n "$LURKER_PID" ]; then
        kill "$LURKER_PID" 2>/dev/null || true
        LURKER_PID=""
        log "Chat lurker stopped."
    fi
}

start_detached_post_processing() {
    local post_log
    post_log="$STREAM_DIR/logs/post-$(date +%s).log"
    mkdir -p "$STREAM_DIR/logs"
    if command -v setsid >/dev/null 2>&1; then
        setsid nohup bash "$SCRIPTS_DIR/post-stream.sh" "$STREAM_DIR" "$VIDEO_FILE" "$CHAT_FILE" "$CHANNEL" "$RECORDING_STARTED_EPOCH" \
            > "$post_log" 2>&1 < /dev/null &
    else
        nohup bash "$SCRIPTS_DIR/post-stream.sh" "$STREAM_DIR" "$VIDEO_FILE" "$CHAT_FILE" "$CHANNEL" "$RECORDING_STARTED_EPOCH" \
            > "$post_log" 2>&1 < /dev/null &
    fi
    disown || true
    log "Post-processing detached. Log: $post_log"
}

poll_until_live() {
    while true; do
        if check_live; then
            log "${CHANNEL} is LIVE on ${LIVE_PLATFORM}! Starting recording..."
            return 0
        fi

        if [ "$cooldown_count" -gt 0 ]; then
            cooldown_count=$((cooldown_count - 1))
            if [ "$cooldown_count" -eq 0 ]; then
                poll_interval=$POLL_IDLE
                log "${CHANNEL} offline. Cooldown done - back to ${poll_interval}s polling."
            else
                log "${CHANNEL} offline. Cooldown ${cooldown_count} remaining..."
            fi
        else
            log "${CHANNEL} offline. Next check in ${poll_interval}s..."
        fi
        sleep "$poll_interval"
    done
}

record_current_stream() {
    STREAM_STAMP=$(date +%Y-%m-%d-%H%M%S)
    STREAM_DIR="$REPO_ROOT/docs.local/stalker-golem/${CHANNEL}-${STREAM_STAMP}"
    VIDEO_FILE="$STREAM_DIR/video.ts"
    CHAT_FILE="$STREAM_DIR/chat.log"
    YTDLP_LOG="$STREAM_DIR/yt-dlp.log"
    WATCHDOG_LOG="$STREAM_DIR/watchdog.log"
    mkdir -p "$STREAM_DIR"

    RECORDING_STARTED_EPOCH=$(date +%s)
    if ! start_chat_lurker; then
        log "ERROR: Chat lurker failed readiness; recording continues with retryable chat failure evidence"
    fi

    log "Recording from ${LIVE_PLATFORM}: $LIVE_URL"
    log "Video: $VIDEO_FILE"
    notify_stalker_telegram \
        "Stalker Stream Live" \
        "${CHANNEL} LIVE on ${LIVE_PLATFORM} - recording to ${VIDEO_FILE} ($(date '+%Y-%m-%d %H:%M:%S %Z'))" \
        "default" \
        "stalker-golem" || true

    ytdlp_args=()
    while IFS= read -r arg; do
        ytdlp_args+=("$arg")
    done < <(stalker_ytdlp_record_args "$QUALITY" "$VIDEO_FILE" "$LIVE_URL")

    set +e
    yt-dlp "${ytdlp_args[@]}" > "$YTDLP_LOG" 2>&1 &
    YTDLP_PID=$!
    stalker_watch_file_growth "$VIDEO_FILE" "$YTDLP_PID" "$VIDEO_HANG_TIMEOUT" "$WATCHDOG_LOG" &
    WATCHDOG_PID=$!
    wait "$YTDLP_PID"
    YTDLP_EXIT=$?
    kill "$WATCHDOG_PID" 2>/dev/null || true
    wait "$WATCHDOG_PID" 2>/dev/null || true
    WATCHDOG_PID=""
    YTDLP_PID=""
    set -e

    log "Recording ended (exit code: $YTDLP_EXIT)"
    stop_chat_lurker

    if [ ! -f "$VIDEO_FILE" ] || [ "$(file_size_bytes "$VIDEO_FILE")" -lt 1000000 ]; then
        log "Recording too small or missing - false positive or brief stream."
    else
        VIDEO_SIZE=$(du -sh "$VIDEO_FILE" | cut -f1)
        CHAT_LINES=$(count_chat_lines "$CHAT_FILE")
        FINISHED_EPOCH=$(date +%s)
        DURATION=$(stalker_format_duration $((FINISHED_EPOCH - RECORDING_STARTED_EPOCH)))
        log "Captured: ${VIDEO_SIZE} video, ${CHAT_LINES} chat messages"
        notify_stalker_telegram \
            "Stalker Stream Ended" \
            "${CHANNEL} stream ended after ${DURATION}. Recorded ${VIDEO_SIZE}, ${CHAT_LINES} chat msgs. Processing started." \
            "default" \
            "stalker-golem" || true
        start_detached_post_processing
    fi

    log "Stream ended. Entering cooldown (${POLL_COOLDOWN}s x ${COOLDOWN_MAX} checks)..."
    poll_interval=$POLL_COOLDOWN
    cooldown_count=$COOLDOWN_MAX
}

LIVE_URL=""
LIVE_PLATFORM=""
RECORDING_STARTED_EPOCH=0

log "=== Stream Watcher: ${CHANNEL} ==="
log "Recording extension: .ts (native HLS mpegts)"
log "Video hang timeout: ${VIDEO_HANG_TIMEOUT}s"
log "Checking if ${CHANNEL} is live on Twitch + YouTube (poll: ${poll_interval}s)..."

while true; do
    poll_until_live
    record_current_stream
    log "Watching for next stream..."
done
