#!/usr/bin/env bats
# Tests for scripts/lib/stream-helpers.sh
# Run with: bats scripts/tests/test-stream-helpers.bats

setup() {
    SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
    FIXTURES="$BATS_TEST_DIRNAME/fixtures"
    # shellcheck source=../lib/stream-helpers.sh
    source "$SCRIPT_DIR/lib/stream-helpers.sh"
    TMPDIR_=$(mktemp -d)
}

teardown() {
    rm -rf "$TMPDIR_"
}

@test "parse_silence_timestamps: extracts numeric timestamps from clean input" {
    result=$(parse_silence_timestamps < "$FIXTURES/silencedetect-clean.txt")
    [ "$result" = "9.536938
45.947938
88.720875" ]
}

@test "parse_silence_timestamps: filters out elapsed= interleaved garbage" {
    result=$(parse_silence_timestamps < "$FIXTURES/silencedetect-polluted.txt")
    # Should keep only the 4 valid numeric silence_end values, drop the
    # 'elapsed=0:00:02.22' corruption and the ffmpeg progress line.
    [ "$(echo "$result" | wc -l | tr -d ' ')" = "4" ]
    # Exact-string matches via -F -x — escape concerns avoided.
    echo "$result" | grep -F -q -x "9.536938"
    echo "$result" | grep -F -q -x "99.9"
    # Critically: NO non-numeric lines survive.
    ! echo "$result" | grep -qE "[a-zA-Z]"
}

@test "parse_silence_timestamps: empty input produces no output, exit 0 under pipefail" {
    # Must exit 0 even with set -o pipefail (regression: previously the final
    # grep returned 1 on no match and aborted the calling script).
    run bash -c 'set -o pipefail; source "'$SCRIPT_DIR'/lib/stream-helpers.sh" && echo "" | parse_silence_timestamps'
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "parse_silence_timestamps: all-garbage input also exits 0 under pipefail" {
    # Same regression — every line filtered out shouldn't propagate exit 1.
    run bash -c 'set -o pipefail; source "'$SCRIPT_DIR'/lib/stream-helpers.sh" && printf "[silencedetect @ 0x1] not_a_silence: x | y\n" | parse_silence_timestamps'
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "parse_silence_timestamps: handles integer-only timestamps (no decimal)" {
    result=$(printf '[silencedetect @ 0x1] silence_end: 42 | silence_duration: 1\n' | parse_silence_timestamps)
    [ "$result" = "42" ]
}

@test "count_chat_lines: returns 0 for missing file without erroring" {
    run count_chat_lines "$TMPDIR_/does-not-exist.log"
    [ "$status" -eq 0 ]
    [ "$output" = "0" ]
}

@test "count_chat_lines: returns 0 for empty path" {
    run count_chat_lines ""
    [ "$status" -eq 0 ]
    [ "$output" = "0" ]
}

@test "count_chat_lines: returns correct count for existing file" {
    printf 'line1\nline2\nline3\n' > "$TMPDIR_/chat.log"
    run count_chat_lines "$TMPDIR_/chat.log"
    [ "$status" -eq 0 ]
    [ "$output" = "3" ]
}

@test "count_chat_lines: returns 0 for empty existing file" {
    : > "$TMPDIR_/empty.log"
    run count_chat_lines "$TMPDIR_/empty.log"
    [ "$status" -eq 0 ]
    [ "$output" = "0" ]
}

@test "durations_match: equal durations pass" {
    run durations_match 15000 15000
    [ "$status" -eq 0 ]
}

@test "durations_match: within tolerance passes" {
    run durations_match 15000 15001 2
    [ "$status" -eq 0 ]
}

@test "durations_match: outside tolerance fails" {
    run durations_match 15000 15010 2
    [ "$status" -ne 0 ]
}

@test "durations_match: empty inputs fail safely" {
    run durations_match "" 100
    [ "$status" -ne 0 ]
}

@test "durations_match: non-numeric input (ffprobe N/A) fails safely, doesn't crash arithmetic" {
    # Regression: ffprobe returns "N/A" for containers with no duration metadata.
    # The old check only rejected empty strings, so $((N/A - 100)) blew up bash.
    run durations_match "N/A" 100
    [ "$status" -ne 0 ]
    run durations_match 100 "N/A"
    [ "$status" -ne 0 ]
}

@test "compress_video_h264: refuses to overwrite existing output" {
    touch "$TMPDIR_/exists.mp4"
    touch "$TMPDIR_/in.mp4"
    run compress_video_h264 "$TMPDIR_/in.mp4" "$TMPDIR_/exists.mp4"
    [ "$status" -eq 4 ]
}

@test "compress_video_h264: errors on missing input" {
    run compress_video_h264 "$TMPDIR_/nope.mp4" "$TMPDIR_/out.mp4"
    [ "$status" -eq 3 ]
}

@test "compress_video_h264: errors on empty args" {
    run compress_video_h264 "" ""
    [ "$status" -eq 2 ]
}

@test "file_size_bytes: returns correct byte count" {
    printf 'hello' > "$TMPDIR_/f.txt"
    run file_size_bytes "$TMPDIR_/f.txt"
    [ "$status" -eq 0 ]
    [ "$output" = "5" ]
}

@test "file_size_bytes: returns 0 for missing file" {
    run file_size_bytes "$TMPDIR_/missing.txt"
    [ "$status" -eq 0 ]
    [ "$output" = "0" ]
}

@test "file_size_bytes: returns 0 for empty arg" {
    run file_size_bytes ""
    [ "$status" -eq 0 ]
    [ "$output" = "0" ]
}

@test "transcribe_segment_with_fallback: retries whisper-cli after whisper-server is unavailable" {
    mkdir -p "$TMPDIR_/bin"
    cat > "$TMPDIR_/bin/curl" <<'SH'
#!/bin/bash
exit 7
SH
    cat > "$TMPDIR_/bin/whisper-cli" <<'SH'
#!/bin/bash
count_file="$WHISPER_ATTEMPTS_FILE"
count=$(cat "$count_file" 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > "$count_file"
if [ "$count" -lt 3 ]; then
  echo "temporary whisper failure" >&2
  exit 9
fi
echo "segment text after retry"
SH
    chmod +x "$TMPDIR_/bin/curl" "$TMPDIR_/bin/whisper-cli"
    touch "$TMPDIR_/segment.wav"
    touch "$TMPDIR_/model.bin"

    PATH="$TMPDIR_/bin:$PATH" \
    WHISPER_ATTEMPTS_FILE="$TMPDIR_/attempts" \
    STALKER_RETRY_SLEEP_BASE=0 \
    run transcribe_segment_with_fallback "$TMPDIR_/segment.wav" "$TMPDIR_/model.bin" 7 "$TMPDIR_"

    [ "$status" -eq 0 ]
    [[ "$output" == *"segment text after retry"* ]]
    [ "$(cat "$TMPDIR_/attempts")" = "3" ]
}

@test "stalker_ytdlp_record_args: uses native HLS mpegts livestream-safe flags" {
    run stalker_ytdlp_record_args "best" "$TMPDIR_/video.ts" "https://www.twitch.tv/theo"

    [ "$status" -eq 0 ]
    [[ "$output" == *"--hls-use-mpegts"* ]]
    [[ "$output" == *"--downloader
native"* ]]
    [[ "$output" == *"--socket-timeout
30"* ]]
    [[ "$output" == *"--retries
infinite"* ]]
    [[ "$output" == *"--fragment-retries
infinite"* ]]
    [[ "$output" == *"--retry-sleep
fragment:exp=1:20"* ]]
    [[ "$output" == *"--abort-on-unavailable-fragment"* ]]
    [[ "$output" == *"--no-part"* ]]
    [[ "$output" == *"--concurrent-fragments
1"* ]]
    [[ "$output" == *"--no-continue"* ]]
    [[ "$output" == *"-f
best"* ]]
    [[ "$output" == *"-o
$TMPDIR_/video.ts"* ]]
}

@test "stalker_watch_file_growth: terminates stale recorder after hang timeout" {
    touch "$TMPDIR_/video.ts"
    sleep 30 &
    local recorder_pid=$!

    STALKER_WATCHDOG_INTERVAL=1 \
    STALKER_WATCHDOG_KILL_AFTER=1 \
    run stalker_watch_file_growth "$TMPDIR_/video.ts" "$recorder_pid" 1 "$TMPDIR_/watchdog.log"

    [ "$status" -eq 0 ]
    wait "$recorder_pid" 2>/dev/null || true
    ! kill -0 "$recorder_pid" 2>/dev/null
    grep -q "No file growth" "$TMPDIR_/watchdog.log"
}

@test "stalker_latest_stamped_stream_dir: exact rapid cascades ignore older directory mutations" {
    local root="$TMPDIR_/streams"
    mkdir -p \
        "$root/theo-2026-08-20-032306" \
        "$root/theo-2026-08-20-032307" \
        "$root/theo-2026-08-20-032309" \
        "$root/theo-2026-08-20-052008" \
        "$root/theo-2026-08-20-052009" \
        "$root/theo-2026-08-20-052010"

    # Detached post-processing mutates an older run after the active run starts.
    touch -t 203001010101 "$root/theo-2026-08-20-032306"
    run stalker_latest_stamped_stream_dir "$root" theo
    [ "$status" -eq 0 ]
    [ "$output" = "$root/theo-2026-08-20-052010" ]

    rm -rf "$root/theo-2026-08-20-05"*
    touch -t 203001010101 "$root/theo-2026-08-20-032306"
    run stalker_latest_stamped_stream_dir "$root" theo
    [ "$status" -eq 0 ]
    [ "$output" = "$root/theo-2026-08-20-032309" ]
}

@test "stalker live guard still restarts the watcher for a genuine newest-run stall" {
    local home="$TMPDIR_/home"
    local log_dir="$home/Gits/golems/docs.local/stalker-golem"
    local fake_bin="$TMPDIR_/guard-bin"
    local launchctl_calls="$TMPDIR_/launchctl-calls"
    local guard_output="$TMPDIR_/guard-output"
    local expected_service="gui/$(id -u)/com.golems.stream-watcher"
    mkdir -p "$log_dir/theo-2026-08-20-032306" \
        "$log_dir/theo-2026-08-20-032309" \
        "$home/Gits/golems/scripts" \
        "$fake_bin"
    truncate -s 2000000 "$log_dir/theo-2026-08-20-032306/video.ts"
    truncate -s 2000000 "$log_dir/theo-2026-08-20-032309/video.ts"
    touch -t 203001010101 "$log_dir/theo-2026-08-20-032306"

    cat > "$fake_bin/yt-dlp" <<'SH'
#!/bin/bash
exit 0
SH
    cat > "$fake_bin/pgrep" <<'SH'
#!/bin/bash
case "$*" in
  *"stream-watcher.sh theo best"*) printf '101\n' ;;
  *"yt-dlp.*theo"*) printf '202\n' ;;
  *"stream-watcher|yt-dlp|ffmpeg|twitch-lurk|process-stream"*) printf '101\n202\n' ;;
esac
SH
    cat > "$fake_bin/launchctl" <<'SH'
#!/bin/bash
printf '%s\n' "$*" >> "$LAUNCHCTL_CALLS"
exit 0
SH
    cat > "$fake_bin/curl" <<'SH'
#!/bin/bash
exit 0
SH
    cat > "$fake_bin/sleep" <<'SH'
#!/bin/bash
exit 0
SH
    chmod +x "$fake_bin/yt-dlp" "$fake_bin/pgrep" "$fake_bin/launchctl" "$fake_bin/curl" "$fake_bin/sleep"

    env PATH="$fake_bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$home" \
        LAUNCHCTL_CALLS="$launchctl_calls" \
        CHECK_INTERVAL=0 \
        STALL_SECONDS=0 \
        RESTART_COOLDOWN=999999 \
        "$SCRIPT_DIR/stalker-live-guard.sh" theo best > "$guard_output" 2>&1 &
    local guard_pid=$!
    for _ in {1..200}; do
        grep -F -q "kickstart -k $expected_service" "$launchctl_calls" 2>/dev/null && break
        sleep 0.01
    done
    kill -TERM "$guard_pid" 2>/dev/null || true
    wait "$guard_pid" 2>/dev/null || true

    grep -F -q "video has not grown for" "$guard_output"
    grep -F -q "$log_dir/theo-2026-08-20-032309/video.ts" "$guard_output"
    grep -F -x -q "kickstart -k $expected_service" "$launchctl_calls"
    ! grep -F -q "kickstart -k gui/$(id -u)/com.golems.heavy-ml-guardian" "$launchctl_calls"
}

@test "stalker_terminate_process_tree: preserves the configured recorder grace period" {
    sleep 30 &
    local recorder_pid=$!
    local started_at
    started_at=$(date +%s)

    run stalker_terminate_process_tree "$recorder_pid" 1
    local elapsed=$(( $(date +%s) - started_at ))
    wait "$recorder_pid" 2>/dev/null || true

    [ "$status" -eq 0 ]
    [ "$elapsed" -ge 1 ]
}

@test "notify_stalker_whatsapp: STREAM_WHATSAPP_NOTIFY=0 skips curl and queue" {
    mkdir -p "$TMPDIR_/bin"
    cat > "$TMPDIR_/bin/curl" <<'SH'
#!/bin/bash
echo "curl should not run" >&2
exit 9
SH
    chmod +x "$TMPDIR_/bin/curl"

    PATH="$TMPDIR_/bin:$PATH" \
    STREAM_WHATSAPP_NOTIFY=0 \
    STALKER_WHATSAPP_QUEUE_DIR="$TMPDIR_/queue" \
    run notify_stalker_whatsapp "quiet"

    [ "$status" -eq 0 ]
    [ "$output" = "WhatsApp notifications disabled by STREAM_WHATSAPP_NOTIFY=0" ]
    [ ! -d "$TMPDIR_/queue" ]
}

@test "notify_stalker_whatsapp: sends configured JID payload to canonical 8741 bridge first" {
    mkdir -p "$TMPDIR_/bin"
    cat > "$TMPDIR_/bin/curl" <<'SH'
#!/bin/bash
printf '%s\n' "$*" > "$CURL_ARGS_FILE"
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-d" ]; then
    shift
    printf '%s\n' "$1" > "$CURL_BODY_FILE"
  fi
  shift || true
done
exit 0
SH
    chmod +x "$TMPDIR_/bin/curl"

    PATH="$TMPDIR_/bin:$PATH" \
    STREAM_WHATSAPP_RECIPIENT="15550123456@s.whatsapp.net" \
    CURL_ARGS_FILE="$TMPDIR_/args" \
    CURL_BODY_FILE="$TMPDIR_/body" \
    run notify_stalker_whatsapp "stream started"

    [ "$status" -eq 0 ]
    grep -q "http://127.0.0.1:8741/api/send" "$TMPDIR_/args"
    grep -q '"recipient": "15550123456@s.whatsapp.net"' "$TMPDIR_/body"
    grep -q '"message": "stream started"' "$TMPDIR_/body"
}

@test "transcribe_segment_with_fallback: prefers resident whisper-server before whisper-cli" {
    mkdir -p "$TMPDIR_/bin"
    cat > "$TMPDIR_/bin/curl" <<'SH'
#!/bin/bash
printf 'server transcript'
SH
    cat > "$TMPDIR_/bin/whisper-cli" <<'SH'
#!/bin/bash
printf 'cli transcript'
SH
    chmod +x "$TMPDIR_/bin/curl" "$TMPDIR_/bin/whisper-cli"
    touch "$TMPDIR_/segment.wav"
    touch "$TMPDIR_/model.bin"

    PATH="$TMPDIR_/bin:$PATH" \
    STALKER_RETRY_SLEEP_BASE=0 \
    run transcribe_segment_with_fallback "$TMPDIR_/segment.wav" "$TMPDIR_/model.bin" 10 "$TMPDIR_"

    [ "$status" -eq 0 ]
    [ "$output" = "server transcript" ]
}

@test "transcribe_segment_with_fallback: falls back to whisper-server when whisper-cli is unavailable" {
    mkdir -p "$TMPDIR_/bin"
    cat > "$TMPDIR_/bin/curl" <<'SH'
#!/bin/bash
printf 'server transcript'
SH
    chmod +x "$TMPDIR_/bin/curl"
    touch "$TMPDIR_/segment.wav"

    PATH="$TMPDIR_/bin" \
    STALKER_RETRY_SLEEP_BASE=0 \
    run transcribe_segment_with_fallback "$TMPDIR_/segment.wav" "$TMPDIR_/model.bin" 8 "$TMPDIR_"

    [ "$status" -eq 0 ]
    [ "$output" = "server transcript" ]
}

@test "transcribe_segment_with_fallback: queues Telegram and fails when cli and server both fail" {
    mkdir -p "$TMPDIR_/bin"
    cat > "$TMPDIR_/bin/whisper-cli" <<'SH'
#!/bin/bash
exit 11
SH
    cat > "$TMPDIR_/bin/curl" <<'SH'
#!/bin/bash
exit 7
SH
    chmod +x "$TMPDIR_/bin/whisper-cli" "$TMPDIR_/bin/curl"
    touch "$TMPDIR_/segment.wav"

    PATH="$TMPDIR_/bin:$PATH" \
    STALKER_RETRY_SLEEP_BASE=0 \
    STALKER_TELEGRAM_QUEUE_DIR="$TMPDIR_/telegram-queue" \
    STALKER_WHATSAPP_QUEUE_DIR="$TMPDIR_/whatsapp-queue" \
    run transcribe_segment_with_fallback "$TMPDIR_/segment.wav" "$TMPDIR_/model.bin" 9 "$TMPDIR_"

    [ "$status" -ne 0 ]
    [ -f "$TMPDIR_/transcription-failures.log" ]
    grep -q "segment 9 transcription failed permanently" "$TMPDIR_/transcription-failures.log"
    [ "$(find "$TMPDIR_/telegram-queue" -type f | wc -l | tr -d ' ')" = "1" ]
    [ ! -d "$TMPDIR_/whatsapp-queue" ]
    grep -q '"title": "Stalker Transcription Failure"' "$(find "$TMPDIR_/telegram-queue" -type f | head -1)"
}

@test "notify_stalker_whatsapp: tries canonical 8741 and fallback bridge endpoints before queueing" {
    mkdir -p "$TMPDIR_/bin"
    cat > "$TMPDIR_/bin/curl" <<'SH'
#!/bin/bash
for arg in "$@"; do
  case "$arg" in
    http://127.0.0.1:*) echo "$arg" >> "$CURL_URLS_FILE" ;;
  esac
done
exit 22
SH
    chmod +x "$TMPDIR_/bin/curl"

    PATH="$TMPDIR_/bin:$PATH" \
    STREAM_WHATSAPP_RECIPIENT="15550123456@s.whatsapp.net" \
    CURL_URLS_FILE="$TMPDIR_/urls" \
    STALKER_WHATSAPP_QUEUE_DIR="$TMPDIR_/queue" \
    run notify_stalker_whatsapp "bridge down"

    [ "$status" -ne 0 ]
    [ "$(cat "$TMPDIR_/urls")" = "http://127.0.0.1:8741/api/send
http://127.0.0.1:8741/api/sendMessage
http://127.0.0.1:8080/api/send
http://127.0.0.1:8742/api/send" ]
    [ "$(find "$TMPDIR_/queue" -type f | wc -l | tr -d ' ')" = "1" ]
    grep -q '"message": "bridge down"' "$(find "$TMPDIR_/queue" -type f | head -1)"
}

@test "notify_stalker_telegram: STALKER_TELEGRAM_NOTIFY=0 skips curl and queue" {
    mkdir -p "$TMPDIR_/bin"
    cat > "$TMPDIR_/bin/curl" <<'SH'
#!/bin/bash
echo "curl should not run" >&2
exit 9
SH
    chmod +x "$TMPDIR_/bin/curl"

    PATH="$TMPDIR_/bin:$PATH" \
    STALKER_TELEGRAM_NOTIFY=0 \
    STALKER_TELEGRAM_QUEUE_DIR="$TMPDIR_/queue" \
    run notify_stalker_telegram "Quiet" "body"

    [ "$status" -eq 0 ]
    [ "$output" = "Telegram notifications disabled by STALKER_TELEGRAM_NOTIFY=0" ]
    [ ! -d "$TMPDIR_/queue" ]
}

@test "notify_stalker_telegram: posts title/body payload to local notification server" {
    mkdir -p "$TMPDIR_/bin"
    cat > "$TMPDIR_/bin/curl" <<'SH'
#!/bin/bash
printf '%s\n' "$*" > "$CURL_ARGS_FILE"
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-d" ]; then
    shift
    printf '%s\n' "$1" > "$CURL_BODY_FILE"
  fi
  shift || true
done
exit 0
SH
    chmod +x "$TMPDIR_/bin/curl"

    PATH="$TMPDIR_/bin:$PATH" \
    CURL_ARGS_FILE="$TMPDIR_/args" \
    CURL_BODY_FILE="$TMPDIR_/body" \
    run notify_stalker_telegram "Digest" "stream summary" "high" "stalker-golem"

    [ "$status" -eq 0 ]
    grep -q "http://127.0.0.1:3847/notify" "$TMPDIR_/args"
    grep -q '"title": "Digest"' "$TMPDIR_/body"
    grep -q '"body": "stream summary"' "$TMPDIR_/body"
    grep -q '"source": "stalker-golem"' "$TMPDIR_/body"
    grep -q '"priority": "high"' "$TMPDIR_/body"
}

@test "notify_stalker_telegram: queues when configured command fails" {
    mkdir -p "$TMPDIR_/bin"
    cat > "$TMPDIR_/bin/send-telegram-fail" <<'SH'
#!/bin/bash
cat >/dev/null
exit 12
SH
    chmod +x "$TMPDIR_/bin/send-telegram-fail"

    STALKER_TELEGRAM_CMD="$TMPDIR_/bin/send-telegram-fail" \
    STALKER_TELEGRAM_QUEUE_DIR="$TMPDIR_/telegram-queue" \
    run notify_stalker_telegram "Digest" "stream summary" "high" "stalker-golem"

    [ "$status" -ne 0 ]
    [ "$(find "$TMPDIR_/telegram-queue" -type f | wc -l | tr -d ' ')" = "1" ]
    grep -q '"title": "Digest"' "$(find "$TMPDIR_/telegram-queue" -type f | head -1)"
}

# --- stalker_circuit_should_open: agy scorer circuit breaker decision ---

@test "stalker_circuit_should_open: stays closed below threshold" {
    run stalker_circuit_should_open 2 3
    [ "$status" -ne 0 ]
}

@test "stalker_circuit_should_open: opens exactly at threshold" {
    run stalker_circuit_should_open 3 3
    [ "$status" -eq 0 ]
}

@test "stalker_circuit_should_open: opens above threshold" {
    run stalker_circuit_should_open 5 3
    [ "$status" -eq 0 ]
}

@test "stalker_circuit_should_open: defaults threshold to 3 when omitted" {
    run stalker_circuit_should_open 2
    [ "$status" -ne 0 ]
    run stalker_circuit_should_open 3
    [ "$status" -eq 0 ]
}

@test "stalker_circuit_should_open: non-integer failures never opens (fail closed)" {
    run stalker_circuit_should_open "abc" 3
    [ "$status" -ne 0 ]
    run stalker_circuit_should_open "" 3
    [ "$status" -ne 0 ]
}

@test "stalker_circuit_should_open: garbage threshold falls back to default 3" {
    run stalker_circuit_should_open 3 "notanum"
    [ "$status" -eq 0 ]
    run stalker_circuit_should_open 2 "notanum"
    [ "$status" -ne 0 ]
}

@test "stalker_circuit_should_open: threshold below 1 is clamped to 1" {
    run stalker_circuit_should_open 1 0
    [ "$status" -eq 0 ]
}

@test "stalker_circuit_should_open: breaker models reset-on-success (0 failures stays closed)" {
    # After an agy success the caller resets the counter to 0 — breaker must close.
    run stalker_circuit_should_open 0 3
    [ "$status" -ne 0 ]
}

# --- stalker_score_parallel_limit: scorer worker limit normalization ---

@test "stalker_score_parallel_limit: defaults to four workers" {
    run stalker_score_parallel_limit ""
    [ "$status" -eq 0 ]
    [ "$output" = "4" ]
}

@test "stalker_score_parallel_limit: preserves explicit serial fallback" {
    run stalker_score_parallel_limit 1
    [ "$status" -eq 0 ]
    [ "$output" = "1" ]
}

@test "stalker_score_parallel_limit: accepts positive configured concurrency" {
    run stalker_score_parallel_limit 8
    [ "$status" -eq 0 ]
    [ "$output" = "8" ]
}

@test "stalker_score_parallel_limit: invalid and non-positive values fall back to four" {
    run stalker_score_parallel_limit nope
    [ "$status" -eq 0 ]
    [ "$output" = "4" ]

    run stalker_score_parallel_limit 0
    [ "$status" -eq 0 ]
    [ "$output" = "4" ]
}

# --- stalker_acquire_circuit_lock: shared state lifecycle ---

@test "stalker_acquire_circuit_lock: aborts when cleanup removes the circuit directory" {
    circuit_dir="$TMPDIR_/removed-circuit"
    mkdir -p "$circuit_dir/lock"
    (
        sleep 0.1
        rm -rf "$circuit_dir"
    ) &
    remover_pid=$!

    run stalker_acquire_circuit_lock "$circuit_dir"
    wait "$remover_pid"

    [ "$status" -eq 1 ]
}

# --- stalker_circuit_next_state: race-free parallel circuit transitions ---

@test "stalker_circuit_next_state: success resets failures before circuit opens" {
    run stalker_circuit_next_state 0 2 success 3
    [ "$status" -eq 0 ]
    [ "$output" = "0|0|0" ]
}

@test "stalker_circuit_next_state: threshold failure opens circuit once" {
    run stalker_circuit_next_state 0 2 failure 3
    [ "$status" -eq 0 ]
    [ "$output" = "1|3|1" ]
}

@test "stalker_circuit_next_state: open circuit is one-way after in-flight success" {
    run stalker_circuit_next_state 1 3 success 3
    [ "$status" -eq 0 ]
    [ "$output" = "1|3|0" ]
}

@test "stalker_circuit_next_state: malformed open state fails closed" {
    run stalker_circuit_next_state corrupt 0 success 3
    [ "$status" -eq 2 ]
}

# --- stalker_merge_score_results: deterministic ordered gem writer ---

@test "stalker_merge_score_results: merges out-of-order worker artifacts by segment index" {
    results="$TMPDIR_/results"
    gems="$TMPDIR_/gems.md"
    mkdir -p "$results/segment-000002" "$results/segment-000001"
    printf '### [00:40] second\n\n' > "$results/segment-000002/gem.md"
    printf '### [00:10] first\n\n' > "$results/segment-000001/gem.md"
    printf '# Gems\n\n' > "$gems"

    run stalker_merge_score_results "$results" "$gems"

    [ "$status" -eq 0 ]
    [ "$output" = "2" ]
    [ "$(grep '^### ' "$gems")" = "### [00:10] first
### [00:40] second" ]
}

@test "stalker_merge_score_results: append failure propagates" {
    results="$TMPDIR_/results"
    mkdir -p "$results/segment-000001"
    printf '### [00:10] first\n\n' > "$results/segment-000001/gem.md"

    run stalker_merge_score_results "$results" "$TMPDIR_/missing/gems.md"

    [ "$status" -ne 0 ]
}

# --- stalker_gems_complete: incomplete/partial gems.md re-score detection ---

@test "stalker_gems_complete: complete gems.md (gems + Scored footer) is complete" {
    f="$TMPDIR_/gems.md"
    printf '# Gems\n\n### [01:23] Funny moment\n**Score:** 8/10\n\n---\nGems found: 1\nScored: Wed Jul 23 2026\n' > "$f"
    run stalker_gems_complete "$f"
    [ "$status" -eq 0 ]
}

@test "stalker_gems_complete: partial gems.md (gems but NO footer) is incomplete" {
    # The salvage bug: scorer killed mid-stream, gems.md has real gems but no
    # completion footer. Must be treated as incomplete so scoring re-runs.
    f="$TMPDIR_/gems.md"
    printf '# Gems\n\n### [01:23] Funny moment\n**Score:** 8/10\n\n### [04:56] Rage clip\n**Score:** 9/10\n' > "$f"
    run stalker_gems_complete "$f"
    [ "$status" -ne 0 ]
}

@test "stalker_gems_complete: header-only gems.md (no gems) is incomplete" {
    f="$TMPDIR_/gems.md"
    printf '# Gems: theo (2026-07-23)\n\n' > "$f"
    run stalker_gems_complete "$f"
    [ "$status" -ne 0 ]
}

@test "stalker_gems_complete: missing file is incomplete" {
    run stalker_gems_complete "$TMPDIR_/does-not-exist.md"
    [ "$status" -ne 0 ]
}

@test "stalker_gems_complete: footer present but no gem entries is incomplete" {
    # Defensive: a footer without any '### [' gem lines shouldn't count complete.
    f="$TMPDIR_/gems.md"
    printf '# Gems\n\n---\nGems found: 0\nScored: Wed Jul 23 2026\n' > "$f"
    run stalker_gems_complete "$f"
    [ "$status" -ne 0 ]
}
