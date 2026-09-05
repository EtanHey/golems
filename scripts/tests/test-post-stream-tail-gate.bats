#!/usr/bin/env bats
# Smoke tests for the Stalker Golem post-stream orphan-tail gate.
# Run with: bats scripts/tests/test-post-stream-tail-gate.bats

setup() {
    REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
    POST_STREAM="$REPO_ROOT/scripts/post-stream.sh"
    TMPDIR_="$(mktemp -d)"
    STALKER_ROOT="$TMPDIR_/stalker-golem"
    mkdir -p "$STALKER_ROOT" "$TMPDIR_/bin"

    FFMPEG_CALLED="$TMPDIR_/ffmpeg-called"
    export FFMPEG_CALLED

    cat > "$TMPDIR_/bin/ffprobe" <<'SH'
#!/bin/bash
last_arg=""
for arg in "$@"; do
    last_arg="$arg"
done

case "$last_arg" in
    *theo-2026-06-18-005309/video.ts|*theo-2026-06-18-005309/video.mp4)
        printf '15039.886656\n'
        ;;
    *theo-2026-06-18-050228/video.ts|*theo-2026-06-18-050228/video.mp4)
        printf '29.939334\n'
        ;;
    *theo-2026-06-18-060000/video.ts|*theo-2026-06-18-060000/video.mp4)
        printf '29.000000\n'
        ;;
    *theo-2026-06-18-045847/video.ts|*theo-2026-06-18-045847/video.mp4|\
    *theo-2026-06-18-045848/video.ts|*theo-2026-06-18-045848/video.mp4|\
    *theo-2026-06-18-051848/video.ts|*theo-2026-06-18-051848/video.mp4|\
    *theo-2026-06-18-051849/video.ts|*theo-2026-06-18-051849/video.mp4)
        printf '29.000000\n'
        ;;
    *)
        printf '150.000000\n'
        ;;
esac
SH

    cat > "$TMPDIR_/bin/ffmpeg" <<'SH'
#!/bin/bash
printf 'ffmpeg should not run for quarantined orphan tail\n' >> "$FFMPEG_CALLED"
exit 99
SH

    cat > "$TMPDIR_/bin/notify" <<'SH'
#!/bin/bash
exit 0
SH

    cat > "$TMPDIR_/bin/curl" <<'SH'
#!/bin/bash
while [ "$#" -gt 0 ]; do
    if [ "$1" = "-d" ]; then
        shift
        printf '%s\n' "$1" > "$TELEGRAM_BODY_FILE"
        if [ -n "${TELEGRAM_CALL_LOG:-}" ]; then
            printf '%s\n' "$1" >> "$TELEGRAM_CALL_LOG"
        fi
        exit 0
    fi
    shift || true
done
exit 1
SH

    cat > "$TMPDIR_/bin/brain-store" <<'SH'
#!/bin/bash
cat >> "$BRAIN_STORE_CAPTURE"
printf '\n' >> "$BRAIN_STORE_CAPTURE"
printf 'manual-test-chunk\n'
SH

    cat > "$TMPDIR_/bin/brain-store-fail" <<'SH'
#!/bin/bash
cat >/dev/null
exit 9
SH

    cat > "$TMPDIR_/bin/timeout" <<'SH'
#!/bin/bash
while [[ "$1" == -* ]]; do
    shift
done
duration="$1"; shift
if [ -n "${STALKER_TIMEOUT_CAPTURE:-}" ]; then
    printf '%s\n' "$duration" > "$STALKER_TIMEOUT_CAPTURE"
fi
"$@"
SH

    chmod +x "$TMPDIR_/bin/ffprobe" "$TMPDIR_/bin/ffmpeg" "$TMPDIR_/bin/notify" "$TMPDIR_/bin/curl" "$TMPDIR_/bin/brain-store" "$TMPDIR_/bin/brain-store-fail" "$TMPDIR_/bin/timeout"
}

teardown() {
    rm -rf "$TMPDIR_"
}

make_run_dir() {
    local name="$1"
    local dir="$STALKER_ROOT/$name"
    mkdir -p "$dir"
    : > "$dir/video.ts"
    : > "$dir/chat.log"
    printf '%s\n' "$dir"
}

mark_downstream_stages_done() {
    local dir="$1"
    : > "$dir/video.mp4"
    printf '[00:00:01] viewer: fixture chat\n' > "$dir/chat.log"
    printf '# Gems\n\n### [00:10] Fixture gem\n' > "$dir/gems.md"
    printf 'done\n' > "$dir/.stage-0-remux.done"
    printf 'done\n' > "$dir/.stage-process.done"
    printf 'done\n' > "$dir/.stage-archive.done"
}

@test "post-stream tail gate: June 18 full run remains eligible" {
    full_dir="$(make_run_dir theo-2026-06-18-005309)"
    mark_downstream_stages_done "$full_dir"

    PATH="$TMPDIR_/bin:$PATH" \
    STREAM_WHATSAPP_NOTIFY=0 \
    STALKER_BRAINLAYER_DRY_RUN=1 \
    STALKER_TELEGRAM_NOTIFY=0 \
    run "$POST_STREAM" "$full_dir" "$full_dir/video.ts" "$full_dir/chat.log" theo 0

    [ "$status" -eq 0 ]
    [ ! -f "$full_dir/.orphan-tail" ]
    [ ! -f "$full_dir/.stage-notified.done" ]
}

@test "post-stream tail gate: June 18 residual tail is quarantined before remux" {
    full_dir="$(make_run_dir theo-2026-06-18-005309)"
    tail_dir="$(make_run_dir theo-2026-06-18-050228)"

    PATH="$TMPDIR_/bin:$PATH" \
    STREAM_WHATSAPP_NOTIFY=0 \
    STALKER_BRAINLAYER_DRY_RUN=1 \
    STALKER_TELEGRAM_NOTIFY=0 \
    run "$POST_STREAM" "$tail_dir" "$tail_dir/video.ts" "$tail_dir/chat.log" theo 0

    [ "$status" -eq 0 ]
    [ -f "$tail_dir/.orphan-tail" ]
    grep -q 'status=ORPHAN_TAIL' "$tail_dir/.orphan-tail"
    grep -q 'theo-2026-06-18-005309' "$tail_dir/.orphan-tail"
    [ ! -f "$tail_dir/.stage-0-remux.done" ]
    [ ! -f "$tail_dir/video.mp4" ]
    [ ! -f "$FFMPEG_CALLED" ]
}

@test "post-stream tail gate: tiny standalone stream with no adjacent full run remains eligible" {
    tiny_dir="$(make_run_dir theo-2026-06-18-060000)"
    mark_downstream_stages_done "$tiny_dir"

    PATH="$TMPDIR_/bin:$PATH" \
    STREAM_WHATSAPP_NOTIFY=0 \
    STALKER_BRAINLAYER_DRY_RUN=1 \
    STALKER_TELEGRAM_NOTIFY=0 \
    run "$POST_STREAM" "$tiny_dir" "$tiny_dir/video.ts" "$tiny_dir/chat.log" theo 0

    [ "$status" -eq 0 ]
    [ ! -f "$tiny_dir/.orphan-tail" ]
}

@test "post-stream tail gate: gap at 900s is in-window and quarantined" {
    full_dir="$(make_run_dir theo-2026-06-18-005309)"
    tail_dir="$(make_run_dir theo-2026-06-18-051848)"

    PATH="$TMPDIR_/bin:$PATH" \
    STREAM_WHATSAPP_NOTIFY=0 \
    STALKER_BRAINLAYER_DRY_RUN=1 \
    STALKER_TELEGRAM_NOTIFY=0 \
    run "$POST_STREAM" "$tail_dir" "$tail_dir/video.ts" "$tail_dir/chat.log" theo 0

    [ "$status" -eq 0 ]
    [ -f "$tail_dir/.orphan-tail" ]
    grep -q 'gap_seconds=900' "$tail_dir/.orphan-tail"
    [ ! -f "$tail_dir/.stage-0-remux.done" ]
    [ ! -f "$FFMPEG_CALLED" ]
    [ -d "$full_dir" ]
}

@test "post-stream tail gate: gap at 901s is outside window and remains eligible" {
    make_run_dir theo-2026-06-18-005309 >/dev/null
    tail_dir="$(make_run_dir theo-2026-06-18-051849)"
    mark_downstream_stages_done "$tail_dir"

    PATH="$TMPDIR_/bin:$PATH" \
    STREAM_WHATSAPP_NOTIFY=0 \
    STALKER_BRAINLAYER_DRY_RUN=1 \
    STALKER_TELEGRAM_NOTIFY=0 \
    run "$POST_STREAM" "$tail_dir" "$tail_dir/video.ts" "$tail_dir/chat.log" theo 0

    [ "$status" -eq 0 ]
    [ ! -f "$tail_dir/.orphan-tail" ]
}

@test "post-stream tail gate: overlap at -300s is in-window and quarantined" {
    make_run_dir theo-2026-06-18-005309 >/dev/null
    tail_dir="$(make_run_dir theo-2026-06-18-045848)"

    PATH="$TMPDIR_/bin:$PATH" \
    STREAM_WHATSAPP_NOTIFY=0 \
    STALKER_BRAINLAYER_DRY_RUN=1 \
    STALKER_TELEGRAM_NOTIFY=0 \
    run "$POST_STREAM" "$tail_dir" "$tail_dir/video.ts" "$tail_dir/chat.log" theo 0

    [ "$status" -eq 0 ]
    [ -f "$tail_dir/.orphan-tail" ]
    grep -q 'gap_seconds=-300' "$tail_dir/.orphan-tail"
    [ ! -f "$tail_dir/.stage-0-remux.done" ]
    [ ! -f "$FFMPEG_CALLED" ]
}

@test "post-stream tail gate: overlap at -301s is outside window and remains eligible" {
    make_run_dir theo-2026-06-18-005309 >/dev/null
    tail_dir="$(make_run_dir theo-2026-06-18-045847)"
    mark_downstream_stages_done "$tail_dir"

    PATH="$TMPDIR_/bin:$PATH" \
    STREAM_WHATSAPP_NOTIFY=0 \
    STALKER_BRAINLAYER_DRY_RUN=1 \
    STALKER_TELEGRAM_NOTIFY=0 \
    run "$POST_STREAM" "$tail_dir" "$tail_dir/video.ts" "$tail_dir/chat.log" theo 0

    [ "$status" -eq 0 ]
    [ ! -f "$tail_dir/.orphan-tail" ]
}

@test "post-stream sends Telegram digest using Drive target from ledger when no http URL exists" {
    full_dir="$(make_run_dir theo-2026-06-18-005309)"
    mark_downstream_stages_done "$full_dir"
    drive_target="$TMPDIR_/Brain Drive/06_ARCHIVE/stalker-golem/theo/2026-06-18-005309"
    printf '# Stalker Golem Drive Ledger\n\n- Drive Target: %s\n' "$drive_target" > "$full_dir/_DRIVE-LEDGER.md"
    printf '### [00:01] First gem\n' > "$full_dir/gems.md"

    PATH="$TMPDIR_/bin:$PATH" \
    STALKER_BRAIN_STORE_CMD="$TMPDIR_/bin/brain-store" \
    BRAIN_STORE_CAPTURE="$TMPDIR_/brain-store.jsonl" \
    TELEGRAM_BODY_FILE="$TMPDIR_/telegram-body.json" \
    run "$POST_STREAM" "$full_dir" "$full_dir/video.ts" "$full_dir/chat.log" theo 0

    [ "$status" -eq 0 ]
    jq -r '.body' "$TMPDIR_/telegram-body.json" > "$TMPDIR_/telegram-body.txt"
    grep -F -q "Brain Drive › stalker-golem/theo/2026-06-18" "$TMPDIR_/telegram-body.txt"
    if grep -F -q "$drive_target" "$TMPDIR_/telegram-body.txt"; then
        false
    fi
    grep -F -q "Stalker Morning Digest - 2026-06-18" "$TMPDIR_/telegram-body.json"
    [ -f "$full_dir/.stage-brainlayer.done" ]
    [ "$(jq -s 'length' "$TMPDIR_/brain-store.jsonl")" = "3" ]
    if grep -F -qi "whatsapp" "$TMPDIR_/telegram-body.json"; then
        false
    fi
    if grep -F -q "Full report: $full_dir" "$TMPDIR_/telegram-body.json"; then
        false
    fi
}

@test "post-stream keeps notified stage open when Telegram delivery queues" {
    full_dir="$(make_run_dir theo-2026-06-18-005309)"
    mark_downstream_stages_done "$full_dir"
    printf '# Stalker Golem Drive Ledger\n\n- Drive Target: fake\n' > "$full_dir/_DRIVE-LEDGER.md"

    cat > "$TMPDIR_/bin/curl" <<'SH'
#!/bin/bash
exit 7
SH
    chmod +x "$TMPDIR_/bin/curl"

    PATH="$TMPDIR_/bin:$PATH" \
    STALKER_BRAIN_STORE_CMD="$TMPDIR_/bin/brain-store" \
    BRAIN_STORE_CAPTURE="$TMPDIR_/brain-store.jsonl" \
    STALKER_TELEGRAM_QUEUE_DIR="$TMPDIR_/telegram-queue" \
    run "$POST_STREAM" "$full_dir" "$full_dir/video.ts" "$full_dir/chat.log" theo 0

    [ "$status" -eq 0 ]
    [ ! -f "$full_dir/.stage-notified.done" ]
    [ "$(find "$TMPDIR_/telegram-queue" -type f | wc -l | tr -d ' ')" = "1" ]
}

@test "post-stream still sends Telegram digest when BrainLayer ingest fails" {
    full_dir="$(make_run_dir theo-2026-06-18-005309)"
    mark_downstream_stages_done "$full_dir"
    printf '# Stalker Golem Drive Ledger\n\n- Drive Target: fake\n' > "$full_dir/_DRIVE-LEDGER.md"

    PATH="$TMPDIR_/bin:$PATH" \
    STALKER_BRAINLAYER_IMPORTANCE=bad \
    TELEGRAM_BODY_FILE="$TMPDIR_/telegram-body.json" \
    run "$POST_STREAM" "$full_dir" "$full_dir/video.ts" "$full_dir/chat.log" theo 0

    [ "$status" -eq 0 ]
    [ -f "$TMPDIR_/telegram-body.json" ]
    [ -f "$full_dir/.stage-notified.done" ]
    [ ! -f "$full_dir/.stage-brainlayer.done" ]
}

@test "post-stream sends Telegram digest before starting BrainLayer ingest" {
    full_dir="$(make_run_dir theo-2026-06-18-005309)"
    mark_downstream_stages_done "$full_dir"
    printf '# Stalker Golem Drive Ledger\n\n- Drive Target: fake\n' > "$full_dir/_DRIVE-LEDGER.md"

    contract="$TMPDIR_/contract-order"
    cat > "$contract" <<'SH'
#!/bin/bash
printf '%s\n' "$1" >> "$CONTRACT_CALLS"
SH
    chmod +x "$contract"

    PATH="$TMPDIR_/bin:$PATH" \
    STALKER_CONTRACT_SCRIPT="$contract" \
    CONTRACT_CALLS="$TMPDIR_/contract-calls" \
    run "$POST_STREAM" "$full_dir" "$full_dir/video.ts" "$full_dir/chat.log" theo 0

    [ "$status" -eq 0 ]
    [ "$(sed -n '1p' "$TMPDIR_/contract-calls")" = "digest" ]
    [ "$(sed -n '2p' "$TMPDIR_/contract-calls")" = "ingest-run" ]
}

@test "post-stream bounds BrainLayer ingest with an overridable timeout" {
    full_dir="$(make_run_dir theo-2026-06-18-005309)"
    mark_downstream_stages_done "$full_dir"
    printf '# Stalker Golem Drive Ledger\n\n- Drive Target: fake\n' > "$full_dir/_DRIVE-LEDGER.md"

    contract="$TMPDIR_/contract-timeout"
    cat > "$contract" <<'SH'
#!/bin/bash
exit 0
SH
    chmod +x "$contract"

    PATH="$TMPDIR_/bin:$PATH" \
    STALKER_CONTRACT_SCRIPT="$contract" \
    STALKER_BRAINLAYER_INGEST_TIMEOUT=23m \
    STALKER_TIMEOUT_CAPTURE="$TMPDIR_/timeout-duration" \
    run "$POST_STREAM" "$full_dir" "$full_dir/video.ts" "$full_dir/chat.log" theo 0

    [ "$status" -eq 0 ]
    [ "$(cat "$TMPDIR_/timeout-duration")" = "23m" ]
}

@test "post-stream external timeout escalates to KILL after TERM" {
    full_dir="$(make_run_dir theo-2026-06-18-005309)"
    mark_downstream_stages_done "$full_dir"
    printf '# Stalker Golem Drive Ledger\n\n- Drive Target: fake\n' > "$full_dir/_DRIVE-LEDGER.md"

    cat > "$TMPDIR_/bin/timeout" <<'SH'
#!/bin/bash
printf '%s\n' "$@" > "$STALKER_TIMEOUT_ARGS"
while [[ "$1" == -* ]]; do
    shift
done
shift
"$@"
SH
    chmod +x "$TMPDIR_/bin/timeout"

    PATH="$TMPDIR_/bin:$PATH" \
    STALKER_CONTRACT_SCRIPT="$TMPDIR_/bin/brain-store-fail" \
    STALKER_BRAINLAYER_TIMEOUT_KILL_AFTER=0 \
    STALKER_TIMEOUT_ARGS="$TMPDIR_/timeout-args" \
    run "$POST_STREAM" "$full_dir" "$full_dir/video.ts" "$full_dir/chat.log" theo 0

    [ "$status" -eq 0 ]
    grep -F -q -- '--kill-after=1s' "$TMPDIR_/timeout-args"
}

@test "post-stream real GNU timeout kills a TERM-ignoring ingest when zero escalation is requested" {
    system_timeout="$(PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" command -v timeout || true)"
    if [ -z "$system_timeout" ] || ! "$system_timeout" --version 2>/dev/null | grep -F -q 'GNU coreutils'; then
        skip "GNU timeout is unavailable"
    fi

    full_dir="$(make_run_dir theo-2026-06-18-005309)"
    mark_downstream_stages_done "$full_dir"
    printf '# Stalker Golem Drive Ledger\n\n- Drive Target: fake\n' > "$full_dir/_DRIVE-LEDGER.md"
    mv "$TMPDIR_/bin/timeout" "$TMPDIR_/bin/timeout.disabled"

    contract="$TMPDIR_/contract-ignore-term"
    cat > "$contract" <<'SH'
#!/bin/bash
case "$1" in
    digest|queue-run) exit 0 ;;
    ingest-run)
        trap '' TERM
        exec /bin/sleep 37.86429
        ;;
esac
exit 2
SH
    chmod +x "$contract"

    PATH="$TMPDIR_/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" \
    STALKER_CONTRACT_SCRIPT="$contract" \
    STALKER_BRAINLAYER_INGEST_TIMEOUT=1s \
    STALKER_BRAINLAYER_TIMEOUT_KILL_AFTER=0 \
    run "$POST_STREAM" "$full_dir" "$full_dir/video.ts" "$full_dir/chat.log" theo 0

    [ "$status" -eq 0 ]
    [[ "$output" == *'BrainLayer contract ingest timed out'* ]]
    if child_pid="$(pgrep -f '^/bin/sleep 37\.86429$' | head -1)" && [ -n "$child_pid" ]; then
        kill "$child_pid" 2>/dev/null || true
        false
    fi
}

@test "post-stream classifies exit 137 after killing a TERM-ignoring ingest as timeout" {
    full_dir="$(make_run_dir theo-2026-06-18-005309)"
    mark_downstream_stages_done "$full_dir"
    printf '# Stalker Golem Drive Ledger\n\n- Drive Target: fake\n' > "$full_dir/_DRIVE-LEDGER.md"

    cat > "$TMPDIR_/bin/timeout" <<'SH'
#!/bin/bash
while [[ "$1" == -* ]]; do shift; done
shift
"$@" &
command_pid=$!
sleep 0.1
kill -TERM "$command_pid" 2>/dev/null || true
sleep 0.1
kill -KILL "$command_pid" 2>/dev/null || true
wait "$command_pid" 2>/dev/null || true
exit 137
SH
    chmod +x "$TMPDIR_/bin/timeout"

    contract="$TMPDIR_/contract-exit-137"
    cat > "$contract" <<'SH'
#!/bin/bash
case "$1" in
    digest) exit 0 ;;
    ingest-run)
        trap '' TERM
        exec /bin/sleep 37.97531
        ;;
    queue-run)
        printf '%s\n' "$3" > "$QUEUE_REASON_CAPTURE"
        exit 0
        ;;
esac
exit 2
SH
    chmod +x "$contract"

    PATH="$TMPDIR_/bin:$PATH" \
    STALKER_CONTRACT_SCRIPT="$contract" \
    QUEUE_REASON_CAPTURE="$TMPDIR_/queue-reason" \
    run "$POST_STREAM" "$full_dir" "$full_dir/video.ts" "$full_dir/chat.log" theo 0

    [ "$status" -eq 0 ]
    [[ "$output" == *'BrainLayer contract ingest timed out'* ]]
    [ "$(cat "$TMPDIR_/queue-reason")" = "brain_store_timeout" ]
    if child_pid="$(pgrep -f '^/bin/sleep 37\.97531$' | head -1)" && [ -n "$child_pid" ]; then
        kill "$child_pid" 2>/dev/null || true
        false
    fi
}

@test "post-stream defaults the BrainLayer ingest timeout to fifteen minutes" {
    full_dir="$(make_run_dir theo-2026-06-18-005309)"
    mark_downstream_stages_done "$full_dir"
    printf '# Stalker Golem Drive Ledger\n\n- Drive Target: fake\n' > "$full_dir/_DRIVE-LEDGER.md"

    contract="$TMPDIR_/contract-timeout-default"
    cat > "$contract" <<'SH'
#!/bin/bash
exit 0
SH
    chmod +x "$contract"

    PATH="$TMPDIR_/bin:$PATH" \
    STALKER_CONTRACT_SCRIPT="$contract" \
    STALKER_TIMEOUT_CAPTURE="$TMPDIR_/timeout-duration" \
    run "$POST_STREAM" "$full_dir" "$full_dir/video.ts" "$full_dir/chat.log" theo 0

    [ "$status" -eq 0 ]
    [ "$(cat "$TMPDIR_/timeout-duration")" = "15m" ]
}

@test "post-stream queues unfinished BrainLayer payloads when ingest times out" {
    full_dir="$(make_run_dir theo-2026-06-18-005309)"
    mark_downstream_stages_done "$full_dir"
    printf '# Stalker Golem Drive Ledger\n\n- Drive Target: fake\n' > "$full_dir/_DRIVE-LEDGER.md"

    cat > "$TMPDIR_/bin/timeout" <<'SH'
#!/bin/bash
exit 124
SH
    chmod +x "$TMPDIR_/bin/timeout"

    PATH="$TMPDIR_/bin:$PATH" \
    STALKER_BRAIN_STORE_CMD="$TMPDIR_/bin/brain-store-fail" \
    TELEGRAM_BODY_FILE="$TMPDIR_/telegram-body.json" \
    run "$POST_STREAM" "$full_dir" "$full_dir/video.ts" "$full_dir/chat.log" theo 0

    [ "$status" -eq 0 ]
    [ -f "$full_dir/.stage-notified.done" ]
    [ ! -f "$full_dir/.stage-brainlayer.done" ]
    grep -F -q 'status=queued' "$full_dir/.brainlayer-status"
    [ "$(jq -s 'length' "$full_dir/orphaned_stores.jsonl")" = "3" ]
    jq -s -e 'all(.[]; .reason == "brain_store_timeout")' "$full_dir/orphaned_stores.jsonl"
}

@test "post-stream sends one separate alert when BrainLayer payloads are queued" {
    full_dir="$(make_run_dir theo-2026-06-18-005309)"
    mark_downstream_stages_done "$full_dir"
    printf '# Stalker Golem Drive Ledger\n\n- Drive Target: fake\n' > "$full_dir/_DRIVE-LEDGER.md"

    cat > "$TMPDIR_/bin/timeout" <<'SH'
#!/bin/bash
exit 124
SH
    chmod +x "$TMPDIR_/bin/timeout"

    for _ in 1 2; do
        PATH="$TMPDIR_/bin:$PATH" \
        STALKER_BRAIN_STORE_CMD="$TMPDIR_/bin/brain-store-fail" \
        TELEGRAM_BODY_FILE="$TMPDIR_/telegram-body.json" \
        TELEGRAM_CALL_LOG="$TMPDIR_/telegram-calls.jsonl" \
        run "$POST_STREAM" "$full_dir" "$full_dir/video.ts" "$full_dir/chat.log" theo 0
        [ "$status" -eq 0 ]
    done

    [ "$(jq -s 'length' "$TMPDIR_/telegram-calls.jsonl")" = "2" ]
    [ "$(jq -r '.title' "$TMPDIR_/telegram-body.json")" = "Stalker BrainLayer replay queued - 2026-06-18" ]
    [ -f "$full_dir/.stage-brainlayer-queue-notified.done" ]
}

@test "post-stream uses a bounded fallback when timeout utilities are unavailable" {
    full_dir="$(make_run_dir theo-2026-06-18-005309)"
    mark_downstream_stages_done "$full_dir"
    printf '# Stalker Golem Drive Ledger\n\n- Drive Target: fake\n' > "$full_dir/_DRIVE-LEDGER.md"
    mv "$TMPDIR_/bin/timeout" "$TMPDIR_/bin/timeout.disabled"

    PATH="$TMPDIR_/bin:/usr/bin:/bin" \
    STALKER_BRAIN_STORE_CMD="$TMPDIR_/bin/brain-store" \
    BRAIN_STORE_CAPTURE="$TMPDIR_/brain-store.jsonl" \
    TELEGRAM_BODY_FILE="$TMPDIR_/telegram-body.json" \
    run "$POST_STREAM" "$full_dir" "$full_dir/video.ts" "$full_dir/chat.log" theo 0

    [ "$status" -eq 0 ]
    [ -f "$full_dir/.stage-brainlayer.done" ]
    [ "$(jq -s 'length' "$TMPDIR_/brain-store.jsonl")" = "3" ]
}

@test "post-stream built-in watchdog times out and queues unfinished payloads" {
    full_dir="$(make_run_dir theo-2026-06-18-005309)"
    mark_downstream_stages_done "$full_dir"
    printf '# Stalker Golem Drive Ledger\n\n- Drive Target: fake\n' > "$full_dir/_DRIVE-LEDGER.md"
    mv "$TMPDIR_/bin/timeout" "$TMPDIR_/bin/timeout.disabled"
    cat > "$TMPDIR_/bin/brain-store-slow" <<'SH'
#!/bin/bash
cat >/dev/null
trap '' TERM
/bin/sleep 37.24681
SH
    chmod +x "$TMPDIR_/bin/brain-store-slow"

    PATH="$TMPDIR_/bin:/usr/bin:/bin" \
    STALKER_BRAIN_STORE_CMD="$TMPDIR_/bin/brain-store-slow" \
    STALKER_BRAINLAYER_INGEST_TIMEOUT=1s \
    STALKER_BRAINLAYER_TIMEOUT_KILL_AFTER=0 \
    TELEGRAM_BODY_FILE="$TMPDIR_/telegram-body.json" \
    run "$POST_STREAM" "$full_dir" "$full_dir/video.ts" "$full_dir/chat.log" theo 0

    [ "$status" -eq 0 ]
    [ -f "$full_dir/.stage-notified.done" ]
    [ ! -f "$full_dir/.stage-brainlayer.done" ]
    grep -F -q 'status=queued' "$full_dir/.brainlayer-status"
    [ "$(jq -s 'length' "$full_dir/orphaned_stores.jsonl")" = "3" ]
    if child_pid="$(pgrep -f '^/bin/sleep 37\.24681$' | head -1)" && [ -n "$child_pid" ]; then
        kill "$child_pid" 2>/dev/null || true
        false
    fi
}

@test "post-stream BrainLayer dry-run still runs when timeout utilities are unavailable" {
    full_dir="$(make_run_dir theo-2026-06-18-005309)"
    mark_downstream_stages_done "$full_dir"
    printf '# Stalker Golem Drive Ledger\n\n- Drive Target: fake\n' > "$full_dir/_DRIVE-LEDGER.md"
    mv "$TMPDIR_/bin/timeout" "$TMPDIR_/bin/timeout.disabled"

    PATH="$TMPDIR_/bin:/usr/bin:/bin" \
    STALKER_BRAINLAYER_DRY_RUN=1 \
    run "$POST_STREAM" "$full_dir" "$full_dir/video.ts" "$full_dir/chat.log" theo 0

    [ "$status" -eq 0 ]
    [[ "$output" == *'record:run-summary'* ]]
    [ ! -f "$full_dir/.stage-brainlayer.done" ]
}

@test "post-stream leaves queued BrainLayer stores retryable" {
    full_dir="$(make_run_dir theo-2026-06-18-005309)"
    mark_downstream_stages_done "$full_dir"
    printf '# Stalker Golem Drive Ledger\n\n- Drive Target: fake\n' > "$full_dir/_DRIVE-LEDGER.md"

    PATH="$TMPDIR_/bin:$PATH" \
    STALKER_BRAIN_STORE_CMD="$TMPDIR_/bin/brain-store-fail" \
    TELEGRAM_BODY_FILE="$TMPDIR_/telegram-body.json" \
    run "$POST_STREAM" "$full_dir" "$full_dir/video.ts" "$full_dir/chat.log" theo 0

    [ "$status" -eq 0 ]
    [ -f "$TMPDIR_/telegram-body.json" ]
    [ -f "$full_dir/.brainlayer-status" ]
    grep -F -q 'status=queued' "$full_dir/.brainlayer-status"
    [ -f "$full_dir/orphaned_stores.jsonl" ]
    [ ! -f "$full_dir/.stage-brainlayer.done" ]
    [ -f "$full_dir/.stage-notified.done" ]
}

@test "post-stream Telegram dry-run does not skip BrainLayer ingest" {
    full_dir="$(make_run_dir theo-2026-06-18-005309)"
    mark_downstream_stages_done "$full_dir"
    printf '# Stalker Golem Drive Ledger\n\n- Drive Target: fake\n' > "$full_dir/_DRIVE-LEDGER.md"

    PATH="$TMPDIR_/bin:$PATH" \
    STALKER_BRAIN_STORE_CMD="$TMPDIR_/bin/brain-store" \
    BRAIN_STORE_CAPTURE="$TMPDIR_/brain-store.jsonl" \
    STALKER_TELEGRAM_DRY_RUN=1 \
    TELEGRAM_BODY_FILE="$TMPDIR_/telegram-body.json" \
    run "$POST_STREAM" "$full_dir" "$full_dir/video.ts" "$full_dir/chat.log" theo 0

    [ "$status" -eq 0 ]
    [ -f "$full_dir/.stage-brainlayer.done" ]
    [ "$(jq -s 'length' "$TMPDIR_/brain-store.jsonl")" = "3" ]
    [ ! -f "$full_dir/.stage-notified.done" ]
    [ ! -f "$TMPDIR_/telegram-body.json" ]
}

@test "post-stream ingests failure telemetry before returning a digest quality error" {
    full_dir="$(make_run_dir theo-2026-06-18-005309)"
    mark_downstream_stages_done "$full_dir"
    rm -f "$full_dir/gems.md"
    : > "$full_dir/chat.log"
    : > "$full_dir/.stage-brainlayer.done"

    contract="$TMPDIR_/contract-quality-failure"
    cat > "$contract" <<'SH'
#!/bin/bash
printf '%s\n' "$1" >> "$CONTRACT_CALLS"
exit 0
SH
    chmod +x "$contract"

    PATH="$TMPDIR_/bin:$PATH" \
    STALKER_CONTRACT_SCRIPT="$contract" \
    CONTRACT_CALLS="$TMPDIR_/contract-calls" \
    run "$POST_STREAM" "$full_dir" "$full_dir/video.ts" "$full_dir/chat.log" theo 0

    [ "$status" -eq 75 ]
    [ "$(cat "$TMPDIR_/contract-calls")" = "ingest-run" ]
    [ ! -f "$full_dir/.stage-notified.done" ]
}
