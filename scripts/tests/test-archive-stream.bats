#!/usr/bin/env bats
# Smoke tests for deterministic Stalker Golem Drive archive behavior.
# Run with: bats scripts/tests/test-archive-stream.bats

setup() {
    REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
    ARCHIVE_STREAM="$REPO_ROOT/scripts/archive-stream.sh"
    TMPDIR_="$(mktemp -d)"
    FAKE_BIN="$TMPDIR_/bin"
    DRIVE_ROOT="$TMPDIR_/Brain Drive"
    mkdir -p "$FAKE_BIN" "$DRIVE_ROOT"

    cat > "$FAKE_BIN/ffprobe" <<'SH'
#!/bin/bash
printf '42.000000\n'
SH

    cat > "$FAKE_BIN/claude" <<'SH'
#!/bin/bash
printf 'claude should not be part of archive-stream Phase 4\n' >&2
exit 0
SH

    chmod +x "$FAKE_BIN/ffprobe" "$FAKE_BIN/claude"
}

teardown() {
    rm -rf "$TMPDIR_"
}

make_stream_dir() {
    local dir="$TMPDIR_/theo-2026-06-18-005309"
    mkdir -p "$dir/frames"
    printf 'original video fixture\n' > "$dir/video.mp4"
    printf 'compressed video fixture\n' > "$dir/video-compressed.mp4"
    printf 'audio fixture\n' > "$dir/full-audio.wav"
    printf '# Transcript\nhello\n' > "$dir/transcript.md"
    printf '# Signals\nsignal\n' > "$dir/signals-combined.md"
    printf 'silence data\n' > "$dir/silences.txt"
    printf 'volume data\n' > "$dir/volume-per-10s.txt"
    printf 'spike data\n' > "$dir/volume-spikes.txt"
    printf 'quiet frame data\n' > "$dir/quiet-frames.txt"
    printf 'chat data\n' > "$dir/chat.log"
    printf 'frame fixture\n' > "$dir/frames/000001.jpg"
    printf '%s\n' "$dir"
}

make_minimal_stream_dir() {
    local dir="$TMPDIR_/theo-2026-06-18-005309"
    mkdir -p "$dir"
    printf 'original video fixture\n' > "$dir/video.mp4"
    printf 'compressed video fixture\n' > "$dir/video-compressed.mp4"
    printf '%s\n' "$dir"
}

@test "archive-stream copies tiny fixtures to Drive and writes deterministic ledger with no-delete" {
    stream_dir="$(make_stream_dir)"

    PATH="$FAKE_BIN:$PATH" \
    STALKER_BRAIN_DRIVE_ROOT="$DRIVE_ROOT" \
    run "$ARCHIVE_STREAM" "$stream_dir" --no-compress --no-delete

    [ "$status" -eq 0 ]
    target="$DRIVE_ROOT/06_ARCHIVE/stalker-golem/theo/2026-06-18-005309"
    [ -f "$target/video.mp4" ]
    [ -f "$target/video-compressed.mp4" ]
    [ -f "$target/full-audio.wav" ]
    [ -f "$target/frames/000001.jpg" ]
    [ -f "$stream_dir/_DRIVE-LEDGER.md" ]
    [ -f "$target/_DRIVE-LEDGER.md" ]
    cmp "$stream_dir/video.mp4" "$target/video.mp4"
    cmp "$stream_dir/video-compressed.mp4" "$target/video-compressed.mp4"
    cmp "$stream_dir/_DRIVE-LEDGER.md" "$target/_DRIVE-LEDGER.md"
    grep -F -q '| video.mp4 |' "$stream_dir/_DRIVE-LEDGER.md"
    grep -F -q '| video-compressed.mp4 |' "$stream_dir/_DRIVE-LEDGER.md"
    grep -F -q '| full-audio.wav |' "$stream_dir/_DRIVE-LEDGER.md"
    grep -E -q '\| video\.mp4 \| [0-9]+ \| [a-f0-9]{64} \|' "$stream_dir/_DRIVE-LEDGER.md"
    [[ "$output" != *"claude"* ]]
    [ -f "$stream_dir/video.mp4" ]
    [ -f "$stream_dir/video-compressed.mp4" ]
    [ -f "$stream_dir/full-audio.wav" ]
}

@test "archive-stream preserves originals when Drive root is not a directory even if cleanup would otherwise run" {
    stream_dir="$(make_stream_dir)"
    bad_drive_root="$TMPDIR_/not-a-directory"
    printf 'not a directory\n' > "$bad_drive_root"

    PATH="$FAKE_BIN:$PATH" \
    STALKER_BRAIN_DRIVE_ROOT="$bad_drive_root" \
    run "$ARCHIVE_STREAM" "$stream_dir" --no-compress

    [ "$status" -ne 0 ]
    [ -f "$stream_dir/video.mp4" ]
    [ -f "$stream_dir/video-compressed.mp4" ]
    [ -f "$stream_dir/full-audio.wav" ]
    [ ! -f "$stream_dir/_DRIVE-LEDGER.md" ]
}

@test "archive-stream refuses to overwrite an existing Drive artifact with a different checksum" {
    stream_dir="$(make_stream_dir)"
    target="$DRIVE_ROOT/06_ARCHIVE/stalker-golem/theo/2026-06-18-005309"
    mkdir -p "$target"
    printf 'archived original video fixture\n' > "$target/video.mp4"

    PATH="$FAKE_BIN:$PATH" \
    STALKER_BRAIN_DRIVE_ROOT="$DRIVE_ROOT" \
    run "$ARCHIVE_STREAM" "$stream_dir" --no-compress --no-delete

    [ "$status" -ne 0 ]
    [ "$(cat "$target/video.mp4")" = "archived original video fixture" ]
    [ ! -f "$stream_dir/_DRIVE-LEDGER.md" ]
}

@test "archive-stream rerun preserves Drive original when local video mp4 is post-cleanup compressed cache" {
    stream_dir="$(make_minimal_stream_dir)"
    target="$DRIVE_ROOT/06_ARCHIVE/stalker-golem/theo/2026-06-18-005309"
    mkdir -p "$target"
    printf 'archived original video fixture\n' > "$target/video.mp4"
    printf 'compressed video fixture\n' > "$target/video-compressed.mp4"
    printf 'compressed video fixture\n' > "$stream_dir/video.mp4"
    rm "$stream_dir/video-compressed.mp4"
    printf 'late sidecar\n' > "$stream_dir/late-sidecar.txt"

    PATH="$FAKE_BIN:$PATH" \
    STALKER_BRAIN_DRIVE_ROOT="$DRIVE_ROOT" \
    run "$ARCHIVE_STREAM" "$stream_dir" --no-compress --no-delete

    [ "$status" -eq 0 ]
    [ "$(cat "$target/video.mp4")" = "archived original video fixture" ]
    [ "$(cat "$target/video-compressed.mp4")" = "compressed video fixture" ]
    [ "$(cat "$target/late-sidecar.txt")" = "late sidecar" ]
    [ -f "$stream_dir/_DRIVE-LEDGER.md" ]
    grep -F -q '| video.mp4 |' "$stream_dir/_DRIVE-LEDGER.md"
    grep -F -q '| late-sidecar.txt |' "$stream_dir/_DRIVE-LEDGER.md"
}

@test "archive-stream removes pending local ledger when Drive ledger copy fails" {
    stream_dir="$(make_stream_dir)"
    fail_cp_bin="$TMPDIR_/fail-cp-bin"
    mkdir -p "$fail_cp_bin"
    cat > "$fail_cp_bin/cp" <<'SH'
#!/bin/bash
last_arg=""
for arg in "$@"; do
    last_arg="$arg"
done

case "$last_arg" in
    */_DRIVE-LEDGER.md)
        exit 9
        ;;
esac

/bin/cp "$@"
SH
    chmod +x "$fail_cp_bin/cp"

    PATH="$fail_cp_bin:$FAKE_BIN:$PATH" \
    STALKER_BRAIN_DRIVE_ROOT="$DRIVE_ROOT" \
    run "$ARCHIVE_STREAM" "$stream_dir" --no-compress --no-delete

    [ "$status" -ne 0 ]
    [ ! -f "$stream_dir/_DRIVE-LEDGER.md" ]
    [ ! -f "$DRIVE_ROOT/06_ARCHIVE/stalker-golem/theo/2026-06-18-005309/_DRIVE-LEDGER.md" ]
    [ -f "$stream_dir/video.mp4" ]
    [ -f "$stream_dir/video-compressed.mp4" ]
}

@test "archive-stream keeps notifying path successful when cleanup re-verification fails" {
    stream_dir="$(make_minimal_stream_dir)"
    flaky_hash_bin="$TMPDIR_/flaky-hash-bin"
    sentinel="$TMPDIR_/ledger-verified"
    mkdir -p "$flaky_hash_bin"
    cat > "$flaky_hash_bin/shasum" <<'SH'
#!/bin/bash
last_arg=""
for arg in "$@"; do
    last_arg="$arg"
done

case "$last_arg" in
    */_DRIVE-LEDGER.md)
        : > "$SHASUM_SENTINEL"
        ;;
esac

if [ -f "$SHASUM_SENTINEL" ]; then
    case "$last_arg" in
        "$HASH_DRIVE_ROOT"/06_ARCHIVE/stalker-golem/theo/2026-06-18-005309/video.mp4)
            printf '0000000000000000000000000000000000000000000000000000000000000000  %s\n' "$last_arg"
            exit 0
            ;;
    esac
fi

/usr/bin/shasum "$@"
SH
    chmod +x "$flaky_hash_bin/shasum"

    PATH="$flaky_hash_bin:$FAKE_BIN:$PATH" \
    STALKER_BRAIN_DRIVE_ROOT="$DRIVE_ROOT" \
    STALKER_ARCHIVE_VERIFY_TIMEOUT_SECONDS=0 \
    SHASUM_SENTINEL="$sentinel" \
    HASH_DRIVE_ROOT="$DRIVE_ROOT" \
    run "$ARCHIVE_STREAM" "$stream_dir" --no-compress

    [ "$status" -eq 0 ]
    [ -f "$stream_dir/_DRIVE-LEDGER.md" ]
    [ -f "$DRIVE_ROOT/06_ARCHIVE/stalker-golem/theo/2026-06-18-005309/_DRIVE-LEDGER.md" ]
    [ "$(cat "$stream_dir/video.mp4")" = "original video fixture" ]
    [ "$(cat "$stream_dir/video-compressed.mp4")" = "compressed video fixture" ]
    [ -f "$stream_dir/.archive-cleanup-skipped" ]
    grep -F -q 'status=CLEANUP_SKIPPED' "$stream_dir/.archive-cleanup-skipped"
    grep -F -q 'reason=drive_reverify_failed' "$stream_dir/.archive-cleanup-skipped"
    grep -F -q 'WARNING: cleanup skipped - originals retained; Drive re-verify failed' "$stream_dir/.archive-cleanup-skipped"
    [[ "$output" == *"WARNING: cleanup skipped - originals retained; Drive re-verify failed"* ]]
}

@test "archive-stream removes video ts only after verified Drive copy and ledger" {
    stream_dir="$(make_stream_dir)"
    printf 'raw transport stream fixture\n' > "$stream_dir/video.ts"

    PATH="$FAKE_BIN:$PATH" \
    STALKER_BRAIN_DRIVE_ROOT="$DRIVE_ROOT" \
    run "$ARCHIVE_STREAM" "$stream_dir" --no-compress

    [ "$status" -eq 0 ]
    target="$DRIVE_ROOT/06_ARCHIVE/stalker-golem/theo/2026-06-18-005309"
    [ "$(cat "$target/video.ts")" = "raw transport stream fixture" ]
    [ -f "$stream_dir/_DRIVE-LEDGER.md" ]
    [ -f "$target/_DRIVE-LEDGER.md" ]
    [ ! -f "$stream_dir/video.ts" ]
    [ ! -f "$stream_dir/video-compressed.mp4" ]
    [ ! -f "$stream_dir/full-audio.wav" ]
    [ "$(cat "$stream_dir/video.mp4")" = "compressed video fixture" ]
}

@test "archive-stream dry-run does not copy, write ledger, invoke claude, or delete media" {
    stream_dir="$(make_stream_dir)"

    PATH="$FAKE_BIN:$PATH" \
    STALKER_BRAIN_DRIVE_ROOT="$DRIVE_ROOT" \
    run "$ARCHIVE_STREAM" "$stream_dir" --no-compress --dry-run

    [ "$status" -eq 0 ]
    [ ! -e "$DRIVE_ROOT/06_ARCHIVE/stalker-golem/theo/2026-06-18-005309" ]
    [ ! -f "$stream_dir/_DRIVE-LEDGER.md" ]
    [[ "$output" != *"claude"* ]]
    [ -f "$stream_dir/video.mp4" ]
    [ -f "$stream_dir/video-compressed.mp4" ]
    [ -f "$stream_dir/full-audio.wav" ]
}
