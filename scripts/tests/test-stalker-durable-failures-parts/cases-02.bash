function split_case_033() {
    root="$TMPDIR_/stalker-partial"
    processed_dir="$root/examplechannel-2026-08-19-2000"
    dropped_dir="$root/examplechannel-2026-08-19-2100"
    mkdir -p "$processed_dir" "$dropped_dir"
    printf 'done\n' > "$processed_dir/.stage-process.done"
    printf 'healthy chat\n' > "$processed_dir/chat.log"
    printf '### [00:05:00] Counted moment\n**Score:** 8/10 | **Type:** insight\n**Gist:** counted\n' > "$processed_dir/gems.md"
    printf 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n' > "$dropped_dir/chat.log"
    printf '### [00:10:00] Dropped moment\n**Score:** 10/10 | **Type:** insight\n**Gist:** must not be counted\n' > "$dropped_dir/gems.md"

    run "$STALKER_DIR/stalker-brainlayer.sh" digest "$root" 2026-08-19 --dry-run

    [[ "$status" -eq 75 \
        && "$output" == *"Stalker Morning Digest FAILED - 2026-08-19"* \
        && "$output" == *"💎 1 gems · 1 chat"* \
        && "$output" == *"Counted moment"* \
        && "$output" != *"Dropped moment"* \
        && "$output" == *"DROPPED (not counted above): examplechannel-2026-08-19-2100"* ]]
}

function split_case_034() {
    root="$TMPDIR_/stalker-reconnect"
    processed_dir="$root/examplechannel-2026-08-19-2000"
    orphan_dir="$root/examplechannel-2026-08-19-2100"
    mkdir -p "$processed_dir" "$orphan_dir"
    printf 'done\n' > "$processed_dir/.stage-process.done"
    printf 'healthy chat\n' > "$processed_dir/chat.log"
    printf '### [00:05:00] Counted moment\n**Score:** 8/10 | **Type:** insight\n**Gist:** counted\n' > "$processed_dir/gems.md"
    printf 'status=ORPHAN_TAIL\n' > "$orphan_dir/.orphan-tail"

    run "$STALKER_DIR/stalker-brainlayer.sh" digest "$root" 2026-08-19 --dry-run

    [[ "$status" -eq 0 \
        && "$output" == *"Stalker Morning Digest - 2026-08-19"* \
        && "$output" == *"💎 1 gems · 1 chat"* \
        && "$output" == *"Counted moment"* \
        && "$output" != *"FAILED"* \
        && "$output" == *"DROPPED (not counted above): examplechannel-2026-08-19-2100"* ]]
}

function split_case_035() {
    stream_dir="$(make_post_fixture)"
    orphan_dir="$(dirname "$stream_dir")/examplechannel-2026-07-10-040000"
    mkdir -p "$orphan_dir"
    printf 'status=ORPHAN_TAIL\n' > "$orphan_dir/.orphan-tail"
    printf '[00:00:01] viewer: hello\n' > "$stream_dir/chat.log"
    printf '# Gems\n\n### [00:10] A real gem\n**Score:** 8/10 | **Type:** insight\n' > "$stream_dir/gems.md"

    run env -i \
        PATH="$FAKE_BIN:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        ALERTS_FILE="$ALERTS_FILE" \
        STALKER_COMPLETION_SCRIPT="$STALKER_COMPLETION_SCRIPT" \
        STALKER_COMPLETION_CALLS="$STALKER_COMPLETION_CALLS" \
        STREAM_AUTO_ARCHIVE=1 \
        "$POST_STREAM" "$stream_dir" "$stream_dir/video.mp4" "$stream_dir/chat.log" examplechannel 0

    [ "$status" -eq 0 ]
    [ "$(cat "$STALKER_COMPLETION_CALLS")" = "$stream_dir" ]
    [ ! -s "$ALERTS_FILE" ]
}

function split_case_036() {
    stream_dir="$(make_post_fixture)"
    printf '[00:00:01] viewer: hello\n' > "$stream_dir/chat.log"
    printf '# Gems\n\n### [00:10] A real gem\n' > "$stream_dir/gems.md"
    run env -i \
        PATH="$FAKE_BIN:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        ALERTS_FILE="$ALERTS_FILE" \
        STALKER_COMPLETION_SCRIPT="$STALKER_COMPLETION_SCRIPT" \
        STALKER_COMPLETION_CALLS="$STALKER_COMPLETION_CALLS" \
        STALKER_COMPLETION_EXIT=17 \
        STREAM_AUTO_ARCHIVE=1 \
        "$POST_STREAM" "$stream_dir" "$stream_dir/video.mp4" "$stream_dir/chat.log" examplechannel 0

    [ "$status" -eq 75 ]
    [ "$(cat "$STALKER_COMPLETION_CALLS")" = "$stream_dir" ]
    [ ! -f "$stream_dir/.stage-notified.done" ]
}

function split_case_037() {
    stream_dir="$(make_post_fixture)"
    contract="$(make_contract)"
    : > "$stream_dir/chat.log"

    run env -i \
        PATH="$FAKE_BIN:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        ALERTS_FILE="$ALERTS_FILE" \
        CONTRACT_CALLS="$CONTRACT_CALLS" \
        STALKER_COMPLETION_SCRIPT="$STALKER_COMPLETION_SCRIPT" \
        STALKER_COMPLETION_CALLS="$STALKER_COMPLETION_CALLS" \
        STALKER_CONTRACT_SCRIPT="$contract" \
        STALKER_BRAINLAYER_INGEST_TIMEOUT=1s \
        STALKER_BRAINLAYER_TIMEOUT_KILL_AFTER=0 \
        STREAM_AUTO_ARCHIVE=1 \
        "$POST_STREAM" "$stream_dir" "$stream_dir/video.mp4" "$stream_dir/chat.log" examplechannel 0

    [ "$status" -ne 0 ]
    [ ! -f "$STALKER_COMPLETION_CALLS" ]
    [ "$(cat "$CONTRACT_CALLS")" = "ingest-run $stream_dir" ]
    [ ! -f "$stream_dir/.stage-notified.done" ]
    [ -f "$stream_dir/.stage-run-quality.failed" ]
    [ ! -s "$ALERTS_FILE" ]
}

function split_case_038() {
    stream_dir="$(make_post_fixture)"
    contract="$(make_contract)"
    : > "$stream_dir/chat.log"
    printf '# Gems\n\n### [00:10] A real gem\n' > "$stream_dir/gems.md"

    run env -i \
        PATH="$FAKE_BIN:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        ALERTS_FILE="$ALERTS_FILE" \
        CONTRACT_CALLS="$CONTRACT_CALLS" \
        STALKER_COMPLETION_SCRIPT="$STALKER_COMPLETION_SCRIPT" \
        STALKER_COMPLETION_CALLS="$STALKER_COMPLETION_CALLS" \
        STALKER_CONTRACT_SCRIPT="$contract" \
        STREAM_AUTO_ARCHIVE=1 \
        "$POST_STREAM" "$stream_dir" "$stream_dir/video.mp4" "$stream_dir/chat.log" examplechannel 0

    [ "$status" -eq 0 ]
    [ "$(cat "$STALKER_COMPLETION_CALLS")" = "$stream_dir" ]
    [ -f "$stream_dir/.stage-chat.failed" ]
    [ ! -f "$stream_dir/.stage-run-quality.failed" ]
    grep -F -q 'chat_count=0' "$stream_dir/.stage-chat.failed"
    [ ! -s "$ALERTS_FILE" ]
    [ ! -s "$ALERTS_FILE" ]
}

function split_case_039() {
    stream_dir="$(make_post_fixture)"
    contract="$(make_contract)"
    printf '[00:00:01] viewer: hello\n' > "$stream_dir/chat.log"
    cat > "$stream_dir/gems.md" <<'EOF'
# Gems

### [00:10] A real gem
EOF

    run env -i \
        PATH="$FAKE_BIN:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        ALERTS_FILE="$ALERTS_FILE" \
        CONTRACT_CALLS="$CONTRACT_CALLS" \
        STALKER_COMPLETION_SCRIPT="$STALKER_COMPLETION_SCRIPT" \
        STALKER_COMPLETION_CALLS="$STALKER_COMPLETION_CALLS" \
        STALKER_CONTRACT_SCRIPT="$contract" \
        STREAM_AUTO_ARCHIVE=1 \
        "$POST_STREAM" "$stream_dir" "$stream_dir/video.mp4" "$stream_dir/chat.log" examplechannel 0

    [ "$status" -eq 0 ]
    [ "$(cat "$STALKER_COMPLETION_CALLS")" = "$stream_dir" ]
    [ ! -s "$ALERTS_FILE" ]
}
