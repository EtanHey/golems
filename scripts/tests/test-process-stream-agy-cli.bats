#!/usr/bin/env bats
# Regression tests for Stalker process-stream gem scoring.
# Run with: bats scripts/tests/test-process-stream-agy-cli.bats

setup() {
    REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
    PROCESS_STREAM="$REPO_ROOT/scripts/process-stream.sh"
    TMPDIR_="$(mktemp -d)"
    FAKE_BIN="$TMPDIR_/bin"
    AGY_ARGS_FILE="$TMPDIR_/agy-args.txt"
    CODEX_ARGS_FILE="$TMPDIR_/codex-args.txt"
    CODEX_TIMEOUT_FILE="$TMPDIR_/codex-timeout.txt"
    mkdir -p "$FAKE_BIN"
    mkdir -p "$TMPDIR_/home/Gits/golems"
    : > "$TMPDIR_/home/Gits/golems/.env"
    export AGY_ARGS_FILE CODEX_ARGS_FILE CODEX_TIMEOUT_FILE

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
    local dir="${1:-$TMPDIR_/theo-2026-06-25-040516}"
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
# Stream Transcript: theo (2026-06-25)

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
    local dir="$TMPDIR_/theo-2026-06-25-050000"
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
# Stream Transcript: theo (2026-06-25)

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
    local dir="$TMPDIR_/theo-2026-06-25-060000"
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
# Stream Transcript: theo (2026-06-25)

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
    local dir="$TMPDIR_/theo-2026-06-25-063000"
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
# Stream Transcript: theo (2026-06-25)

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
    local dir="$TMPDIR_/theo-2026-06-25-070000"
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
# Stream Transcript: theo (2026-06-25)

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
    local dir="$TMPDIR_/theo-2026-06-25-070000"
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
# Stream Transcript: theo (2026-06-25)

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
    local dir="$TMPDIR_/theo-2026-06-25-070000"
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
# Stream Transcript: theo (2026-06-25)

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
    local dir="$TMPDIR_/theo-2026-06-25-070000"
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
# Stream Transcript: theo (2026-06-25)

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
    local dir="$TMPDIR_/theo-2026-06-25-070000"
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
# Stream Transcript: theo (2026-06-25)

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
    local dir="$TMPDIR_/theo-2026-06-25-120000"
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
# Stream Transcript: theo (2026-06-25)

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
    local dir="$TMPDIR_/theo-2026-06-25-120000"
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
# Stream Transcript: theo (2026-06-25)

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
# Stream Transcript: theo (2026-06-25)

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
    printf '# Stream Transcript: theo (2026-06-25)\n\n' > "$dir/transcript.md"
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

@test "process-stream defaults to four concurrent scorers and merges gems in timestamp order" {
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

@test "process-stream STALKER_SCORE_PARALLEL=1 keeps the serial fallback" {
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

@test "process-stream parallel circuit opens once and stops later agy calls" {
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

@test "process-stream interruption terminates active scorer workers before cleanup" {
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

@test "SIGKILLed scoring is reconciled from its durable start marker and alerts" {
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

@test "process-stream scores Stalker gems with headless agy and no API key" {
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

@test "process-stream labels video.mp4 from recording directory name" {
    stream_dir="$(make_scoring_fixture "$TMPDIR_/theo-2026-06-25-040516" "video.mp4")"

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
    assert_stream_labels "$stream_dir" "theo" "2026-06-25"
}

@test "process-stream keeps legacy twitch channel-date filename labels" {
    stream_dir="$(make_scoring_fixture "$TMPDIR_/legacy" "twitch-theo-2026-06-24.mp4")"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        "$PROCESS_STREAM" "$stream_dir/twitch-theo-2026-06-24.mp4" --json-output

    [ "$status" -eq 0 ]
    [ -f "$stream_dir/gems.md" ]
    [ -f "$stream_dir/gems-manifest.json" ]
    assert_stream_labels "$stream_dir" "theo" "2026-06-24"
}

@test "process-stream fallback labels strip file extensions" {
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

@test "process-stream preserves JSON chat offsets as stream-relative spikes" {
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

@test "process-stream parses stream-relative chat spike times when present" {
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

@test "process-stream rebuilds stale chat velocity before fallback parsing" {
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

@test "process-stream skips empty directory chat log and uses valid fallback chat" {
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

@test "process-stream uses directory chat log for legacy velocity rebuilds" {
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

@test "process-stream generates missing chat velocity before reading spikes" {
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

@test "process-stream advances post-midnight live chat times before clamping" {
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

@test "process-stream tracks live chat day rollovers beyond 24 hours" {
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

@test "process-stream scores volume spikes beyond the saved top 20 display rows" {
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

@test "process-stream ignores echoed prompt JSON and parses scorer response" {
    stream_dir="$(make_scoring_fixture)"

    cat > "$FAKE_BIN/agy" <<'SH'
#!/bin/bash
printf '%s\n' "$*"
printf '{"score":9,"type":"hype","title":"Actual Response Wins","summary":"The parser ignores echoed prompt JSON and keeps the final scorer summary."}\n'
SH
    chmod +x "$FAKE_BIN/agy"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4"

    [ "$status" -eq 0 ]
    [ -f "$stream_dir/gems.md" ]
    grep -F -q '### [00:10] Segment 1 (30s) Actual Response Wins' "$stream_dir/gems.md"
    grep -F -q '**Score:** 9/10 | **Type:** hype' "$stream_dir/gems.md"
    grep -F -q '**Gist:** The parser ignores echoed prompt JSON and keeps the final scorer summary.' "$stream_dir/gems.md"
}

@test "process-stream prefers final scorer JSON over echoed segment JSON" {
    stream_dir="$(make_scoring_fixture)"
    cat > "$stream_dir/transcript.md" <<'EOF'
# Stream Transcript: theo (2026-06-25)

## [00:10] Segment 1 (30s)

The stream shows this config before the actual model answer: {"foo":"bar"}
EOF

    cat > "$FAKE_BIN/agy" <<'SH'
#!/bin/bash
printf '%s\n' "$*"
printf '{"score":9,"type":"hype","title":"Final JSON Wins","summary":"The final scorer JSON wins over JSON-looking transcript text."}\n'
SH
    chmod +x "$FAKE_BIN/agy"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4"

    [ "$status" -eq 0 ]
    [ -f "$stream_dir/gems.md" ]
    grep -F -q 'Final JSON Wins' "$stream_dir/gems.md"
    grep -F -q '**Score:** 9/10 | **Type:** hype' "$stream_dir/gems.md"
}

@test "process-stream passes transcript shell metacharacters literally to scorer" {
    stream_dir="$(make_scoring_fixture)"
    pwned_file="$stream_dir/pwned-by-transcript"
    tmp_transcript="$stream_dir/transcript.tmp"

    awk -v pwned_file="$pwned_file" '
        /clear highlight moment happens here/ {
            print
            print "Literal shell text $(touch " pwned_file ") and `touch " pwned_file "` must stay inert."
            next
        }
        { print }
    ' "$stream_dir/transcript.md" > "$tmp_transcript"
    mv "$tmp_transcript" "$stream_dir/transcript.md"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4"

    [ "$status" -eq 0 ]
    [ -f "$stream_dir/gems.md" ]
    [ ! -e "$pwned_file" ]
}

@test "process-stream skips scorer when diagnostics clean to empty text" {
    stream_dir="$(make_scoring_fixture)"
    cat > "$stream_dir/transcript.md" <<'EOF'
# Stream Transcript: theo (2026-06-25)

## [00:10] Segment 1 (30s)

load_backend: loaded BLAS backend from /opt/homebrew/libexec/libggml-blas.so
main: processing '/tmp/segment-001.wav' (480000 samples, 30.0 sec), 4 threads, timestamps = 0 ...
whisper_print_timings: total time = 123.45 ms
EOF

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4"

    [ "$status" -eq 75 ]
    [ ! -f "$stream_dir/gems.md" ]
    [ ! -s "$AGY_ARGS_FILE" ]
    [[ "$output" == *"no transcript text after cleaning diagnostics"* ]]
    [ -f "$stream_dir/.stage-scoring.failed" ]
}

@test "process-stream does not cache an empty gems file when no candidates are scored" {
    stream_dir="$(make_no_candidate_fixture)"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4"

    [ "$status" -eq 75 ]
    [ ! -f "$stream_dir/gems.md" ]
    [ ! -s "$AGY_ARGS_FILE" ]
    [[ "$output" == *"No candidate segments near spikes; removed empty gems.md so retry can run after signal/window changes"* ]]
    [ -f "$stream_dir/.stage-run-quality.failed" ]
}

@test "process-stream regenerates a header-only gems file when scorers are available" {
    stream_dir="$(make_scoring_fixture)"
    printf '# Gems: interrupted run\n' > "$stream_dir/gems.md"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4"

    [ "$status" -eq 0 ]
    grep -F -q '### [00:10] Segment 1 (30s) Spike Chat Goes Wild' "$stream_dir/gems.md"
    [[ "$output" == *"Removing incomplete gems.md before scorer retry"* ]]
    [ ! -f "$stream_dir/.stage-run-quality.failed" ]
}

@test "process-stream removes incomplete gems file after partial scorer failures" {
    stream_dir="$(make_two_candidate_fixture)"

    cat > "$FAKE_BIN/agy" <<'SH'
#!/bin/bash
lock="${AGY_COUNT_FILE}.lock"
while ! mkdir "$lock" 2>/dev/null; do
    sleep 0.01
done
count=0
[ -f "$AGY_COUNT_FILE" ] && count="$(cat "$AGY_COUNT_FILE")"
count=$((count + 1))
printf '%s\n' "$count" > "$AGY_COUNT_FILE"
rmdir "$lock"
if [ "$count" -eq 1 ]; then
    printf '{"score":9,"type":"hype","title":"First Candidate Scores","summary":"The first candidate scores before the second candidate fails."}\n'
    exit 0
fi
printf 'agy timeout\n' >&2
exit 9
SH

    cat > "$FAKE_BIN/codex" <<'SH'
#!/bin/bash
printf 'codex unavailable\n' >&2
exit 9
SH

    chmod +x "$FAKE_BIN/agy" "$FAKE_BIN/codex"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        AGY_COUNT_FILE="$TMPDIR_/agy-count.txt" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4"

    [ "$status" -eq 75 ]
    [ ! -f "$stream_dir/gems.md" ]
    [[ "$output" == *"Auto-scoring had 1 failed candidate segment(s); removed incomplete gems.md so retry can run"* ]]
    [ -f "$stream_dir/.stage-scoring.failed" ]
    grep -F -q 'retryable=true' "$stream_dir/.stage-scoring.failed"
}

@test "process-stream falls back to codex exec when agy errors" {
    stream_dir="$(make_scoring_fixture)"

cat > "$FAKE_BIN/agy" <<'SH'
#!/bin/bash
if read -r -t 0.1 inherited_stdin; then
    printf 'agy inherited transcript stdin: %s\n' "$inherited_stdin" >&2
    exit 44
fi
printf 'agy auth unavailable\n' >&2
exit 9
SH

    cat > "$FAKE_BIN/codex" <<'SH'
#!/bin/bash
if read -r -t 0.1 inherited_stdin; then
    printf 'codex inherited transcript stdin: %s\n' "$inherited_stdin" >&2
    exit 45
fi
printf '%s\n' "$@" > "$CODEX_ARGS_FILE"
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
printf '{"score":8,"type":"reaction","title":"Fallback Finds The Moment","summary":"The codex fallback identifies the moment after agy fails."}\n' > "$out_file"
SH

    cat > "$FAKE_BIN/timeout" <<'SH'
#!/bin/bash
if [ "$1" = "--kill-after=5s" ]; then
    shift
fi
printf '%s\n' "$1" > "$CODEX_TIMEOUT_FILE"
shift
exec "$@"
SH

    chmod +x "$FAKE_BIN/agy" "$FAKE_BIN/codex" "$FAKE_BIN/timeout"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        CODEX_ARGS_FILE="$CODEX_ARGS_FILE" \
        CODEX_TIMEOUT_FILE="$CODEX_TIMEOUT_FILE" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4"

    [ "$status" -eq 0 ]
    [ -f "$stream_dir/gems.md" ]
    grep -F -q '### [00:10] Segment 1 (30s) Fallback Finds The Moment' "$stream_dir/gems.md"
    grep -F -q '**Score:** 8/10 | **Type:** reaction' "$stream_dir/gems.md"
    grep -F -q '**Gist:** The codex fallback identifies the moment after agy fails.' "$stream_dir/gems.md"
    [[ "$output" == *"agy failed"* ]]
    [[ "$output" == *"codex exec fallback scored segment after agy failure"* ]]
    grep -F -x -q -- '-m' "$CODEX_ARGS_FILE"
    grep -F -x -q 'gpt-5.6-sol' "$CODEX_ARGS_FILE"
    grep -F -x -q -- '-c' "$CODEX_ARGS_FILE"
    grep -F -x -q 'model_reasoning_effort=low' "$CODEX_ARGS_FILE"
    [ "$(cat "$CODEX_TIMEOUT_FILE")" = "120s" ]
}

@test "process-stream passes configured codex model effort and timeout explicitly" {
    stream_dir="$(make_scoring_fixture)"

    cat > "$FAKE_BIN/agy" <<'SH'
#!/bin/bash
exit 9
SH

    cat > "$FAKE_BIN/codex" <<'SH'
#!/bin/bash
printf '%s\n' "$@" > "$CODEX_ARGS_FILE"
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
printf '{"score":8,"type":"reaction","title":"Configured Fallback Scores","summary":"The configured codex fallback returns valid scoring JSON."}\n' > "$out_file"
SH

    cat > "$FAKE_BIN/timeout" <<'SH'
#!/bin/bash
if [ "$1" = "--kill-after=5s" ]; then
    shift
fi
printf '%s\n' "$1" > "$CODEX_TIMEOUT_FILE"
shift
exec "$@"
SH

    chmod +x "$FAKE_BIN/agy" "$FAKE_BIN/codex" "$FAKE_BIN/timeout"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        CODEX_ARGS_FILE="$CODEX_ARGS_FILE" \
        CODEX_TIMEOUT_FILE="$CODEX_TIMEOUT_FILE" \
        STALKER_CODEX_MODEL="configured-test-model" \
        STALKER_CODEX_EFFORT="medium" \
        STALKER_CODEX_TIMEOUT="7s" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4"

    [ "$status" -eq 0 ]
    grep -F -x -q 'configured-test-model' "$CODEX_ARGS_FILE"
    grep -F -x -q 'model_reasoning_effort=medium' "$CODEX_ARGS_FILE"
    [ "$(cat "$CODEX_TIMEOUT_FILE")" = "7s" ]
}

@test "process-stream counts a codex timeout as a loud scoring failure" {
    stream_dir="$(make_scoring_fixture)"

    cat > "$FAKE_BIN/agy" <<'SH'
#!/bin/bash
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
printf '{"score":8,"type":"reaction","title":"Unbounded Call Succeeds","summary":"This succeeds only when the deadline wrapper is bypassed."}\n' > "$out_file"
SH

    cat > "$FAKE_BIN/timeout" <<'SH'
#!/bin/bash
if [ "$1" = "--kill-after=5s" ]; then
    shift
fi
printf '%s\n' "$1" > "$CODEX_TIMEOUT_FILE"
exit 124
SH

    chmod +x "$FAKE_BIN/agy" "$FAKE_BIN/codex" "$FAKE_BIN/timeout"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        CODEX_TIMEOUT_FILE="$CODEX_TIMEOUT_FILE" \
        STALKER_CODEX_TIMEOUT="7s" \
        STALKER_SCORE_PARALLEL=1 \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4"

    [ "$status" -eq 75 ]
    [ ! -f "$stream_dir/gems.md" ]
    [ "$(cat "$CODEX_TIMEOUT_FILE")" = "7s" ]
    [[ "$output" == *"codex exec fallback timed out after 7s"* ]]
    [[ "$output" == *"scoring failure counted for [00:10] Segment 1 (30s)"* ]]
    [ -f "$stream_dir/.stage-scoring.failed" ]
    grep -F -q 'available scorers failed for 1 candidate segment(s)' "$stream_dir/.stage-scoring.failed"
}

@test "process-stream scores spikes that occur inside long transcript segments" {
    stream_dir="$(make_long_segment_fixture)"

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
    grep -F -q '### [00:00] Segment 1 (60s) Spike Chat Goes Wild' "$stream_dir/gems.md"
    grep -F -q '**Volume spike:** yes' "$stream_dir/gems.md"
    grep -F -q 'Candidate segments scored: 1' "$stream_dir/gems.md"
}

@test "process-stream removes incomplete gems file when all candidate scoring fails" {
    stream_dir="$(make_scoring_fixture)"

    cat > "$FAKE_BIN/agy" <<'SH'
#!/bin/bash
printf 'agy unavailable\n' >&2
exit 9
SH

    cat > "$FAKE_BIN/codex" <<'SH'
#!/bin/bash
printf 'codex unavailable\n' >&2
exit 9
SH

    chmod +x "$FAKE_BIN/agy" "$FAKE_BIN/codex"

    run env -i \
        PATH="$FAKE_BIN:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
        HOME="$TMPDIR_/home" \
        AGY_ARGS_FILE="$AGY_ARGS_FILE" \
        STALKER_TELEGRAM_NOTIFY=0 \
        STREAM_WHATSAPP_NOTIFY=0 \
        "$PROCESS_STREAM" "$stream_dir/video.mp4"

    [ "$status" -eq 75 ]
    [ ! -f "$stream_dir/gems.md" ]
    [[ "$output" == *"Auto-scoring failed for all candidate segments; removed incomplete gems.md so retry can run"* ]]
    [ -f "$stream_dir/.stage-scoring.failed" ]
    grep -F -q 'retryable=true' "$stream_dir/.stage-scoring.failed"
}
