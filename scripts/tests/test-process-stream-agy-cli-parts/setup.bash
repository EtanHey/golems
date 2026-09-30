#!/usr/bin/env bats
# Regression tests for Stalker process-stream gem scoring.
# Run with: bats scripts/tests/test-process-stream-agy-cli.bats

setup() {
    REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
    REAL_PROCESS_STREAM="$REPO_ROOT/scripts/stalker/process-stream.sh"
    TMPDIR_="$(mktemp -d)"
    FAKE_BIN="$TMPDIR_/bin"
    PROCESS_STREAM="$TMPDIR_/process-stream-scoring-only"
    AGY_ARGS_FILE="$TMPDIR_/agy-args.txt"
    CODEX_ARGS_FILE="$TMPDIR_/codex-args.txt"
    CODEX_TIMEOUT_FILE="$TMPDIR_/codex-timeout.txt"
    mkdir -p "$FAKE_BIN"
    mkdir -p "$TMPDIR_/home/Gits/golems"
    : > "$TMPDIR_/home/Gits/golems/.env"
    export AGY_ARGS_FILE CODEX_ARGS_FILE CODEX_TIMEOUT_FILE

    # This suite owns scoring behavior only; completion has dedicated tests.
    cat > "$PROCESS_STREAM" <<SH
#!/bin/bash
exec env STALKER_DEFER_DELIVERY=1 "$REAL_PROCESS_STREAM" "\$@"
SH
    chmod +x "$PROCESS_STREAM"

cat > "$FAKE_BIN/agy" <<'SH'
#!/bin/bash
if read -r -t 0.1 inherited_stdin; then
    printf 'agy inherited transcript stdin: %s\n' "$inherited_stdin" >&2
    exit 44
fi
printf '%s\n' "$*" >> "$AGY_ARGS_FILE"
case " $* " in
    *" --model Gemini 3.1 Pro (High) "*) ;;
    *) printf 'expected Gemini 3.1 Pro (High) model\n' >&2; exit 41 ;;
esac
case " $* " in
    *load_backend*|*whisper_print_timings*) printf 'diagnostic noise leaked into scoring prompt\n' >&2; exit 46 ;;
esac
printf '{"score":9,"type":"hype","title":"Spike Chat Goes Wild","summary":"The streamer gets loud and chat explodes around a clear highlight moment."}\n'
SH

    cat > "$FAKE_BIN/ffmpeg" <<'SH'
#!/bin/bash
last_arg=""
for arg in "$@"; do
    last_arg="$arg"
done
mkdir -p "$(dirname "$last_arg")"
printf 'fake clip\n' > "$last_arg"
SH

    cat > "$FAKE_BIN/ffprobe" <<'SH'
#!/bin/bash
printf '60.000000\n'
SH

    chmod +x "$FAKE_BIN/agy" "$FAKE_BIN/ffmpeg" "$FAKE_BIN/ffprobe"
}

teardown() {
    rm -rf "$TMPDIR_"
}

mark_stage_done() {
    local dir="$1"
    local stage="$2"
    printf 'done\n' > "$dir/.stage-${stage}.done"
}

make_scoring_fixture() {
    local dir="${1:-$TMPDIR_/examplechannel-2026-06-25-040516}"
    local video_name="${2:-video.mp4}"
    mkdir -p "$dir/frames" "$dir/clips"
    printf 'fake video\n' > "$dir/$video_name"
    printf 'fake audio\n' > "$dir/full-audio.wav"
    printf '0.0\n' > "$dir/silences.txt"
    printf '10 0.900000\n20 0.100000\n' > "$dir/volume-per-10s.txt"
    printf '# Average RMS: 0.100000  Threshold: 0.130000\n10 0.900000 9.0x [00:10]\n' > "$dir/volume-spikes.txt"
    printf '# Chat velocity (msgs per 10s) | avg: 1.0\n10 5 [00:10] stream=10 [00:10] <<<\n' > "$dir/chat-velocity.txt"
    printf '# Combined Signals\n\n## Transcript\nfixture\n' > "$dir/signals-combined.md"
    printf '[04:05:00] viewer: fixture chat\n' > "$dir/chat.log"
    cat > "$dir/transcript.md" <<'EOF'
# Stream Transcript: examplechannel (2026-06-25)

## [00:10] Segment 1 (30s)

load_backend: loaded BLAS backend from /opt/homebrew/libexec/libggml-blas.so
main: processing '/tmp/segment-001.wav' (480000 samples, 30.0 sec), 4 threads, timestamps = 0 ...
The streamer gets loud, chat explodes, and a clear highlight moment happens here.
whisper_print_timings: total time = 123.45 ms

## [00:40] Segment 2 (30s)

This is a normal quiet moment.
EOF

    mark_stage_done "$dir" "1a-audio"
    mark_stage_done "$dir" "1b-silences"
    mark_stage_done "$dir" "1c-volume"
    mark_stage_done "$dir" "1d-spikes"
    mark_stage_done "$dir" "1e-transcript"
    mark_stage_done "$dir" "2-frames"
    mark_stage_done "$dir" "3-signals"
    printf '%s\n' "$dir"
}

assert_stream_labels() {
    local dir="$1"
    local streamer="$2"
    local date="$3"

    grep -F -q "# Gems: ${streamer} (${date})" "$dir/gems.md"
    grep -F -q "\"streamer\": \"${streamer}\"" "$dir/gems-manifest.json"
    grep -F -q "\"date\": \"${date}\"" "$dir/gems-manifest.json"
}

make_long_segment_fixture() {
    local dir="$TMPDIR_/examplechannel-2026-06-25-050000"
    mkdir -p "$dir/frames" "$dir/clips"
    printf 'fake video\n' > "$dir/video.mp4"
    printf 'fake audio\n' > "$dir/full-audio.wav"
    printf '0.0\n' > "$dir/silences.txt"
    printf '20 0.900000\n' > "$dir/volume-per-10s.txt"
    printf '# Average RMS: 0.100000  Threshold: 0.130000\n20 0.900000 9.0x [00:20]\n' > "$dir/volume-spikes.txt"
    printf '# Chat velocity (msgs per 10s) | avg: 1.0\n' > "$dir/chat-velocity.txt"
    printf '# Combined Signals\n\n## Transcript\nfixture\n' > "$dir/signals-combined.md"
    printf '[04:05:00] viewer: fixture chat\n' > "$dir/chat.log"
    cat > "$dir/transcript.md" <<'EOF'
# Stream Transcript: examplechannel (2026-06-25)

## [00:00] Segment 1 (60s)

The highlight happens twenty seconds into this long segment, not at the segment start.
EOF

    mark_stage_done "$dir" "1a-audio"
    mark_stage_done "$dir" "1b-silences"
    mark_stage_done "$dir" "1c-volume"
    mark_stage_done "$dir" "1d-spikes"
    mark_stage_done "$dir" "1e-transcript"
    mark_stage_done "$dir" "2-frames"
    mark_stage_done "$dir" "3-signals"
    printf '%s\n' "$dir"
}

make_no_candidate_fixture() {
    local dir="$TMPDIR_/examplechannel-2026-06-25-060000"
    mkdir -p "$dir/frames" "$dir/clips"
    printf 'fake video\n' > "$dir/video.mp4"
    printf 'fake audio\n' > "$dir/full-audio.wav"
    printf '0.0\n' > "$dir/silences.txt"
    printf '10 0.100000\n20 0.100000\n' > "$dir/volume-per-10s.txt"
    printf '# Average RMS: 0.100000  Threshold: 0.130000\n' > "$dir/volume-spikes.txt"
    printf '# Chat velocity (msgs per 10s) | avg: 1.0\n' > "$dir/chat-velocity.txt"
    printf '# Combined Signals\n\n## Transcript\nfixture\n' > "$dir/signals-combined.md"
    printf '[04:05:00] viewer: fixture chat\n' > "$dir/chat.log"
    cat > "$dir/transcript.md" <<'EOF'
# Stream Transcript: examplechannel (2026-06-25)

## [00:10] Segment 1 (30s)

This segment has no nearby volume or chat spike and should not be scored.
EOF

    mark_stage_done "$dir" "1a-audio"
    mark_stage_done "$dir" "1b-silences"
    mark_stage_done "$dir" "1c-volume"
    mark_stage_done "$dir" "1d-spikes"
    mark_stage_done "$dir" "1e-transcript"
    mark_stage_done "$dir" "2-frames"
    mark_stage_done "$dir" "3-signals"
    printf '%s\n' "$dir"
}

make_volume_spike_beyond_top20_fixture() {
    local dir="$TMPDIR_/examplechannel-2026-06-25-063000"
    mkdir -p "$dir/frames" "$dir/clips"
    printf 'fake video\n' > "$dir/video.mp4"
    printf 'fake audio\n' > "$dir/full-audio.wav"
    printf '0.0\n' > "$dir/silences.txt"
    : > "$dir/volume-per-10s.txt"
    for t in $(seq 0 10 990); do
        printf '%s 0.100000\n' "$t" >> "$dir/volume-per-10s.txt"
    done
    for t in $(seq 10 10 250); do
        printf '%s 0.900000\n' "$t" >> "$dir/volume-per-10s.txt"
    done
    {
        printf '# Average RMS: 0.260000  Threshold: 0.338000\n'
        for t in $(seq 10 10 200); do
            mins=$((t / 60))
            secs=$((t % 60))
            printf '%s 0.900000 3.5x [%02d:%02d]\n' "$t" "$mins" "$secs"
        done
    } > "$dir/volume-spikes.txt"
    printf '# Chat velocity (msgs per 10s) | avg: 1.0\n' > "$dir/chat-velocity.txt"
    printf '# Combined Signals\n\n## Transcript\nfixture\n' > "$dir/signals-combined.md"
    printf '[04:05:00] viewer: fixture chat\n' > "$dir/chat.log"
    cat > "$dir/transcript.md" <<'EOF'
# Stream Transcript: examplechannel (2026-06-25)

## [03:40] Segment 1 (20s)

This highlight sits beyond the saved top twenty volume spikes.
EOF

    mark_stage_done "$dir" "1a-audio"
    mark_stage_done "$dir" "1b-silences"
    mark_stage_done "$dir" "1c-volume"
    mark_stage_done "$dir" "1d-spikes"
    mark_stage_done "$dir" "1e-transcript"
    mark_stage_done "$dir" "2-frames"
    mark_stage_done "$dir" "3-signals"
    printf '%s\n' "$dir"
}

make_chat_stream_offset_fixture() {
    local dir="$TMPDIR_/examplechannel-2026-06-25-070000"
    mkdir -p "$dir/frames" "$dir/clips"
    printf 'fake video\n' > "$dir/video.mp4"
    printf 'fake audio\n' > "$dir/full-audio.wav"
    printf '0.0\n' > "$dir/silences.txt"
    printf '10 0.100000\n80 0.100000\n' > "$dir/volume-per-10s.txt"
    printf '# Average RMS: 0.100000  Threshold: 0.130000\n' > "$dir/volume-spikes.txt"
    printf '# Chat velocity (msgs per 10s) | avg: 1.0\n50 5 [00:50] stream=80 [01:20] <<<\n' > "$dir/chat-velocity.txt"
    printf '[04:00:01] viewer: fixture chat\n' > "$dir/chat.log"
    printf '# Combined Signals\n\n## Transcript\nfixture\n' > "$dir/signals-combined.md"
    cat > "$dir/transcript.md" <<'EOF'
# Stream Transcript: examplechannel (2026-06-25)

## [01:20] Segment 1 (20s)

Chat spikes at the stream-relative timestamp for this segment.
EOF

    mark_stage_done "$dir" "1a-audio"
    mark_stage_done "$dir" "1b-silences"
    mark_stage_done "$dir" "1c-volume"
    mark_stage_done "$dir" "1d-spikes"
    mark_stage_done "$dir" "1e-transcript"
    mark_stage_done "$dir" "2-frames"
    mark_stage_done "$dir" "3-signals"
    printf '%s\n' "$dir"
}

make_json_relative_chat_fixture() {
    local dir="$TMPDIR_/examplechannel-2026-06-25-070000"
    mkdir -p "$dir/frames" "$dir/clips"
    printf 'fake video\n' > "$dir/video.mp4"
    printf 'fake audio\n' > "$dir/full-audio.wav"
    printf '0.0\n' > "$dir/silences.txt"
    printf '10 0.100000\n80 0.100000\n' > "$dir/volume-per-10s.txt"
    printf '# Average RMS: 0.100000  Threshold: 0.130000\n' > "$dir/volume-spikes.txt"
    cat > "$dir/chat.json" <<'EOF'
[
  {"time_s": 10, "user": "a", "message": "warmup"},
  {"time_s": 20, "user": "b", "message": "still calm"},
  {"time_s": 80, "user": "c", "message": "Pog"},
  {"time_s": 80, "user": "d", "message": "Pog"},
  {"time_s": 80, "user": "e", "message": "Pog"},
  {"time_s": 80, "user": "f", "message": "Pog"},
  {"time_s": 80, "user": "g", "message": "Pog"}
]
EOF
    cat > "$dir/transcript.md" <<'EOF'
# Stream Transcript: examplechannel (2026-06-25)

## [01:20] Segment 1 (20s)

Chat spikes at the JSON stream-relative timestamp for this segment.
EOF

    mark_stage_done "$dir" "1a-audio"
    mark_stage_done "$dir" "1b-silences"
    mark_stage_done "$dir" "1c-volume"
    mark_stage_done "$dir" "1d-spikes"
    mark_stage_done "$dir" "1e-transcript"
    mark_stage_done "$dir" "2-frames"
    printf '%s\n' "$dir"
}

make_directory_chat_fallback_fixture() {
    local dir="$TMPDIR_/examplechannel-2026-06-25-070000"
    mkdir -p "$dir/frames" "$dir/clips"
    printf 'fake video\n' > "$dir/video.mp4"
    printf 'fake audio\n' > "$dir/full-audio.wav"
    printf '0.0\n' > "$dir/silences.txt"
    printf '10 0.100000\n80 0.100000\n' > "$dir/volume-per-10s.txt"
    printf '# Average RMS: 0.100000  Threshold: 0.130000\n' > "$dir/volume-spikes.txt"
    : > "$dir/chat.log"
    cat > "$dir/chat.txt" <<'EOF'
[00:00:10] a: warmup
[00:00:20] b: still calm
[00:01:20] c: Pog
[00:01:20] d: Pog
[00:01:20] e: Pog
[00:01:20] f: Pog
[00:01:20] g: Pog
EOF
    printf '# Combined Signals\n\n## Transcript\nfixture\n' > "$dir/signals-combined.md"
    cat > "$dir/transcript.md" <<'EOF'
# Stream Transcript: examplechannel (2026-06-25)

## [01:20] Segment 1 (20s)

Chat spikes from the fallback chat.txt file for this segment.
EOF

    mark_stage_done "$dir" "1a-audio"
    mark_stage_done "$dir" "1b-silences"
    mark_stage_done "$dir" "1c-volume"
    mark_stage_done "$dir" "1d-spikes"
    mark_stage_done "$dir" "1e-transcript"
    mark_stage_done "$dir" "2-frames"
    mark_stage_done "$dir" "3-signals"
    printf '%s\n' "$dir"
}

make_stale_chat_velocity_fixture() {
    local dir="$TMPDIR_/examplechannel-2026-06-25-070000"
    mkdir -p "$dir/frames" "$dir/clips"
    printf 'fake video\n' > "$dir/video.mp4"
    printf 'fake audio\n' > "$dir/full-audio.wav"
    printf '0.0\n' > "$dir/silences.txt"
    printf '10 0.100000\n80 0.100000\n' > "$dir/volume-per-10s.txt"
    printf '# Average RMS: 0.100000  Threshold: 0.130000\n' > "$dir/volume-spikes.txt"
    printf '# Chat velocity (msgs per 10s) | avg: 1.0\n50 5 [00:50] <<<\n' > "$dir/chat-velocity.txt"
    cat > "$dir/chat.log" <<'EOF'
[04:00:10] a: warmup
[04:00:20] b: still calm
[04:01:20] c: Pog
[04:01:20] d: Pog
[04:01:20] e: Pog
[04:01:20] f: Pog
[04:01:20] g: Pog
EOF
    printf '# Combined Signals\n\n## Transcript\nfixture\n' > "$dir/signals-combined.md"
    cat > "$dir/transcript.md" <<'EOF'
# Stream Transcript: examplechannel (2026-06-25)

## [01:20] Segment 1 (20s)

Chat spikes at the rebuilt stream-relative timestamp for this segment.
EOF

    mark_stage_done "$dir" "1a-audio"
    mark_stage_done "$dir" "1b-silences"
    mark_stage_done "$dir" "1c-volume"
    mark_stage_done "$dir" "1d-spikes"
    mark_stage_done "$dir" "1e-transcript"
    mark_stage_done "$dir" "2-frames"
    mark_stage_done "$dir" "3-signals"
    printf '%s\n' "$dir"
}

make_missing_chat_velocity_fixture() {
    local dir="$TMPDIR_/examplechannel-2026-06-25-070000"
    mkdir -p "$dir/frames" "$dir/clips"
    printf 'fake video\n' > "$dir/video.mp4"
    printf 'fake audio\n' > "$dir/full-audio.wav"
    printf '0.0\n' > "$dir/silences.txt"
    printf '10 0.100000\n80 0.100000\n' > "$dir/volume-per-10s.txt"
    printf '# Average RMS: 0.100000  Threshold: 0.130000\n' > "$dir/volume-spikes.txt"
    cat > "$dir/chat.log" <<'EOF'
[04:00:10] a: warmup
[04:00:20] b: still calm
[04:01:20] c: Pog
[04:01:20] d: Pog
[04:01:20] e: Pog
[04:01:20] f: Pog
[04:01:20] g: Pog
EOF
    printf '# Combined Signals\n\n## Transcript\nfixture\n' > "$dir/signals-combined.md"
    cat > "$dir/transcript.md" <<'EOF'
# Stream Transcript: examplechannel (2026-06-25)

## [01:20] Segment 1 (20s)

Chat spikes after rerun-only velocity generation for this segment.
EOF

    mark_stage_done "$dir" "1a-audio"
    mark_stage_done "$dir" "1b-silences"
    mark_stage_done "$dir" "1c-volume"
    mark_stage_done "$dir" "1d-spikes"
    mark_stage_done "$dir" "1e-transcript"
    mark_stage_done "$dir" "2-frames"
    mark_stage_done "$dir" "3-signals"
    printf '%s\n' "$dir"
}

make_post_midnight_chat_fixture() {
    local dir="$TMPDIR_/examplechannel-2026-06-25-120000"
    mkdir -p "$dir/frames" "$dir/clips"
    printf 'fake video\n' > "$dir/video.mp4"
    printf 'fake audio\n' > "$dir/full-audio.wav"
    printf '0.0\n' > "$dir/silences.txt"
    printf '10 0.100000\n43800 0.100000\n' > "$dir/volume-per-10s.txt"
    printf '# Average RMS: 0.100000  Threshold: 0.130000\n' > "$dir/volume-spikes.txt"
    cat > "$dir/chat.log" <<'EOF'
[12:00:10] a: warmup
[12:00:20] b: still calm
[00:10:00] c: Pog
[00:10:00] d: Pog
[00:10:00] e: Pog
[00:10:00] f: Pog
[00:10:00] g: Pog
EOF
    printf '# Combined Signals\n\n## Transcript\nfixture\n' > "$dir/signals-combined.md"
    cat > "$dir/transcript.md" <<'EOF'
# Stream Transcript: examplechannel (2026-06-25)

## [12:10:00] Segment 1 (20s)

Chat spikes after UTC midnight for this long-running live stream.
EOF

    mark_stage_done "$dir" "1a-audio"
    mark_stage_done "$dir" "1b-silences"
    mark_stage_done "$dir" "1c-volume"
    mark_stage_done "$dir" "1d-spikes"
    mark_stage_done "$dir" "1e-transcript"
    mark_stage_done "$dir" "2-frames"
    printf '%s\n' "$dir"
}

make_multi_day_chat_fixture() {
    local dir="$TMPDIR_/examplechannel-2026-06-25-120000"
    mkdir -p "$dir/frames" "$dir/clips"
    printf 'fake video\n' > "$dir/video.mp4"
    printf 'fake audio\n' > "$dir/full-audio.wav"
    printf '0.0\n' > "$dir/silences.txt"
    printf '10 0.100000\n151200 0.100000\n' > "$dir/volume-per-10s.txt"
    printf '# Average RMS: 0.100000  Threshold: 0.130000\n' > "$dir/volume-spikes.txt"
    cat > "$dir/chat.log" <<'EOF'
[12:00:10] a: warmup
[23:59:50] b: still here
[00:00:10] c: crossed midnight
[23:59:50] d: still going
[00:00:10] e: crossed midnight again
[06:00:00] f: Pog
[06:00:00] g: Pog
[06:00:00] h: Pog
[06:00:00] i: Pog
[06:00:00] j: Pog
EOF
    printf '# Combined Signals\n\n## Transcript\nfixture\n' > "$dir/signals-combined.md"
    cat > "$dir/transcript.md" <<'EOF'
# Stream Transcript: examplechannel (2026-06-25)

## [42:00:00] Segment 1 (20s)

Chat spikes forty-two hours into this multi-day live stream.
EOF

    mark_stage_done "$dir" "1a-audio"
    mark_stage_done "$dir" "1b-silences"
    mark_stage_done "$dir" "1c-volume"
    mark_stage_done "$dir" "1d-spikes"
    mark_stage_done "$dir" "1e-transcript"
    mark_stage_done "$dir" "2-frames"
    printf '%s\n' "$dir"
}

make_two_candidate_fixture() {
    local dir
    dir="$(make_scoring_fixture)"
    printf '# Average RMS: 0.100000  Threshold: 0.130000\n10 0.900000 9.0x [00:10]\n40 0.900000 9.0x [00:40]\n' > "$dir/volume-spikes.txt"
    printf '%s\n' "$dir"
}

make_parallel_candidate_fixture() {
    local dir
    dir="$(make_scoring_fixture)"
    printf '# Average RMS: 0.100000  Threshold: 0.130000\n10 0.900000 9.0x [00:10]\n40 0.900000 9.0x [00:40]\n70 0.900000 9.0x [01:10]\n100 0.900000 9.0x [01:40]\n130 0.900000 9.0x [02:10]\n' > "$dir/volume-spikes.txt"
    cat > "$dir/transcript.md" <<'EOF'
# Stream Transcript: examplechannel (2026-06-25)

## [00:10] Segment 1 (20s)

parallel segment ONE finishes last.

## [00:40] Segment 2 (20s)

parallel segment TWO finishes third.

## [01:10] Segment 3 (20s)

parallel segment THREE finishes second.

## [01:40] Segment 4 (20s)

parallel segment FOUR finishes first.

## [02:10] Segment 5 (20s)

parallel segment FIVE fills the first completed slot.
EOF
    printf '%s\n' "$dir"
}

install_timed_parallel_agy() {
    cat > "$FAKE_BIN/agy" <<'SH'
#!/bin/bash
lock="$PARALLEL_STATE_DIR/lock"
while ! mkdir "$lock" 2>/dev/null; do
    sleep 0.01
done
active=$(cat "$PARALLEL_STATE_DIR/active" 2>/dev/null || echo 0)
active=$((active + 1))
printf '%s\n' "$active" > "$PARALLEL_STATE_DIR/active"
maximum=$(cat "$PARALLEL_STATE_DIR/max" 2>/dev/null || echo 0)
[ "$active" -le "$maximum" ] || printf '%s\n' "$active" > "$PARALLEL_STATE_DIR/max"
rmdir "$lock"

case "$*" in
    *"segment ONE"*) label="ONE"; delay=0.5; title="First Finishes Last" ;;
    *"segment TWO"*) label="TWO"; delay=0.1; title="Second Frees First Slot" ;;
    *"segment THREE"*) label="THREE"; delay=0.2; title="Third Finishes After Second" ;;
    *"segment FOUR"*) label="FOUR"; delay=0.3; title="Fourth Finishes Before First" ;;
    *"segment FIVE"*) label="FIVE"; delay=0.1; title="Fifth Uses Completed Slot" ;;
    *) label="UNKNOWN"; delay=0.1; title="Unknown Segment" ;;
esac
printf 'start:%s\n' "$label" >> "$PARALLEL_STATE_DIR/events"
sleep "$delay"
printf 'finish:%s\n' "$label" >> "$PARALLEL_STATE_DIR/events"

while ! mkdir "$lock" 2>/dev/null; do
    sleep 0.01
done
active=$(cat "$PARALLEL_STATE_DIR/active")
printf '%s\n' $((active - 1)) > "$PARALLEL_STATE_DIR/active"
rmdir "$lock"

printf '{"score":9,"type":"hype","title":"%s","summary":"A deterministic parallel scoring fixture completes out of order."}\n' "$title"
SH
    chmod +x "$FAKE_BIN/agy"
}

make_parallel_circuit_fixture() {
    local dir
    dir="$(make_scoring_fixture)"
    : > "$dir/volume-spikes.txt"
    printf '# Average RMS: 0.100000  Threshold: 0.130000\n' > "$dir/volume-spikes.txt"
    : > "$dir/transcript.md"
    printf '# Stream Transcript: examplechannel (2026-06-25)\n\n' > "$dir/transcript.md"
    local index timestamp
    for index in 1 2 3 4 5 6 7 8; do
        timestamp=$((index * 30))
        printf '%s 0.900000 9.0x\n' "$timestamp" >> "$dir/volume-spikes.txt"
        printf '## [%02d:%02d] Segment %s (20s)\n\nparallel circuit candidate %s.\n\n' \
            $((timestamp / 60)) $((timestamp % 60)) "$index" "$index" >> "$dir/transcript.md"
    done
    printf '%s\n' "$dir"
}

install_failing_parallel_agy_with_codex_fallback() {
    cat > "$FAKE_BIN/agy" <<'SH'
#!/bin/bash
lock="${AGY_CALLS_FILE}.lock"
while ! mkdir "$lock" 2>/dev/null; do
    sleep 0.01
done
calls=$(cat "$AGY_CALLS_FILE" 2>/dev/null || echo 0)
printf '%s\n' $((calls + 1)) > "$AGY_CALLS_FILE"
rmdir "$lock"
sleep 0.15
printf 'agy unavailable\n' >&2
exit 9
SH

    cat > "$FAKE_BIN/codex" <<'SH'
#!/bin/bash
out_file=""
while [ "$#" -gt 0 ]; do
    if [ "$1" = "--output-last-message" ]; then
        shift
        out_file="$1"
        break
    fi
    shift || true
done
[ -n "$out_file" ] || exit 44
printf '{"score":8,"type":"reaction","title":"Circuit Fallback Scores Segment","summary":"The shared circuit routes this candidate through the codex fallback."}\n' > "$out_file"
SH
    chmod +x "$FAKE_BIN/agy" "$FAKE_BIN/codex"
}

install_blocking_agy() {
    cat > "$FAKE_BIN/agy" <<'SH'
#!/bin/bash
printf '%s %s\n' "$PPID" "$$" > "$SCORER_PIDS_FILE"
while :; do
    sleep 1
done
SH

    cat > "$FAKE_BIN/ps" <<'SH'
#!/bin/bash
case "$*" in
    *"-o lstart="*) printf 'Thu Aug 20 01:00:00 2026\n' ;;
    *)
        if [ -s "$SCORER_PIDS_FILE" ]; then
            read -r worker_pid scorer_pid < "$SCORER_PIDS_FILE"
            printf '%s %s\n' "$scorer_pid" "$worker_pid"
        fi
        ;;
esac
SH

    cat > "$FAKE_BIN/codex" <<'SH'
#!/bin/bash
exit 1
SH
    chmod +x "$FAKE_BIN/agy" "$FAKE_BIN/codex" "$FAKE_BIN/ps"
}

