#!/bin/bash
# Sourced only by process-stream.sh; definitions only, same scoring shell.
# Globals (R): SPIKE_TIMES, CHAT_SPIKE_TIMES, STALKER_GEM_SCORE_WINDOW_SECS,
# SCORE_RESULT, SCORE_RESULTS_DIR, SCORE_RUN_DIR, SCORE_CIRCUIT_DIR,
# STALKER_SCORE_PARALLEL, OUT_DIR, STREAMER, DATE, STALKER_HEARTBEAT_SECS,
# STALKER_HEARTBEAT_NOTIFY, LAST_HEARTBEAT_EPOCH, TOTAL_SEGMENTS, CURRENT_TS_SECS,
# GEM_COUNT, SCORED_SEGMENTS, SKIPPED_SEGMENTS, SCORING_FAILURES,
# SCORE_PIDS, SCORE_RESULT_DIRS, SCORE_PENDING_SIGNAL, SCORE_PENDING_STATUS.
# (W): SEGMENT_INDEX, SCORE_PIDS, SCORE_RESULT_DIRS, SCORE_LAUNCH_ACTIVE,
# CURRENT_TS_SECS, SCORED_SEGMENTS, SKIPPED_SEGMENTS,
# SCORING_FAILURES, GEM_COUNT, LAST_HEARTBEAT_EPOCH; per-worker result files.
# Background PIDs, ordered results and cleanup stay in this one shell.

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

        # terminate_score_worker_groups — TERM every worker's process group,
        # poll up to <grace-secs> for all members to exit, then KILL the rest.
        # Needs no process-table access, unlike stalker_terminate_scorer_tree's
        # ps walk, so it still reaps where ps is denied (the Codex seatbelt
        # sandbox, #323). A group ID cannot be reused while any member lives,
        # so a live group is still this run's worker tree.
        terminate_score_worker_groups() {
            local grace="$1"
            local pgid alive polls
            shift

            for pgid in "$@"; do
                kill -TERM -- "-$pgid" 2>/dev/null || true
            done

            polls=$((grace * 20))
            while :; do
                alive=0
                for pgid in "$@"; do
                    if kill -0 -- "-$pgid" 2>/dev/null; then
                        alive=1
                        break
                    fi
                done
                [ "$alive" -eq 1 ] || return 0
                [ "$polls" -gt 0 ] || break
                polls=$((polls - 1))
                sleep 0.05
            done

            for pgid in "$@"; do
                kill -KILL -- "-$pgid" 2>/dev/null || true
            done
        }

        cleanup_score_run() {
            local pid

            if [ "${SCORE_PIDS+x}" = "x" ] && [ "${#SCORE_PIDS[@]}" -gt 0 ]; then
                # stderr is silenced for the whole block: bash may report a
                # killed monitor-mode worker ("Killed") at any command here,
                # not only at its wait.
                {
                    for pid in "${SCORE_PIDS[@]}"; do
                        stalker_terminate_scorer_tree "$pid" || true
                    done
                    # The tree walk needs ps; each worker leads its own process
                    # group (see dispatch_score_segment), so this sweep also
                    # reaps descendants the walk could not see (#323).
                    terminate_score_worker_groups 2 "${SCORE_PIDS[@]}" || true
                    for pid in "${SCORE_PIDS[@]}"; do
                        wait "$pid" || true
                    done
                } 2>/dev/null
            fi
            SCORE_PIDS=()
            SCORE_RESULT_DIRS=()

            case "${SCORE_RUN_DIR:-}" in
                "$OUT_DIR"/.stalker-score-results.*)
                    rm -rf -- "$SCORE_RUN_DIR"
                    ;;
            esac
        }

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

            # Monitor mode for this one launch makes the worker lead its own
            # process group, so cleanup can signal the whole scorer tree
            # without listing processes (#323). The entry shell stays in its
            # group; monitor mode is off again before anything else runs.
            # Monitor mode also drops the implicit </dev/null of a background
            # job, so keep it explicit: the worker must never share the
            # transcript read loop's stdin. A scoring signal from here until the
            # PID is registered is deferred, so cleanup always sees the worker.
            # shellcheck disable=SC2034  # read by scoring_signal_handler
            SCORE_LAUNCH_ACTIVE=1
            set -m
            run_score_segment_worker \
                "$header" "$text" "$ts_secs" "$duration_secs" "$result_dir" \
                < /dev/null > "$result_dir/worker.log" 2>&1 &
            set +m
            SCORE_PIDS+=("$!")
            SCORE_RESULT_DIRS+=("$result_dir")
            # shellcheck disable=SC2034  # read by scoring_signal_handler
            SCORE_LAUNCH_ACTIVE=0
            if [ -n "$SCORE_PENDING_SIGNAL" ]; then
                scoring_signal_handler "$SCORE_PENDING_SIGNAL" "$SCORE_PENDING_STATUS"
            fi
            if [ "${#SCORE_PIDS[@]}" -ge "$STALKER_SCORE_PARALLEL" ]; then
                reap_any_score_worker
            fi
        }
