#!/bin/bash
# Sourced only by process-stream.sh; no top-level side effects.
# run_audio_stages globals (R): VIDEO, OUT_DIR, STREAMER, DATE, WHISPER_MODEL,
# SEGMENT_MIN_DURATION, SILENCE_THRESHOLD, SILENCE_DURATION, VOLUME_SPIKE_RATIO.
# Globals (W): AUDIO, SILENCES, VOLUME_FILE, SPIKES_FILE, TRANSCRIPT, SEG_NUM,
# FAILED_SEGMENTS. Files: full-audio.wav, silences.txt, volume-per-10s.txt,
# volume-spikes.txt, transcript.md, segment WAVs and the 1a-1e stage markers.

run_audio_stages() {
# --- 1a: Extract audio ---
AUDIO="$OUT_DIR/full-audio.wav"
if stalker_stage_done "$OUT_DIR" "1a-audio" && [ -f "$AUDIO" ]; then
    log "Pass 1a: Stage complete, skipping audio extraction"
elif [ ! -f "$AUDIO" ]; then
    log "Pass 1a: Extracting audio..."
    ffmpeg -i "$VIDEO" -vn -acodec pcm_s16le -ar 16000 -ac 1 "$AUDIO" -y 2>/dev/null
    log "  Audio extracted: $(du -sh "$AUDIO" | cut -f1)"
    mark_stalker_stage_done "$OUT_DIR" "1a-audio"
else
    log "Pass 1a: Audio exists, skipping extraction"
    mark_stalker_stage_done "$OUT_DIR" "1a-audio"
fi

# --- 1b: Detect silence boundaries ---
# Note: -nostats suppresses ffmpeg's progress reporter so it can't interleave
# into silencedetect output. parse_silence_timestamps also filters non-numeric
# garbage as defense in depth (see lib/stream-helpers.sh).
SILENCES="$OUT_DIR/silences.txt"
if stalker_stage_done "$OUT_DIR" "1b-silences" && [ -f "$SILENCES" ]; then
    log "Pass 1b: Stage complete, skipping silence detection"
elif [ ! -f "$SILENCES" ]; then
    log "Pass 1b: Detecting silence boundaries..."
    ffmpeg -nostats -hide_banner -i "$AUDIO" -af "silencedetect=noise=${SILENCE_THRESHOLD}dB:d=${SILENCE_DURATION}" -f null - 2>&1 \
      | parse_silence_timestamps \
      > "$SILENCES"
    log "  Found $(wc -l < "$SILENCES") silence boundaries"
    mark_stalker_stage_done "$OUT_DIR" "1b-silences"
else
    log "Pass 1b: Silences file exists, skipping"
    mark_stalker_stage_done "$OUT_DIR" "1b-silences"
fi

# --- 1c: Volume per 10-second window ---
VOLUME_FILE="$OUT_DIR/volume-per-10s.txt"
if stalker_stage_done "$OUT_DIR" "1c-volume" && [ -f "$VOLUME_FILE" ]; then
    log "Pass 1c: Stage complete, skipping volume measurement"
elif [ ! -f "$VOLUME_FILE" ]; then
    log "Pass 1c: Measuring volume per 10s window..."
    # ffprobe emits "N/A" (or nothing) when a container lacks duration metadata.
    # An empty/non-integer DURATION makes `for (( t=0; t<DURATION ))` abort with
    # a bash arithmetic "syntax error in expression" — the same class as the old
    # ffmpeg-progress `elapsed=0:00:01` leak. Parse to an integer first.
    DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$AUDIO" 2>/dev/null | cut -d. -f1)
    [[ "$DURATION" =~ ^[0-9]+$ ]] || DURATION=0
    : > "$VOLUME_FILE"
    for ((t=0; t<DURATION; t+=10)); do
        RMS=$(sox "$AUDIO" -n trim "$t" 10 stat 2>&1 | grep "RMS.*amplitude" | head -1 | awk '{print $NF}' 2>/dev/null || echo "0")
        echo "$t $RMS" >> "$VOLUME_FILE"
    done
    log "  Volume measured: $(wc -l < "$VOLUME_FILE") windows"
    mark_stalker_stage_done "$OUT_DIR" "1c-volume"
else
    log "Pass 1c: Volume file exists, skipping"
    mark_stalker_stage_done "$OUT_DIR" "1c-volume"
fi

# --- 1d: Find volume spikes ---
SPIKES_FILE="$OUT_DIR/volume-spikes.txt"
if stalker_stage_done "$OUT_DIR" "1d-spikes" && [ -f "$SPIKES_FILE" ]; then
    log "Pass 1d: Stage complete, skipping volume spike detection"
else
log "Pass 1d: Finding volume spikes (>${VOLUME_SPIKE_RATIO}x average)..."
python3 -c "
import sys
lines = [l.strip().split() for l in open('$VOLUME_FILE') if l.strip()]
vals = [(int(l[0]), float(l[1])) for l in lines if len(l) == 2 and float(l[1]) > 0.0001]
if not vals:
    sys.exit(0)
avg = sum(v for _,v in vals) / len(vals)
threshold = avg * $VOLUME_SPIKE_RATIO
spikes = [(t, v, v/avg) for t,v in vals if v > threshold]
spikes.sort(key=lambda x: -x[2])
with open('$SPIKES_FILE', 'w') as f:
    f.write(f'# Average RMS: {avg:.6f}  Threshold: {threshold:.6f}\n')
    for t, v, ratio in spikes[:20]:
        mins, secs = divmod(t, 60)
        f.write(f'{t} {v:.6f} {ratio:.1f}x [{mins:02d}:{secs:02d}]\n')
print(f'  Found {len(spikes)} spikes (top 20 saved)')
"
touch "$SPIKES_FILE"  # ensure file exists even if no spikes found
head -5 "$SPIKES_FILE"
mark_stalker_stage_done "$OUT_DIR" "1d-spikes"
fi

# --- 1e: Segment and transcribe ---
TRANSCRIPT="$OUT_DIR/transcript.md"
if stalker_stage_done "$OUT_DIR" "1e-transcript" && [ -f "$TRANSCRIPT" ]; then
    log "Pass 1e: Stage complete, skipping transcription"
    SEG_NUM=$(grep -c "^## \[" "$TRANSCRIPT" || echo 0)
    FAILED_SEGMENTS=$(grep -c "transcription unavailable" "$TRANSCRIPT" || true)
elif [ ! -f "$TRANSCRIPT" ]; then
    log "Pass 1e: Segmenting and transcribing..."
    echo "# Stream Transcript: ${STREAMER} (${DATE})" > "$TRANSCRIPT"
    echo "" >> "$TRANSCRIPT"

    PREV_END=0
    SEG_NUM=0
    DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$AUDIO" 2>/dev/null | cut -d. -f1)
    # Guard against ffprobe returning "N/A"/empty: a non-integer DURATION becomes
    # the end marker below and would crash the SEGMENT_DURATION arithmetic.
    [[ "$DURATION" =~ ^[0-9]+$ ]] || DURATION=0

    # Work with a copy of silences + end marker
    SILENCES_WORK=$(mktemp)
    cp "$SILENCES" "$SILENCES_WORK"
    echo "$DURATION" >> "$SILENCES_WORK"

    while IFS= read -r SILENCE_END; do
        END=$(echo "$SILENCE_END" | cut -d. -f1)
        SEGMENT_DURATION=$((END - PREV_END))

        [ "$SEGMENT_DURATION" -lt "$SEGMENT_MIN_DURATION" ] && continue

        SEG_NUM=$((SEG_NUM + 1))
        SEG_FILE="$OUT_DIR/segment-$(printf '%03d' $SEG_NUM).wav"

        ffmpeg -nostdin -i "$AUDIO" -ss "$PREV_END" -to "$END" -y "$SEG_FILE" 2>/dev/null

        if ! TRANSCRIPTION=$(transcribe_segment_with_fallback "$SEG_FILE" "$WHISPER_MODEL" "$SEG_NUM" "$OUT_DIR"); then
            FAILED_SEGMENTS=$((FAILED_SEGMENTS + 1))
            TRANSCRIPTION="[transcription unavailable; see $OUT_DIR/transcription-failures.log; audio retained at $SEG_FILE]"
        fi

        MINS=$((PREV_END / 60))
        SECS=$((PREV_END % 60))
        TIMESTAMP=$(printf "%02d:%02d" $MINS $SECS)

        echo "## [$TIMESTAMP] Segment $SEG_NUM (${SEGMENT_DURATION}s)" >> "$TRANSCRIPT"
        echo "" >> "$TRANSCRIPT"
        echo "$TRANSCRIPTION" >> "$TRANSCRIPT"
        echo "" >> "$TRANSCRIPT"

        log "  Segment $SEG_NUM [$TIMESTAMP] (${SEGMENT_DURATION}s): $(echo "$TRANSCRIPTION" | head -1 | cut -c1-60)..."

        PREV_END=$END
    done < "$SILENCES_WORK"
    rm -f "$SILENCES_WORK"

    log "  Transcription complete: $SEG_NUM segments ($FAILED_SEGMENTS failed)"
    mark_stalker_stage_done "$OUT_DIR" "1e-transcript"
else
    log "Pass 1e: Transcript exists, skipping"
    SEG_NUM=$(grep -c "^## \[" "$TRANSCRIPT" || echo 0)
    FAILED_SEGMENTS=$(grep -c "transcription unavailable" "$TRANSCRIPT" || true)
    mark_stalker_stage_done "$OUT_DIR" "1e-transcript"
fi
}
