#!/bin/bash
# Stream Overnight Monitor — watchdog + morning summary generator.
# Watches the stalker-golem pipeline, ensures nothing dies, and
# prepares a summary when the stream ends and pipeline completes.
#
# Usage: stream-overnight-monitor.sh [channel] [date]
# Example: stream-overnight-monitor.sh theo 2026-03-12

set -euo pipefail

CHANNEL="${1:-theo}"
DATE="${2:-$(date +%Y-%m-%d)}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STREAM_ROOT="$HOME/Gits/golems/docs.local/stalker-golem"
STREAM_DIR="${STALKER_RUN_DIR:-$STREAM_ROOT/${CHANNEL}-${DATE}}"
CHECK_INTERVAL=600  # 10 minutes

log() { echo "[monitor $(date '+%H:%M:%S')] $1"; }

notify() {
    local title="$1"
    local body="$2"
    curl -s -X POST http://localhost:3847/notify \
        -H "Content-Type: application/json" \
        -d "{\"title\":\"$title\",\"body\":\"$body\",\"priority\":\"default\"}" \
        > /dev/null 2>&1 || true
}

# Track state
LAST_VIDEO_SIZE=0
VIDEO_STALL_COUNT=0
RECORDING_DONE=false

check_delivery() {
    if [ -z "${STALKER_RUN_DIR:-}" ]; then
        for candidate in "$STREAM_ROOT/${CHANNEL}-${DATE}"-*; do
            [ ! -d "$candidate" ] || STREAM_DIR="$candidate"
        done
    fi
    local receipt
    if receipt=$(node "$SCRIPT_DIR/stalker-run-contract.mjs" "$STREAM_DIR" 2>&1); then
        local dashboard_url
        dashboard_url=$(printf '%s' "$receipt" | node -e 'let s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>console.log(JSON.parse(s).dashboardUrl))')
        printf '# Morning Summary: %s (%s)\n\n## Pipeline Status: COMPLETE\n\nDashboard: %s\n' "$CHANNEL" "$DATE" "$dashboard_url" > "$STREAM_DIR/morning-summary.md"
        log "PIPELINE COMPLETE — verified dashboard and notification: $dashboard_url"
        return 0
    fi
    if [ "${STALKER_MONITOR_ONCE:-0}" = "1" ]; then log "$receipt"; fi
    return 75
}

if [ "${STALKER_MONITOR_ONCE:-0}" = "1" ]; then
    check_delivery
    exit $?
fi

log "=== Overnight Monitor: ${CHANNEL} (${DATE}) ==="
log "Stream dir: $STREAM_DIR"
log "Check interval: ${CHECK_INTERVAL}s"
notify "Monitor Started" "Watching ${CHANNEL} stream overnight. Will notify when pipeline completes."

while true; do
    if check_delivery; then exit 0; fi
    # --- Check 1: Is stream-watcher process alive? ---
    WATCHER_PID=$(pgrep -f "stream-watcher.sh.*${CHANNEL}" || echo "")
    if [ -z "$WATCHER_PID" ]; then
        log "WARNING: stream-watcher not running! Restarting via launchd..."
        launchctl stop com.golems.stream-watcher 2>/dev/null || true
        sleep 2
        launchctl start com.golems.stream-watcher 2>/dev/null || true
        notify "Watcher Restarted" "stream-watcher died, restarted via launchd"
        sleep 10
        continue
    fi

    # --- Check 2: Is video file growing? ---
    VIDEO_FILE="$STREAM_DIR/video.mp4"
    if [ -f "$VIDEO_FILE" ]; then
        CURRENT_SIZE=$(stat -f%z "$VIDEO_FILE" 2>/dev/null || echo 0)
        VIDEO_SIZE_MB=$((CURRENT_SIZE / 1024 / 1024))

        if [ "$CURRENT_SIZE" -eq "$LAST_VIDEO_SIZE" ] && [ "$CURRENT_SIZE" -gt 0 ] && [ "$RECORDING_DONE" = false ]; then
            VIDEO_STALL_COUNT=$((VIDEO_STALL_COUNT + 1))
            log "Video stalled at ${VIDEO_SIZE_MB}MB (stall count: ${VIDEO_STALL_COUNT})"

            if [ "$VIDEO_STALL_COUNT" -ge 3 ]; then
                # Video hasn't grown in 30 min — stream probably ended
                RECORDING_DONE=true
                log "Recording appears done (${VIDEO_SIZE_MB}MB, stalled ${VIDEO_STALL_COUNT} checks)"
            fi
        else
            VIDEO_STALL_COUNT=0
            if [ "$RECORDING_DONE" = false ]; then
                log "Recording healthy: ${VIDEO_SIZE_MB}MB (+$((( CURRENT_SIZE - LAST_VIDEO_SIZE ) / 1024 / 1024))MB)"
            fi
        fi
        LAST_VIDEO_SIZE=$CURRENT_SIZE
    else
        log "No video file yet"
    fi

    # --- Check 3: Is yt-dlp still downloading? ---
    YTDLP_PID=$(pgrep -f "yt-dlp.*${CHANNEL}" || echo "")
    if [ -z "$YTDLP_PID" ] && [ "$RECORDING_DONE" = false ] && [ -f "$VIDEO_FILE" ]; then
        RECORDING_DONE=true
        VIDEO_SIZE_MB=$(( $(stat -f%z "$VIDEO_FILE" 2>/dev/null || echo 0) / 1024 / 1024 ))
        log "yt-dlp finished — recording done (${VIDEO_SIZE_MB}MB)"
        notify "Recording Done" "${CHANNEL} stream ended. ${VIDEO_SIZE_MB}MB recorded. Pipeline processing..."
    fi

    # --- Check 4: Has process-stream.sh started? ---
    PROCESS_PID=$(pgrep -f "process-stream.sh" || echo "")
    if [ -n "$PROCESS_PID" ]; then
        log "Pipeline running (PID: $PROCESS_PID)"
    fi

    log "Delivery is not verified yet; gems or legacy markers alone do not complete a run."

    # --- Check 6: Video file still exists (not deleted) ---
    if [ "$RECORDING_DONE" = true ] && [ ! -f "$VIDEO_FILE" ]; then
        log "ALERT: Video file disappeared! Was at ${LAST_VIDEO_SIZE} bytes."
        notify "VIDEO DELETED" "${CHANNEL} video.mp4 disappeared! Check stalker-golem dir."
    fi

    sleep "$CHECK_INTERVAL"
done
