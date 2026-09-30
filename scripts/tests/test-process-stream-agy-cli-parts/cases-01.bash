function split_case_001() {
    stream_dir="$(make_parallel_candidate_fixture)"
    parallel_state="$TMPDIR_/parallel-default"
    mkdir -p "$parallel_state"
    install_timed_parallel_agy

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        PARALLEL_STATE_DIR="$parallel_state" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4"

    [ "$status" -eq 0 ]
    [ "$(cat "$parallel_state/max")" = "4" ]
    grep -F -q 'Scoring concurrency: 4' <<< "$output"
    [ "$(grep '^### ' "$stream_dir/gems.md")" = "### [00:10] Segment 1 (20s) First Finishes Last
### [00:40] Segment 2 (20s) Second Frees First Slot
### [01:10] Segment 3 (20s) Third Finishes After Second
### [01:40] Segment 4 (20s) Fourth Finishes Before First
### [02:10] Segment 5 (20s) Fifth Uses Completed Slot" ]
    five_start_line=$(grep -n '^start:FIVE$' "$parallel_state/events" | cut -d: -f1)
    one_finish_line=$(grep -n '^finish:ONE$' "$parallel_state/events" | cut -d: -f1)
    [ "$five_start_line" -lt "$one_finish_line" ]
    grep -F -q 'Gems found: 5' "$stream_dir/gems.md"
    grep -q '^Scored: ' "$stream_dir/gems.md"
}

function split_case_002() {
    stream_dir="$(make_parallel_candidate_fixture)"
    parallel_state="$TMPDIR_/parallel-serial"
    mkdir -p "$parallel_state"
    install_timed_parallel_agy

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        PARALLEL_STATE_DIR="$parallel_state" \
        STALKER_SCORE_PARALLEL=1 \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4"

    [ "$status" -eq 0 ]
    [ "$(cat "$parallel_state/max")" = "1" ]
    grep -F -q 'Scoring concurrency: 1' <<< "$output"
    [ "$(grep '^### ' "$stream_dir/gems.md" | wc -l | tr -d ' ')" = "5" ]
    grep -q '^Scored: ' "$stream_dir/gems.md"
}

function split_case_003() {
    stream_dir="$(make_parallel_circuit_fixture)"
    agy_calls="$TMPDIR_/parallel-circuit-agy-calls"
    install_failing_parallel_agy_with_codex_fallback

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        AGY_CALLS_FILE="$agy_calls" \
        STALKER_AGY_CIRCUIT_THRESHOLD=2 \
        STALKER_SCORE_PARALLEL=4 \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4"

    [ "$status" -eq 0 ]
    calls=$(cat "$agy_calls")
    [ "$calls" -ge 2 ]
    [ "$calls" -lt 8 ]
    [ "$(grep -c 'agy circuit breaker OPEN' <<< "$output")" = "1" ]
    grep -F -q 'Candidate segments scored: 8' "$stream_dir/gems.md"
    grep -F -q 'Scoring failures: 0' "$stream_dir/gems.md"
    grep -q '^Scored: ' "$stream_dir/gems.md"
}

function split_case_004() {
    stream_dir="$(make_scoring_fixture)"
    scorer_pids_file="$TMPDIR_/interrupt-scorer-pids"
    process_output="$TMPDIR_/interrupt-output"
    telegram_capture="$TMPDIR_/interrupt-telegram.json"
    install_blocking_agy
    cat > "$FAKE_BIN/capture-telegram" <<'SH'
#!/bin/bash
cat > "$TELEGRAM_CAPTURE_FILE"
SH
    chmod +x "$FAKE_BIN/capture-telegram"

    env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        SCORER_PIDS_FILE="$scorer_pids_file" \
        TELEGRAM_CAPTURE_FILE="$telegram_capture" \
        STALKER_SCORE_PARALLEL=4 \
        STALKER_TELEGRAM_CMD="$FAKE_BIN/capture-telegram" \
        STREAM_WHATSAPP_NOTIFY=0 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4" > "$process_output" 2>&1 &
    process_pid=$!

    for _ in {1..100}; do
        [ -s "$scorer_pids_file" ] && break
        sleep 0.02
    done
    [ -s "$scorer_pids_file" ]
    read -r worker_pid scorer_pid < "$scorer_pids_file"

    kill -TERM "$process_pid"
    for _ in {1..100}; do
        kill -0 "$process_pid" 2>/dev/null || break
        sleep 0.02
    done
    if kill -0 "$process_pid" 2>/dev/null; then
        kill -KILL "$process_pid" 2>/dev/null || true
    fi
    wait "$process_pid" 2>/dev/null || true

    for _ in {1..100}; do
        kill -0 "$scorer_pid" 2>/dev/null || break
        sleep 0.02
    done
    scorer_survived=0
    if kill -0 "$scorer_pid" 2>/dev/null; then
        scorer_survived=1
        kill -KILL "$scorer_pid" 2>/dev/null || true
    fi
    kill -KILL "$worker_pid" 2>/dev/null || true

    [ "$scorer_survived" -eq 0 ]
    [ "$(find "$stream_dir" -maxdepth 1 -type d -name '.stalker-score-results.*' | wc -l | tr -d ' ')" = "0" ]
    [ ! -f "$stream_dir/gems.md" ]
    [ -f "$stream_dir/.stage-scoring.failed" ]
    grep -F -q 'retryable=true' "$stream_dir/.stage-scoring.failed"
    grep -F -q "$(basename "$stream_dir")" "$stream_dir/.stage-scoring.failed"
    grep -F -q 'interrupted before completion' "$stream_dir/.stage-scoring.failed"
    [ -f "$telegram_capture" ]
    grep -F -q '"title": "Stalker Pipeline Failure"' "$telegram_capture"
    grep -F -q "$(basename "$stream_dir")" "$telegram_capture"
}

# issue #323: a slow scorer that owns a grandchild, so a reap has to walk the
# whole worker tree (worker shell -> agy -> sleep), not just the worker shell.
install_slow_tree_agy() {
    cat > "$FAKE_BIN/agy" <<'SH'
#!/bin/bash
sleep 30 &
child=$!
printf '%s %s %s\n' "$PPID" "$$" "$child" > "$SLOW_AGY_PID_DIR/agy-$$"
wait "$child"
SH

    cat > "$FAKE_BIN/codex" <<'SH'
#!/bin/bash
exit 1
SH
    chmod +x "$FAKE_BIN/agy" "$FAKE_BIN/codex"
}

# The Codex seatbelt sandbox denies the process table: /bin/ps exits 126 with
# "Operation not permitted". A reap that needs ps to find descendants finds none.
install_denied_ps() {
    cat > "$FAKE_BIN/ps" <<'SH'
#!/bin/bash
printf 'sh: /bin/ps: Operation not permitted\n' >&2
exit 126
SH
    chmod +x "$FAKE_BIN/ps"
}

# Send $1 to process-stream while two parallel scorers are in flight; sets
# signal_status and surviving_pids (worker/agy/grandchild PIDs still alive).
# Pass "deny-ps" as $3 to run with the process table hidden.
interrupt_parallel_scoring() {
    local signal="$1"
    local stream_dir="$2"
    local ps_mode="${3:-real-ps}"
    local pid_dir="$TMPDIR_/slow-agy-pids-$signal"
    local pid_file pid process_pid

    mkdir -p "$pid_dir"
    install_slow_tree_agy
    [ "$ps_mode" = "deny-ps" ] && install_denied_ps
    # A background job in a non-interactive shell starts with SIGINT ignored,
    # and bash cannot trap a signal ignored on entry; restore the default so
    # INT reaches the entry trap the way a terminal Ctrl-C would.
    perl -e '$SIG{INT} = "DEFAULT"; exec @ARGV or die $!' \
        env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        SLOW_AGY_PID_DIR="$pid_dir" \
        STALKER_SCORE_PARALLEL=2 \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4" \
        > "$TMPDIR_/interrupt-$signal.stdout" 2> "$TMPDIR_/interrupt-$signal.stderr" &
    process_pid=$!

    for _ in {1..250}; do
        [ "$(find "$pid_dir" -name 'agy-*' | wc -l | tr -d ' ')" -ge 2 ] && break
        sleep 0.02
    done
    [ "$(find "$pid_dir" -name 'agy-*' | wc -l | tr -d ' ')" -eq 2 ]

    kill "-$signal" "$process_pid"
    signal_status=0
    wait "$process_pid" || signal_status=$?

    surviving_pids=""
    for pid_file in "$pid_dir"/agy-*; do
        for pid in $(cat "$pid_file"); do
            for _ in {1..50}; do
                kill -0 "$pid" 2>/dev/null || break
                sleep 0.02
            done
            if kill -0 "$pid" 2>/dev/null; then
                surviving_pids="$surviving_pids $pid"
            fi
        done
    done
    # Never leak a stray sleeper into the rest of the suite.
    for pid in $surviving_pids; do
        kill -KILL "$pid" 2>/dev/null || true
    done
}

assert_interrupted_scoring_outputs() {
    local signal="$1"
    local stream_dir="$2"

    [ "$(find "$stream_dir" -maxdepth 1 -type d -name '.stalker-score-results.*' | wc -l | tr -d ' ')" = "0" ]
    [ ! -f "$stream_dir/gems.md" ]
    [ ! -f "$stream_dir/.stage-scoring.done" ]
    grep -F -q "scoring interrupted before completion by $signal;" "$stream_dir/.stage-scoring.failed"
    grep -F -q 'retryable=true' "$stream_dir/.stage-scoring.failed"
    grep -F -q 'Scoring concurrency: 2' "$TMPDIR_/interrupt-$signal.stdout"
    ! grep -F -q 'Auto-scoring complete' "$TMPDIR_/interrupt-$signal.stdout"
    [ ! -s "$TMPDIR_/interrupt-$signal.stderr" ]
}

function split_case_005() {
    stream_dir="$(make_two_candidate_fixture)"

    interrupt_parallel_scoring TERM "$stream_dir"

    [ "$signal_status" -eq 143 ]
    [ -z "$surviving_pids" ]
    assert_interrupted_scoring_outputs TERM "$stream_dir"
}

function split_case_006() {
    stream_dir="$(make_two_candidate_fixture)"

    interrupt_parallel_scoring INT "$stream_dir"

    [ "$signal_status" -eq 130 ]
    [ -z "$surviving_pids" ]
    assert_interrupted_scoring_outputs INT "$stream_dir"
}

function split_case_007() {
    stream_dir="$(make_two_candidate_fixture)"

    interrupt_parallel_scoring TERM "$stream_dir" deny-ps

    [ "$signal_status" -eq 143 ]
    [ -z "$surviving_pids" ]
    assert_interrupted_scoring_outputs TERM "$stream_dir"
}

function split_case_008() {
    stream_dir="$(make_two_candidate_fixture)"

    interrupt_parallel_scoring INT "$stream_dir" deny-ps

    [ "$signal_status" -eq 130 ]
    [ -z "$surviving_pids" ]
    assert_interrupted_scoring_outputs INT "$stream_dir"
}

# R1 race (#323): a signal between the worker fork and its SCORE_PIDS
# registration must still reap that worker. A DEBUG trap fires the signal right
# before the command named by $2 inside dispatch_score_segment, deterministically.
signal_in_dispatch_window() {
    local signal="$1"
    local window_command="$2"
    local harness="$TMPDIR_/dispatch-window-harness.sh"
    local worker_pid_file="$TMPDIR_/dispatch-window-worker-pid"

    cat > "$harness" <<'SH'
#!/bin/bash
set -euo pipefail
source "$REPO_ROOT/scripts/lib/stream-helpers.sh"
source "$REPO_ROOT/scripts/stalker/process/score-workers.sh"
source "$REPO_ROOT/scripts/stalker/process/scoring.sh"
log() { :; }
OUT_DIR="$WINDOW_OUT_DIR"
SCORE_RUN_DIR="$OUT_DIR/.stalker-score-results.window"
SCORE_RESULTS_DIR="$SCORE_RUN_DIR/results"
mkdir -p "$SCORE_RESULTS_DIR"
STALKER_SCORE_PARALLEL=2
SEGMENT_INDEX=0
SCORE_PIDS=()
SCORE_RESULT_DIRS=()
SCORE_LAUNCH_ACTIVE=0
SCORE_PENDING_SIGNAL=""
SCORING_SIGNAL=""
run_score_segment_worker() { exec sleep 30; }
window_exit() {
    local status=$?
    trap - EXIT INT TERM
    cleanup_score_run
    exit "$status"
}
trap window_exit EXIT
trap 'scoring_signal_handler INT 130' INT
trap 'scoring_signal_handler TERM 143' TERM
fire_in_window() {
    case "$BASH_COMMAND" in
        "$WINDOW_COMMAND"*)
            trap - DEBUG
            printf '%s\n' "$!" > "$WINDOW_WORKER_PID_FILE"
            kill "-$WINDOW_SIGNAL" "$$"
            ;;
    esac
}
set -T
trap fire_in_window DEBUG
dispatch_score_segment "## [00:10] Segment 1 (20s)" "text" 10 20
trap - DEBUG
printf 'dispatch returned without the signal\n' >&2
exit 3
SH
    chmod +x "$harness"

    signal_status=0
    perl -e '$SIG{INT} = "DEFAULT"; exec @ARGV or die $!' \
        env REPO_ROOT="$REPO_ROOT" WINDOW_OUT_DIR="$TMPDIR_" \
        WINDOW_COMMAND="$window_command" WINDOW_SIGNAL="$signal" \
        WINDOW_WORKER_PID_FILE="$worker_pid_file" \
        /bin/bash "$harness" > "$TMPDIR_/dispatch-window.out" 2>&1 || signal_status=$?

    [ -s "$worker_pid_file" ]
    window_worker_pid="$(cat "$worker_pid_file")"
    [[ "$window_worker_pid" =~ ^[0-9]+$ ]]
    window_worker_survived=0
    for _ in {1..50}; do
        kill -0 "$window_worker_pid" 2>/dev/null || break
        sleep 0.02
    done
    if kill -0 "$window_worker_pid" 2>/dev/null; then
        window_worker_survived=1
        kill -KILL "$window_worker_pid" 2>/dev/null || true
    fi
}

function split_case_009() {
    signal_in_dispatch_window TERM 'SCORE_PIDS+='

    [ "$window_worker_survived" -eq 0 ]
    [ "$signal_status" -eq 143 ]
    [ ! -d "$TMPDIR_/.stalker-score-results.window" ]
}

function split_case_010() {
    signal_in_dispatch_window INT 'set +m'

    [ "$window_worker_survived" -eq 0 ]
    [ "$signal_status" -eq 130 ]
    [ ! -d "$TMPDIR_/.stalker-score-results.window" ]
}

function split_case_011() {
    stream_dir="$(make_scoring_fixture)"
    scorer_pids_file="$TMPDIR_/sigkill-scorer-pids"
    telegram_capture="$TMPDIR_/sigkill-telegram.json"
    install_blocking_agy
    cat > "$FAKE_BIN/capture-telegram" <<'SH'
#!/bin/bash
cat > "$TELEGRAM_CAPTURE_FILE"
SH
    chmod +x "$FAKE_BIN/capture-telegram"

    env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        SCORER_PIDS_FILE="$scorer_pids_file" \
        STALKER_SCORE_PARALLEL=4 \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4" > "$TMPDIR_/sigkill-output" 2>&1 &
    process_pid=$!

    for _ in {1..100}; do
        [ -s "$scorer_pids_file" ] && break
        sleep 0.02
    done
    [ -s "$scorer_pids_file" ]
    read -r worker_pid scorer_pid < "$scorer_pids_file"
    started_exists=0
    [ -f "$stream_dir/.stage-scoring.started" ] && started_exists=1

    # Model launchd kickstart -k: the whole coalition receives an untrappable KILL.
    kill -KILL "$process_pid" "$worker_pid" "$scorer_pid" 2>/dev/null || true
    wait "$process_pid" 2>/dev/null || true

    [ "$started_exists" -eq 1 ]
    [ ! -f "$stream_dir/.stage-scoring.done" ]
    [ ! -f "$stream_dir/.stage-scoring.failed" ]

    TELEGRAM_CAPTURE_FILE="$telegram_capture" \
    STALKER_TELEGRAM_CMD="$FAKE_BIN/capture-telegram" \
    run bash -c 'source "$1"; stalker_reconcile_interrupted_scoring_run "$2"' \
        _ "$REPO_ROOT/scripts/lib/stream-helpers.sh" "$stream_dir"

    [ "$status" -eq 0 ]
    [ ! -f "$stream_dir/gems.md" ]
    [ -f "$stream_dir/.stage-scoring.failed" ]
    grep -F -q 'untrappable exit or SIGKILL' "$stream_dir/.stage-scoring.failed"
    grep -F -q "$(basename "$stream_dir")" "$stream_dir/.stage-scoring.failed"
    grep -F -q '"title": "Stalker Pipeline Failure"' "$telegram_capture"
    grep -F -q "$(basename "$stream_dir")" "$telegram_capture"
}

function split_case_012() {
    stream_dir="$(make_scoring_fixture)"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4"

    [[ "$status" -eq 0 \
        && -f "$stream_dir/gems.md" \
        && -f "$stream_dir/.stage-scoring.done" \
        && ! -f "$stream_dir/.stage-scoring.failed" ]] \
        && grep -F -q '### [00:10] Segment 1 (30s) Spike Chat Goes Wild' "$stream_dir/gems.md" \
        && grep -F -q '**Score:** 9/10 | **Type:** hype' "$stream_dir/gems.md" \
        && grep -F -q '**Gist:** The streamer gets loud and chat explodes around a clear highlight moment.' "$stream_dir/gems.md" \
        && grep -F -q '**Volume spike:** yes' "$stream_dir/gems.md" \
        && grep -F -q '**Chat spike:** yes' "$stream_dir/gems.md" \
        && grep -F -q 'Gems found: 1' "$stream_dir/gems.md" \
        && grep -F -q -- '--model Gemini 3.1 Pro (High)' "$AGY_ARGS_FILE"
}

function split_case_013() {
    stream_dir="$(make_scoring_fixture "$TMPDIR_/examplechannel-2026-06-25-040516" "video.mp4")"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4" --json-output

    [ "$status" -eq 0 ]
    [ -f "$stream_dir/gems.md" ]
    [ -f "$stream_dir/gems-manifest.json" ]
    assert_stream_labels "$stream_dir" "examplechannel" "2026-06-25"
}

function split_case_014() {
    stream_dir="$(make_scoring_fixture "$TMPDIR_/legacy" "twitch-examplechannel-2026-06-24.mp4")"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        "$PROCESS_STREAM" "$stream_dir/twitch-examplechannel-2026-06-24.mp4" --json-output

    [ "$status" -eq 0 ]
    [ -f "$stream_dir/gems.md" ]
    [ -f "$stream_dir/gems-manifest.json" ]
    assert_stream_labels "$stream_dir" "examplechannel" "2026-06-24"
}

function split_case_015() {
    stream_dir="$(make_scoring_fixture "$TMPDIR_/fallback" "local-highlight.mp4")"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        "$PROCESS_STREAM" "$stream_dir/local-highlight.mp4" --json-output

    [ "$status" -eq 0 ]
    [ -f "$stream_dir/gems.md" ]
    [ -f "$stream_dir/gems-manifest.json" ]
    grep -F -q '# Gems: local-highlight (' "$stream_dir/gems.md"
    grep -F -q '"streamer": "local-highlight"' "$stream_dir/gems-manifest.json"
    ! grep -F -q '"streamer": "local-highlight.mp4"' "$stream_dir/gems-manifest.json"
}

function split_case_016() {
    stream_dir="$(make_json_relative_chat_fixture)"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        TZ=Asia/Jerusalem \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        STALKER_GEM_SCORE_WINDOW_SECS=10 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4" "$stream_dir/chat.json" --chat-json

    [ "$status" -eq 0 ]
    [ -f "$stream_dir/gems.md" ]
    grep -F -q 'stream=80 [01:20] <<<' "$stream_dir/chat-velocity.txt"
    grep -F -q '### [01:20] Segment 1 (20s) Spike Chat Goes Wild' "$stream_dir/gems.md"
    grep -F -q '**Chat spike:** yes' "$stream_dir/gems.md"
}

function split_case_017() {
    stream_dir="$(make_chat_stream_offset_fixture)"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        STALKER_GEM_SCORE_WINDOW_SECS=10 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4"

    [ "$status" -eq 0 ]
    [ -f "$stream_dir/gems.md" ]
    grep -F -q '### [01:20] Segment 1 (20s) Spike Chat Goes Wild' "$stream_dir/gems.md"
    grep -F -q '**Chat spike:** yes' "$stream_dir/gems.md"
    ! grep -F -q '**Volume spike:** yes' "$stream_dir/gems.md"
}

function split_case_018() {
    stream_dir="$(make_stale_chat_velocity_fixture)"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        TZ=Asia/Jerusalem \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        STALKER_GEM_SCORE_WINDOW_SECS=10 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4" "$stream_dir/chat.log"

    [ "$status" -eq 0 ]
    [ -f "$stream_dir/gems.md" ]
    grep -F -q 'stream=80 [01:20] <<<' "$stream_dir/chat-velocity.txt"
    grep -F -q '### [01:20] Segment 1 (20s) Spike Chat Goes Wild' "$stream_dir/gems.md"
    [[ "$output" == *"Rebuilding legacy chat velocity with stream-relative spike times"* ]]
}

function split_case_019() {
    stream_dir="$(make_directory_chat_fallback_fixture)"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        TZ=UTC \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        STALKER_GEM_SCORE_WINDOW_SECS=10 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4"

    [ "$status" -eq 0 ]
    [ -f "$stream_dir/gems.md" ]
    grep -F -q 'stream=80 [01:20] <<<' "$stream_dir/chat-velocity.txt"
    grep -F -q '### [01:20] Segment 1 (20s) Spike Chat Goes Wild' "$stream_dir/gems.md"
    [[ "$output" == *"Using chat log from output directory: chat.txt"* ]]
}

function split_case_020() {
    stream_dir="$(make_stale_chat_velocity_fixture)"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        TZ=Asia/Jerusalem \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        STALKER_GEM_SCORE_WINDOW_SECS=10 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4"

    [ "$status" -eq 0 ]
    [ -f "$stream_dir/gems.md" ]
    grep -F -q 'stream=80 [01:20] <<<' "$stream_dir/chat-velocity.txt"
    grep -F -q '### [01:20] Segment 1 (20s) Spike Chat Goes Wild' "$stream_dir/gems.md"
    [[ "$output" == *"Using chat log from output directory: chat.log"* ]]
}

function split_case_021() {
    stream_dir="$(make_missing_chat_velocity_fixture)"
    [ ! -f "$stream_dir/chat-velocity.txt" ]

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        TZ=Asia/Jerusalem \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        STALKER_GEM_SCORE_WINDOW_SECS=10 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4" "$stream_dir/chat.log"

    [ "$status" -eq 0 ]
    [ -f "$stream_dir/gems.md" ]
    grep -F -q 'stream=80 [01:20] <<<' "$stream_dir/chat-velocity.txt"
    grep -F -q '### [01:20] Segment 1 (20s) Spike Chat Goes Wild' "$stream_dir/gems.md"
    [[ "$output" == *"Generating missing chat velocity with stream-relative spike times"* ]]
}

function split_case_022() {
    stream_dir="$(make_post_midnight_chat_fixture)"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        TZ=UTC \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        STALKER_GEM_SCORE_WINDOW_SECS=10 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4" "$stream_dir/chat.log"

    [ "$status" -eq 0 ]
    [ -f "$stream_dir/gems.md" ]
    grep -F -q 'stream=43800 [730:00] <<<' "$stream_dir/chat-velocity.txt"
    grep -F -q '### [12:10:00] Segment 1 (20s) Spike Chat Goes Wild' "$stream_dir/gems.md"
}

function split_case_023() {
    stream_dir="$(make_multi_day_chat_fixture)"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        TZ=UTC \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        STALKER_GEM_SCORE_WINDOW_SECS=10 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4" "$stream_dir/chat.log"

    [ "$status" -eq 0 ]
    [ -f "$stream_dir/gems.md" ]
    grep -F -q 'stream=151200 [2520:00] <<<' "$stream_dir/chat-velocity.txt"
    grep -F -q '### [42:00:00] Segment 1 (20s) Spike Chat Goes Wild' "$stream_dir/gems.md"
}

function split_case_024() {
    stream_dir="$(make_volume_spike_beyond_top20_fixture)"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        STALKER_GEM_SCORE_WINDOW_SECS=10 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4"

    [ "$status" -eq 0 ]
    [ -f "$stream_dir/gems.md" ]
    grep -F -q '### [03:40] Segment 1 (20s) Spike Chat Goes Wild' "$stream_dir/gems.md"
    grep -F -q '**Volume spike:** yes' "$stream_dir/gems.md"
}

