#!/bin/bash
# Shared helpers for stream-watcher.sh and process-stream.sh.
#
# These exist as standalone functions so they can be unit-tested via bats
# (see scripts/tests/test-stream-helpers.bats). Source this file, then call
# the functions directly. No side effects on source.

STREAM_HELPERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=portable-stat.sh
source "$STREAM_HELPERS_DIR/portable-stat.sh"

# shellcheck source=stream/media.sh
source "$STREAM_HELPERS_DIR/stream/media.sh"
# shellcheck source=stream/process.sh
source "$STREAM_HELPERS_DIR/stream/process.sh"

# stalker_circuit_should_open — pure decision for the agy scorer circuit breaker.
# Exit 0 (open the breaker → skip agy, use codex exec) once consecutive agy
# failures reach the threshold; exit 1 otherwise. A single agy success resets the
# caller's counter, so a transient blip never permanently trips the breaker.
# Kept side-effect-free here so it can be unit-tested (see test-stream-helpers.bats).
stalker_circuit_should_open() {
    local failures="$1"
    local threshold="${2:-3}"
    [[ "$failures" =~ ^[0-9]+$ ]] || return 1
    [[ "$threshold" =~ ^[0-9]+$ ]] || threshold=3
    [ "$threshold" -lt 1 ] && threshold=1
    [ "$failures" -ge "$threshold" ]
}

# stalker_score_parallel_limit — normalize STALKER_SCORE_PARALLEL.
# A positive integer is preserved (including 1 for the serial safety fallback);
# unset, invalid, and non-positive values use the conservative default of 4.
stalker_score_parallel_limit() {
    local requested="${1:-}"
    if [[ "$requested" =~ ^[1-9][0-9]*$ ]]; then
        printf '%s\n' "$requested"
    else
        printf '4\n'
    fi
}

# stalker_acquire_circuit_lock — acquire the shared scorer-state lock.
# Cleanup may remove the per-run directory while an in-flight scorer is
# returning. Stop retrying in that case so the orphaned worker can exit.
stalker_acquire_circuit_lock() {
    local circuit_dir="$1"
    local lock_dir="$circuit_dir/lock"

    [ -d "$circuit_dir" ] || return 1
    while ! mkdir "$lock_dir" 2>/dev/null; do
        [ -d "$circuit_dir" ] || return 1
        sleep 0.05
    done
}

# stalker_circuit_next_state — pure transition for shared parallel agy state.
# Prints open|consecutive_failures|opened_now. Once open, the circuit is one-way
# for the run: an agy call that was already in flight cannot close it on success.
stalker_circuit_next_state() {
    local open="${1:-0}"
    local failures="${2:-0}"
    local outcome="${3:-}"
    local threshold="${4:-3}"

    case "$open" in
        0|1) ;;
        *) return 2 ;;
    esac
    [[ "$failures" =~ ^[0-9]+$ ]] || failures=0
    [[ "$threshold" =~ ^[0-9]+$ ]] || threshold=3
    [ "$threshold" -lt 1 ] && threshold=1

    if [ "$open" = "1" ]; then
        printf '1|%s|0\n' "$failures"
        return 0
    fi

    case "$outcome" in
        success)
            printf '0|0|0\n'
            ;;
        failure)
            failures=$((failures + 1))
            if stalker_circuit_should_open "$failures" "$threshold"; then
                printf '1|%s|1\n' "$failures"
            else
                printf '0|%s|0\n' "$failures"
            fi
            ;;
        *)
            return 2
            ;;
    esac
}

# stalker_merge_score_results — append worker gem fragments in segment order.
# Workers may finish in any order, but zero-padded result directory names make
# this single-writer merge deterministic and keep concurrent writes out of
# gems.md. Prints the number of gem fragments appended.
stalker_merge_score_results() {
    local results_root="$1"
    local gems_file="$2"
    local result_dir
    local merged=0
    local LC_ALL=C

    [ -d "$results_root" ] || return 1
    for result_dir in "$results_root"/segment-*; do
        [ -d "$result_dir" ] || continue
        [ -s "$result_dir/gem.md" ] || continue
        if ! cat "$result_dir/gem.md" >> "$gems_file"; then
            return 1
        fi
        merged=$((merged + 1))
    done
    printf '%s\n' "$merged"
}

# stalker_gems_complete — exit 0 only if a gems.md represents a scoring run that
# ran to completion. A full run always appends a "Scored: <date>" footer; the
# zero-gem and failure paths remove gems.md entirely. So a surviving gems.md that
# has gem entries but NO footer is a PARTIAL/interrupted run (e.g. the scorer was
# killed mid-stream) and must be re-scored — never silently skipped. This is the
# smarter auto-detection for the scheduled path: "a re-process must re-process."
stalker_gems_complete() {
    local file="$1"
    [ -f "$file" ] || return 1
    # Must contain at least one gem entry ("### [MM:SS] title").
    grep -q '^### \[' "$file" 2>/dev/null || return 1
    # Must contain the completion footer only written when scoring finishes.
    grep -q '^Scored: ' "$file" 2>/dev/null || return 1
    return 0
}

stalker_stage_done() {
    local out_dir="$1"
    local stage="$2"
    [ -f "$out_dir/.stage-${stage}.done" ]
}

mark_stalker_stage_done() {
    local out_dir="$1"
    local stage="$2"
    mkdir -p "$out_dir"
    printf '%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$out_dir/.stage-${stage}.done"
}

stalker_resolve_command() {
    local name="$1"
    local resolved
    if resolved=$(command -v "$name" 2>/dev/null); then
        printf '%s\n' "$resolved"
        return 0
    fi
    if [ -x "$HOME/.local/bin/$name" ]; then
        printf '%s\n' "$HOME/.local/bin/$name"
        return 0
    fi
    return 1
}

stalker_stage_status_summary() {
    local out_dir="$1"
    local marker name status summary=""
    for marker in "$out_dir"/.stage-*.done "$out_dir"/.stage-*.failed; do
        [ -f "$marker" ] || continue
        name="$(basename "$marker")"
        status="${name##*.}"
        name="${name#.stage-}"
        name="${name%.*}"
        summary="${summary}${name}=${status},"
    done
    [ -n "$summary" ] && printf '%s\n' "${summary%,}" || printf 'none\n'
}

stalker_mark_scoring_started() {
    local out_dir="$1"
    local pid="${2:-$$}"
    local marker tmp process_start
    marker="$out_dir/.stage-scoring.started"
    tmp="${marker}.tmp.$$"
    process_start="$(stalker_process_start_identity "$pid" || true)"

    mkdir -p "$out_dir"
    {
        printf 'status=STARTED\n'
        printf 'pid=%s\n' "$pid"
        printf 'started_at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
        printf 'process_start=%s\n' "$process_start"
    } > "$tmp"
    if ! mv "$tmp" "$marker"; then
        rm -f "$tmp"
        return 1
    fi
    rm -f "$out_dir/.stage-scoring.done" \
        "$out_dir/.stage-scoring.failed" \
        "$out_dir/.stage-pipeline-failure-alerted.done"
}

stalker_reconcile_interrupted_scoring_run() {
    local out_dir="$1"
    local marker="$out_dir/.stage-scoring.started"
    local pid expected_start actual_start started_at reason

    [ -f "$marker" ] || return 0
    [ ! -f "$out_dir/.stage-scoring.done" ] || return 0
    [ ! -f "$out_dir/.stage-scoring.failed" ] || return 0

    if stalker_gems_complete "$out_dir/gems.md"; then
        mark_stalker_stage_done "$out_dir" "scoring"
        return 0
    fi

    pid="$(sed -n 's/^pid=//p' "$marker" | head -n 1)"
    expected_start="$(sed -n 's/^process_start=//p' "$marker" | head -n 1)"
    started_at="$(sed -n 's/^started_at=//p' "$marker" | head -n 1)"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
        actual_start="$(stalker_process_start_identity "$pid" || true)"
        if [ -n "$expected_start" ] \
            && [ -n "$actual_start" ] \
            && [ "$actual_start" = "$expected_start" ]; then
            return 0
        fi
    fi

    rm -f "$out_dir/gems.md"
    reason="scoring process ${pid:-unknown} from ${started_at:-unknown time} disappeared before completion (untrappable exit or SIGKILL); incomplete gems were removed and the run can be retried with STALKER_FORCE_RESCORE=1"
    stalker_record_stage_failure "$out_dir" "scoring" "$reason" "$out_dir/chat.log"
}

stalker_reconcile_interrupted_scoring_root() {
    local root="$1"
    local marker
    [ -d "$root" ] || return 0

    for marker in "$root"/*/.stage-scoring.started; do
        [ -f "$marker" ] || continue
        stalker_reconcile_interrupted_scoring_run "${marker%/.stage-scoring.started}"
    done
}

stalker_record_stage_failure() {
    local out_dir="$1"
    local stage="$2"
    local reason="$3"
    local chat_file="${4:-$out_dir/chat.log}"
    local marker="$out_dir/.stage-${stage}.failed"
    local gem_count=0 chat_count
    mkdir -p "$out_dir"
    rm -f "$out_dir/.stage-${stage}.done"
    if [ -f "$out_dir/gems.md" ]; then
        gem_count=$(grep -c '^### \[' "$out_dir/gems.md" 2>/dev/null || true)
        gem_count="${gem_count:-0}"
    fi
    chat_count=$(count_chat_lines "$chat_file")
    {
        printf 'status=FAILED\n'
        printf 'stage=%s\n' "$stage"
        printf 'retryable=true\n'
        printf 'reason=%s\n' "$reason"
        printf 'gem_count=%s\n' "$gem_count"
        printf 'chat_count=%s\n' "$chat_count"
        printf 'stream_dir=%s\n' "$out_dir"
        printf 'gems_path=%s\n' "$out_dir/gems.md"
        printf 'chat_path=%s\n' "${chat_file:-not-provided}"
        printf 'failed_at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    } > "$marker"

    if [ ! -f "$out_dir/.stage-pipeline-failure-alerted.done" ]; then
        local stages body
        stages=$(stalker_stage_status_summary "$out_dir")
        body="Stage: ${stage}. Reason: ${reason}. Statuses: ${stages}. gem_count=${gem_count}; chat_count=${chat_count}. Stream: ${out_dir}. Gems: ${out_dir}/gems.md. Chat: ${chat_file:-not-provided}. retryable=true; success markers remain open."
        local failure_title="Stalker Pipeline Failure"
        [ "$stage" != "run-quality" ] || failure_title="Stalker FAILED at stage 6"
        notify_stalker_telegram "$failure_title" "$body" "high" "stalker-golem" || true
        mark_stalker_stage_done "$out_dir" "pipeline-failure-alerted"
    fi
}

stalker_require_run_quality() {
    local out_dir="$1"
    local chat_file="${2:-$out_dir/chat.log}"
    local stage="${3:-run-quality}"
    local gem_count=0 chat_count
    if [ -f "$out_dir/gems.md" ]; then
        gem_count=$(grep -c '^### \[' "$out_dir/gems.md" 2>/dev/null || true)
        gem_count="${gem_count:-0}"
    fi
    chat_count=$(count_chat_lines "$chat_file")
    if [ "$gem_count" -le 0 ]; then
        stalker_record_stage_failure "$out_dir" "run-quality" \
            "quality gate before ${stage}: requires gem_count>0 (got ${gem_count}); chat_count=${chat_count} is tracked independently" \
            "$chat_file"
        if [ "$chat_count" -le 0 ]; then
            stalker_record_stage_failure "$out_dir" "chat" \
                "chat_count=0; digest remains eligible only after gem_count>0" "$chat_file"
        fi
        return 1
    fi

    rm -f "$out_dir/.stage-run-quality.failed"
    if [ "$chat_count" -le 0 ]; then
        stalker_record_stage_failure "$out_dir" "chat" \
            "chat_count=0; curated gems remain eligible for delivery" "$chat_file"
    else
        rm -f "$out_dir/.stage-chat.failed"
    fi
    return 0
}

# The chat lurker bundle is generated (scripts/dist/ is gitignored). Build it
# when it is missing or older than its source or the lockfile; a fresh bundle
# is left alone. Fails loud without bun rather than launching a missing file.
stalker_ensure_lurker_bundle() {
    local bundle="$1"
    local source_file="$2"
    local lockfile="$3"
    local build_script="$4"
    if [ -f "$bundle" ] && [ ! "$source_file" -nt "$bundle" ] && [ ! "$lockfile" -nt "$bundle" ]; then
        return 0
    fi
    if ! command -v bun >/dev/null 2>&1; then
        echo "ERROR: bun is required to build the chat lurker bundle $bundle" >&2
        return 1
    fi
    "$build_script" "$bundle"
}

stalker_require_lurker_ready() {
    local out_dir="$1"
    local pid="$2"
    local log_file="$3"
    local chat_file="$4"
    local timeout="${STALKER_LURKER_START_TIMEOUT:-15}"
    local waited=0
    while [ "$waited" -lt "$timeout" ]; do
        if ! kill -0 "$pid" 2>/dev/null; then
            stalker_record_stage_failure "$out_dir" "chat" \
                "chat lurker pid ${pid} exited before connected sentinel" "$chat_file"
            return 1
        fi
        if [ -f "$chat_file" ] && grep -F -q '[lurk] Connected to ' "$log_file" 2>/dev/null; then
            return 0
        fi
        sleep 1
        waited=$((waited + 1))
    done
    stalker_record_stage_failure "$out_dir" "chat" \
        "chat lurker pid ${pid} produced no connected sentinel/chat.log within ${timeout}s" "$chat_file"
    return 1
}

_stalker_sleep_between_retries() {
    local attempt="$1"
    local base="${STALKER_RETRY_SLEEP_BASE:-1}"
    [ "$base" = "0" ] && return 0
    sleep $((base * (2 ** (attempt - 1))))
}

transcribe_with_whisper_cli() {
    local segment_file="$1"
    local model_file="$2"
    local max_attempts="${3:-3}"

    command -v whisper-cli >/dev/null 2>&1 || return 127
    [ -f "$model_file" ] || return 126

    local attempt output status
    for ((attempt=1; attempt<=max_attempts; attempt++)); do
        output=$(whisper-cli -m "$model_file" -f "$segment_file" --no-timestamps 2>&1)
        status=$?
        if [ "$status" -eq 0 ]; then
            if [[ "$output" == \{* ]] && command -v python3 >/dev/null 2>&1; then
                python3 -c 'import json, sys; d=json.load(sys.stdin); print(d.get("text") or d.get("transcription") or d.get("result") or json.dumps(d))' <<< "$output"
            else
                printf '%s\n' "$output"
            fi
            return 0
        fi
        printf 'whisper-cli attempt %s/%s failed for %s: %s\n' "$attempt" "$max_attempts" "$segment_file" "$output" >&2
        [ "$attempt" -lt "$max_attempts" ] && _stalker_sleep_between_retries "$attempt"
    done

    return 1
}

transcribe_with_whisper_server() {
    local segment_file="$1"
    local max_attempts="${2:-3}"
    local endpoint="${WHISPER_SERVER_URL:-http://127.0.0.1:8178/inference}"

    command -v curl >/dev/null 2>&1 || return 127

    local attempt output status
    for ((attempt=1; attempt<=max_attempts; attempt++)); do
        output=$(curl -fsS -m "${WHISPER_SERVER_TIMEOUT:-30}" \
            -X POST \
            -F "file=@${segment_file}" \
            "$endpoint" 2>&1)
        status=$?
        if [ "$status" -eq 0 ]; then
            if [[ "$output" == \{* ]] && command -v python3 >/dev/null 2>&1; then
                python3 -c 'import json, sys; d=json.load(sys.stdin); print(d.get("text") or d.get("transcription") or d.get("result") or json.dumps(d))' <<< "$output"
            else
                printf '%s\n' "$output"
            fi
            return 0
        fi
        printf 'whisper-server attempt %s/%s failed for %s: %s\n' "$attempt" "$max_attempts" "$segment_file" "$output" >&2
        [ "$attempt" -lt "$max_attempts" ] && _stalker_sleep_between_retries "$attempt"
    done

    return 1
}

_stalker_json_payload() {
    local recipient="$1"
    local message="$2"
    command -v python3 >/dev/null 2>&1 || return 127
    python3 -c 'import json, sys; print(json.dumps({"recipient": sys.argv[1], "message": sys.argv[2]}))' "$recipient" "$message"
}

_stalker_telegram_payload() {
    local title="$1"
    local body="$2"
    local priority="${3:-default}"
    local source="${4:-stalker-golem}"
    command -v python3 >/dev/null 2>&1 || return 127
    python3 -c 'import json, sys; print(json.dumps({"title": sys.argv[1], "body": sys.argv[2], "source": sys.argv[4], "priority": sys.argv[3]}, indent=2))' \
        "$title" "$body" "$priority" "$source"
}

notify_stalker_telegram() {
    local title="$1"
    local body="$2"
    local priority="${3:-default}"
    local source="${4:-stalker-golem}"

    if [ "${STALKER_TELEGRAM_NOTIFY:-1}" = "0" ]; then
        echo "Telegram notifications disabled by STALKER_TELEGRAM_NOTIFY=0"
        return 0
    fi

    local payload
    payload=$(_stalker_telegram_payload "$title" "$body" "$priority" "$source") || {
        echo "Telegram notifications disabled: python3 is required to build JSON payload" >&2
        return 1
    }

    if [ -n "${STALKER_TELEGRAM_CMD:-}" ]; then
        if printf '%s\n' "$payload" | "$STALKER_TELEGRAM_CMD"; then
            return 0
        fi
        printf 'Telegram send failed via STALKER_TELEGRAM_CMD=%s\n' "$STALKER_TELEGRAM_CMD" >&2
    else
        local url="${STALKER_TELEGRAM_NOTIFY_URL:-http://127.0.0.1:3847/notify}"
        if command -v curl >/dev/null 2>&1 && curl -fsS -m "${STALKER_TELEGRAM_TIMEOUT:-5}" \
            -X POST \
            -H "Content-Type: application/json" \
            -d "$payload" \
            "$url" >/dev/null 2>&1; then
            printf 'Telegram sent via %s\n' "$url" >&2
            return 0
        fi
    fi

    local queue_dir="${STALKER_TELEGRAM_QUEUE_DIR:-$HOME/.brainlayer/queue/stalker-telegram-pending}"
    mkdir -p "$queue_dir"
    local queue_file
    queue_file="$queue_dir/$(date -u '+%Y%m%dT%H%M%SZ')-$$-${RANDOM:-0}-stalker-telegram.json"
    printf '%s\n' "$payload" > "$queue_file"
    printf 'Telegram queued for retry: %s\n' "$queue_file" >&2
    return 1
}

notify_stalker_whatsapp() {
    local message="$1"
    if [ "${STREAM_WHATSAPP_NOTIFY:-1}" = "0" ]; then
        echo "WhatsApp notifications disabled by STREAM_WHATSAPP_NOTIFY=0"
        return 0
    fi

    local queue_dir="${STALKER_WHATSAPP_QUEUE_DIR:-$HOME/.brainlayer/queue/stalker-whatsapp-pending}"
    local recipient="${STREAM_WHATSAPP_RECIPIENT:-${STALKER_WHATSAPP_RECIPIENT:-}}"
    if [ -z "$recipient" ]; then
        echo "WhatsApp notifications disabled: STREAM_WHATSAPP_RECIPIENT not set"
        return 0
    fi

    local payload
    payload=$(_stalker_json_payload "$recipient" "$message") || {
        echo "WhatsApp notifications disabled: python3 is required to build JSON payload" >&2
        return 1
    }

    local endpoints="${STALKER_WHATSAPP_ENDPOINTS:-http://127.0.0.1:8741/api/send http://127.0.0.1:8741/api/sendMessage http://127.0.0.1:8080/api/send http://127.0.0.1:8742/api/send}"
    local url
    for url in $endpoints; do
        if command -v curl >/dev/null 2>&1 && curl -fsS -m "${STALKER_WHATSAPP_TIMEOUT:-5}" \
            -X POST \
            -H "Content-Type: application/json" \
            -d "$payload" \
            "$url" >/dev/null 2>&1; then
            printf 'WhatsApp sent via %s\n' "$url" >&2
            return 0
        fi
        printf 'WhatsApp send failed via %s\n' "$url" >&2
    done

    mkdir -p "$queue_dir"
    local queued_at queue_file
    queued_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
    queue_file="$queue_dir/$(date -u '+%Y%m%dT%H%M%SZ')-$$-${RANDOM:-0}-stalker-whatsapp.json"
    python3 -c '
import json, sys
record = {"recipient": sys.argv[1], "message": sys.argv[2], "queued_at": sys.argv[3], "reason": "all WhatsApp bridge endpoints failed"}
open(sys.argv[4], "w").write(json.dumps(record, indent=2) + "\n")
' "$recipient" "$message" "$queued_at" "$queue_file"
    printf 'WhatsApp queued for retry: %s\n' "$queue_file" >&2
    return 1
}

transcribe_segment_with_fallback() {
    local segment_file="$1"
    local model_file="$2"
    local segment_id="$3"
    local out_dir="$4"
    local max_attempts="${STALKER_TRANSCRIBE_ATTEMPTS:-3}"

    local output
    if output=$(transcribe_with_whisper_server "$segment_file" "$max_attempts"); then
        printf '%s\n' "$output"
        return 0
    fi

    if output=$(transcribe_with_whisper_cli "$segment_file" "$model_file" "$max_attempts"); then
        printf '%s\n' "$output"
        return 0
    fi

    local message="Stalker: segment ${segment_id} transcription failed permanently after ${max_attempts} retries, audio at ${segment_file}"
    mkdir -p "$out_dir"
    printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$message" >> "$out_dir/transcription-failures.log"
    notify_stalker_telegram "Stalker Transcription Failure" "$message" "high" "stalker-golem" || true
    return 1
}
