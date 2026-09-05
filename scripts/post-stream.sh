#!/bin/bash
# Post-stream handler — remuxes, processes, archives, and notifies.
#
# Usage: post-stream.sh <channel> <date>
# Example: post-stream.sh theo 2026-02-23
#
# New watcher mode:
#   post-stream.sh <stream-dir> <video-file> <chat-log> <channel> [started-epoch]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/stream-helpers.sh
source "$SCRIPT_DIR/lib/stream-helpers.sh"

log() { echo "[post-stream $(date '+%H:%M:%S')] $1"; }

stalker_timeout_seconds() {
    local duration="$1"
    local value multiplier
    if [[ "$duration" =~ ^([1-9][0-9]*)([smhd]?)$ ]]; then
        value="${BASH_REMATCH[1]}"
        case "${BASH_REMATCH[2]}" in
            ""|s) multiplier=1 ;;
            m) multiplier=60 ;;
            h) multiplier=3600 ;;
            d) multiplier=86400 ;;
        esac
        printf '%s\n' "$((value * multiplier))"
        return 0
    fi
    return 2
}

stalker_signal_process_tree() {
    local pid="$1"
    local signal="$2"
    local child
    while IFS= read -r child; do
        [ -n "$child" ] || continue
        stalker_signal_process_tree "$child" "$signal"
    done < <(pgrep -P "$pid" 2>/dev/null || true)
    kill "-$signal" "$pid" 2>/dev/null || true
}

stalker_terminate_full_process_tree() {
    local pid="$1"
    local kill_after="${2:-1}"
    [[ "$pid" =~ ^[0-9]+$ ]] || return 2
    kill -0 "$pid" 2>/dev/null || return 0

    stalker_signal_process_tree "$pid" TERM
    sleep "$kill_after"
    if kill -0 "$pid" 2>/dev/null; then
        stalker_signal_process_tree "$pid" KILL
    fi
}

run_with_stalker_timeout() {
    local timeout_bin="$1"
    local duration="$2"
    local kill_after="${STALKER_BRAINLAYER_TIMEOUT_KILL_AFTER:-1}"
    local external_kill_after="$kill_after"
    shift 2

    if [ -n "$timeout_bin" ]; then
        # GNU timeout treats -k 0 as disabled, while the built-in watchdog
        # treats zero as immediate escalation. Keep the public knob bounded in
        # both paths by mapping zero to the smallest whole-second grace.
        [ "$external_kill_after" = "0" ] && external_kill_after=1
        "$timeout_bin" --kill-after="${external_kill_after}s" "$duration" "$@"
        return
    fi

    local timeout_seconds command_pid watchdog_pid marker status
    timeout_seconds="$(stalker_timeout_seconds "$duration")" || {
        log "WARNING: invalid BrainLayer ingest timeout: $duration"
        return 125
    }
    marker="$(mktemp)"
    "$@" &
    command_pid=$!
    (
        sleep "$timeout_seconds"
        if kill -0 "$command_pid" 2>/dev/null; then
            printf 'timed-out\n' > "$marker"
            stalker_terminate_full_process_tree "$command_pid" "$kill_after"
        fi
    ) &
    watchdog_pid=$!

    status=0
    wait "$command_pid" || status=$?
    stalker_terminate_full_process_tree "$watchdog_pid" 0
    wait "$watchdog_pid" 2>/dev/null || true

    if [ -s "$marker" ]; then
        status=124
    fi
    rm -f "$marker"
    return "$status"
}

queue_brainlayer_replay() {
    local stream_dir="$1"
    local reason="$2"
    if ! "$CONTRACT_SCRIPT" queue-run "$stream_dir" "$reason"; then
        log "WARNING: failed to queue unfinished BrainLayer payloads for replay"
        return 1
    fi
}

notify_brainlayer_queue() {
    local stream_dir="$1"
    local status_file="$stream_dir/.brainlayer-status"
    local queued_count

    [ "$TELEGRAM_DRY_RUN" = "0" ] || return 0
    [ -f "$status_file" ] || return 0
    grep -F -q 'status=queued' "$status_file" || return 0
    stalker_stage_done "$stream_dir" "brainlayer-queue-notified" && return 0

    queued_count="$(sed -n 's/^queued_count=//p' "$status_file" | head -1)"
    queued_count="${queued_count:-unknown}"
    if ! notify_stalker_telegram \
        "Stalker BrainLayer replay queued - ${DATE}" \
        "${CHANNEL} ${DATE}: ${queued_count} BrainLayer payload(s) queued for durable replay after ingest did not complete." \
        "default" \
        "stalker-golem"; then
        log "WARNING: BrainLayer queue alert was preserved in the Telegram retry queue"
    fi
    mark_stalker_stage_done "$stream_dir" "brainlayer-queue-notified"
}

if [ "$#" -ge 4 ]; then
    if [ ! -d "$1" ]; then
        echo "ERROR: Watcher mode expects stream directory as first argument, got '$1'" >&2
        exit 1
    fi
    STREAM_DIR="$1"
    SOURCE_VIDEO="$2"
    TARGET_CHAT="$3"
    CHANNEL="$4"
    STARTED_EPOCH="${5:-0}"
    DATE="$(basename "$STREAM_DIR" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1 || date +%Y-%m-%d)"
else
    CHANNEL="${1:?Usage: post-stream.sh <channel> <date> OR <stream-dir> <video-file> <chat-log> <channel> [started-epoch]}"
    DATE="${2:?Usage: post-stream.sh <channel> <date> OR <stream-dir> <video-file> <chat-log> <channel> [started-epoch]}"
    BASE="$HOME/Gits/golems/docs.local/stalker-golem"
    STREAM_DIR="$BASE/${CHANNEL}-${DATE}"
    RECORDINGS="$BASE/recordings"
    LEGACY_VIDEO="$RECORDINGS/twitch-${CHANNEL}-${DATE}.mp4"
    SOURCE_VIDEO="$STREAM_DIR/video.mp4"
    TARGET_CHAT="$STREAM_DIR/chat.log"

    mkdir -p "$STREAM_DIR"

    if [ -f "$LEGACY_VIDEO" ] && [ ! -f "$SOURCE_VIDEO" ]; then
        log "Moving video: $LEGACY_VIDEO -> $SOURCE_VIDEO"
        mv "$LEGACY_VIDEO" "$SOURCE_VIDEO"
    fi

    LEGACY_CHAT="$RECORDINGS/twitch-${CHANNEL}-${DATE}.log"
    if [ -f "$LEGACY_CHAT" ] && [ ! -f "$TARGET_CHAT" ]; then
        log "Moving chat: $LEGACY_CHAT -> $TARGET_CHAT"
        mv "$LEGACY_CHAT" "$TARGET_CHAT"
    fi

    STARTED_EPOCH=0
fi

TARGET_VIDEO="$STREAM_DIR/video.mp4"
mkdir -p "$STREAM_DIR"
stalker_reconcile_interrupted_scoring_root "$(dirname "$STREAM_DIR")"

# Explicit re-process (STALKER_FORCE_RESCORE=1): clear the stage markers this
# script gates on so process-stream.sh runs again AND the digest re-fires. The
# env var propagates to the process-stream.sh child, which clears gems.md and
# its own notify/scoring markers. A re-process must re-process — silent
# skip-on-existing is exactly the failure class this change exists to kill.
if [ "${STALKER_FORCE_RESCORE:-0}" = "1" ]; then
    log "STALKER_FORCE_RESCORE=1 — clearing process + notified markers for a full re-process"
    rm -f "$STREAM_DIR/.stage-process.done" \
        "$STREAM_DIR/.stage-notified.done" \
        "$STREAM_DIR/.stage-complete-notify.done"
fi

if [ ! -f "$SOURCE_VIDEO" ]; then
    log "ERROR: No video found at $SOURCE_VIDEO"
    exit 1
fi

SOURCE_DURATION=$(video_duration_seconds "$SOURCE_VIDEO" || true)
if ORPHAN_TAIL_REASON=$(stalker_orphan_tail_reason "$STREAM_DIR" "$CHANNEL" "$SOURCE_DURATION" "$STARTED_EPOCH"); then
    ORPHAN_TAIL_MARKER="$STREAM_DIR/.orphan-tail"
    {
        printf 'status=ORPHAN_TAIL\n'
        printf 'created_at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
        printf 'channel=%s\n' "$CHANNEL"
        printf 'date=%s\n' "$DATE"
        printf 'stream_dir=%s\n' "$STREAM_DIR"
        printf 'source_video=%s\n' "$SOURCE_VIDEO"
        printf 'source_duration_seconds=%s\n' "$SOURCE_DURATION"
        printf '%s\n' "$ORPHAN_TAIL_REASON"
    } > "$ORPHAN_TAIL_MARKER"
    mark_stalker_stage_done "$STREAM_DIR" "orphan-tail"
    log "ORPHAN_TAIL: $ORPHAN_TAIL_REASON"
    log "ORPHAN_TAIL: wrote $ORPHAN_TAIL_MARKER; skipping remux/process/archive/notify"
    exit 0
fi

if [[ "$SOURCE_VIDEO" == *.ts ]] && [ "$SOURCE_VIDEO" != "$TARGET_VIDEO" ]; then
    if stalker_stage_done "$STREAM_DIR" "0-remux" && [ -f "$TARGET_VIDEO" ]; then
        log "Remux stage complete, using existing $TARGET_VIDEO"
    else
        log "Remuxing transport stream to mp4: $SOURCE_VIDEO -> $TARGET_VIDEO"
        ffmpeg -nostdin -y -i "$SOURCE_VIDEO" -c copy "$TARGET_VIDEO" 2> "$STREAM_DIR/.remux.log"
        mark_stalker_stage_done "$STREAM_DIR" "0-remux"
    fi
elif [ -f "$TARGET_VIDEO" ]; then
    log "Video already in place: $TARGET_VIDEO"
else
    TARGET_VIDEO="$SOURCE_VIDEO"
fi

if [ ! -f "$TARGET_CHAT" ]; then
    log "WARNING: No chat log found"
    TARGET_CHAT=""
fi

CHAT_LINES=$(count_chat_lines "$TARGET_CHAT")
VIDEO_SIZE=$(du -sh "$TARGET_VIDEO" | cut -f1)
log "Ready: ${VIDEO_SIZE} video, ${CHAT_LINES} chat messages"

if stalker_stage_done "$STREAM_DIR" "process"; then
    log "Process stage complete, skipping process-stream.sh"
else
    log "Starting process-stream.sh..."
    "$SCRIPT_DIR/process-stream.sh" "$TARGET_VIDEO" "$TARGET_CHAT"
    mark_stalker_stage_done "$STREAM_DIR" "process"
fi

if [ "${STREAM_AUTO_ARCHIVE:-1}" != "0" ]; then
    if stalker_stage_done "$STREAM_DIR" "archive"; then
        log "Archive stage complete, skipping archive-stream.sh"
    else
        log "Starting archive-stream.sh..."
        "$SCRIPT_DIR/archive-stream.sh" "$STREAM_DIR"
        mark_stalker_stage_done "$STREAM_DIR" "archive"
    fi
else
    log "STREAM_AUTO_ARCHIVE=0 — skipping Brain Drive archive."
fi

GEM_COUNT=0
GEMS_FILE="$STREAM_DIR/gems.md"
if [ -f "$GEMS_FILE" ]; then
    GEM_COUNT=$(grep -c '^### \[' "$GEMS_FILE" 2>/dev/null || true)
    GEM_COUNT="${GEM_COUNT:-0}"
fi

CONTRACT_SCRIPT="${STALKER_CONTRACT_SCRIPT:-$SCRIPT_DIR/stalker-brainlayer-telegram.sh}"
BRAINLAYER_DRY_RUN=0
TELEGRAM_DRY_RUN=0
if [ "${STALKER_BRAINLAYER_DRY_RUN:-${STALKER_BRAIN_STORE_DRY_RUN:-0}}" = "1" ]; then
    BRAINLAYER_DRY_RUN=1
    TELEGRAM_DRY_RUN=1
elif [ "${STALKER_TELEGRAM_DRY_RUN:-0}" = "1" ]; then
    TELEGRAM_DRY_RUN=1
fi
DIGEST_QUALITY_STATUS=0
if ! stalker_stage_done "$STREAM_DIR" "notified"; then
    if ! stalker_require_run_quality "$STREAM_DIR" "$TARGET_CHAT" "digest"; then
        log "Pipeline quality gate failed; digest and notified marker remain open"
        DIGEST_QUALITY_STATUS=75
        # The quality gate just wrote new failure telemetry. Reopen BrainLayer
        # even if an earlier attempt completed; ingest-run skips already stored
        # payload keys and exports only the newly pending records.
        rm -f "$STREAM_DIR/.stage-brainlayer.done"
    else
        log "Starting Telegram digest..."
        if "$CONTRACT_SCRIPT" digest "$(dirname "$STREAM_DIR")" "$DATE"; then
            if [ "$TELEGRAM_DRY_RUN" = "1" ]; then
                log "Telegram digest dry-run complete; notified stage left open"
            else
                mark_stalker_stage_done "$STREAM_DIR" "notified"
            fi
        else
            log "WARNING: Telegram digest was not delivered; queued payloads are preserved for retry when available"
        fi
    fi
fi

if stalker_stage_done "$STREAM_DIR" "brainlayer"; then
    log "BrainLayer stage complete, skipping contract ingest"
else
    BRAINLAYER_INGEST_TIMEOUT="${STALKER_BRAINLAYER_INGEST_TIMEOUT:-15m}"
    if [ "$BRAINLAYER_DRY_RUN" = "1" ]; then
        log "Starting BrainLayer contract dry-run..."
        if ! "$CONTRACT_SCRIPT" ingest-run "$STREAM_DIR" --dry-run; then
            log "WARNING: BrainLayer contract dry-run failed"
        fi
    else
        BRAINLAYER_TIMEOUT_BIN="$(stalker_resolve_command timeout || stalker_resolve_command gtimeout || true)"
        if [ -z "$BRAINLAYER_TIMEOUT_BIN" ]; then
            log "timeout/gtimeout not found; using built-in BrainLayer watchdog"
        fi
        log "Starting BrainLayer contract ingest (timeout: ${BRAINLAYER_INGEST_TIMEOUT})..."
        ingest_status=0
        run_with_stalker_timeout "$BRAINLAYER_TIMEOUT_BIN" "$BRAINLAYER_INGEST_TIMEOUT" \
            "$CONTRACT_SCRIPT" ingest-run "$STREAM_DIR" || ingest_status=$?
        if [ "$ingest_status" -eq 124 ] || [ "$ingest_status" -eq 137 ]; then
            log "WARNING: BrainLayer contract ingest timed out; queueing unfinished payloads for replay"
            queue_brainlayer_replay "$STREAM_DIR" "brain_store_timeout" || true
        elif [ "$ingest_status" -ne 0 ]; then
            log "WARNING: BrainLayer contract ingest failed; queueing unfinished payloads for replay"
            queue_brainlayer_replay "$STREAM_DIR" "brain_store_failed" || true
        fi
        notify_brainlayer_queue "$STREAM_DIR"
    fi
fi

if [ "$DIGEST_QUALITY_STATUS" -ne 0 ]; then
    exit "$DIGEST_QUALITY_STATUS"
fi

if command -v notify &> /dev/null; then
    notify "Stream Processed" "${CHANNEL} ${DATE}: ${VIDEO_SIZE}, ${CHAT_LINES} chat msgs, ${GEM_COUNT} gems"
fi

if [[ "$STARTED_EPOCH" =~ ^[0-9]+$ ]] && [ "$STARTED_EPOCH" -gt 0 ]; then
    FINISHED_EPOCH=$(date +%s)
    log "Elapsed since recording start: $(stalker_format_duration $((FINISHED_EPOCH - STARTED_EPOCH)))"
fi

log "=== Done! Check: $STREAM_DIR/ ==="
