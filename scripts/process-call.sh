#!/bin/bash
# Process a recorded call — transcribe + score for actionable gems.
# Usage: process-call.sh <audio-or-video-file> [output-dir]
#
# Simplified version of process-stream.sh for calls/meetings:
#   - No chat log, no frame extraction
#   - Hebrew/English auto-detection (WHISPER_LANG=auto)
#   - Call-specific scoring prompt (actionable items, not stream moments)
#
# Supports: .mp4, .m4a, .wav, .mp3, .webm, .ogg
# Output: transcript.md + gems.md in output dir

set -euo pipefail

INPUT="${1:?Usage: process-call.sh <audio-or-video-file> [output-dir]}"
OUT_DIR="${2:-$(dirname "$INPUT")/$(basename "$INPUT" | sed 's/\.[^.]*$//')}"
WHISPER_MODEL="${WHISPER_MODEL:-$HOME/.cache/whisper/ggml-large-v3-turbo.bin}"
WHISPER_LANG="${WHISPER_LANG:-auto}"
SEGMENT_MIN_DURATION=20
SILENCE_THRESHOLD="-30"
SILENCE_DURATION="2"

mkdir -p "$OUT_DIR"

log() { echo "[$(date '+%H:%M:%S')] $1"; }

# ============================================================
# STEP 1: EXTRACT AUDIO
# ============================================================

AUDIO="$OUT_DIR/audio.wav"
if [ ! -f "$AUDIO" ]; then
    EXT="${INPUT##*.}"
    if [ "$EXT" = "wav" ]; then
        # Already WAV — just resample to 16kHz mono
        log "Step 1: Resampling WAV to 16kHz mono..."
        ffmpeg -i "$INPUT" -ar 16000 -ac 1 -sample_fmt s16 "$AUDIO" -y 2>/dev/null
    else
        log "Step 1: Extracting audio from $EXT..."
        ffmpeg -i "$INPUT" -vn -acodec pcm_s16le -ar 16000 -ac 1 "$AUDIO" -y 2>/dev/null
    fi
    log "  Audio: $(du -sh "$AUDIO" | cut -f1)"
else
    log "Step 1: Audio exists, skipping"
fi

# ============================================================
# STEP 2: DETECT SILENCE BOUNDARIES
# ============================================================

SILENCES="$OUT_DIR/silences.txt"
if [ ! -f "$SILENCES" ]; then
    log "Step 2: Detecting silence boundaries..."
    ffmpeg -i "$AUDIO" -af "silencedetect=noise=${SILENCE_THRESHOLD}dB:d=${SILENCE_DURATION}" -f null - 2>&1 \
      | { grep "silence_end" || true; } \
      | awk '{print $5}' \
      > "$SILENCES"
    log "  Found $(wc -l < "$SILENCES") silence boundaries"
else
    log "Step 2: Silences file exists, skipping"
fi

# ============================================================
# STEP 3: SEGMENT AND TRANSCRIBE
# ============================================================

TRANSCRIPT="$OUT_DIR/transcript.md"
if [ ! -f "$TRANSCRIPT" ]; then
    log "Step 3: Segmenting and transcribing (lang=$WHISPER_LANG)..."
    CALL_NAME=$(basename "$INPUT" | sed 's/\.[^.]*$//')
    DATE=$(date +%Y-%m-%d)
    echo "# Call Transcript: ${CALL_NAME} (${DATE})" > "$TRANSCRIPT"
    echo "" >> "$TRANSCRIPT"

    PREV_END=0
    SEG_NUM=0
    DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$AUDIO" 2>/dev/null | cut -d. -f1)

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

        TRANSCRIPTION=$(whisper-cli -m "$WHISPER_MODEL" -f "$SEG_FILE" --no-timestamps -l "$WHISPER_LANG" 2>/dev/null || echo "[transcription failed]")

        MINS=$((PREV_END / 60))
        SECS=$((PREV_END % 60))
        TIMESTAMP=$(printf "%02d:%02d" $MINS $SECS)

        echo "## [$TIMESTAMP] Segment $SEG_NUM (${SEGMENT_DURATION}s)" >> "$TRANSCRIPT"
        echo "" >> "$TRANSCRIPT"
        echo "$TRANSCRIPTION" >> "$TRANSCRIPT"
        echo "" >> "$TRANSCRIPT"

        log "  Segment $SEG_NUM [$TIMESTAMP] (${SEGMENT_DURATION}s): $(echo "$TRANSCRIPTION" | head -1 | cut -c1-60)..."

        # Clean up segment WAV immediately
        rm -f "$SEG_FILE"

        PREV_END=$END
    done < "$SILENCES_WORK"
    rm -f "$SILENCES_WORK"

    log "  Transcription complete: $SEG_NUM segments"
else
    log "Step 3: Transcript exists, skipping"
    SEG_NUM=$(grep -c "^## \[" "$TRANSCRIPT" || echo 0)
fi

# ============================================================
# STEP 4: SCORE WITH GEMINI
# ============================================================

source "$HOME/Gits/golems/.env" 2>/dev/null || true
GEMINI_KEY="${GOOGLE_GENERATIVE_AI_API_KEY:-}"

GEMS_FILE="$OUT_DIR/gems.md"
if [ -n "$GEMINI_KEY" ] && [ ! -f "$GEMS_FILE" ]; then
    log "Step 4: Scoring transcript with Gemini..."

    SCORING_PROMPT="You are scoring call transcript segments for a developer named Etan.

Score for ACTIONABLE content — things Etan should remember or act on:
- Action items / commitments made by either side
- Technical decisions or requirements discussed
- Deadlines, dates, or scheduling agreements
- Key questions asked and answers given
- Names, companies, or contacts mentioned
- Problem definitions and proposed solutions
- Follow-up tasks agreed upon

Context: This is a work call (may be interview, client call, team sync, or discovery).
Language: May be Hebrew, English, or mixed. Score the content regardless of language.

Score 1-10 for actionability. Reply with ONLY a JSON object:
{\"score\": N, \"type\": \"action|decision|requirement|question|contact|deadline|insight|filler\", \"reason\": \"one sentence\"}"

    echo "# Gems: $(basename "$OUT_DIR")" > "$GEMS_FILE"
    echo "" >> "$GEMS_FILE"

    CURRENT_HEADER=""
    CURRENT_TEXT=""
    GEM_COUNT=0

    score_segment() {
        local header="$1"
        local text="$2"
        [ -z "$text" ] && return

        local escaped_text
        escaped_text=$(echo "$text" | tr '\n' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g' | LC_ALL=C tr -cd '[:print:] ' | cut -c1-2000)

        RESULT=$(curl -sf "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent" \
            -H "Content-Type: application/json" \
            -H "x-goog-api-key: ${GEMINI_KEY}" \
            -d "{
                \"contents\": [{\"parts\": [{\"text\": \"${SCORING_PROMPT}\n\nSegment:\n${escaped_text}\"}]}],
                \"generationConfig\": {\"maxOutputTokens\": 100}
            }" 2>/dev/null | /Library/Frameworks/Python.framework/Versions/3.13/bin/python3 -c "
import sys, json
try:
    r = json.load(sys.stdin)
    text = r['candidates'][0]['content']['parts'][0]['text'].strip()
    if '{' in text:
        text = text[text.index('{'):text.rindex('}')+1]
    d = json.loads(text)
    print(f\"{d.get('score',0)}|{d.get('type','unknown')}|{d.get('reason','')}\")
except:
    print('5|unknown|parse error')
" 2>/dev/null || echo "5|unknown|api error")

        SCORE=$(echo "$RESULT" | cut -d'|' -f1)
        TYPE=$(echo "$RESULT" | cut -d'|' -f2)
        REASON=$(echo "$RESULT" | cut -d'|' -f3-)

        log "  [$SCORE/10 $TYPE] $(echo "$header" | head -1)"

        if [ "${SCORE:-0}" -ge 7 ] 2>/dev/null; then
            GEM_COUNT=$((GEM_COUNT + 1))
            echo "### $header" >> "$GEMS_FILE"
            echo "**Score:** $SCORE/10 | **Type:** $TYPE" >> "$GEMS_FILE"
            echo "**Why:** $REASON" >> "$GEMS_FILE"
            echo "" >> "$GEMS_FILE"
            echo "$text" >> "$GEMS_FILE"
            echo "" >> "$GEMS_FILE"
            log "  ^ GEM!"
        fi

        # Rate limit: 15 req/min free tier
        sleep 5
    }

    while IFS= read -r line; do
        if [[ "$line" == "## ["* ]]; then
            [ -n "$CURRENT_TEXT" ] && score_segment "$CURRENT_HEADER" "$CURRENT_TEXT"
            CURRENT_HEADER="$line"
            CURRENT_TEXT=""
        elif [[ "$line" != "# Call"* ]] && [[ -n "$line" ]]; then
            CURRENT_TEXT="$CURRENT_TEXT $line"
        fi
    done < "$TRANSCRIPT"
    [ -n "$CURRENT_TEXT" ] && score_segment "$CURRENT_HEADER" "$CURRENT_TEXT"

    echo "" >> "$GEMS_FILE"
    echo "---" >> "$GEMS_FILE"
    echo "Source: $INPUT" >> "$GEMS_FILE"
    echo "Gems found: $GEM_COUNT" >> "$GEMS_FILE"
    echo "Scored: $(date)" >> "$GEMS_FILE"

    log "Done! Found $GEM_COUNT gems."
else
    if [ -f "$GEMS_FILE" ]; then
        log "Step 4: Gems file exists, skipping"
    elif [ -z "$GEMINI_KEY" ]; then
        log "Step 4: No GOOGLE_GENERATIVE_AI_API_KEY — skipping scoring"
        log "  Run score-transcript.sh manually later, or set the key in .env"
    fi
fi

# ============================================================
# SUMMARY
# ============================================================

log ""
log "=== CALL PROCESSING COMPLETE ==="
log "Output: $OUT_DIR"
log "Transcript: $TRANSCRIPT ($SEG_NUM segments)"
[ -f "$GEMS_FILE" ] && log "Gems: $GEMS_FILE"
log "Audio: $AUDIO ($(du -sh "$AUDIO" | cut -f1))"
log ""
log "Total disk: $(du -sh "$OUT_DIR" | cut -f1)"
