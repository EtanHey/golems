#!/bin/bash
# Sourced only by process-stream.sh; definitions only. Entry owns config,
# stage order and trap install/removal; all functions run in the entry shell.
# prepare_scoring_stage globals (R): OUT_DIR, VIDEO, CHAT_LOG,
# CHAT_TIMESTAMPS_ARE_RELATIVE, TRANSCRIPT, VOLUME_FILE, SPIKES_FILE,
# GEMS_FILE, VOLUME_SPIKE_RATIO, STREAMER, DATE. (W): SPIKE_TIMES,
# CHAT_SPIKE_TIMES, SCORING_PROMPT, CURRENT_HEADER, CURRENT_TEXT,
# CURRENT_TS_SECS, CURRENT_DURATION_SECS, GEM_COUNT, SCORED_SEGMENTS,
# SKIPPED_SEGMENTS, SCORING_FAILURES, SCORE_RESULT, AGY_CONSECUTIVE_FAILURES,
# AGY_CIRCUIT_OPEN, TOTAL_SEGMENTS, LAST_HEARTBEAT_EPOCH, SEGMENT_INDEX,
# SCORE_RUN_DIR, SCORE_RESULTS_DIR, SCORE_CIRCUIT_DIR, SCORE_PIDS,
# SCORE_RESULT_DIRS, SCORING_COMPLETE, SCORING_SIGNAL.
# run_scoring_stage reads these globals and writes gems.md, worker statuses,
# counters and .stage-scoring.done; exits 75 on a failed score. Handlers read
# scoring state and remove incomplete gems, preserving retryable failure.

prepare_scoring_stage() {
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
}

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

run_scoring_stage() {
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
}
