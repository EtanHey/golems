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
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

source "$SCRIPT_DIR/process/inputs.sh"
source "$SCRIPT_DIR/process/audio.sh"
source "$SCRIPT_DIR/process/signals.sh"
source "$SCRIPT_DIR/process/score-providers.sh"
source "$SCRIPT_DIR/process/score-workers.sh"

derive_stream_labels
WHISPER_MODEL="${WHISPER_MODEL:-$HOME/.cache/whisper/ggml-large-v3-turbo.bin}"
SEGMENT_MIN_DURATION=20
SILENCE_THRESHOLD="-30"
SILENCE_DURATION="2"
VOLUME_SPIKE_RATIO="1.3"  # flag timestamps where volume > 1.3x average
FAILED_SEGMENTS=0

mkdir -p "$OUT_DIR/frames" "$OUT_DIR/clips"

# shellcheck source=lib/stream-helpers.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/stream-helpers.sh"

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

prepare_stream_inputs

# ============================================================
# PASS 1: AUDIO ANALYSIS (transcript + volume + silence)
# ============================================================

run_audio_stages

# ============================================================
# PASS 2: VISUAL ANALYSIS (frames + clips)
# ============================================================

run_frame_stage

# --- 2b: Clips extracted AFTER scoring (Pass 3 identifies gem timestamps) ---

# ============================================================
# PASS 3: SCORING (combine all signals)
# ============================================================

run_signal_stage

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

if ! stalker_require_run_quality "$OUT_DIR" "$CHAT_LOG" "complete-notify"; then
    log "Stalker FAILED at stage 6: pipeline quality gate failed; delivery remains open"
    exit 75
fi
if [ "${STALKER_DEFER_DELIVERY:-0}" != "1" ]; then
    node "${STALKER_COMPLETION_SCRIPT:-$SCRIPT_DIR/stalker-complete-run.mjs}" "$OUT_DIR"
fi

log ""
log "=== MEDIA ANALYSIS FINISHED ==="
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
