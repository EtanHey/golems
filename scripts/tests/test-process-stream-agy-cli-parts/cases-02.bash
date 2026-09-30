function split_case_025() {
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

function split_case_026() {
    stream_dir="$(make_scoring_fixture)"
    cat > "$stream_dir/transcript.md" <<'EOF'
# Stream Transcript: examplechannel (2026-06-25)

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

function split_case_027() {
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

function split_case_028() {
    stream_dir="$(make_scoring_fixture)"
    cat > "$stream_dir/transcript.md" <<'EOF'
# Stream Transcript: examplechannel (2026-06-25)

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
    [[ "$output" == *"no transcript text after cleaning diagnostics"* ]] || false
    [ -f "$stream_dir/.stage-scoring.failed" ]
}

function split_case_029() {
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
    [[ "$output" == *"No candidate segments near spikes; removed empty gems.md so retry can run after signal/window changes"* ]] || false
    [ -f "$stream_dir/.stage-run-quality.failed" ]
}

function split_case_030() {
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
    [[ "$output" == *"Pass 0: gems.md is incomplete (no completion footer / partial scoring) — removing so scoring re-runs"* ]] || false
    [ ! -f "$stream_dir/.stage-run-quality.failed" ]
}

function split_case_031() {
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
    [[ "$output" == *"Auto-scoring had 1 failed candidate segment(s); removed incomplete gems.md so retry can run"* ]] || false
    [ -f "$stream_dir/.stage-scoring.failed" ]
    grep -F -q 'retryable=true' "$stream_dir/.stage-scoring.failed"
}

function split_case_032() {
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
    [[ "$output" == *"agy failed"* ]] || false
    [[ "$output" == *"codex exec fallback scored segment after agy failure"* ]] || false
    grep -F -x -q -- '-m' "$CODEX_ARGS_FILE"
    grep -F -x -q 'gpt-5.6-sol' "$CODEX_ARGS_FILE"
    grep -F -x -q -- '-c' "$CODEX_ARGS_FILE"
    grep -F -x -q 'model_reasoning_effort=low' "$CODEX_ARGS_FILE"
    [ "$(cat "$CODEX_TIMEOUT_FILE")" = "120s" ]
}

function split_case_033() {
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

function split_case_034() {
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
    [[ "$output" == *"codex exec fallback timed out after 7s"* ]] || false
    [[ "$output" == *"scoring failure counted for [00:10] Segment 1 (30s)"* ]] || false
    [ -f "$stream_dir/.stage-scoring.failed" ]
    grep -F -q 'available scorers failed for 1 candidate segment(s)' "$stream_dir/.stage-scoring.failed"
}

function split_case_035() {
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

function split_case_036() {
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
    [[ "$output" == *"Auto-scoring failed for all candidate segments; removed incomplete gems.md so retry can run"* ]] || false
    [ -f "$stream_dir/.stage-scoring.failed" ]
    grep -F -q 'retryable=true' "$stream_dir/.stage-scoring.failed"
}
