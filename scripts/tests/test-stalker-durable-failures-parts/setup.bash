#!/usr/bin/env bats

setup() {
    REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
    SCRIPT_DIR="$REPO_ROOT/scripts"
    STALKER_DIR="$REPO_ROOT/scripts/stalker"
    POST_STREAM="$STALKER_DIR/post-stream.sh"
    # shellcheck source=../lib/stream-helpers.sh
    source "$SCRIPT_DIR/lib/stream-helpers.sh"
    # shellcheck source=../lib/bun-version.sh
    source "$SCRIPT_DIR/lib/bun-version.sh"
    TMPDIR_="$(mktemp -d)"
    FAKE_BIN="$TMPDIR_/bin"
    ALERTS_FILE="$TMPDIR_/alerts.jsonl"
    CONTRACT_CALLS="$TMPDIR_/contract-calls.txt"
    mkdir -p "$FAKE_BIN"

    STALKER_COMPLETION_SCRIPT="$TMPDIR_/synthetic-completion.mjs"
    STALKER_COMPLETION_CALLS="$TMPDIR_/completion-calls"
    cat > "$STALKER_COMPLETION_SCRIPT" <<'JS'
#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(process.env.STALKER_COMPLETION_CALLS, `${process.argv[2]}\n`);
process.exit(Number(process.env.STALKER_COMPLETION_EXIT ?? 0));
JS
    chmod +x "$STALKER_COMPLETION_SCRIPT"
    export STALKER_COMPLETION_SCRIPT STALKER_COMPLETION_CALLS

    cat > "$FAKE_BIN/curl" <<'SH'
#!/bin/bash
printf '%s\n' "$*" >> "$ALERTS_FILE"
exit 9
SH
    cat > "$FAKE_BIN/ffprobe" <<'SH'
#!/bin/bash
printf '60.0\n'
SH
    cat > "$FAKE_BIN/ffmpeg" <<'SH'
#!/bin/bash
for arg in "$@"; do output="$arg"; done
printf 'clip\n' > "$output"
SH
    chmod +x "$FAKE_BIN/curl" "$FAKE_BIN/ffprobe" "$FAKE_BIN/ffmpeg"
    ln -s "$(command -v node)" "$FAKE_BIN/node"
    export ALERTS_FILE
}

teardown() {
    rm -rf "$TMPDIR_"
}

make_contract() {
    local contract="$TMPDIR_/contract"
    cat > "$contract" <<'SH'
#!/bin/bash
printf '%s\n' "$*" >> "$CONTRACT_CALLS"
exit 0
SH
    chmod +x "$contract"
    printf '%s\n' "$contract"
}

make_post_fixture() {
    local dir="$TMPDIR_/examplechannel-2026-07-10-030737"
    mkdir -p "$dir"
    printf 'video\n' > "$dir/video.mp4"
    printf 'done\n' > "$dir/.stage-process.done"
    printf 'done\n' > "$dir/.stage-archive.done"
    printf 'done\n' > "$dir/.stage-brainlayer.done"
    printf '%s\n' "$dir"
}

write_dead_scoring_marker() {
    local dir="$1"
    mkdir -p "$dir"
    cat > "$dir/.stage-scoring.started" <<'EOF'
status=STARTED
pid=99999999
started_at=2026-08-20T01:00:00Z
process_start=Thu Aug 20 01:00:00 2026
EOF
}

write_scoring_marker() {
    local dir="$1"
    local pid="$2"
    local process_start="$3"
    mkdir -p "$dir"
    {
        printf 'status=STARTED\n'
        printf 'pid=%s\n' "$pid"
        printf 'started_at=2026-08-20T01:00:00Z\n'
        printf 'process_start=%s\n' "$process_start"
    } > "$dir/.stage-scoring.started"
}

# The bundle is generated, not tracked: scripts/dist/ is gitignored and the
# watcher builds it on start when it is missing or stale.
build_fresh_bundle() {
    fresh_bundle="$TMPDIR_/fresh/twitch-chat-lurker.js"
    fresh_license="$TMPDIR_/fresh/twitch-chat-lurker.LICENSE.txt"
    "$STALKER_DIR/build-twitch-chat-lurker.sh" "$fresh_bundle"
}

fake_lurker_build() {
    FAKE_BUILD="$TMPDIR_/fake-build.sh"
    BUILD_CALLS="$TMPDIR_/build-calls"
    cat > "$FAKE_BUILD" <<SH
#!/bin/bash
echo built >> "$BUILD_CALLS"
mkdir -p "\$(dirname "\$1")"
echo '// bundle' > "\$1"
SH
    chmod +x "$FAKE_BUILD"
    LURKER_SRC="$TMPDIR_/twitch-chat-lurker.ts"
    LURKER_LOCK="$TMPDIR_/bun.lock"
    LURKER_BUNDLE="$TMPDIR_/dist/twitch-chat-lurker.js"
    echo 'src' > "$LURKER_SRC"
    echo 'lock' > "$LURKER_LOCK"
}

