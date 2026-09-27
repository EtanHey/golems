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
# shellcheck source=stream/scoring.sh
source "$STREAM_HELPERS_DIR/stream/scoring.sh"
# shellcheck source=stream/transcription.sh
source "$STREAM_HELPERS_DIR/stream/transcription.sh"
# shellcheck source=stream/notifications.sh
source "$STREAM_HELPERS_DIR/stream/notifications.sh"

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
