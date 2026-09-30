function split_case_001() {
    grep -F -q 'LURKER_SCRIPT="$SCRIPT_DIR/dist/twitch-chat-lurker.js"' "$STALKER_DIR/stream-watcher.sh"
    ! grep -F -q 'LURKER_SCRIPT="$SCRIPT_DIR/twitch-chat-lurker.ts"' "$STALKER_DIR/stream-watcher.sh" || false
    grep -F -q 'stalker_ensure_lurker_bundle "$LURKER_SCRIPT"' "$STALKER_DIR/stream-watcher.sh"
    run git -C "$REPO_ROOT" ls-files --error-unmatch scripts/dist/twitch-chat-lurker.js
    [ "$status" -ne 0 ]
}

function split_case_002() {
    fake_lurker_build
    run stalker_ensure_lurker_bundle "$LURKER_BUNDLE" "$LURKER_SRC" "$LURKER_LOCK" "$FAKE_BUILD"
    [ "$status" -eq 0 ]
    [ -f "$LURKER_BUNDLE" ]
    [ "$(wc -l < "$BUILD_CALLS")" -eq 1 ]
}

function split_case_003() {
    fake_lurker_build
    mkdir -p "$(dirname "$LURKER_BUNDLE")"
    echo '// bundle' > "$LURKER_BUNDLE"
    touch -t 202601010000 "$LURKER_SRC" "$LURKER_LOCK"
    run stalker_ensure_lurker_bundle "$LURKER_BUNDLE" "$LURKER_SRC" "$LURKER_LOCK" "$FAKE_BUILD"
    [ "$status" -eq 0 ]
    [ ! -f "$BUILD_CALLS" ]
}

function split_case_004() {
    fake_lurker_build
    mkdir -p "$(dirname "$LURKER_BUNDLE")"
    echo '// bundle' > "$LURKER_BUNDLE"
    touch -t 202601010000 "$LURKER_BUNDLE" "$LURKER_SRC"
    run stalker_ensure_lurker_bundle "$LURKER_BUNDLE" "$LURKER_SRC" "$LURKER_LOCK" "$FAKE_BUILD"
    [ "$status" -eq 0 ]
    [ "$(wc -l < "$BUILD_CALLS")" -eq 1 ]
}

function split_case_005() {
    fake_lurker_build
    run env PATH="/usr/bin:/bin" bash -c 'source "$1"; stalker_ensure_lurker_bundle "$2" "$3" "$4" "$5"' _ \
        "$SCRIPT_DIR/lib/stream-helpers.sh" "$LURKER_BUNDLE" "$LURKER_SRC" "$LURKER_LOCK" "$FAKE_BUILD"
    [ "$status" -ne 0 ]
    grep -F -q "bun is required" <<< "$output"
    [ ! -f "$BUILD_CALLS" ]
}

function split_case_006() {
    build_fresh_bundle
    grep -F -q 'node_modules/tmi.js/index.js' "$fresh_bundle"
    grep -F -q 'Permission is hereby granted' "$fresh_license"
    [ ! -x "$fresh_license" ]

    run "$STALKER_DIR/preflight-twitch-chat-lurker.sh" "$fresh_bundle"
    [ "$status" -eq 0 ]
    [[ "$output" == *"chat_lurker_preflight=PASS"* ]]
}

function split_case_007() {
    build_fresh_bundle
    run "$STALKER_DIR/preflight-twitch-chat-lurker.sh" "$fresh_bundle"

    [ "$status" -eq 0 ]
    [[ "$output" == *"chat_lurker_preflight=PASS"* ]] || false
    [[ "$output" == *"output_open=true"* ]] || false
    [[ "$output" == *"connected_sentinel=true"* ]]
}

function split_case_008() {
    isolated_source="$TMPDIR_/twitch-chat-lurker.ts"
    cp "$STALKER_DIR/twitch-chat-lurker.ts" "$isolated_source"

    run "$STALKER_DIR/preflight-twitch-chat-lurker.sh" "$isolated_source"

    [ "$status" -ne 0 ]
    [[ "$output" == *"Cannot find package 'tmi.js'"* ]] || false
    [[ "$output" == *"chat_lurker_preflight=FAIL"* ]]
}

function split_case_009() {
    stream_dir="$TMPDIR_/missing-dependency"
    isolated_source="$TMPDIR_/twitch-chat-lurker.ts"
    mkdir -p "$stream_dir"
    cp "$STALKER_DIR/twitch-chat-lurker.ts" "$isolated_source"

    STALKER_CHAT_PREFLIGHT=1 \
    TWITCH_CHANNEL=__golems_preflight__ \
    CHAT_OUTPUT="$stream_dir/chat.log" \
        bun run --no-install "$isolated_source" > "$stream_dir/chat-lurker.log" 2>&1 &
    lurker_pid=$!

    STALKER_LURKER_START_TIMEOUT=1 \
    STALKER_TELEGRAM_CMD="$FAKE_BIN/telegram-capture" \
    run stalker_require_lurker_ready "$stream_dir" "$lurker_pid" "$stream_dir/chat-lurker.log" "$stream_dir/chat.log"

    [ "$status" -ne 0 ]
    grep -F -q "Cannot find package 'tmi.js'" "$stream_dir/chat-lurker.log"
    grep -F -q 'connected sentinel' "$stream_dir/.stage-chat.failed"
    grep -F -q 'retryable=true' "$stream_dir/.stage-chat.failed"
}

function split_case_010() {
    build_fresh_bundle
    isolated_bundle="$TMPDIR_/twitch-chat-lurker.js"
    cp "$fresh_bundle" "$isolated_bundle"

    run "$STALKER_DIR/preflight-twitch-chat-lurker.sh" "$isolated_bundle"

    [ "$status" -eq 0 ]
    [[ "$output" == *"chat_lurker_preflight=PASS"* ]]
}

function split_case_011() {
    stream_dir="$TMPDIR_/stream"
    mkdir -p "$stream_dir"
    sleep 0.05 &
    lurker_pid=$!

    STALKER_LURKER_START_TIMEOUT=1 \
    STALKER_TELEGRAM_CMD="$FAKE_BIN/telegram-capture" \
    run stalker_require_lurker_ready "$stream_dir" "$lurker_pid" "$stream_dir/chat-lurker.log" "$stream_dir/chat.log"

    [ "$status" -ne 0 ]
    [ -f "$stream_dir/.stage-chat.failed" ]
    grep -F -q 'retryable=true' "$stream_dir/.stage-chat.failed"
    [ "$(grep -c 'Stalker Pipeline Failure' "$ALERTS_FILE")" -eq 1 ]
}

function split_case_012() {
    mkdir -p "$TMPDIR_/home/.local/bin"
    printf '#!/bin/bash\n' > "$TMPDIR_/home/.local/bin/agy"
    chmod +x "$TMPDIR_/home/.local/bin/agy"

    run env PATH="/usr/bin:/bin:/usr/sbin:/sbin" HOME="$TMPDIR_/home" \
        bash -c 'source "$1"; stalker_resolve_command agy' _ "$SCRIPT_DIR/lib/stream-helpers.sh"

    [ "$status" -eq 0 ]
    [ "$output" = "$TMPDIR_/home/.local/bin/agy" ]
}

function split_case_013() {
    stream_dir="$TMPDIR_/examplechannel-2026-07-10-030737"
    mkdir -p "$stream_dir" "$TMPDIR_/empty-home"
    printf 'video\n' > "$stream_dir/video.mp4"

    run env -i \
        PATH="$FAKE_BIN:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/empty-home" \
        ALERTS_FILE="$ALERTS_FILE" \
        STALKER_TELEGRAM_CMD="$FAKE_BIN/telegram-capture" \
        "$STALKER_DIR/process-stream.sh" "$stream_dir/video.mp4"

    [ "$status" -eq 75 ]
    [ -f "$stream_dir/.stage-scoring.failed" ]
    grep -F -q 'scorer preflight failed before expensive processing' "$stream_dir/.stage-scoring.failed"
    grep -F -q 'retryable=true' "$stream_dir/.stage-scoring.failed"
    [ "$(grep -c 'Stalker Pipeline Failure' "$ALERTS_FILE")" -eq 1 ]
    [ ! -f "$stream_dir/full-audio.wav" ]
}

function split_case_014() {
    stream_dir="$TMPDIR_/examplechannel-2026-07-10-030738"
    codex_calls="$TMPDIR_/codex-calls.txt"
    mkdir -p "$stream_dir" "$TMPDIR_/empty-home"
    printf 'video\n' > "$stream_dir/video.mp4"

    cat > "$FAKE_BIN/codex" <<'SH'
#!/bin/bash
printf 'called\n' >> "$CODEX_CALLS"
exit 0
SH
    cat > "$FAKE_BIN/ffmpeg" <<'SH'
#!/bin/bash
exit 91
SH
    chmod +x "$FAKE_BIN/codex" "$FAKE_BIN/ffmpeg"
    for required_cmd in basename date dirname mkdir rm; do
        ln -s "$(command -v "$required_cmd")" "$FAKE_BIN/$required_cmd"
    done

    run env -i \
        PATH="$FAKE_BIN" \
        HOME="$TMPDIR_/empty-home" \
        CODEX_CALLS="$codex_calls" \
        STALKER_TELEGRAM_NOTIFY=0 \
        "$STALKER_DIR/process-stream.sh" "$stream_dir/video.mp4"

    [ "$status" -eq 75 ]
    [[ "$output" == *"Codex scorer requires timeout or gtimeout"* ]] || false
    [ -f "$stream_dir/.stage-scoring.failed" ]
    grep -F -q 'codex timeout preflight failed before expensive processing' "$stream_dir/.stage-scoring.failed"
    grep -F -q 'retryable=true' "$stream_dir/.stage-scoring.failed"
    [ ! -f "$stream_dir/full-audio.wav" ]
    [ ! -f "$codex_calls" ]
}

function split_case_015() {
    stream_dir="$TMPDIR_/examplechannel-2026-07-10-030737"
    mkdir -p "$stream_dir/frames" "$stream_dir/clips" "$TMPDIR_/empty-home"
    printf 'video\n' > "$stream_dir/video.mp4"
    printf 'audio\n' > "$stream_dir/full-audio.wav"
    printf '0\n' > "$stream_dir/silences.txt"
    printf '1 0.1\n' > "$stream_dir/volume-per-10s.txt"
    printf '# spikes\n' > "$stream_dir/volume-spikes.txt"
    printf '# transcript\n' > "$stream_dir/transcript.md"
    printf '# signals\n' > "$stream_dir/signals-combined.md"
    printf '[00:00:01] viewer: hello\n' > "$stream_dir/chat.log"
    # A DURABLE gems.md is one a scoring run wrote to completion: it always ends
    # with the "Scored:" footer. The zero-gem and failure paths delete gems.md
    # entirely, so a surviving footer-less gems.md means the scorer was killed
    # mid-run (partial) and must be re-scored — see stalker_gems_complete. This
    # fixture therefore includes the footer to represent a genuinely-complete run.
    printf '# Gems\n\n### [00:10] Existing gem\n**Score:** 8/10\n\n---\nGems found: 1\nScored: Fri Jul 10 03:30:00 IDT 2026\n' > "$stream_dir/gems.md"
    for stage in 1a-audio 1b-silences 1c-volume 1d-spikes 1e-transcript 2-frames 3-signals 4-clips; do
        printf 'done\n' > "$stream_dir/.stage-${stage}.done"
    done

    run env -i \
        PATH="$FAKE_BIN:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/empty-home" \
        ALERTS_FILE="$ALERTS_FILE" \
        STALKER_COMPLETION_SCRIPT="$STALKER_COMPLETION_SCRIPT" \
        STALKER_COMPLETION_CALLS="$STALKER_COMPLETION_CALLS" \
        STALKER_TELEGRAM_CMD="$FAKE_BIN/telegram-capture" \
        "$STALKER_DIR/process-stream.sh" "$stream_dir/video.mp4" "$stream_dir/chat.log"

    [ "$status" -eq 0 ]
    [ "$(cat "$STALKER_COMPLETION_CALLS")" = "$stream_dir" ]
    [ ! -f "$stream_dir/.stage-scoring.failed" ]
}

function split_case_016() {
    empty_dir="$TMPDIR_/empty-live-identity"
    sleep 20 &
    live_pid=$!
    write_scoring_marker "$empty_dir" "$live_pid" ""
    printf '# partial empty-identity gems\n' > "$empty_dir/gems.md"

    STALKER_TELEGRAM_CMD="$FAKE_BIN/telegram-capture" \
    run bash -c 'source "$1"; stalker_reconcile_interrupted_scoring_run "$2"' \
        _ "$SCRIPT_DIR/lib/stream-helpers.sh" "$empty_dir"
    empty_status=$status

    empty_gems=0
    empty_failed=0
    [ -f "$empty_dir/gems.md" ] && empty_gems=1
    [ -f "$empty_dir/.stage-scoring.failed" ] && empty_failed=1
    alert_count=$(grep -c 'Stalker Pipeline Failure' "$ALERTS_FILE" 2>/dev/null || true)
    alert_count="${alert_count:-0}"
    kill "$live_pid" 2>/dev/null || true
    wait "$live_pid" 2>/dev/null || true

    [[ "$empty_status" -eq 0 \
        && "$empty_gems" -eq 0 \
        && "$empty_failed" -eq 1 \
        && "$alert_count" -eq 1 ]]
}

function split_case_017() {
    matching_dir="$TMPDIR_/matching-live-identity"
    mismatch_dir="$TMPDIR_/mismatched-live-identity"
    sleep 20 &
    live_pid=$!
    if ! identity_c="$(LC_ALL=C stalker_process_start_identity "$live_pid")"; then
        kill "$live_pid" 2>/dev/null || true
        wait "$live_pid" 2>/dev/null || true
        skip "process identity unavailable in this test environment"
    fi
    identity_he="$(LC_ALL=he_IL.UTF-8 stalker_process_start_identity "$live_pid")"
    write_scoring_marker "$matching_dir" "$live_pid" "$identity_c"
    write_scoring_marker "$mismatch_dir" "$live_pid" "not-the-live-process-$identity_c"
    printf '# partial matching gems\n' > "$matching_dir/gems.md"
    printf '# partial mismatched gems\n' > "$mismatch_dir/gems.md"

    STALKER_TELEGRAM_CMD="$FAKE_BIN/telegram-capture" \
    run bash -c 'source "$1"; stalker_reconcile_interrupted_scoring_run "$2"' \
        _ "$SCRIPT_DIR/lib/stream-helpers.sh" "$matching_dir"
    matching_status=$status

    STALKER_TELEGRAM_CMD="$FAKE_BIN/telegram-capture" \
    run bash -c 'source "$1"; stalker_reconcile_interrupted_scoring_run "$2"' \
        _ "$SCRIPT_DIR/lib/stream-helpers.sh" "$mismatch_dir"
    mismatch_status=$status

    matching_gems=0
    matching_failed=0
    mismatch_gems=0
    mismatch_failed=0
    [ -f "$matching_dir/gems.md" ] && matching_gems=1
    [ -f "$matching_dir/.stage-scoring.failed" ] && matching_failed=1
    [ -f "$mismatch_dir/gems.md" ] && mismatch_gems=1
    [ -f "$mismatch_dir/.stage-scoring.failed" ] && mismatch_failed=1
    kill "$live_pid" 2>/dev/null || true
    wait "$live_pid" 2>/dev/null || true

    [[ -n "$identity_c" \
        && "$identity_he" = "$identity_c" \
        && "$matching_status" -eq 0 \
        && "$mismatch_status" -eq 0 \
        && "$matching_gems" -eq 1 \
        && "$matching_failed" -eq 0 \
        && "$mismatch_gems" -eq 0 \
        && "$mismatch_failed" -eq 1 ]]
}

function split_case_018() {
    stream_dir="$TMPDIR_/complete-without-done"
    write_dead_scoring_marker "$stream_dir"
    printf '# Gems\n\n### [00:10] Complete gem\n**Score:** 8/10\n\n---\nGems found: 1\nScored: Thu Aug 20 01:10:00 IDT 2026\n' > "$stream_dir/gems.md"
    cp "$stream_dir/gems.md" "$stream_dir/gems.before"

    STALKER_TELEGRAM_CMD="$FAKE_BIN/telegram-capture" \
    run bash -c 'source "$1"; stalker_reconcile_interrupted_scoring_run "$2"' \
        _ "$SCRIPT_DIR/lib/stream-helpers.sh" "$stream_dir"
    reconcile_status=$status

    gems_unchanged=0
    done_exists=0
    failure_exists=0
    cmp -s "$stream_dir/gems.before" "$stream_dir/gems.md" && gems_unchanged=1
    [ -f "$stream_dir/.stage-scoring.done" ] && done_exists=1
    [ -f "$stream_dir/.stage-scoring.failed" ] && failure_exists=1
    alert_count=$(grep -c 'Stalker Pipeline Failure' "$ALERTS_FILE" 2>/dev/null || true)
    alert_count="${alert_count:-0}"

    [[ "$reconcile_status" -eq 0 \
        && "$gems_unchanged" -eq 1 \
        && "$done_exists" -eq 1 \
        && "$failure_exists" -eq 0 \
        && "$alert_count" -eq 0 ]]
}

function split_case_019() {
    stream_dir="$TMPDIR_/atomic-start-marker"
    mkdir -p "$stream_dir"
    printf 'done\n' > "$stream_dir/.stage-scoring.done"
    printf 'failed\n' > "$stream_dir/.stage-scoring.failed"
    printf 'alerted\n' > "$stream_dir/.stage-pipeline-failure-alerted.done"
    mv() { return 99; }

    run stalker_mark_scoring_started "$stream_dir" "$$"
    install_status=$status
    unset -f mv

    done_exists=0
    failure_exists=0
    alert_exists=0
    started_exists=0
    tmp_count=$(find "$stream_dir" -maxdepth 1 -name '.stage-scoring.started.tmp.*' | wc -l | tr -d ' ')
    [ -f "$stream_dir/.stage-scoring.done" ] && done_exists=1
    [ -f "$stream_dir/.stage-scoring.failed" ] && failure_exists=1
    [ -f "$stream_dir/.stage-pipeline-failure-alerted.done" ] && alert_exists=1
    [ -f "$stream_dir/.stage-scoring.started" ] && started_exists=1

    [[ "$install_status" -ne 0 \
        && "$done_exists" -eq 1 \
        && "$failure_exists" -eq 1 \
        && "$alert_exists" -eq 1 \
        && "$started_exists" -eq 0 \
        && "$tmp_count" -eq 0 ]]
}

function split_case_020() {
    scorer_branch_line=$(grep -n 'if \[ -n "$AGY_BIN" \] || \[ -n "$CODEX_BIN" \]; then' "$STALKER_DIR/process-stream.sh" | head -n 1 | cut -d: -f1)
    marker_line=$(grep -n 'stalker_mark_scoring_started "$OUT_DIR" "\$\$"' "$STALKER_DIR/process-stream.sh" | head -n 1 | cut -d: -f1)

    [[ "$scorer_branch_line" =~ ^[0-9]+$ \
        && "$marker_line" =~ ^[0-9]+$ \
        && "$marker_line" -gt "$scorer_branch_line" ]]
}

function split_case_021() {
    stream_dir="$(make_post_fixture)"
    stale_dir="$(dirname "$stream_dir")/examplechannel-2026-07-10-010000"
    contract="$(make_contract)"
    write_dead_scoring_marker "$stale_dir"
    printf '# partial gems\n' > "$stale_dir/gems.md"
    printf '[00:00:01] viewer: old run\n' > "$stale_dir/chat.log"
    printf '[00:00:01] viewer: current run\n' > "$stream_dir/chat.log"
    printf '# Gems\n\n### [00:10] Current gem\n' > "$stream_dir/gems.md"

    run env -i \
        PATH="$FAKE_BIN:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        ALERTS_FILE="$ALERTS_FILE" \
        CONTRACT_CALLS="$CONTRACT_CALLS" \
        STALKER_COMPLETION_SCRIPT="$STALKER_COMPLETION_SCRIPT" \
        STALKER_COMPLETION_CALLS="$STALKER_COMPLETION_CALLS" \
        STALKER_CONTRACT_SCRIPT="$contract" \
        STALKER_TELEGRAM_CMD="$FAKE_BIN/telegram-capture" \
        STREAM_AUTO_ARCHIVE=1 \
        "$POST_STREAM" "$stream_dir" "$stream_dir/video.mp4" "$stream_dir/chat.log" examplechannel 0

    [ "$status" -eq 0 ]
    [ -f "$stale_dir/.stage-scoring.failed" ]
    [ ! -f "$stale_dir/gems.md" ]
    grep -F -q "$(basename "$stale_dir")" "$ALERTS_FILE"
}

function split_case_022() {
    root="$TMPDIR_/stalker-sigkill"
    stale_dir="$root/examplechannel-2026-08-19-010000"
    write_dead_scoring_marker "$stale_dir"
    printf '# partial gems\n' > "$stale_dir/gems.md"
    printf '[00:00:01] viewer: old run\n' > "$stale_dir/chat.log"

    STALKER_TELEGRAM_CMD="$FAKE_BIN/telegram-capture" \
    run "$STALKER_DIR/stalker-brainlayer-telegram.sh" digest "$root" 2026-08-19 --dry-run

    [ -f "$stale_dir/.stage-scoring.failed" ]
    [ ! -f "$stale_dir/gems.md" ]
    grep -F -q "$(basename "$stale_dir")" "$ALERTS_FILE"
}

function split_case_023() {
    stream_dir="$TMPDIR_/empty-run"
    mkdir -p "$stream_dir"
    : > "$stream_dir/chat.log"

    STALKER_TELEGRAM_CMD="$FAKE_BIN/telegram-capture" \
    run stalker_require_run_quality "$stream_dir" "$stream_dir/chat.log" "digest"

    [ "$status" -ne 0 ]
    [ ! -f "$stream_dir/.stage-complete-notify.done" ]
    [ ! -f "$stream_dir/.stage-notified.done" ]
    [ -f "$stream_dir/.stage-run-quality.failed" ]
    grep -F -q 'gem_count=0' "$stream_dir/.stage-run-quality.failed"
    grep -F -q 'chat_count=0' "$stream_dir/.stage-run-quality.failed"
    [ "$(jq -s 'map(select(.title == "Stalker FAILED at stage 6")) | length' "$ALERTS_FILE")" -eq 1 ]
}

function split_case_024() {
    root="$TMPDIR_/stalker"
    run_dir="$root/etan-2026-08-19-2100"
    mkdir -p "$run_dir"
    printf 'chatline\nchatline\n' > "$run_dir/chat.log"
    printf '### [00:10:00] A real moment\n**Score:** 9/10 | **Type:** insight\n**Gist:** something good\n' > "$run_dir/gems.md"

    STALKER_TELEGRAM_DRY_RUN=1 \
    run "$STALKER_DIR/stalker-brainlayer-telegram.sh" digest "$root" 2026-08-19 --dry-run

    [[ "$status" -eq 75 \
        && "$output" == *"Stalker Morning Digest FAILED - 2026-08-19"* \
        && "$output" == *"Found 1 matching run directory, but none were eligible for processing"* \
        && "$output" == *"etan-2026-08-19-2100"* \
        && "$output" == *"missing completion markers: .stage-process.done, .stage-archive.done, .stage-brainlayer.done, .stage-notified.done, .brainlayer-status, _DRIVE-LEDGER.md"* \
        && "$output" == *"gems.md exists on disk (1 curated heading)"* \
        && "$output" == *"chat.log exists on disk (2 lines)"* \
        && "$output" != *"no gems.md found"* ]]
}

function split_case_025() {
    root="$TMPDIR_/stalker-empty"
    mkdir -p "$root"

    STALKER_TELEGRAM_DRY_RUN=1 \
    run "$STALKER_DIR/stalker-brainlayer-telegram.sh" digest "$root" 2026-08-19 --dry-run

    [[ "$status" -eq 75 \
        && "$output" == *"Stalker Morning Digest - 2026-08-19"* \
        && "$output" != *"FAILED"* \
        && "$output" == *"no runs recorded for 2026-08-19"* \
        && "$output" != *"🚨"* \
        && "$output" != *"Dropped runs:"* ]]
}

function split_case_026() {
    root="$TMPDIR_/stalker-orphan"
    run_dir="$root/examplechannel-2026-08-19-0300"
    mkdir -p "$run_dir"
    printf 'orphaned\n' > "$run_dir/.orphan-tail"
    printf 'done\n' > "$run_dir/.stage-process.done"
    printf '### [00:03:00] Tail gem\n**Score:** 8/10 | **Type:** insight\n' > "$run_dir/gems.md"

    STALKER_TELEGRAM_DRY_RUN=1 \
    run "$STALKER_DIR/stalker-brainlayer-telegram.sh" digest "$root" 2026-08-19 --dry-run

    [[ "$status" -eq 75 \
        && "$output" == *"examplechannel-2026-08-19-0300: .orphan-tail present"* \
        && "$output" == *"gems.md exists on disk (1 curated heading)"* ]]
}

function split_case_027() {
    root="$TMPDIR_/stalker-delivery"
    run_dir="$root/etan-2026-08-19-2100"
    mkdir -p "$run_dir"
    printf '### [00:10:00] A real moment\n**Score:** 9/10 | **Type:** insight\n' > "$run_dir/gems.md"

    STALKER_TELEGRAM_CMD="$FAKE_BIN/telegram-capture" \
    run "$STALKER_DIR/stalker-brainlayer-telegram.sh" digest "$root" 2026-08-19

    grep -F -q 'Stalker Morning Digest FAILED - 2026-08-19' "$ALERTS_FILE" \
        && grep -F -q 'etan-2026-08-19-2100' "$ALERTS_FILE" \
        && [ "$status" -eq 75 ]
}

function split_case_028() {
    root="$TMPDIR_/stalker-many-drops"
    captured_payload="$TMPDIR_/captured-payload.json"
    queue_dir="$TMPDIR_/telegram-queue"
    rejecting_sender="$FAKE_BIN/telegram-reject-oversized"

    cat > "$rejecting_sender" <<'SH'
#!/bin/bash
cat > "$CAPTURED_PAYLOAD"
[ "$(LC_ALL=C wc -c < "$CAPTURED_PAYLOAD" | tr -d ' ')" -le 4096 ]
SH
    chmod +x "$rejecting_sender"

    for index in $(seq -w 1 20); do
        run_dir="$root/etan-2026-08-19-$index"
        mkdir -p "$run_dir"
        printf 'chatline\nchatline\n' > "$run_dir/chat.log"
        printf '### [00:10:00] Dropped moment %s\n**Score:** 9/10 | **Type:** insight\n' "$index" > "$run_dir/gems.md"
    done

    CAPTURED_PAYLOAD="$captured_payload" \
    STALKER_TELEGRAM_CMD="$rejecting_sender" \
    STALKER_TELEGRAM_QUEUE_DIR="$queue_dir" \
    run "$STALKER_DIR/stalker-brainlayer-telegram.sh" digest "$root" 2026-08-19

    payload_bytes="$(LC_ALL=C wc -c < "$captured_payload" | tr -d ' ')"
    body="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["body"])' "$captured_payload")"
    body_bytes="$(LC_ALL=C printf '%s' "$body" | wc -c | tr -d ' ')"
    printf '# notify_status=%s payload_bytes=%s body_bytes=%s queued_files=%s\n' \
        "$status" "$payload_bytes" "$body_bytes" "$(find "$queue_dir" -type f 2>/dev/null | wc -l | tr -d ' ')" >&3
    [[ "$status" -eq 75 \
        && -f "$captured_payload" \
        && "$payload_bytes" -le 4096 \
        && "$body_bytes" -le 1200 \
        && "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["title"])' "$captured_payload")" = "Stalker Morning Digest FAILED - 2026-08-19" \
        && "$body" == *"Found 20 matching run directories, but none were eligible for processing"* \
        && "$body" == *"details truncated:"* \
        && "$body" == *"20 total"* \
        && ! -d "$queue_dir" ]]
}

function split_case_029() {
    root="$TMPDIR_/stalker-many-partial-drops"
    captured_payload="$TMPDIR_/captured-partial-payload.json"
    queue_dir="$TMPDIR_/partial-telegram-queue"
    rejecting_sender="$FAKE_BIN/telegram-reject-partial-oversized"
    processed_dir="$root/examplechannel-2026-08-19-0000"
    long_suffix="$(printf '%0180d' 0 | tr '0' 'x')"

    cat > "$rejecting_sender" <<'SH'
#!/bin/bash
cat > "$CAPTURED_PAYLOAD"
[ "$(LC_ALL=C wc -c < "$CAPTURED_PAYLOAD" | tr -d ' ')" -le 4096 ]
SH
    chmod +x "$rejecting_sender"

    mkdir -p "$processed_dir"
    printf 'done\n' > "$processed_dir/.stage-process.done"
    printf 'healthy chat\n' > "$processed_dir/chat.log"
    printf '### [00:05:00] Counted moment\n**Score:** 8/10 | **Type:** insight\n**Gist:** counted\n' > "$processed_dir/gems.md"
    for index in $(seq -w 1 20); do
        mkdir -p "$root/examplechannel-$long_suffix-$index-2026-08-19"
    done

    CAPTURED_PAYLOAD="$captured_payload" \
    STALKER_TELEGRAM_CMD="$rejecting_sender" \
    STALKER_TELEGRAM_QUEUE_DIR="$queue_dir" \
    run "$STALKER_DIR/stalker-brainlayer-telegram.sh" digest "$root" 2026-08-19

    body="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["body"])' "$captured_payload")"
    payload_bytes="$(LC_ALL=C wc -c < "$captured_payload" | tr -d ' ')"
    body_bytes="$(LC_ALL=C printf '%s' "$body" | wc -c | tr -d ' ')"
    printf '# notify_status=%s payload_bytes=%s body_bytes=%s queued_files=%s\n' \
        "$status" "$payload_bytes" "$body_bytes" "$(find "$queue_dir" -type f 2>/dev/null | wc -l | tr -d ' ')" >&3
    [[ "$status" -eq 75 \
        && -f "$captured_payload" \
        && "$payload_bytes" -le 4096 \
        && "$body_bytes" -le 1200 \
        && "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["title"])' "$captured_payload")" = "Stalker Morning Digest FAILED - 2026-08-19" \
        && "$body" == *"💎 1 gems · 1 chat"* \
        && "$body" == *"DROPPED (not counted above):"* \
        && "$body" == *"details truncated:"* \
        && "$body" == *"20 total"* \
        && ! -d "$queue_dir" ]]
}

function split_case_030() {
    root="$TMPDIR_/stalker-real-shape"
    captured_payload="$TMPDIR_/captured-real-shape.json"
    capturing_sender="$FAKE_BIN/telegram-capture-real-shape"
    processed_dir="$root/examplechannel-2026-08-20-010000"

    cat > "$capturing_sender" <<'SH'
#!/bin/bash
cat > "$CAPTURED_PAYLOAD"
SH
    chmod +x "$capturing_sender"

    mkdir -p "$processed_dir"
    printf 'done\n' > "$processed_dir/.stage-process.done"
    printf 'chat\n' > "$processed_dir/chat.log"
    for index in $(seq -w 1 8); do
        printf '### [00:0%s:00] Expensive moment %s\n**Score:** 9/10 | **Type:** insight\n**Gist:** %s\n' \
            "$index" "$index" "$(printf '%0220d' 0 | tr '0' 'g')" >> "$processed_dir/gems.md"
    done

    for suffix in 031841 032306 032307 032309 051534 052008 052009; do
        run_dir="$root/examplechannel-2026-08-20-$suffix"
        mkdir -p "$run_dir"
        printf 'orphaned\n' > "$run_dir/.orphan-tail"
    done

    CAPTURED_PAYLOAD="$captured_payload" \
    STALKER_TELEGRAM_CMD="$capturing_sender" \
    run "$STALKER_DIR/stalker-brainlayer-telegram.sh" digest "$root" 2026-08-20

    body_metrics="$(python3 - "$captured_payload" <<'PY'
import json
import sys

body = json.load(open(sys.argv[1]))["body"]
utf16_units = len(body.encode("utf-16-le")) // 2
server_kept = body.encode("utf-16-le")[:4000].decode("utf-16-le", errors="ignore")
print(f"{utf16_units}|{'examplechannel-2026-08-20-032309' in server_kept}|{'digest truncated' in server_kept}")
PY
)"
    printf '# notify_status=%s body_metrics=%s\n' "$status" "$body_metrics" >&3
    [[ "$status" -eq 0 \
        && "$body_metrics" == *"|True|True" \
        && "${body_metrics%%|*}" -le 2000 \
        && "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["title"])' "$captured_payload")" = "Stalker Morning Digest - 2026-08-20" ]]
}

function split_case_031() {
    root="$TMPDIR_/stalker-all-drops-shown"
    processed_dir="$root/examplechannel-2026-08-20-010000"

    mkdir -p "$processed_dir"
    printf 'done\n' > "$processed_dir/.stage-process.done"
    for index in $(seq -w 1 8); do
        printf '### [00:0%s:00] Expensive moment %s\n**Score:** 9/10 | **Type:** insight\n**Gist:** %s\n' \
            "$index" "$index" "$(printf '%0220d' 0 | tr '0' 'g')" >> "$processed_dir/gems.md"
    done
    for suffix in 031841 032306 032307 051534 052008 052009; do
        mkdir -p "$root/examplechannel-2026-08-20-$suffix"
    done

    STALKER_TELEGRAM_DRY_RUN=1 \
    run "$STALKER_DIR/stalker-brainlayer-telegram.sh" digest "$root" 2026-08-20 --dry-run

    [[ "$status" -eq 75 \
        && "$output" == *"examplechannel-2026-08-20-052009"* \
        && "$output" == *"digest truncated to fit notification limit"* \
        && "$output" != *"details truncated: 6 of 6"* ]]
}

function split_case_032() {
    root="$TMPDIR_/stalker-healthy"
    run_dir="$root/etan-2026-08-19-2100"
    mkdir -p "$run_dir"
    printf 'done\n' > "$run_dir/.stage-process.done"
    printf 'chatline\nchatline\n' > "$run_dir/chat.log"
    printf '### [00:10:00] A real moment\n**Score:** 9/10 | **Type:** insight\n**Gist:** something good\n' > "$run_dir/gems.md"
    expected="$(cat <<'EOF'
Stalker Morning Digest - 2026-08-19
🎬 Etan — Aug 19 · duration unknown
💎 1 gems · 2 chat · ⚠️ not backed up

Top moments:
🔥 9/10 · 00:10:00 · A real moment (insight)
something good

📁 Brain Drive › stalker-golem/etan/2026-08-19

Warnings: Missing Drive ledger: etan-2026-08-19-2100
EOF
)"

    STALKER_TELEGRAM_DRY_RUN=1 \
    run "$STALKER_DIR/stalker-brainlayer-telegram.sh" digest "$root" 2026-08-19 --dry-run

    [[ "$status" -eq 0 && "$output" = "$expected" ]]
}

