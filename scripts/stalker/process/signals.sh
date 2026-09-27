#!/bin/bash
# Sourced only by process-stream.sh; no top-level side effects.
# run_frame_stage globals (R): OUT_DIR, VIDEO, SPIKES_FILE, VOLUME_FILE;
# (W): none cross-stage. Files: quiet-frames.txt, frames/*, .stage-2-frames.done.
# run_signal_stage globals (R): OUT_DIR, STREAMER, DATE, SPIKES_FILE, CHAT_LOG,
# CHAT_TIMESTAMPS_ARE_RELATIVE, TRANSCRIPT; (W): SIGNALS_FILE. Files:
# signals-combined.md, chat-velocity.txt, chat-clip-markers.txt,
# .stage-3-signals.done. Scratch counters remain in the function shell.

run_frame_stage() {
# --- 2a: Extract frames at volume spike timestamps ---
if stalker_stage_done "$OUT_DIR" "2-frames"; then
    log "Pass 2a: Stage complete, skipping frame extraction"
else
log "Pass 2a: Extracting frames at spike timestamps..."
SPIKE_TIMESTAMPS=()
while IFS= read -r line; do
    [[ "$line" == "#"* ]] && continue
    TS=$(echo "$line" | awk '{print $1}')
    [ -n "$TS" ] && SPIKE_TIMESTAMPS+=("$TS")
done < "$SPIKES_FILE"

# Also extract periodic frames during silent stretches (every 60s when volume < avg)
# This catches visual-only gems (e.g., browsing Twitter silently)
python3 -c "
lines = [l.strip().split() for l in open('$VOLUME_FILE') if l.strip()]
vals = [(int(l[0]), float(l[1])) for l in lines if len(l) == 2]
avg = sum(v for _,v in vals) / len(vals) if vals else 0.01
# Find runs of 3+ consecutive low-volume windows (30s+ of quiet)
quiet_starts = []
run_start = None
run_count = 0
for t, v in vals:
    if v < avg * 0.5:
        if run_start is None: run_start = t
        run_count += 1
    else:
        if run_count >= 3:
            # Sample one frame per 60s in the quiet stretch
            for qt in range(run_start, t, 60):
                quiet_starts.append(qt)
        run_start = None
        run_count = 0
for t in quiet_starts:
    print(t)
" > "$OUT_DIR/quiet-frames.txt" 2>/dev/null

FRAME_COUNT=0
for TS in ${SPIKE_TIMESTAMPS[@]+"${SPIKE_TIMESTAMPS[@]}"}; do
    MINS=$((TS / 60))
    SECS=$((TS % 60))
    FNAME="frame-${MINS}m${SECS}s.jpg"
    if [ ! -f "$OUT_DIR/frames/$FNAME" ]; then
        ffmpeg -nostdin -ss "$TS" -i "$VIDEO" -vframes 1 -q:v 3 "$OUT_DIR/frames/$FNAME" -y 2>/dev/null
        FRAME_COUNT=$((FRAME_COUNT + 1))
    fi
done

# Quiet-period frames
while IFS= read -r TS; do
    [ -z "$TS" ] && continue
    MINS=$((TS / 60))
    SECS=$((TS % 60))
    FNAME="frame-quiet-${MINS}m${SECS}s.jpg"
    if [ ! -f "$OUT_DIR/frames/$FNAME" ]; then
        ffmpeg -nostdin -ss "$TS" -i "$VIDEO" -vframes 1 -q:v 3 "$OUT_DIR/frames/$FNAME" -y 2>/dev/null
        FRAME_COUNT=$((FRAME_COUNT + 1))
    fi
done < "$OUT_DIR/quiet-frames.txt"

log "  Extracted $FRAME_COUNT new frames ($(ls "$OUT_DIR/frames/" | wc -l | tr -d ' ') total)"
mark_stalker_stage_done "$OUT_DIR" "2-frames"
fi
}

run_signal_stage() {
# Build a combined signal file for scoring
SIGNALS_FILE="$OUT_DIR/signals-combined.md"
if stalker_stage_done "$OUT_DIR" "3-signals" && [ -f "$SIGNALS_FILE" ]; then
    log "Pass 3: Stage complete, skipping combined signal rebuild"
else
log "Pass 3: Building combined signal file..."

echo "# Combined Signals: ${STREAMER} (${DATE})" > "$SIGNALS_FILE"
echo "" >> "$SIGNALS_FILE"

echo "## Volume Spikes" >> "$SIGNALS_FILE"
cat "$SPIKES_FILE" >> "$SIGNALS_FILE"
echo "" >> "$SIGNALS_FILE"

echo "## Chat Analysis" >> "$SIGNALS_FILE"
if [ -n "$CHAT_LOG" ] && [ -f "$CHAT_LOG" ]; then
    CHAT_TOTAL=$(wc -l < "$CHAT_LOG")
    echo "Total messages: $CHAT_TOTAL" >> "$SIGNALS_FILE"
    echo "" >> "$SIGNALS_FILE"

    # Chat velocity: messages per 10-second window
    VELOCITY_FILE="$OUT_DIR/chat-velocity.txt"
    log "  Measuring chat velocity..."
    write_chat_velocity "$CHAT_LOG" "$VELOCITY_FILE" "$CHAT_TIMESTAMPS_ARE_RELATIVE" 2>/dev/null

    echo "### Chat Velocity Spikes (>2x average):" >> "$SIGNALS_FILE"
    grep "<<<" "$VELOCITY_FILE" >> "$SIGNALS_FILE" 2>/dev/null || echo "  None" >> "$SIGNALS_FILE"
    echo "" >> "$SIGNALS_FILE"

    # Chat clip markers (!clip, CLIP, editor markers)
    CLIP_MARKERS="$OUT_DIR/chat-clip-markers.txt"
    log "  Finding chat clip markers (!clip, editor marks)..."
    grep -iE '!clip|CLIP IT|clip that|that was good|editor|highlight|bookmark' "$CHAT_LOG" > "$CLIP_MARKERS" 2>/dev/null || true
    MARKER_COUNT=$(wc -l < "$CLIP_MARKERS" 2>/dev/null | tr -d ' ')
    if [ "$MARKER_COUNT" -gt 0 ]; then
        echo "### Chat Clip Markers ($MARKER_COUNT found):" >> "$SIGNALS_FILE"
        cat "$CLIP_MARKERS" >> "$SIGNALS_FILE"
        echo "" >> "$SIGNALS_FILE"
        log "  Found $MARKER_COUNT clip markers in chat"
    fi

    echo "### First 30 messages:" >> "$SIGNALS_FILE"
    head -30 "$CHAT_LOG" >> "$SIGNALS_FILE"
else
    echo "No chat log available" >> "$SIGNALS_FILE"
fi
echo "" >> "$SIGNALS_FILE"

echo "## Transcript" >> "$SIGNALS_FILE"
cat "$TRANSCRIPT" >> "$SIGNALS_FILE"
echo "" >> "$SIGNALS_FILE"

echo "## Frames Extracted" >> "$SIGNALS_FILE"
ls "$OUT_DIR/frames/" >> "$SIGNALS_FILE" 2>/dev/null || echo "None" >> "$SIGNALS_FILE"

log "  Combined signals written to $SIGNALS_FILE"
mark_stalker_stage_done "$OUT_DIR" "3-signals"
fi
}
