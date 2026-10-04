#!/usr/bin/env bats
# Entry point: the original test names call mechanically moved bodies.
load 'test-stalker-durable-failures-parts/setup.bash'
load 'test-stalker-durable-failures-parts/cases-01.bash'
load 'test-stalker-durable-failures-parts/cases-02.bash'

@test "stream watcher ensures the generated Twitch chat bundle before watching" {
    split_case_001
}

@test "lurker bundle helper builds a missing bundle" {
    split_case_002
}

@test "lurker bundle helper keeps a bundle newer than its source and lockfile" {
    split_case_003
}

@test "lurker bundle helper rebuilds a bundle older than its source or lockfile" {
    split_case_004
}

@test "lurker bundle helper fails loud when bun is missing" {
    split_case_005
}

@test "a fresh dependency-inclusive build passes the chat deploy preflight" {
    split_case_006
}

@test "chat deploy preflight opens output and reaches a connected sentinel" {
    split_case_007
}

@test "source preflight fails when tmi.js is unavailable" {
    split_case_008
}

@test "missing tmi.js reaches the durable chat failure path" {
    split_case_009
}

@test "bundled preflight stays ready without node_modules" {
    split_case_010
}

@test "dead chat lurker records retryable failure without sending" {
    split_case_011
}

@test "scorer resolver finds HOME local bin under launchd-like PATH" {
    split_case_012
}

@test "process-stream fails retryably before expensive work when all scorers are absent" {
    split_case_013
}

@test "process-stream fails before expensive work when codex has no timeout utility" {
    split_case_014
}

@test "process-stream does not require a scorer when durable gems already exist" {
    split_case_015
}

@test "empty scoring identity fails closed even while the recorded PID is alive" {
    split_case_016
}

@test "live scoring identity is locale-stable, spares a match, and reconciles a mismatch" {
    split_case_017
}

@test "reconcile backfills scoring done without deleting complete gems" {
    split_case_018
}

@test "scoring start marker install failure preserves prior durable state" {
    split_case_019
}

@test "process-stream arms scoring only inside the scorer-present branch" {
    split_case_020
}

@test "post-stream entry reconciles a SIGKILLed sibling scoring run" {
    split_case_021
}

@test "digest entry reconciles a SIGKILLed scoring run before reporting" {
    split_case_022
}

@test "zero-gem zero-chat quality gate blocks success and records retry state" {
    split_case_023
}

@test "morning digest reports dropped run evidence and exits retryably" {
    split_case_024
}

@test "morning digest distinguishes an empty root from dropped runs" {
    split_case_025
}

@test "morning digest names orphan-tail drops and their on-disk gems" {
    split_case_026
}

@test "vacuous morning digest prints its failure without sending" {
    split_case_027
}

@test "vacuous morning digest bounds twenty dropped-run evidence blocks in its text" {
    split_case_028
}

@test "partial-failure digest keeps verdict and exact counts while bounding dropped names" {
    split_case_029
}

@test "orphan-tail digest reserves dropped runs in bounded text" {
    split_case_030
}

@test "failed digest does not claim dropped details were omitted when every name survives" {
    split_case_031
}

@test "morning digest keeps healthy output byte-identical" {
    split_case_032
}

@test "morning digest reports partial drops without counting their evidence" {
    split_case_033
}

@test "morning digest does not fail a healthy reconnect day for an orphan tail" {
    split_case_034
}

@test "post-stream completion remains eligible beside an orphan tail" {
    split_case_035
}

@test "post-stream returns retryably when completion fails" {
    split_case_036
}

@test "post-stream quality failure blocks completion and keeps notified stage retryable" {
    split_case_037
}

@test "post-stream invokes completion with real gems and records empty chat independently" {
    split_case_038
}

@test "post-stream invokes completion for a non-empty eligible run" {
    split_case_039
}

@test "detached post-processing runs under nounset with a numeric recording epoch" {
    python3 - "$STALKER_DIR/stream-watcher.sh" "$TMPDIR_/watcher-function.sh" <<'PYTEST'
import pathlib, re, sys
source = pathlib.Path(sys.argv[1]).read_text()
function = re.search(r"^start_detached_post_processing\(\) \{\n.*?^\}", source, re.M | re.S).group()
default = re.search(r"^RECORDING_STARTED_EPOCH=0$", source, re.M)
pathlib.Path(sys.argv[2]).write_text((default.group() + "\n" if default else "") + function + "\n")
PYTEST
    mkdir -p "$TMPDIR_/stub" "$TMPDIR_/run"
    mkfifo "$TMPDIR_/receipt"
    cat > "$TMPDIR_/stub/post-stream.sh" <<'SH'
#!/bin/bash
printf 'RAN %s\n' "$5" > "$POST_RECEIPT"
SH
    export POST_RECEIPT="$TMPDIR_/receipt"
    run bash -uc '
        source "$1"
        STREAM_DIR="$2/run" VIDEO_FILE=video CHAT_FILE=chat CHANNEL=synthetic
        SCRIPTS_DIR="$2/stub"
        log() { :; }
        exec 3<> "$POST_RECEIPT"
        start_detached_post_processing
        read -r -t 5 receipt <&3
        [[ "$receipt" =~ ^RAN\ [0-9]+$ ]] || exit 1
        printf "%s\n" "$receipt"
    ' bash "$TMPDIR_/watcher-function.sh" "$TMPDIR_"
    [ "$status" -eq 0 ]
    [[ "$output" =~ RAN\ [0-9]+ ]]
}
