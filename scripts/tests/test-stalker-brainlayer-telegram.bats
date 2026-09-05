#!/usr/bin/env bats
# Smoke tests for the Stalker Golem BrainLayer + Telegram contract.
# Run with: bats scripts/tests/test-stalker-brainlayer-telegram.bats

setup() {
    REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
    CONTRACT="$REPO_ROOT/scripts/stalker-brainlayer-telegram.sh"
    TMPDIR_="$(mktemp -d)"
    STALKER_ROOT="$TMPDIR_/stalker-golem"
    FAKE_BIN="$TMPDIR_/bin"
    mkdir -p "$STALKER_ROOT" "$FAKE_BIN"

    cat > "$FAKE_BIN/brain-store" <<'SH'
#!/bin/bash
cat >> "$BRAIN_STORE_CAPTURE"
printf '\n' >> "$BRAIN_STORE_CAPTURE"
printf 'manual-test-chunk\n'
SH

    cat > "$FAKE_BIN/brain-store-fail" <<'SH'
#!/bin/bash
cat >/dev/null
printf 'simulated BrainLayer outage\n' >&2
exit 9
SH

    cat > "$FAKE_BIN/brain-store-fail-after-first" <<'SH'
#!/bin/bash
count_file="$BRAIN_STORE_COUNTER"
count=0
if [ -f "$count_file" ]; then
    count="$(cat "$count_file")"
fi
count=$((count + 1))
printf '%s\n' "$count" > "$count_file"
if [ "$count" -eq 1 ]; then
    cat >> "$BRAIN_STORE_CAPTURE"
    printf '\n' >> "$BRAIN_STORE_CAPTURE"
    printf 'manual-test-chunk\n'
else
    cat >/dev/null
    printf 'simulated partial BrainLayer outage\n' >&2
    exit 9
fi
SH

    cat > "$FAKE_BIN/send-telegram" <<'SH'
#!/bin/bash
cat > "$TELEGRAM_CAPTURE"
SH

    chmod +x "$FAKE_BIN/brain-store" "$FAKE_BIN/brain-store-fail" "$FAKE_BIN/brain-store-fail-after-first" "$FAKE_BIN/send-telegram"
}

teardown() {
    rm -rf "$TMPDIR_"
}

make_processed_run() {
    local name="$1"
    local dir="$STALKER_ROOT/$name"
    mkdir -p "$dir/frames" "$dir/clips"
    printf 'video fixture\n' > "$dir/video.mp4"
    printf 'chat one\nchat two\n' > "$dir/chat.log"
    printf '# Transcript\nUseful discussion about deterministic pipelines.\n' > "$dir/transcript.md"
    cat > "$dir/gems.md" <<'EOF'
# Gems: theo (2026-06-18)

### [00:01] Segment 1 (12s) First gem
**Score:** 7/10 | **Type:** take
**Gist:** The first moment explains a useful take clearly enough to save.

### [00:02] Segment 2 (42s) Second gem
**Score:** 8/10 | **Type:** rant
**Gist:** The second moment is a sharper rant that should lead the digest.
EOF
    printf '# Stalker Golem Drive Ledger\n\n- Drive Target: %s\n\n| Path | Bytes | SHA256 | Duration Seconds |\n' "$TMPDIR_/Brain Drive/archive/$name" > "$dir/_DRIVE-LEDGER.md"
    printf '2026-06-18T00:00:00Z transcription failed permanently\n' > "$dir/transcription-failures.log"
    printf 'done\n' > "$dir/.stage-process.done"
    printf 'done\n' > "$dir/.stage-archive.done"
    printf '%s\n' "$dir"
}

@test "stalker contract stores structured BrainLayer records with traceability metadata" {
    run_dir="$(make_processed_run theo-2026-06-18-005309)"

    STALKER_BRAIN_STORE_CMD="$FAKE_BIN/brain-store" \
    BRAIN_STORE_CAPTURE="$TMPDIR_/stores.jsonl" \
    run "$CONTRACT" ingest-run "$run_dir"

    [ "$status" -eq 0 ]
    [ -f "$run_dir/.stage-brainlayer.done" ]
    grep -F -q 'status=stored' "$run_dir/.brainlayer-status"
    [ "$(jq -s 'length' "$TMPDIR_/stores.jsonl")" = "4" ]
    jq -s -e 'all(.[]; .project == "golems")' "$TMPDIR_/stores.jsonl"
    jq -s -e 'all(.[]; .tags | index("agent:stalker-golem-codex-trackB"))' "$TMPDIR_/stores.jsonl"
    jq -s -e 'all(.[]; .content | contains("[2026-06-18]"))' "$TMPDIR_/stores.jsonl"
    jq -s -e 'any(.[]; .tags | index("record:run-summary"))' "$TMPDIR_/stores.jsonl"
    jq -s -e 'any(.[]; .tags | index("record:curated-gems"))' "$TMPDIR_/stores.jsonl"
    jq -s -e 'any(.[]; .tags | index("record:failures"))' "$TMPDIR_/stores.jsonl"
    jq -s -e 'any(.[]; .tags | index("record:replay-state"))' "$TMPDIR_/stores.jsonl"
    [ ! -f "$run_dir/orphaned_stores.jsonl" ]
}

@test "stalker contract opens VectorStore once for all payloads" {
    run_dir="$(make_processed_run theo-2026-06-18-005309)"
    fake_src="$TMPDIR_/fake-brainlayer"
    mkdir -p "$fake_src/brainlayer"
    : > "$fake_src/brainlayer/__init__.py"
    cat > "$fake_src/brainlayer/paths.py" <<'PY'
import os
from pathlib import Path

def get_db_path():
    return Path(os.environ["FAKE_BRAINLAYER_DB"])
PY
    cat > "$fake_src/brainlayer/vector_store.py" <<'PY'
import os
from pathlib import Path

class VectorStore:
    def __init__(self, _path):
        counter = Path(os.environ["VECTOR_STORE_OPEN_COUNT"])
        count = int(counter.read_text()) if counter.exists() else 0
        counter.write_text(str(count + 1))
PY
    cat > "$fake_src/brainlayer/store.py" <<'PY'
def store_memory(**_kwargs):
    return {"id": "fake-memory-id"}
PY

    STALKER_BRAINLAYER_SRC="$fake_src" \
    VECTOR_STORE_OPEN_COUNT="$TMPDIR_/vector-store-opens" \
    FAKE_BRAINLAYER_DB="$TMPDIR_/fake-brainlayer.db" \
    run "$CONTRACT" ingest-run "$run_dir"

    [ "$status" -eq 0 ]
    [ "$(cat "$TMPDIR_/vector-store-opens")" = "1" ]
    [ -f "$run_dir/.stage-brainlayer.done" ]

    rm "$run_dir/.stage-brainlayer.done"
    STALKER_BRAINLAYER_SRC="$fake_src" \
    VECTOR_STORE_OPEN_COUNT="$TMPDIR_/vector-store-opens" \
    FAKE_BRAINLAYER_DB="$TMPDIR_/fake-brainlayer.db" \
    run "$CONTRACT" ingest-run "$run_dir"

    [ "$status" -eq 0 ]
    [ "$(cat "$TMPDIR_/vector-store-opens")" = "1" ]
}

@test "stalker contract queues every payload when the batch python cannot import BrainLayer" {
    run_dir="$(make_processed_run theo-2026-06-18-005309)"
    fake_src="$TMPDIR_/broken-brainlayer"
    mkdir -p "$fake_src/brainlayer"
    : > "$fake_src/brainlayer/__init__.py"
    cat > "$fake_src/brainlayer/paths.py" <<'PY'
raise ImportError("simulated BrainLayer import failure")
PY

    STALKER_BRAINLAYER_SRC="$fake_src" \
    run "$CONTRACT" ingest-run "$run_dir"

    [ "$status" -eq 0 ]
    [ ! -f "$run_dir/.stage-brainlayer.done" ]
    grep -F -q 'status=queued' "$run_dir/.brainlayer-status"
    [ "$(jq -s 'length' "$run_dir/orphaned_stores.jsonl")" = "4" ]
}

@test "stalker contract persists completed payload state before a batch is interrupted" {
    run_dir="$(make_processed_run theo-2026-06-18-005309)"
    fake_src="$TMPDIR_/slow-brainlayer"
    mkdir -p "$fake_src/brainlayer"
    : > "$fake_src/brainlayer/__init__.py"
    cat > "$fake_src/brainlayer/paths.py" <<'PY'
from pathlib import Path

def get_db_path():
    return Path("unused")
PY
    cat > "$fake_src/brainlayer/vector_store.py" <<'PY'
class VectorStore:
    def __init__(self, _path):
        pass
PY
    cat > "$fake_src/brainlayer/store.py" <<'PY'
import os
import time
from pathlib import Path

def store_memory(**_kwargs):
    counter = Path(os.environ["STORE_CALL_COUNT"])
    count = int(counter.read_text()) if counter.exists() else 0
    count += 1
    counter.write_text(str(count))
    if count > 1:
        time.sleep(30)
    return {"id": f"fake-{count}"}
PY

    STALKER_BRAINLAYER_SRC="$fake_src" \
    STORE_CALL_COUNT="$TMPDIR_/store-calls" \
    "$CONTRACT" ingest-run "$run_dir" >"$TMPDIR_/slow-ingest.out" 2>"$TMPDIR_/slow-ingest.err" &
    ingest_pid=$!

    for _ in $(seq 1 50); do
        if grep -F -q '"status": "stored"' "$run_dir/.brainlayer-store-state.jsonl" 2>/dev/null; then
            break
        fi
        sleep 0.1
    done

    pkill -TERM -P "$ingest_pid" 2>/dev/null || true
    kill -TERM "$ingest_pid" 2>/dev/null || true
    wait "$ingest_pid" 2>/dev/null || true

    grep -F -q '"status": "stored"' "$run_dir/.brainlayer-store-state.jsonl"
    run "$CONTRACT" queue-run "$run_dir" brain_store_timeout

    [ "$status" -eq 0 ]
    [ "$(jq -s '[.[] | select(.status == "stored")] | length' "$run_dir/.brainlayer-store-state.jsonl")" = "1" ]
    [ "$(jq -s 'length' "$run_dir/orphaned_stores.jsonl")" = "3" ]
}

@test "stalker contract emits failures payload when transcription failures are present" {
    run_dir="$(make_processed_run theo-2026-06-18-005309)"

    STALKER_BRAINLAYER_DRY_RUN=1 \
    run "$CONTRACT" ingest-run "$run_dir"

    [ "$status" -eq 0 ]
    printf '%s\n' "$output" > "$TMPDIR_/payloads.jsonl"
    [ "$(jq -s '[.[] | select(.tags | index("record:failures"))] | length' "$TMPDIR_/payloads.jsonl")" = "1" ]
    jq -s -e '
      any(.[]; (.tags | index("record:failures"))
        and (.tags | index("agent:stalker-golem-codex-trackB"))
        and (.tags | index("date:2026-06-18"))
        and (.tags | index("status:open"))
        and (.tags | index("severity:high"))
        and .memory_type == "issue"
        and .importance == 9
        and (.content | contains("transcription failed permanently"))
        and (.content | contains("Importance: 9"))
      )
    ' "$TMPDIR_/payloads.jsonl"
}

@test "stalker contract queues replay records when BrainLayer store fails" {
    run_dir="$(make_processed_run theo-2026-06-18-005309)"

    STALKER_BRAIN_STORE_CMD="$FAKE_BIN/brain-store-fail" \
    run "$CONTRACT" ingest-run "$run_dir"

    [ "$status" -eq 0 ]
    [ ! -f "$run_dir/.stage-brainlayer.done" ]
    grep -F -q 'status=queued' "$run_dir/.brainlayer-status"
    [ -f "$run_dir/orphaned_stores.jsonl" ]
    [ "$(jq -s 'length' "$run_dir/orphaned_stores.jsonl")" = "4" ]
    jq -s -e 'all(.[]; .intended_brain_store == true)' "$run_dir/orphaned_stores.jsonl"
    jq -s -e 'all(.[]; .payload.tags | index("agent:stalker-golem-codex-trackB"))' "$run_dir/orphaned_stores.jsonl"
}

@test "stalker contract retries only non-stored BrainLayer records after partial failure" {
    run_dir="$(make_processed_run theo-2026-06-18-005309)"

    STALKER_BRAIN_STORE_CMD="$FAKE_BIN/brain-store-fail-after-first" \
    BRAIN_STORE_CAPTURE="$TMPDIR_/stores.jsonl" \
    BRAIN_STORE_COUNTER="$TMPDIR_/store-count" \
    run "$CONTRACT" ingest-run "$run_dir"

    [ "$status" -eq 0 ]
    grep -F -q 'status=queued' "$run_dir/.brainlayer-status"
    [ ! -f "$run_dir/.stage-brainlayer.done" ]
    [ "$(jq -s 'length' "$TMPDIR_/stores.jsonl")" = "1" ]
    [ "$(jq -s 'length' "$run_dir/orphaned_stores.jsonl")" = "3" ]

    STALKER_BRAIN_STORE_CMD="$FAKE_BIN/brain-store" \
    BRAIN_STORE_CAPTURE="$TMPDIR_/stores.jsonl" \
    run "$CONTRACT" ingest-run "$run_dir"

    [ "$status" -eq 0 ]
    grep -F -q 'status=stored' "$run_dir/.brainlayer-status"
    [ -f "$run_dir/.stage-brainlayer.done" ]
    [ "$(jq -s 'length' "$TMPDIR_/stores.jsonl")" = "4" ]
    [ "$(jq -s 'length' "$run_dir/orphaned_stores.jsonl")" = "3" ]
}

@test "stalker digest sends readable Telegram highlight reel with short backup path and warnings only when needed" {
    run_dir="$(make_processed_run theo-2026-06-18-005309)"
    printf 'done\n' > "$run_dir/.stage-brainlayer.done"
    printf 'status=stored\nstored_count=4\nqueued_count=0\n' > "$run_dir/.brainlayer-status"

    tail_dir="$STALKER_ROOT/theo-2026-06-18-050228"
    mkdir -p "$tail_dir"
    printf 'status=ORPHAN_TAIL\n' > "$tail_dir/.orphan-tail"

    missing_drive_dir="$STALKER_ROOT/theo-2026-06-18-070000"
    mkdir -p "$missing_drive_dir"
    printf 'done\n' > "$missing_drive_dir/.stage-process.done"

    empty_watcher_dir="$STALKER_ROOT/theo-2026-06-18-090000"
    mkdir -p "$empty_watcher_dir"
    printf 'in-flight media\n' > "$empty_watcher_dir/video.mp4"

    active_process_dir="$STALKER_ROOT/theo-2026-06-18-100000"
    mkdir -p "$active_process_dir"
    printf '# partial transcript\n' > "$active_process_dir/transcript.md"
    printf '### [00:01] In-flight gem\n' > "$active_process_dir/gems.md"

    STALKER_TELEGRAM_CMD="$FAKE_BIN/send-telegram" \
    TELEGRAM_CAPTURE="$TMPDIR_/telegram.json" \
    run "$CONTRACT" digest "$STALKER_ROOT" 2026-06-18

    title="$(jq -r '.title' "$TMPDIR_/telegram.json")"
    source="$(jq -r '.source' "$TMPDIR_/telegram.json")"
    body="$(jq -r '.body' "$TMPDIR_/telegram.json")"
    [[ "$status" -eq 75 \
        && "$title" = "Stalker Morning Digest FAILED - 2026-06-18" \
        && "$source" = "stalker-golem" \
        && "$body" == *'🎬 Theo — Jun 18 · duration unknown'* \
        && "$body" == *'💎 2 gems · 2 chat · ⚠️ not backed up'* \
        && "$body" == *'Top moments:'* \
        && "$body" == *'🔥 8/10 · 00:02 · Second gem (rant)'* \
        && "$body" == *'The second moment is a sharper rant that should lead the digest.'* \
        && "$body" == *'💎 7/10 · 00:01 · First gem (take)'* \
        && "$body" == *'The first moment explains a useful take clearly enough to save.'* \
        && "$body" == *'📁 Brain Drive › stalker-golem/theo/2026-06-18'* \
        && "$body" == *'Missing Drive ledger: theo-2026-06-18-070000'* \
        && "$body" == *'DROPPED (not counted above): theo-2026-06-18-050228, theo-2026-06-18-090000, theo-2026-06-18-100000'* \
        && "$body" != *'Stream status:'* \
        && "$body" != *'Tail suppression:'* \
        && "$body" != *'BrainLayer:'* \
        && "$body" != *'In-flight gem'* ]]
}

@test "stalker digest warns when archive cleanup was skipped after Drive re-verify failed" {
    run_dir="$(make_processed_run theo-2026-06-18-005309)"
    printf 'done\n' > "$run_dir/.stage-brainlayer.done"
    printf 'status=stored\nstored_count=4\nqueued_count=0\n' > "$run_dir/.brainlayer-status"
    cat > "$run_dir/.archive-cleanup-skipped" <<'EOF'
status=CLEANUP_SKIPPED
reason=drive_reverify_failed
message=WARNING: cleanup skipped - originals retained; Drive re-verify failed
EOF

    STALKER_TELEGRAM_CMD="$FAKE_BIN/send-telegram" \
    TELEGRAM_CAPTURE="$TMPDIR_/telegram.json" \
    run "$CONTRACT" digest "$STALKER_ROOT" 2026-06-18

    [ "$status" -eq 0 ]
    grep -F -q 'WARNING: cleanup skipped - originals retained; Drive re-verify failed: theo-2026-06-18-005309' "$TMPDIR_/telegram.json"
}

@test "stalker digest is not coupled to BrainLayer ingest status" {
    make_processed_run theo-2026-06-18-005309 >/dev/null

    STALKER_TELEGRAM_CMD="$FAKE_BIN/send-telegram" \
    TELEGRAM_CAPTURE="$TMPDIR_/telegram.json" \
    run "$CONTRACT" digest "$STALKER_ROOT" 2026-06-18

    [ "$status" -eq 0 ]
    if grep -F -q 'BrainLayer' "$TMPDIR_/telegram.json"; then
        false
    fi
}

@test "stalker digest states an explicit no-gems reason and dry-run does not send Telegram" {
    run_dir="$STALKER_ROOT/theo-2026-06-18-005309"
    mkdir -p "$run_dir"
    printf '# Stalker Golem Drive Ledger\n\n- Drive Target: fake\n' > "$run_dir/_DRIVE-LEDGER.md"
    printf 'done\n' > "$run_dir/.stage-brainlayer.done"

    STALKER_BRAINLAYER_DRY_RUN=1 \
    STALKER_TELEGRAM_CMD="$FAKE_BIN/send-telegram" \
    TELEGRAM_CAPTURE="$TMPDIR_/telegram.json" \
    run "$CONTRACT" digest "$STALKER_ROOT" 2026-06-18

    [ "$status" -eq 0 ]
    [[ "$output" == *"Top moments:"* ]]
    [[ "$output" == *"No highlights found — no gems.md found for processed runs"* ]]
    [ ! -f "$TMPDIR_/telegram.json" ]
}
