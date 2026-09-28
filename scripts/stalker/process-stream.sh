#!/bin/bash
# shellcheck disable=SC2034
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
source "$SCRIPT_DIR/process/scoring.sh"
source "$SCRIPT_DIR/process/outputs.sh"

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

GEMS_FILE="$OUT_DIR/gems.md"
preflight_stream
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

        prepare_scoring_stage

        trap scoring_exit_handler EXIT
        trap 'scoring_signal_handler INT 130' INT
        trap 'scoring_signal_handler TERM 143' TERM
        trap 'scoring_signal_handler HUP 129' HUP

        run_scoring_stage
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

run_clip_stage

# ============================================================
# PASS 5: GENERATE GEMS-MANIFEST.JSON (if --json-output)
# ============================================================

run_manifest_stage

# ============================================================
# CLEANUP: Remove segment WAVs (regeneratable from full-audio.wav)
# ============================================================

complete_stream_run
