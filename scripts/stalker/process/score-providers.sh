#!/bin/bash
# Sourced only by process-stream.sh; definitions only, same scoring shell.
# Globals (R): AGY_BIN, CODEX_BIN, CODEX_TIMEOUT_BIN, OUT_DIR, SCORING_PROMPT,
# STALKER_AGY_MODEL, STALKER_AGY_TIMEOUT, STALKER_CODEX_MODEL,
# STALKER_CODEX_EFFORT, STALKER_CODEX_TIMEOUT, STALKER_SCORE_PARALLEL,
# STALKER_AGY_CIRCUIT_THRESHOLD, SCORE_CIRCUIT_DIR, AGY_CIRCUIT_OPEN,
# AGY_CONSECUTIVE_FAILURES. (W): SCORE_RESULT, AGY_CIRCUIT_OPEN,
# AGY_CONSECUTIVE_FAILURES, SCORE_CIRCUIT_DIR/{open,failures,lock}.
# Provider stdin/argv and scoring JSON diagnostics remain exact.

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
