#!/bin/bash
# Process a recorded Twitch stream — multi-signal gem detection pipeline.
# Usage: process-stream.sh <video-file> [chat-log] [--json-output] [--chat-json]
#
# Pipeline:
#   Pass 1: Audio → transcript + silence boundaries + volume spikes
#   Pass 2: Video → frames at candidate timestamps + 10s clips at gems
#   Pass 3: Score via agy or local fallback CLI (combines all signals)
#   Pass 4: Clip extraction (if gems.md exists)
#   Pass 5: Generate gems-manifest.json (if --json-output)
#
# All output goes next to the video file (data stays together).

set -euo pipefail

# Parse positional + flag arguments
VIDEO=""
CHAT_LOG=""
JSON_OUTPUT=false
CHAT_IS_JSON=false
CHAT_TIMESTAMPS_ARE_RELATIVE=false
# Force a re-score: clear gems.md + notify/scoring markers so a re-process
# actually re-processes instead of silently skipping on existing artifacts.
# Settable via env (STALKER_FORCE_RESCORE=1) or the --rescore flag.
STALKER_FORCE_RESCORE="${STALKER_FORCE_RESCORE:-0}"

for arg in "$@"; do
    case "$arg" in
        --json-output) JSON_OUTPUT=true ;;
        --chat-json)   CHAT_IS_JSON=true ;;
        --rescore)     STALKER_FORCE_RESCORE=1 ;;
        *)
            if [ -z "$VIDEO" ]; then
                VIDEO="$arg"
            elif [ -z "$CHAT_LOG" ]; then
                CHAT_LOG="$arg"
            fi
            ;;
    esac
done

[ -z "$VIDEO" ] && { echo "Usage: process-stream.sh <video-file> [chat-log] [--json-output] [--chat-json] [--rescore]"; exit 1; }
OUT_DIR="$(dirname "$VIDEO")"

derive_stream_labels() {
    local video_base parent_base fallback_date base_no_ext
    video_base="$(basename "$VIDEO")"
    parent_base="$(basename "$OUT_DIR")"
    fallback_date="$(date +%Y-%m-%d)"

    if [[ "$video_base" =~ ^video\.(mp4|ts)$ ]] \
        && [[ "$parent_base" =~ ^(.+)-([0-9]{4})-([0-9]{2})-([0-9]{2})-[0-9]{6}$ ]]; then
        STREAMER="${BASH_REMATCH[1]}"
        DATE="${BASH_REMATCH[2]}-${BASH_REMATCH[3]}-${BASH_REMATCH[4]}"
        return
    fi

    if [[ "$video_base" =~ ^twitch-(.+)-([0-9]{4})-?([0-9]{2})-?([0-9]{2})\.[^.]+$ ]]; then
        STREAMER="${BASH_REMATCH[1]}"
        DATE="${BASH_REMATCH[2]}-${BASH_REMATCH[3]}-${BASH_REMATCH[4]}"
        return
    fi

    base_no_ext="${video_base%.*}"
    STREAMER=$(printf '%s\n' "$base_no_ext" | sed 's/^twitch-//;s/-[0-9]*$//')
    DATE="$fallback_date"
}

derive_stream_labels
WHISPER_MODEL="${WHISPER_MODEL:-$HOME/.cache/whisper/ggml-large-v3-turbo.bin}"
SEGMENT_MIN_DURATION=20
SILENCE_THRESHOLD="-30"
SILENCE_DURATION="2"
VOLUME_SPIKE_RATIO="1.3"  # flag timestamps where volume > 1.3x average
FAILED_SEGMENTS=0

mkdir -p "$OUT_DIR/frames" "$OUT_DIR/clips"

# shellcheck source=lib/stream-helpers.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/stream-helpers.sh"

log() { echo "[$(date '+%H:%M:%S')] $1"; }

if [ -z "$CHAT_LOG" ]; then
    for default_chat_log in "$OUT_DIR/chat.log" "$OUT_DIR/chat.txt" "$OUT_DIR/chat-converted.txt"; do
        if [ -f "$default_chat_log" ] && grep -qE '^\[[0-9]{2}:[0-9]{2}:[0-9]{2}\]' "$default_chat_log"; then
            CHAT_LOG="$default_chat_log"
            log "Using chat log from output directory: $(basename "$CHAT_LOG")"
            break
        fi
    done
fi

GEMS_FILE="$OUT_DIR/gems.md"
# Explicit re-score (--rescore / STALKER_FORCE_RESCORE=1): a human decided this
# stream must be re-processed. Clear gems.md and the notify/scoring markers so
# scoring AND the completion digest both run again — silent skip-on-existing is
# the same silent-failure class this whole change exists to kill.
if [ "$STALKER_FORCE_RESCORE" = "1" ]; then
    log "Pass 0: STALKER_FORCE_RESCORE=1 — clearing gems.md + notify/scoring markers for a full re-score"
    rm -f "$GEMS_FILE" \
        "$OUT_DIR/.stage-complete-notify.done" \
        "$OUT_DIR/.stage-notified.done" \
        "$OUT_DIR/.stage-scoring.failed" \
        "$OUT_DIR/.stage-scoring.started" \
        "$OUT_DIR/.stage-scoring.done"
fi
# Auto-detection: a gems.md that exists but did not run to completion (no
# "Scored:" footer — e.g. the scorer was killed mid-stream leaving a PARTIAL
# file with only the first few gems) must NOT be treated as done. The old check
# only caught a header-only file; a partial file with real gems slipped through
# and scoring was skipped entirely on re-run. stalker_gems_complete catches both.
if [ -f "$GEMS_FILE" ] && ! stalker_gems_complete "$GEMS_FILE"; then
    log "Pass 0: gems.md is incomplete (no completion footer / partial scoring) — removing so scoring re-runs"
    rm -f "$GEMS_FILE"
    # A partial run also never fired its digest; clear the notify marker so the
    # re-score's completion actually notifies instead of skipping on the marker.
    rm -f "$OUT_DIR/.stage-complete-notify.done"
fi
AGY_BIN=$(stalker_resolve_command agy || true)
CODEX_BIN=$(stalker_resolve_command codex || true)
CODEX_TIMEOUT_BIN=$(stalker_resolve_command timeout || stalker_resolve_command gtimeout || true)
if [ ! -f "$GEMS_FILE" ] && [ -z "$AGY_BIN" ] && [ -z "$CODEX_BIN" ]; then
    log "Pass 0: No local scoring CLI found (need agy or codex exec)"
    stalker_record_stage_failure "$OUT_DIR" "scoring" \
        "scorer preflight failed before expensive processing: agy and codex are absent from PATH and HOME/.local/bin" \
        "$CHAT_LOG"
    exit 75
fi
if [ ! -f "$GEMS_FILE" ] && [ -z "$AGY_BIN" ] && [ -n "$CODEX_BIN" ] && [ -z "$CODEX_TIMEOUT_BIN" ]; then
    log "Pass 0: Codex scorer requires timeout or gtimeout; refusing to begin expensive processing without a deadline"
    stalker_record_stage_failure "$OUT_DIR" "scoring" \
        "codex timeout preflight failed before expensive processing: timeout and gtimeout are absent from PATH and HOME/.local/bin" \
        "$CHAT_LOG"
    exit 75
fi

write_chat_velocity() {
    local chat_log="$1"
    local velocity_file="$2"
    local timestamps_are_relative="$3"

    python3 - "$chat_log" "$velocity_file" "$OUT_DIR" "$timestamps_are_relative" <<'PY'
import datetime
import os
import re
import sys
import time
from collections import Counter

chat_log, velocity_file, out_dir, timestamps_mode = sys.argv[1:5]
timestamps_are_relative = timestamps_mode == "true"
try:
    time.tzset()
except AttributeError:
    pass

lines = open(chat_log).readlines()
times = []
stream_start_epoch = None
previous_clock_secs = None
day_offset_secs = 0
base_name = os.path.basename(out_dir)
start_match = re.search(r'(\d{4}-\d{2}-\d{2})-(\d{6})$', base_name)
if start_match and not timestamps_are_relative:
    try:
        start_text = f'{start_match.group(1)} {start_match.group(2)}'
        # stream-watcher.sh names directories with local shell date, while its
        # chat lurker writes UTC HH:MM:SS via toISOString(). Convert the local
        # directory timestamp to UTC before comparing chat clock times.
        stream_start_local = datetime.datetime.strptime(start_text, '%Y-%m-%d %H%M%S').astimezone()
        stream_start_epoch = stream_start_local.timestamp()
        stream_start_utc = stream_start_local.astimezone(datetime.timezone.utc)
    except Exception:
        stream_start_epoch = None

for line in lines:
    m = re.match(r'\[(\d{2}):(\d{2}):(\d{2})\]', line)
    if not m:
        continue
    h, mi, s = int(m.group(1)), int(m.group(2)), int(m.group(3))
    clock_secs = h * 3600 + mi * 60 + s
    stream_secs = None
    if timestamps_are_relative:
        stream_secs = clock_secs
    elif stream_start_epoch is not None:
        if previous_clock_secs is not None and clock_secs < previous_clock_secs:
            day_offset_secs += 24 * 3600
        chat_utc = datetime.datetime.combine(
            stream_start_utc.date(),
            datetime.time(h, mi, s),
            tzinfo=datetime.timezone.utc,
        ).timestamp() + day_offset_secs
        # Live watcher chat timestamps are UTC clock times. If a stream crosses
        # UTC midnight, early next-day chat clocks are numerically before the
        # recording start time and must advance before candidate gating.
        while chat_utc < stream_start_epoch:
            chat_utc += 24 * 3600
        stream_secs = max(0, int(round(chat_utc - stream_start_epoch)))
    previous_clock_secs = clock_secs
    times.append((clock_secs, stream_secs))

if not times:
    print('No parseable timestamps')
    raise SystemExit(0)

# Keep the historical first-chat-relative bucket for display, and add
# stream= seconds when the chat source can be aligned to transcript time.
base = times[0][0]
buckets = Counter()
for clock_secs, stream_secs in times:
    rel_bucket = ((clock_secs - base) // 10) * 10
    stream_bucket = rel_bucket if stream_secs is None else (stream_secs // 10) * 10
    buckets[(rel_bucket, stream_bucket)] += 1

avg = len(times) / max(len(buckets), 1)
with open(velocity_file, 'w') as f:
    f.write(f'# Chat velocity (msgs per 10s) | avg: {avg:.1f}\n')
    for rel_bucket, stream_bucket in sorted(buckets):
        count = buckets[(rel_bucket, stream_bucket)]
        marker = ' <<<' if count > avg * 2 else ''
        mins, secs = divmod(rel_bucket, 60)
        stream_part = ''
        if timestamps_are_relative or stream_start_epoch is not None:
            smins, ssecs = divmod(stream_bucket, 60)
            stream_part = f' stream={stream_bucket} [{smins:02d}:{ssecs:02d}]'
        f.write(f'{rel_bucket} {count} [{mins:02d}:{secs:02d}]{stream_part}{marker}\n')

spikes = [(b, c) for b, c in buckets.items() if c > avg * 2]
print(f'  {len(times)} messages, {len(buckets)} windows, {len(spikes)} velocity spikes')
PY
}

# --- Convert JSON chat to text format if needed ---
if [ -n "$CHAT_LOG" ] && [ "$CHAT_IS_JSON" = true ] && [ -f "$CHAT_LOG" ]; then
    CHAT_TEXT="$OUT_DIR/chat-converted.txt"
    if [ ! -f "$CHAT_TEXT" ]; then
        log "Converting JSON chat to text format..."
        python3 -c "
import json
with open('$CHAT_LOG') as f:
    messages = json.load(f)
with open('$CHAT_TEXT', 'w') as f:
    for m in messages:
        secs = int(m.get('time_s', 0))
        h, rem = divmod(secs, 3600)
        mins, s = divmod(rem, 60)
        f.write(f'[{h:02d}:{mins:02d}:{s:02d}] {m[\"user\"]}: {m[\"message\"]}\n')
print(f'  Converted {len(messages)} messages')
" 2>/dev/null
    fi
    CHAT_LOG="$CHAT_TEXT"
    CHAT_TIMESTAMPS_ARE_RELATIVE=true
fi

if [ -n "$CHAT_LOG" ]; then
    case "$(basename "$CHAT_LOG")" in
        chat-converted.txt|chat.txt) CHAT_TIMESTAMPS_ARE_RELATIVE=true ;;
    esac
fi

# ============================================================
# PASS 1: AUDIO ANALYSIS (transcript + volume + silence)
# ============================================================

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

# ============================================================
# PASS 2: VISUAL ANALYSIS (frames + clips)
# ============================================================

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

# --- 2b: Clips extracted AFTER scoring (Pass 3 identifies gem timestamps) ---

# ============================================================
# PASS 3: SCORING (combine all signals)
# ============================================================

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

# --- 3b: Auto-score with local CLI model ---
if [ ! -f "$GEMS_FILE" ]; then
    if [ -n "$AGY_BIN" ] || [ -n "$CODEX_BIN" ]; then
        stalker_mark_scoring_started "$OUT_DIR" "$$"
        log "Pass 3b: Auto-scoring transcript candidate segments with local CLI model..."

        STALKER_AGY_MODEL="${STALKER_AGY_MODEL:-Gemini 3.1 Pro (High)}"
        # A scoring prompt that has not answered in ~45s is dead weight. The old
        # 5m default (commit 3a6fed6f, #558) meant a wedged agy burned the full
        # timeout on EVERY segment before the working codex exec fallback ran —
        # ~5m40s/segment turned a 5h stream into ~30h of scoring, so the
        # completion digest never fired in Etan's waking window (the recurring
        # Thursday "processing started, no results" failure). 45s is plenty for a
        # single JSON scoring reply; still overridable via env.
        STALKER_AGY_TIMEOUT="${STALKER_AGY_TIMEOUT:-45s}"
        # Codex CLI reads model + reasoning defaults from ~/.codex/config.toml.
        # This classification is small and structured, so pin both explicitly:
        # never let a workstation's interactive defaults silently turn every
        # segment into a max-reasoning call. The fallback also gets a hard
        # deadline so a wedged codex process cannot stall the whole stream.
        STALKER_CODEX_MODEL="${STALKER_CODEX_MODEL:-gpt-5.6-sol}"
        STALKER_CODEX_EFFORT="${STALKER_CODEX_EFFORT:-low}"
        STALKER_CODEX_TIMEOUT="${STALKER_CODEX_TIMEOUT:-120s}"
        # Circuit breaker: after this many consecutive agy failures/timeouts,
        # stop calling agy for the rest of the run and go straight to codex exec
        # (~37s vs ~5m40s per segment). A single agy success resets the counter,
        # so a transient blip never permanently disables the primary scorer.
        STALKER_AGY_CIRCUIT_THRESHOLD="${STALKER_AGY_CIRCUIT_THRESHOLD:-3}"
        # Bound concurrent segment scorers. Four is conservative enough for local
        # headless CLIs while cutting the serial critical path substantially.
        # STALKER_SCORE_PARALLEL=1 preserves the serial safety fallback.
        STALKER_SCORE_PARALLEL=$(stalker_score_parallel_limit "${STALKER_SCORE_PARALLEL:-}")
        # Heartbeat: while scoring can still take a while on long streams, surface
        # progress every N seconds instead of going silent for hours.
        STALKER_HEARTBEAT_SECS="${STALKER_HEARTBEAT_SECS:-900}"
        if ! [[ "$STALKER_HEARTBEAT_SECS" =~ ^[0-9]+$ ]]; then
            STALKER_HEARTBEAT_SECS=900
        fi
        STALKER_GEM_SCORE_WINDOW_SECS="${STALKER_GEM_SCORE_WINDOW_SECS:-10}"
        if ! [[ "$STALKER_GEM_SCORE_WINDOW_SECS" =~ ^[0-9]+$ ]]; then
            STALKER_GEM_SCORE_WINDOW_SECS=10
        fi

        if [ -n "$AGY_BIN" ]; then
            log "  Primary scorer: $AGY_BIN ($STALKER_AGY_MODEL)"
        else
            log "  agy not found; using $CODEX_BIN exec fallback"
        fi
        if [ -n "$CODEX_BIN" ]; then
            log "  Codex fallback: $CODEX_BIN (model=$STALKER_CODEX_MODEL, effort=$STALKER_CODEX_EFFORT, timeout=$STALKER_CODEX_TIMEOUT)"
        fi
        log "  Scoring concurrency: $STALKER_SCORE_PARALLEL"

        # Build volume spike lookup and chat spike lookup.
        SPIKE_TIMES=""
        if [ -f "$VOLUME_FILE" ]; then
            SPIKE_TIMES="${SPIKE_TIMES}$(python3 - "$VOLUME_FILE" "$VOLUME_SPIKE_RATIO" <<'PY' | tr '\n' ',' || echo ""
import sys

volume_file = sys.argv[1]
ratio = float(sys.argv[2])
vals = []
with open(volume_file) as f:
    for line in f:
        parts = line.strip().split()
        if len(parts) < 2:
            continue
        try:
            t = int(float(parts[0]))
            v = float(parts[1])
        except ValueError:
            continue
        if v > 0.0001:
            vals.append((t, v))

if vals:
    avg = sum(v for _, v in vals) / len(vals)
    threshold = avg * ratio
    for t, v in vals:
        if v > threshold:
            print(t)
PY
            )"
        fi
        if [ -f "$SPIKES_FILE" ]; then
            SPIKE_TIMES="${SPIKE_TIMES}$(grep -v "^#" "$SPIKES_FILE" | awk '{print $1}' | tr '\n' ',' || echo "")"
        fi
        if [ -n "$CHAT_LOG" ] && [ -f "$CHAT_LOG" ] && [ ! -f "$OUT_DIR/chat-velocity.txt" ]; then
            log "  Generating missing chat velocity with stream-relative spike times"
            write_chat_velocity "$CHAT_LOG" "$OUT_DIR/chat-velocity.txt" "$CHAT_TIMESTAMPS_ARE_RELATIVE" 2>/dev/null || true
        elif [ -n "$CHAT_LOG" ] && [ -f "$CHAT_LOG" ] && [ -f "$OUT_DIR/chat-velocity.txt" ] \
            && grep -q "<<<" "$OUT_DIR/chat-velocity.txt" \
            && ! awk '/<<</ && /stream=/{found=1} END{exit found ? 0 : 1}' "$OUT_DIR/chat-velocity.txt"; then
            log "  Rebuilding legacy chat velocity with stream-relative spike times"
            write_chat_velocity "$CHAT_LOG" "$OUT_DIR/chat-velocity.txt" "$CHAT_TIMESTAMPS_ARE_RELATIVE" 2>/dev/null || true
        fi
        CHAT_SPIKE_TIMES=""
        if [ -f "$OUT_DIR/chat-velocity.txt" ]; then
            CHAT_SPIKE_TIMES=$(awk '/<<</ {
                spike_time = ""
                for (i = 1; i <= NF; i++) {
                    if ($i ~ /^stream=[0-9]+$/) {
                        spike_time = $i
                        sub(/^stream=/, "", spike_time)
                        break
                    }
                }
                if (spike_time == "") {
                    spike_time = $1
                }
                if (spike_time ~ /^[0-9]+$/) {
                    print spike_time
                }
            }' "$OUT_DIR/chat-velocity.txt" | tr '\n' ',' || echo "")
        fi

        SCORING_PROMPT="You are scoring Twitch/YouTube stream moments for a highlight reel.

Score for ENTERTAINMENT VALUE — moments viewers would want to see in a highlights compilation:
- Funny reactions, rage moments, hype moments
- Hot takes, controversial opinions, rants
- Impressive gameplay, clutch plays, fails
- Unexpected events, surprise reveals, pranks
- Wholesome interactions, viewer call-outs
- Tech drama, industry gossip, juicy takes
- Memes born, catchphrases created, inside jokes

Signals boosting the score:
- VOLUME_SPIKE=true means the streamer got loud here (excitement/rage)
- CHAT_SPIKE=true means chat went wild here (hype/reaction)
- Both together = almost certainly a gem

Score 1-10 for entertainment value. 7+ = gem worthy. Reply ONLY with JSON:
{\"score\": N, \"type\": \"reaction/take/gameplay/fail/hype/wholesome/drama/meme/rant/other\", \"title\": \"short catchy title (5-8 words)\", \"summary\": \"one sentence explaining why this moment is worth saving\"}"

        parse_score_json() {
            python3 -c '
import json
import re
import sys

text = sys.stdin.read().strip()
decoder = json.JSONDecoder()
last_error = None
data = None
for idx, ch in enumerate(text):
    if ch != "{":
        continue
    try:
        candidate, _ = decoder.raw_decode(text[idx:])
        if isinstance(candidate, dict) and all(key in candidate for key in ("score", "type", "title", "summary")):
            data = candidate
    except Exception as exc:
        last_error = exc
if not isinstance(data, dict):
    raise SystemExit(f"no complete scoring JSON object found: {last_error or text[:120]}")

try:
    score = int(float(data.get("score", 0)))
except Exception:
    score = 0
score = max(0, min(10, score))
gem_type = str(data.get("type") or "other")
title = str(data.get("title") or "untitled")
summary = str(data.get("summary") or "").strip()
gem_type = re.sub(r"[^A-Za-z0-9_/-]+", "-", gem_type).strip("-")[:40] or "other"
title = re.sub(r"\s+", " ", title.replace("|", "/")).strip()[:90] or "untitled"
summary = re.sub(r"\s+", " ", summary.replace("|", "/")).strip()[:180]
if not summary:
    raise SystemExit("scoring JSON must include a non-empty summary")
print(f"{score}|{gem_type}|{title}|{summary}")
'
        }

        build_score_prompt() {
            local signal_text="$1"
            local segment_text="$2"
            printf '%s\n\nSignals: %s\n\nSegment:\n%s\n\n<output_contract>\nReturn exactly one JSON object and nothing else. Do not summarize the whole stream. Do not use markdown.\nRequired keys: score, type, title, summary.\nUse score as an integer 1-10, type as a short category, title as a 5-8 word headline, and summary as one sentence explaining why this specific moment is worth saving.\n</output_contract>\n' "$SCORING_PROMPT" "$signal_text" "$segment_text"
        }

        clean_segment_for_scoring() {
            python3 -c '
import re
import sys

text = sys.stdin.read()
text = text.replace("\r", " ")

# Existing June 25 transcripts contain whisper-cli/ggml diagnostics inline
# before the spoken words. Remove those diagnostics before the 2000-char cut.
marker = "timestamps = 0 ..."
if marker in text:
    text = text.split(marker, 1)[1]
text = re.split(r"\bwhisper_print_timings:", text, maxsplit=1)[0]
text = re.sub(r"\bggml_metal_free:.*$", " ", text)

patterns = [
    r"\bload_backend:[^|]*(?=\b(?:load_backend|ggml_|whisper_|read_audio_data|system_info|main:|[A-Z][a-z]))",
    r"\bggml_[a-zA-Z0-9_]+:[^|]*(?=\b(?:load_backend|ggml_|whisper_|read_audio_data|system_info|main:|[A-Z][a-z]))",
    r"\bwhisper_[a-zA-Z0-9_]+:[^|]*(?=\b(?:load_backend|ggml_|whisper_|read_audio_data|system_info|main:|[A-Z][a-z]))",
    r"\bread_audio_data:[^|]*(?=\b(?:load_backend|ggml_|whisper_|read_audio_data|system_info|main:|[A-Z][a-z]))",
    r"\bsystem_info:[^|]*(?:\|\s*[A-Z0-9_ :.=/-]+)+",
    r"\bmain: processing [^.]+ \.\.\.",
]
for pattern in patterns:
    text = re.sub(pattern, " ", text)

text = re.sub(r"\s+", " ", text).strip()
print(text[:2000])
'
        }

        score_with_agy() {
            local prompt="$1"
            local tmp_dir stdout_file stderr_file output combined_output parsed brief agy_start agy_elapsed
            [ -n "$AGY_BIN" ] || return 127
            tmp_dir=$(mktemp -d)
            stdout_file="$tmp_dir/stdout.txt"
            stderr_file="$tmp_dir/stderr.txt"
            agy_start=$SECONDS
            if ! "$AGY_BIN" --model "$STALKER_AGY_MODEL" --print-timeout "$STALKER_AGY_TIMEOUT" --print "$prompt" </dev/null >"$stdout_file" 2>"$stderr_file"; then
                agy_elapsed=$((SECONDS - agy_start))
                brief=$(cat "$stderr_file" "$stdout_file" 2>/dev/null | tr '\n' ' ' | cut -c1-180)
                rm -rf "$tmp_dir"
                log "  agy failed after ${agy_elapsed}s (timeout ${STALKER_AGY_TIMEOUT}): $brief" >&2
                return 1
            fi
            output=$(cat "$stdout_file" 2>/dev/null)
            combined_output=$(cat "$stderr_file" "$stdout_file" 2>/dev/null)
            if ! parsed=$(printf '%s' "$output" | parse_score_json); then
                brief=$(printf '%s' "$combined_output" | tr '\n' ' ' | cut -c1-180)
                rm -rf "$tmp_dir"
                log "  agy returned unparseable scoring JSON: $brief" >&2
                return 1
            fi
            rm -rf "$tmp_dir"
            SCORE_RESULT="$parsed"
        }

        run_codex_with_timeout() {
            local deadline="$1"
            shift

            if [ -z "$CODEX_TIMEOUT_BIN" ]; then
                log "  codex exec fallback cannot start: timeout/gtimeout not found; refusing an unbounded scoring call" >&2
                return 127
            fi
            "$CODEX_TIMEOUT_BIN" --kill-after=5s "$deadline" "$@"
        }

        score_with_codex_exec() {
            local prompt="$1"
            local tmp_dir out_file stdout_file stderr_file output parsed brief codex_status
            [ -n "$CODEX_BIN" ] || return 127
            tmp_dir=$(mktemp -d)
            out_file="$tmp_dir/last-message.txt"
            stdout_file="$tmp_dir/stdout.txt"
            stderr_file="$tmp_dir/stderr.txt"
            codex_status=0
            run_codex_with_timeout "$STALKER_CODEX_TIMEOUT" \
                "$CODEX_BIN" exec --ephemeral --sandbox read-only --skip-git-repo-check \
                -C "$OUT_DIR" --output-last-message "$out_file" \
                -m "$STALKER_CODEX_MODEL" \
                -c "model_reasoning_effort=$STALKER_CODEX_EFFORT" \
                "$prompt" </dev/null >"$stdout_file" 2>"$stderr_file" || codex_status=$?
            if [ "$codex_status" -ne 0 ]; then
                brief=$(cat "$stderr_file" "$stdout_file" 2>/dev/null | tr '\n' ' ' | cut -c1-180)
                rm -rf "$tmp_dir"
                if [ "$codex_status" -eq 124 ] || [ "$codex_status" -eq 137 ]; then
                    log "  codex exec fallback timed out after $STALKER_CODEX_TIMEOUT: ${brief:-no output}" >&2
                else
                    log "  codex exec fallback failed with status $codex_status: ${brief:-no output}" >&2
                fi
                return 1
            fi
            if [ -s "$out_file" ]; then
                output=$(cat "$out_file")
            else
                output=$(cat "$stdout_file")
            fi
            rm -rf "$tmp_dir"
            if ! parsed=$(printf '%s' "$output" | parse_score_json); then
                brief=$(printf '%s' "$output" | tr '\n' ' ' | cut -c1-180)
                log "  codex exec fallback returned unparseable scoring JSON: $brief" >&2
                return 1
            fi
            SCORE_RESULT="$parsed"
        }

        scoring_circuit_is_open() {
            if [ "$STALKER_SCORE_PARALLEL" -eq 1 ]; then
                [ "$AGY_CIRCUIT_OPEN" = "1" ]
            else
                [ -f "$SCORE_CIRCUIT_DIR/open" ]
            fi
        }

        # Serialize shared circuit transitions with atomic mkdir. The transition
        # itself is pure/tested; this small critical section makes the failure
        # counter race-free across background workers. The open marker is
        # one-way, so a success from an already in-flight agy call cannot close it.
        update_parallel_circuit_state() (
            local outcome="$1"
            local lock_dir="$SCORE_CIRCUIT_DIR/lock"
            local open=0 failures=0 transition next_open next_failures opened_now

            stalker_acquire_circuit_lock "$SCORE_CIRCUIT_DIR" || return 1
            trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT

            [ -f "$SCORE_CIRCUIT_DIR/open" ] && open=1
            if [ -f "$SCORE_CIRCUIT_DIR/failures" ]; then
                failures=$(cat "$SCORE_CIRCUIT_DIR/failures")
            fi
            transition=$(stalker_circuit_next_state \
                "$open" "$failures" "$outcome" "$STALKER_AGY_CIRCUIT_THRESHOLD")
            IFS='|' read -r next_open next_failures opened_now <<< "$transition"
            printf '%s\n' "$next_failures" > "$SCORE_CIRCUIT_DIR/failures" || return 1
            if [ "$next_open" = "1" ]; then
                : > "$SCORE_CIRCUIT_DIR/open" || return 1
            fi
            printf '%s\n' "$transition"
        )

        # Circuit-breaker wrapper around agy. Serial mode keeps the exact
        # in-process counter. Parallel mode uses the shared locked transition
        # above so every worker observes the same one-way circuit.
        maybe_score_with_agy() {
            local prompt="$1"
            local transition next_open next_failures opened_now
            [ -n "$AGY_BIN" ] || return 1

            if [ "$STALKER_SCORE_PARALLEL" -eq 1 ]; then
                [ "$AGY_CIRCUIT_OPEN" = "1" ] && return 1
                if score_with_agy "$prompt"; then
                    AGY_CONSECUTIVE_FAILURES=0
                    return 0
                fi
                AGY_CONSECUTIVE_FAILURES=$((AGY_CONSECUTIVE_FAILURES + 1))
                if stalker_circuit_should_open "$AGY_CONSECUTIVE_FAILURES" "$STALKER_AGY_CIRCUIT_THRESHOLD"; then
                    AGY_CIRCUIT_OPEN=1
                    log "  agy circuit breaker OPEN after ${AGY_CONSECUTIVE_FAILURES} consecutive failures — using ${CODEX_BIN:-codex} exec for the remainder of this run"
                fi
                return 1
            fi

            [ -f "$SCORE_CIRCUIT_DIR/open" ] && return 1
            if score_with_agy "$prompt"; then
                if ! update_parallel_circuit_state success >/dev/null; then
                    log "  agy circuit state update failed after successful scoring" >&2
                    return 1
                fi
                return 0
            fi

            if ! transition=$(update_parallel_circuit_state failure); then
                log "  agy circuit state update failed — forcing codex-only for the remainder of this run" >&2
                if [ -d "$SCORE_CIRCUIT_DIR" ]; then
                    : > "$SCORE_CIRCUIT_DIR/open" || true
                fi
                return 1
            fi
            IFS='|' read -r next_open next_failures opened_now <<< "$transition"
            if [ "$opened_now" = "1" ]; then
                log "  agy circuit breaker OPEN after ${next_failures} consecutive failures — using ${CODEX_BIN:-codex} exec for the remainder of this run"
            fi
            return 1
        }

        # Emit a progress heartbeat at most once per STALKER_HEARTBEAT_SECS so a
        # long stream does not go silent for hours between "Processing started"
        # and the completion digest.
        maybe_heartbeat() {
            local now stream_min processed body circuit_mode
            now=$(date +%s)
            [ $((now - LAST_HEARTBEAT_EPOCH)) -ge "$STALKER_HEARTBEAT_SECS" ] || return 0
            LAST_HEARTBEAT_EPOCH="$now"
            stream_min=$(( CURRENT_TS_SECS / 60 ))
            processed=$((SCORED_SEGMENTS + SKIPPED_SEGMENTS + SCORING_FAILURES))
            if scoring_circuit_is_open; then
                circuit_mode="codex-only"
            else
                circuit_mode="agy+codex"
            fi
            log "  heartbeat: scored ${SCORED_SEGMENTS}, skipped ${SKIPPED_SEGMENTS}, failed ${SCORING_FAILURES} of ~${TOTAL_SEGMENTS} windows (${processed} seen); stream-minute ${stream_min}; ${GEM_COUNT} gems so far; circuit=${circuit_mode}"
            if [ "${STALKER_HEARTBEAT_NOTIFY:-1}" = "1" ]; then
                if [ "$circuit_mode" = "codex-only" ]; then
                    body="Scored ${SCORED_SEGMENTS}, skipped ${SKIPPED_SEGMENTS}, failed ${SCORING_FAILURES} of ~${TOTAL_SEGMENTS} candidate windows (${processed} seen); at stream-minute ${stream_min}; ${GEM_COUNT} gems so far. Scorer: codex exec (agy circuit open)."
                else
                    body="Scored ${SCORED_SEGMENTS}, skipped ${SKIPPED_SEGMENTS}, failed ${SCORING_FAILURES} of ~${TOTAL_SEGMENTS} candidate windows (${processed} seen); at stream-minute ${stream_min}; ${GEM_COUNT} gems so far. Scorer: agy + codex fallback."
                fi
                notify_stalker_telegram "Stalker still processing ${STREAMER} (${DATE})" "$body" "low" "stalker-golem" || true
            fi
        }

        echo "# Gems: ${STREAMER} (${DATE})" > "$GEMS_FILE"
        echo "" >> "$GEMS_FILE"

        CURRENT_HEADER=""
        CURRENT_TEXT=""
        CURRENT_TS_SECS=0
        CURRENT_DURATION_SECS=0
        GEM_COUNT=0
        SCORED_SEGMENTS=0
        SKIPPED_SEGMENTS=0
        SCORING_FAILURES=0
        SCORE_RESULT=""
        # Circuit breaker + heartbeat state (see env defaults above).
        AGY_CONSECUTIVE_FAILURES=0
        AGY_CIRCUIT_OPEN=0
        TOTAL_SEGMENTS=$(grep -c '^## \[' "$TRANSCRIPT" 2>/dev/null || echo 0)
        [[ "$TOTAL_SEGMENTS" =~ ^[0-9]+$ ]] || TOTAL_SEGMENTS=0
        LAST_HEARTBEAT_EPOCH=$(date +%s)
        SEGMENT_INDEX=0
        SCORE_RUN_DIR=$(mktemp -d "${OUT_DIR}/.stalker-score-results.XXXXXX")
        SCORE_RESULTS_DIR="$SCORE_RUN_DIR/results"
        SCORE_CIRCUIT_DIR="$SCORE_RUN_DIR/circuit"
        mkdir -p "$SCORE_RESULTS_DIR" "$SCORE_CIRCUIT_DIR"
        printf '0\n' > "$SCORE_CIRCUIT_DIR/failures"
        SCORE_PIDS=()
        SCORE_RESULT_DIRS=()

        cleanup_score_run() {
            local pid

            if [ "${SCORE_PIDS+x}" = "x" ] && [ "${#SCORE_PIDS[@]}" -gt 0 ]; then
                for pid in "${SCORE_PIDS[@]}"; do
                    stalker_terminate_scorer_tree "$pid" || true
                done
                for pid in "${SCORE_PIDS[@]}"; do
                    wait "$pid" 2>/dev/null || true
                done
            fi
            SCORE_PIDS=()
            SCORE_RESULT_DIRS=()

            case "${SCORE_RUN_DIR:-}" in
                "$OUT_DIR"/.stalker-score-results.*)
                    rm -rf -- "$SCORE_RUN_DIR"
                    ;;
            esac
        }
        SCORING_COMPLETE=0
        SCORING_SIGNAL=""

        scoring_exit_handler() {
            local status=$?
            local reason
            trap - EXIT INT TERM HUP

            if [ "$SCORING_COMPLETE" != "1" ] && [ ! -f "$OUT_DIR/.stage-scoring.failed" ]; then
                rm -f "$GEMS_FILE"
                reason="scoring interrupted before completion"
                if [ -n "$SCORING_SIGNAL" ]; then
                    reason="${reason} by ${SCORING_SIGNAL}"
                else
                    reason="${reason} (exit status ${status})"
                fi
                reason="${reason}; incomplete gems were removed and the run can be retried with STALKER_FORCE_RESCORE=1"
                stalker_record_stage_failure "$OUT_DIR" "scoring" "$reason" "$CHAT_LOG"
            fi

            cleanup_score_run
            if [ "$SCORING_COMPLETE" != "1" ] && [ "$status" -eq 0 ]; then
                status=75
            fi
            exit "$status"
        }

        scoring_signal_handler() {
            SCORING_SIGNAL="$1"
            exit "$2"
        }

        trap scoring_exit_handler EXIT
        trap 'scoring_signal_handler INT 130' INT
        trap 'scoring_signal_handler TERM 143' TERM
        trap 'scoring_signal_handler HUP 129' HUP

        score_segment() {
            local header="$1"
            local text="$2"
            local ts_secs="$3"
            local duration_secs="$4"
            local result_dir="$5"
            local short_header

            short_header=$(printf '%s\n' "$header" | sed 's/## //' | cut -c1-40)
            printf '%s\n' "$header" > "$result_dir/header"
            printf '%s\n' "$ts_secs" > "$result_dir/timestamp"
            if [ -z "$text" ]; then
                printf 'skipped\n' > "$result_dir/status"
                return 0
            fi
            [[ "$duration_secs" =~ ^[0-9]+$ ]] || duration_secs=0
            local segment_end=$((ts_secs + duration_secs))

            # CLI startup is much slower than the old API call, so only score
            # transcript segments near deterministic volume/chat spikes.
            local vol_spike=false
            local chat_spike=false
            for spike_t in ${SPIKE_TIMES//,/ }; do
                [ -z "$spike_t" ] && continue
                [ "$spike_t" -ge $((ts_secs - STALKER_GEM_SCORE_WINDOW_SECS)) ] \
                    && [ "$spike_t" -le $((segment_end + STALKER_GEM_SCORE_WINDOW_SECS)) ] \
                    && vol_spike=true && break
            done
            for spike_t in ${CHAT_SPIKE_TIMES//,/ }; do
                [ -z "$spike_t" ] && continue
                [ "$spike_t" -ge $((ts_secs - STALKER_GEM_SCORE_WINDOW_SECS)) ] \
                    && [ "$spike_t" -le $((segment_end + STALKER_GEM_SCORE_WINDOW_SECS)) ] \
                    && chat_spike=true && break
            done

            if [ "$vol_spike" != true ] && [ "$chat_spike" != true ]; then
                printf 'skipped\n' > "$result_dir/status"
                return 0
            fi

            local signal_text="VOLUME_SPIKE=${vol_spike}, CHAT_SPIKE=${chat_spike}"
            local clean_text prompt result
            clean_text=$(printf '%s\n' "$text" | LC_ALL=C tr -cd '[:print:]\n ' | clean_segment_for_scoring)
            if [ -z "$clean_text" ]; then
                printf 'no transcript text after cleaning diagnostics\n' > "$result_dir/reason"
                printf 'failed\n' > "$result_dir/status"
                log "  scoring FAILED for ${short_header}: no transcript text after cleaning diagnostics"
                return 0
            fi
            prompt=$(build_score_prompt "$signal_text" "$clean_text")

            if maybe_score_with_agy "$prompt"; then
                result="$SCORE_RESULT"
            elif score_with_codex_exec "$prompt"; then
                result="$SCORE_RESULT"
                scoring_circuit_is_open || log "  codex exec fallback scored segment after agy failure"
            else
                printf 'no local model returned valid JSON\n' > "$result_dir/reason"
                printf 'failed\n' > "$result_dir/status"
                log "  scoring FAILED for ${short_header}: no local model returned valid JSON"
                return 0
            fi

            local score gem_type title summary
            score=$(printf '%s\n' "$result" | cut -d'|' -f1)
            gem_type=$(printf '%s\n' "$result" | cut -d'|' -f2)
            title=$(printf '%s\n' "$result" | cut -d'|' -f3)
            summary=$(printf '%s\n' "$result" | cut -d'|' -f4-)

            local signals=""
            [ "$vol_spike" = true ] && signals="${signals}VOL "
            [ "$chat_spike" = true ] && signals="${signals}CHAT "
            log "  [$score/10 $gem_type ${signals}] ${short_header}"

            if [ "${score:-0}" -ge 7 ] 2>/dev/null; then
                # header is "## [MM:SS]" — strip "## " prefix to match downstream ### [MM:SS] format
                local ts_tag="${header#\#\# }"
                {
                    printf '### %s %s\n' "$ts_tag" "$title"
                    printf '**Score:** %s/10 | **Type:** %s\n' "$score" "$gem_type"
                    [ -n "$summary" ] && printf '**Gist:** %s\n' "$summary"
                    [ "$vol_spike" = true ] && printf '**Volume spike:** yes\n'
                    [ "$chat_spike" = true ] && printf '**Chat spike:** yes\n'
                    printf '\n'
                    printf '**Transcript:** %s\n' "$(printf '%s\n' "$clean_text" | cut -c1-300)"
                    printf '\n'
                } > "$result_dir/gem.md"
                log "  ^ GEM!"
            fi
            printf 'scored\n' > "$result_dir/status"
        }

        run_score_segment_worker() {
            local header="$1"
            local text="$2"
            local ts_secs="$3"
            local duration_secs="$4"
            local result_dir="$5"

            if ! score_segment "$header" "$text" "$ts_secs" "$duration_secs" "$result_dir"; then
                printf 'score worker exited unexpectedly\n' > "$result_dir/reason"
                printf 'failed\n' > "$result_dir/status"
                return 0
            fi
            if [ ! -f "$result_dir/status" ]; then
                printf 'score worker produced no completion status\n' > "$result_dir/reason"
                printf 'failed\n' > "$result_dir/status"
            fi
        }

        collect_score_result() {
            local result_dir="$1"
            local status header reason timestamp

            [ -s "$result_dir/worker.log" ] && cat "$result_dir/worker.log"
            status=$(cat "$result_dir/status" 2>/dev/null || printf 'failed\n')
            header=$(cat "$result_dir/header" 2>/dev/null || printf 'unknown segment\n')
            timestamp=$(cat "$result_dir/timestamp" 2>/dev/null || printf '0\n')
            [[ "$timestamp" =~ ^[0-9]+$ ]] || timestamp=0
            CURRENT_TS_SECS="$timestamp"

            case "$status" in
                scored)
                    SCORED_SEGMENTS=$((SCORED_SEGMENTS + 1))
                    [ -s "$result_dir/gem.md" ] && GEM_COUNT=$((GEM_COUNT + 1))
                    ;;
                skipped)
                    SKIPPED_SEGMENTS=$((SKIPPED_SEGMENTS + 1))
                    ;;
                *)
                    SCORING_FAILURES=$((SCORING_FAILURES + 1))
                    reason=$(cat "$result_dir/reason" 2>/dev/null || printf 'worker produced invalid status: %s\n' "$status")
                    log "  scoring failure counted for ${header#\#\# }: $reason"
                    ;;
            esac
            maybe_heartbeat
        }

        reap_score_worker_at() {
            local index="$1"
            local pid="${SCORE_PIDS[$index]}"
            local result_dir="${SCORE_RESULT_DIRS[$index]}"
            local wait_status=0

            if wait "$pid"; then
                wait_status=0
            else
                wait_status=$?
            fi
            if [ "$wait_status" -ne 0 ]; then
                printf 'score worker process exited with status %s\n' "$wait_status" > "$result_dir/reason"
                printf 'failed\n' > "$result_dir/status"
            fi
            collect_score_result "$result_dir"
            unset 'SCORE_PIDS[index]'
            unset 'SCORE_RESULT_DIRS[index]'
        }

        # Bash 3.2 has no `wait -n`, so poll the per-worker completion artifact
        # and process liveness, then wait only on a worker known to be done.
        # Reaping any completed slot keeps the pool work-conserving when an older
        # segment is slow or timeout-prone.
        reap_any_score_worker() {
            local index pid result_dir

            while :; do
                for index in "${!SCORE_PIDS[@]}"; do
                    pid="${SCORE_PIDS[$index]}"
                    result_dir="${SCORE_RESULT_DIRS[$index]}"
                    if [ -f "$result_dir/status" ] || ! kill -0 "$pid" 2>/dev/null; then
                        reap_score_worker_at "$index"
                        return 0
                    fi
                done
                sleep 0.05
            done
        }

        dispatch_score_segment() {
            local header="$1"
            local text="$2"
            local ts_secs="$3"
            local duration_secs="$4"
            local segment_name result_dir

            SEGMENT_INDEX=$((SEGMENT_INDEX + 1))
            printf -v segment_name 'segment-%06d' "$SEGMENT_INDEX"
            result_dir="$SCORE_RESULTS_DIR/$segment_name"
            mkdir -p "$result_dir"
            printf '%s\n' "$header" > "$result_dir/header"
            printf '%s\n' "$ts_secs" > "$result_dir/timestamp"

            if [ "$STALKER_SCORE_PARALLEL" -eq 1 ]; then
                run_score_segment_worker \
                    "$header" "$text" "$ts_secs" "$duration_secs" "$result_dir" \
                    > "$result_dir/worker.log" 2>&1
                collect_score_result "$result_dir"
                return 0
            fi

            run_score_segment_worker \
                "$header" "$text" "$ts_secs" "$duration_secs" "$result_dir" \
                > "$result_dir/worker.log" 2>&1 &
            SCORE_PIDS+=("$!")
            SCORE_RESULT_DIRS+=("$result_dir")
            if [ "${#SCORE_PIDS[@]}" -ge "$STALKER_SCORE_PARALLEL" ]; then
                reap_any_score_worker
            fi
        }

        while IFS= read -r line; do
            if [[ "$line" == "## ["* ]]; then
                [ -n "$CURRENT_TEXT" ] && dispatch_score_segment "$CURRENT_HEADER" "$CURRENT_TEXT" "$CURRENT_TS_SECS" "$CURRENT_DURATION_SECS"
                CURRENT_HEADER="$line"
                CURRENT_TEXT=""
                # Extract timestamp seconds from "## [MM:SS]"
                TS_RAW=$(echo "$line" | sed 's/## \[\([0-9:]*\)\].*/\1/')
                CURRENT_TS_SECS=0
                for P in $(echo "$TS_RAW" | tr ':' ' '); do
                    CURRENT_TS_SECS=$(( CURRENT_TS_SECS * 60 + ${P#0} ))
                done
                CURRENT_DURATION_SECS=$(echo "$line" | sed -n 's/.*(\([0-9][0-9]*\)s).*/\1/p')
                [[ "$CURRENT_DURATION_SECS" =~ ^[0-9]+$ ]] || CURRENT_DURATION_SECS=0
            elif [[ "$line" != "# Stream"* ]] && [[ -n "$line" ]]; then
                CURRENT_TEXT="$CURRENT_TEXT $line"
            fi
        done < "$TRANSCRIPT"
        [ -n "$CURRENT_TEXT" ] && dispatch_score_segment "$CURRENT_HEADER" "$CURRENT_TEXT" "$CURRENT_TS_SECS" "$CURRENT_DURATION_SECS"
        while [ "${#SCORE_PIDS[@]}" -gt 0 ]; do
            reap_any_score_worker
        done

        if [ "$SCORING_FAILURES" -eq 0 ] && [ "$SCORED_SEGMENTS" -gt 0 ]; then
            MERGED_GEMS=0
            if ! MERGED_GEMS=$(stalker_merge_score_results "$SCORE_RESULTS_DIR" "$GEMS_FILE"); then
                SCORING_FAILURES=$((SCORING_FAILURES + 1))
                log "  ordered gem merge FAILED: worker result directory could not be merged"
            elif ! [[ "$MERGED_GEMS" =~ ^[0-9]+$ ]] || [ "$MERGED_GEMS" -ne "$GEM_COUNT" ]; then
                SCORING_FAILURES=$((SCORING_FAILURES + 1))
                log "  ordered gem merge FAILED: expected $GEM_COUNT gem fragment(s), merged ${MERGED_GEMS:-invalid}"
            fi
        fi

        if [ "$SCORING_FAILURES" -gt 0 ]; then
            rm -f "$GEMS_FILE"
            if [ "$SCORED_SEGMENTS" -eq 0 ]; then
                log "  Auto-scoring failed for all candidate segments; removed incomplete gems.md so retry can run"
            else
                log "  Auto-scoring had $SCORING_FAILURES failed candidate segment(s); removed incomplete gems.md so retry can run"
            fi
            stalker_record_stage_failure "$OUT_DIR" "scoring" \
                "available scorers failed for ${SCORING_FAILURES} candidate segment(s); incomplete gems were removed" "$CHAT_LOG"
            exit 75
        elif [ "$SCORED_SEGMENTS" -eq 0 ]; then
            rm -f "$GEMS_FILE"
            log "  No candidate segments near spikes; removed empty gems.md so retry can run after signal/window changes"
        else
            echo "" >> "$GEMS_FILE"
            echo "---" >> "$GEMS_FILE"
            echo "Source: $VIDEO" >> "$GEMS_FILE"
            echo "Gems found: $GEM_COUNT" >> "$GEMS_FILE"
            echo "Candidate segments scored: $SCORED_SEGMENTS" >> "$GEMS_FILE"
            echo "Skipped non-candidates: $SKIPPED_SEGMENTS" >> "$GEMS_FILE"
            echo "Scoring failures: $SCORING_FAILURES" >> "$GEMS_FILE"
            echo "Scored: $(date)" >> "$GEMS_FILE"
        fi

        mark_stalker_stage_done "$OUT_DIR" "scoring"
        SCORING_COMPLETE=1
        cleanup_score_run
        trap - EXIT INT TERM HUP
        log "  Auto-scoring complete: $GEM_COUNT gems found ($SCORED_SEGMENTS candidates, $SKIPPED_SEGMENTS skipped, $SCORING_FAILURES failures)"
    fi
elif [ -f "$GEMS_FILE" ]; then
    log "Pass 3b: Gems file exists, skipping scoring"
fi

# ============================================================
# PASS 4: CLIP EXTRACTION (runs if gems.md already has timestamps)
# ============================================================

# GEMS_FILE already set above
if [ -f "$GEMS_FILE" ]; then
    log "Pass 4: Extracting clips for existing gems..."
    # Parse gem timestamps from gems.md (format: ### [MM:SS] or ### [HH:MM:SS])
    CLIP_COUNT=0
    # Extract timestamps from gems.md (macOS-compatible, no grep -P)
    while IFS= read -r TS; do
        [ -z "$TS" ] && continue
        # Parse MM:SS or HH:MM:SS to seconds
        PARTS=$(echo "$TS" | tr ':' ' ')
        SECS=0
        for P in $PARTS; do
            SECS=$(( SECS * 60 + ${P#0} ))
        done

        CLIP_NAME="clip-$(echo "$TS" | tr ':' 'm')s"
        CLIP_FILE="$OUT_DIR/clips/${CLIP_NAME}.mp4"

        if [ ! -f "$CLIP_FILE" ]; then
            START=$((SECS - 10))
            [ $START -lt 0 ] && START=0
            ffmpeg -nostdin -y -ss "$START" -i "$VIDEO" -t 45 \
                -c:v libx264 -preset fast -crf 28 \
                -c:a aac -b:a 64k \
                -movflags +faststart \
                "$CLIP_FILE" 2>/dev/null
            log "  Clip: $CLIP_NAME ($(du -h "$CLIP_FILE" | cut -f1))"
            CLIP_COUNT=$((CLIP_COUNT + 1))
        fi
    done < <(sed -n 's/^### \[\([0-9:]*\)\].*/\1/p' "$GEMS_FILE" 2>/dev/null)
    log "  Extracted $CLIP_COUNT new clips"

    # --- 4b: Auto-annotate clips if annotate-clip.sh exists ---
    ANNOTATE_SCRIPT="$(dirname "$0")/annotate-clip.sh"
    if [ -x "$ANNOTATE_SCRIPT" ]; then
        log "Pass 4b: Annotating clips..."
        # Parse gem titles and context from gems.md for annotation
        # Format: ### [MM:SS] Title\n**Score:** X/10 | **Type:** Y
        python3 -c "
import re, subprocess, os, glob

gems_path = '$GEMS_FILE'
clips_dir = '$OUT_DIR/clips'
script = '$ANNOTATE_SCRIPT'

with open(gems_path) as f:
    text = f.read()

# Find gems: ### [timestamp] title
gems = re.findall(r'### \[([^\]]+)\]\s+(.+?)$\n\*\*Score:\*\*\s+(\d+/10)\s+\|\s+\*\*Type:\*\*\s+(\w+[/\w]*)', text, re.MULTILINE)

for ts, title, score, gtype in gems:
    # Find matching clip
    ts_clean = ts.replace(':', 'm') + 's'
    matches = glob.glob(f'{clips_dir}/clip-{ts_clean}*.mp4')
    matches = [m for m in matches if 'annotated' not in m]
    if not matches:
        continue
    clip = matches[0]
    out = clip.replace('.mp4', '-annotated.mp4')
    if os.path.exists(out):
        continue

    header = f'{title}  |  {score}  |  {gtype}'
    # Get first context line after the gem header (skip score line)
    idx = text.find(f'### [{ts}]')
    context = ''
    if idx >= 0:
        lines_after = text[idx:idx+500].split('\n')
        for line in lines_after[2:]:
            if line.startswith('**') and 'Transcript' in line:
                continue
            if line.startswith('**') and 'Screen' in line:
                continue
            if line.startswith('**') and 'Context' in line:
                context = line.split(':', 1)[1].strip() if ':' in line else ''
                break
            if line.startswith('**') and 'Relevance' in line:
                context = line.split(':', 1)[1].strip() if ':' in line else ''
                break
    if not context:
        context = title

    subprocess.run([script, clip, header, context, out], capture_output=True)
    if os.path.exists(out):
        print(f'  Annotated: {os.path.basename(out)}')
" 2>/dev/null
    fi
else
    log "Pass 4: No gems.md yet — skipping clip extraction"
fi
mark_stalker_stage_done "$OUT_DIR" "4-clips"

# ============================================================
# PASS 5: GENERATE GEMS-MANIFEST.JSON (if --json-output)
# ============================================================

MANIFEST_FILE="$OUT_DIR/gems-manifest.json"
if [ "$JSON_OUTPUT" = true ] && [ -f "$GEMS_FILE" ] && [ ! -f "$MANIFEST_FILE" ]; then
    log "Pass 5: Generating gems-manifest.json..."
    DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO" 2>/dev/null | cut -d. -f1 || echo "0")

    python3 -c "
import json, re, os

gems_path = '$GEMS_FILE'
manifest_path = '$MANIFEST_FILE'
spikes_path = '$SPIKES_FILE'
volume_path = '$VOLUME_FILE'

with open(gems_path) as f:
    text = f.read()

# Parse gems from markdown
pattern = r'### \[([^\]]+)\]\s+(.+?)$\n\*\*Score:\*\*\s+(\d+)/10\s+\|\s+\*\*Type:\*\*\s+(\S+)'
gems = []
for match in re.finditer(pattern, text, re.MULTILINE):
    ts, title, score, gtype = match.groups()

    # Parse timestamp to seconds
    parts = ts.split(':')
    secs = 0
    for p in parts:
        secs = secs * 60 + int(p)

    gem_id = f'gem-{len(gems)+1:03d}'

    # Check for volume spike at this timestamp
    volume_spike = False
    if os.path.exists(spikes_path):
        with open(spikes_path) as f:
            for line in f:
                if line.startswith('#'): continue
                parts_v = line.strip().split()
                if parts_v and abs(int(parts_v[0]) - secs) <= 10:
                    volume_spike = True
                    break

    # Check for clip and frame
    mins, s = divmod(secs, 60)
    clip_name = f'clip-{ts.replace(\":\", \"m\")}s.mp4'
    clip_path = f'clips/{clip_name}' if os.path.exists(os.path.join('$OUT_DIR', 'clips', clip_name)) else None
    frame_name = f'frame-{mins}m{s}s.jpg'
    frame_path = f'frames/{frame_name}' if os.path.exists(os.path.join('$OUT_DIR', 'frames', frame_name)) else None

    # Extract transcript snippet from gems.md
    idx = text.find(f'### [{ts}]')
    transcript = ''
    if idx >= 0:
        block = text[idx:idx+1000]
        lines = block.split('\n')
        for line in lines[3:]:
            if line.startswith('### [') or line.startswith('---'):
                break
            if line.strip() and not line.startswith('**'):
                transcript += line.strip() + ' '
        transcript = transcript.strip()[:300]

    gems.append({
        'id': gem_id,
        'timestamp': ts,
        'start_s': max(0, secs - 5),
        'end_s': secs + 5,
        'score': int(score),
        'type': gtype,
        'title': title.strip(),
        'signals': {
            'volume_spike': volume_spike,
        },
        'transcript': transcript,
        'clip_path': clip_path,
        'frame_path': frame_path
    })

manifest = {
    'version': 1,
    'vod_url': '',
    'streamer': '$STREAMER',
    'date': '$DATE',
    'duration_s': int('$DURATION' or 0),
    'gem_count': len(gems),
    'gems': sorted(gems, key=lambda g: -g['score'])
}

with open(manifest_path, 'w') as f:
    json.dump(manifest, f, indent=2, ensure_ascii=False)

print(f'  Manifest: {len(gems)} gems written to gems-manifest.json')
" 2>/dev/null

elif [ "$JSON_OUTPUT" = true ] && [ -f "$MANIFEST_FILE" ]; then
    log "Pass 5: Manifest already exists, skipping"
elif [ "$JSON_OUTPUT" = true ]; then
    log "Pass 5: No gems.md yet — manifest generation deferred"
fi
if [ "$JSON_OUTPUT" = true ]; then
    mark_stalker_stage_done "$OUT_DIR" "5-manifest"
fi

# ============================================================
# CLEANUP: Remove segment WAVs (regeneratable from full-audio.wav)
# ============================================================

SEGMENT_SIZE=$(du -sh "$OUT_DIR"/segment-*.wav 2>/dev/null | tail -1 | cut -f1 || echo "0")
SEGMENT_COUNT_FILES=$(find "$OUT_DIR" -maxdepth 1 -name "segment-*.wav" 2>/dev/null | wc -l | tr -d ' ')
if [ "$SEGMENT_COUNT_FILES" -gt 0 ]; then
    log "Cleanup: Removing $SEGMENT_COUNT_FILES segment WAVs ($SEGMENT_SIZE total)"
    rm -f "$OUT_DIR"/segment-*.wav
fi

if ! stalker_stage_done "$OUT_DIR" "complete-notify"; then
    if ! stalker_require_run_quality "$OUT_DIR" "$CHAT_LOG" "complete-notify"; then
        log "Pipeline quality gate failed; success notification and marker remain open"
        exit 75
    fi
    DURATION_SECONDS=$(video_duration_seconds "$AUDIO" || echo "0")
    if [[ "$DURATION_SECONDS" =~ ^[0-9]+$ ]]; then
        DURATION_LABEL=$(printf "%d:%02d" $((DURATION_SECONDS / 3600)) $(((DURATION_SECONDS % 3600) / 60)))
    else
        DURATION_LABEL="unknown"
    fi
    FRAME_TOTAL=$(ls "$OUT_DIR/frames/" 2>/dev/null | wc -l | tr -d ' ')
    TOP_SPIKES=$(grep -v "^#" "$SPIKES_FILE" 2>/dev/null | head -5 | awk '{print $4}' | tr '\n' ' ' | sed 's/[[:space:]]*$//' || true)
    [ -z "$TOP_SPIKES" ] && TOP_SPIKES="none"
    if [ -f "$GEMS_FILE" ]; then
        GEMS_PATH="$GEMS_FILE"
    else
        GEMS_PATH="not generated"
    fi
    notify_stalker_telegram \
        "Stalker Run Complete" \
        "Stalker run complete for ${STREAMER}-${DATE}. Duration: ${DURATION_LABEL}. Segments: ${SEG_NUM} (${FAILED_SEGMENTS} failed). Frames: ${FRAME_TOTAL}. Top volume spikes: [${TOP_SPIKES}]. Gems: ${GEMS_PATH}." \
        "default" \
        "stalker-golem" || true
    mark_stalker_stage_done "$OUT_DIR" "complete-notify"
fi

log ""
log "=== PROCESSING COMPLETE ==="
log "Directory: $OUT_DIR"
log "Transcript: $TRANSCRIPT ($SEG_NUM segments)"
log "Volume spikes: $SPIKES_FILE"
log "Frames: $OUT_DIR/frames/ ($(ls "$OUT_DIR/frames/" 2>/dev/null | wc -l | tr -d ' ') files)"
log "Clips: $OUT_DIR/clips/ ($(ls "$OUT_DIR/clips/" 2>/dev/null | wc -l | tr -d ' ') files)"
log "Combined signals: $SIGNALS_FILE"
[ -f "$GEMS_FILE" ] && log "Gems: $GEMS_FILE"
log ""
log "Total disk: $(du -sh "$OUT_DIR" | cut -f1)"
log ""
log "Cleanup options:"
log "  rm $OUT_DIR/segment-*.wav     # Segment audio (~50MB)"
log "  rm $OUT_DIR/full-audio.wav    # Full audio (~50MB)"
log "  rm $VIDEO                      # Full video (biggest)"
