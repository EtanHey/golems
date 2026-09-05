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
STREAM_DIR="$HOME/Gits/golems/docs.local/stalker-golem/${CHANNEL}-${DATE}"
CHECK_INTERVAL=600  # 10 minutes
SUMMARY_FILE="$STREAM_DIR/morning-summary.md"

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
PIPELINE_DONE=false
RECORDING_DONE=false

log "=== Overnight Monitor: ${CHANNEL} (${DATE}) ==="
log "Stream dir: $STREAM_DIR"
log "Check interval: ${CHECK_INTERVAL}s"
notify "Monitor Started" "Watching ${CHANNEL} stream overnight. Will notify when pipeline completes."

while true; do
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

    # --- Check 5: Did pipeline complete? (gems.md or transcript.md exists) ---
    GEMS_FILE="$STREAM_DIR/gems.md"
    TRANSCRIPT="$STREAM_DIR/transcript.md"

    if [ -f "$GEMS_FILE" ] && [ "$PIPELINE_DONE" = false ]; then
        PIPELINE_DONE=true
        log "PIPELINE COMPLETE — gems.md found!"

        # Count gems and get stats
        GEM_COUNT=$(grep -c "^### \[" "$GEMS_FILE" 2>/dev/null || echo 0)
        CHAT_LINES=$(wc -l < "$STREAM_DIR/chat.log" 2>/dev/null || echo 0)
        TRANSCRIPT_SEGS=$(grep -c "^## \[" "$TRANSCRIPT" 2>/dev/null || echo 0)
        CLIP_COUNT=$(ls "$STREAM_DIR/clips/" 2>/dev/null | wc -l | tr -d ' ')
        FRAME_COUNT=$(ls "$STREAM_DIR/frames/" 2>/dev/null | wc -l | tr -d ' ')
        VIDEO_SIZE_MB=$(( $(stat -f%z "$VIDEO_FILE" 2>/dev/null || echo 0) / 1024 / 1024 ))
        DISK_TOTAL=$(du -sh "$STREAM_DIR" | cut -f1)

        # --- Build morning summary ---
        log "Building morning summary..."
        cat > "$SUMMARY_FILE" << SUMMARY_EOF
# Morning Summary: ${CHANNEL} (${DATE})

## Pipeline Status: COMPLETE

| Metric | Value |
|--------|-------|
| Video | ${VIDEO_SIZE_MB}MB |
| Chat messages | ${CHAT_LINES} |
| Transcript segments | ${TRANSCRIPT_SEGS} |
| Gems found | ${GEM_COUNT} |
| Clips extracted | ${CLIP_COUNT} |
| Frames captured | ${FRAME_COUNT} |
| Total disk | ${DISK_TOTAL} |

## Top Gems

$(head -80 "$GEMS_FILE" | grep -A3 "^### \[" || echo "No gems found")

## Files

- Video: \`${VIDEO_FILE}\`
- Gems: \`${GEMS_FILE}\`
- Transcript: \`${TRANSCRIPT}\`
- Chat: \`${STREAM_DIR}/chat.log\`
- Clips: \`${STREAM_DIR}/clips/\`
- Frames: \`${STREAM_DIR}/frames/\`
SUMMARY_EOF

        log "Morning summary written to $SUMMARY_FILE"

        # --- Notify ---
        notify "Stream Pipeline Done" "${CHANNEL}: ${GEM_COUNT} gems, ${TRANSCRIPT_SEGS} segments, ${CLIP_COUNT} clips. Summary ready."

        # --- Verify nothing got deleted ---
        MISSING=""
        [ ! -f "$VIDEO_FILE" ] && MISSING="${MISSING} video.mp4"
        [ ! -f "$TRANSCRIPT" ] && MISSING="${MISSING} transcript.md"
        [ ! -f "$GEMS_FILE" ] && MISSING="${MISSING} gems.md"

        if [ -n "$MISSING" ]; then
            log "WARNING: Missing files:${MISSING}"
            notify "Pipeline Warning" "Missing files:${MISSING}"
        else
            log "All pipeline outputs verified present."
        fi

        log "Monitor done. Summary at: $SUMMARY_FILE"
        exit 0

    elif [ "$RECORDING_DONE" = true ] && [ "$PIPELINE_DONE" = false ]; then
        # Recording done but pipeline hasn't produced gems yet
        if [ -f "$TRANSCRIPT" ]; then
            log "Pipeline in progress: transcript exists, waiting for gems..."
        else
            log "Waiting for pipeline to start/complete..."
        fi
    fi

    # --- Check 6: Video file still exists (not deleted) ---
    if [ "$RECORDING_DONE" = true ] && [ ! -f "$VIDEO_FILE" ]; then
        log "ALERT: Video file disappeared! Was at ${LAST_VIDEO_SIZE} bytes."
        notify "VIDEO DELETED" "${CHANNEL} video.mp4 disappeared! Check stalker-golem dir."
    fi

    sleep "$CHECK_INTERVAL"
done
