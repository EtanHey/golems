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

@test "empty scoring identity preserves a live owner" {
    split_case_016
}

@test "live scoring identity is locale-stable, spares a match, and reconciles a mismatch" {
    split_case_017
}

@test "legacy partial garbled and unreadable live identities survive a new invocation" {
    for token in '' 'Thu Aug 20 01:00:00 2026' 'garbled' 'v2:darwin:' 'v2:linux:a:0' 'v2:darwin:1.000000' 'v2:darwin:2.000000' 'v2:darwin:3.000000'; do
        dir="$TMPDIR_/migration"
        write_scoring_marker "$dir" "$$" "$token"
        printf 'partial gems\n' > "$dir/gems.md"
        run env PATH="$FAKE_BIN:$PATH" bash -c '
            source "$1"
            if [ "$3" = v2:darwin:1.000000 ]; then
                stalker_process_start_identity() { return 2; }
            elif [ "$3" = v2:darwin:2.000000 ]; then
                kill() { return 1; }
                stalker_process_start_identity() { return 2; }
            elif [ "$3" = v2:darwin:3.000000 ]; then
                stalker_process_start_identity() { return 0; }
            fi
            stalker_reconcile_interrupted_scoring_run "$2"
        ' _ "$SCRIPT_DIR/lib/stream-helpers.sh" "$dir" "$token"
        [ "$status" -eq 0 ]
        [ -f "$dir/gems.md" ]
        [ ! -f "$dir/.stage-scoring.failed" ]
    done
}

@test "scorer child enumeration errors propagate before signaling" {
    run bash -c '
        source "$1"
        function /usr/bin/pgrep() { return 2; }
        stalker_terminate_scorer_tree "$$"
    ' _ "$SCRIPT_DIR/lib/stream-helpers.sh"
    [ "$status" -eq 2 ]
}

@test "gone scoring owners lose incomplete gems" {
    write_dead_scoring_marker "$TMPDIR_/gone"
    echo partial > "$TMPDIR_/gone/gems.md"
    run stalker_reconcile_interrupted_scoring_run "$TMPDIR_/gone"
    [ "$status" -eq 0 ]
    [ ! -f "$TMPDIR_/gone/gems.md" ] && [ -f "$TMPDIR_/gone/.stage-scoring.failed" ]
}

@test "post-stream watchdog uses native identities for TERM and KILL without ps" {
    python3 - "$POST_STREAM" "$TMPDIR_/watchdog-function.sh" <<'PY'
import pathlib, re, sys
source = pathlib.Path(sys.argv[1]).read_text()
functions = re.findall(r"^stalker_(?:process_tree|terminate_full_process_tree)\(\) \{\n.*?^\}", source, re.M | re.S)
assert len(functions) == 2
pathlib.Path(sys.argv[2]).write_text("\n".join(functions) + "\n")
PY
    mkfifo "$TMPDIR_/ready"
    exec 9<> "$TMPDIR_/ready"
    python3 -u -c 'import signal; signal.signal(signal.SIGTERM, signal.SIG_IGN); print("ready", flush=True); signal.pause()' > "$TMPDIR_/ready" &
    child_pid=$!
    read -r -t 5 ready <&9 || ready=""
    run env PATH="$FAKE_BIN:$PATH" bash -c '
        source "$1"; source "$2"
        stalker_terminate_full_process_tree "$3" 0
    ' _ "$SCRIPT_DIR/lib/stream-helpers.sh" "$TMPDIR_/watchdog-function.sh" "$child_pid"
    survived=0
    kill -0 "$child_pid" 2>/dev/null && survived=1
    kill -KILL "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
    exec 9>&-
    printf 'ready=%s status=%s survived=%s output=%s\n' "$ready" "$status" "$survived" "$output"
    [ ! -e "$PS_CALLS" ]
    [ "$ready" = ready ] && [ "$status" -eq 0 ] && [ "$survived" -eq 0 ]
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

@test "readable scoring owner survives EPERM from kill zero" {
    dir="$TMPDIR_/eperm"
    write_scoring_marker "$dir" 424242 'v2:darwin:1.000000'
    echo partial > "$dir/gems.md"
    run bash -c '
        source "$1"
        kill() { echo "Operation not permitted" >&2; return 1; }
        stalker_process_start_identity() { echo v2:darwin:1.000000; }
        stalker_reconcile_interrupted_scoring_run "$2"
    ' _ "$SCRIPT_DIR/lib/stream-helpers.sh" "$dir"
    [ "$status" -eq 0 ]
    [ -f "$dir/.stage-scoring.started" ]
    [ "$(cat "$dir/gems.md")" = partial ]
    [ ! -f "$dir/.stage-scoring.failed" ]
}

extract_termination_functions() {
    python3 - "$POST_STREAM" "$TMPDIR_/termination.sh" <<'PYTHON'
import pathlib, re, sys
source = pathlib.Path(sys.argv[1]).read_text()
functions = re.findall(r"^stalker_(?:process_tree|terminate_full_process_tree)\(\) \{\n.*?^\}", source, re.M | re.S)
assert len(functions) == 2
pathlib.Path(sys.argv[2]).write_text("\n".join(functions) + "\n")
PYTHON
}

@test "unverifiable identity after TERM never receives KILL" {
    extract_termination_functions
    run bash -c '
        source "$1"
        stalker_process_tree() { echo 424242; }
        # Identity reads happen in subshells, so persist the read counter.
        stalker_process_start_identity() {
            if [ -e "$READ_MARKER" ]; then return 2; fi
            : > "$READ_MARKER"
            echo v2:darwin:1.000000
        }
        kill() { echo "$*" >> "$SIGNALS"; }
        sleep() { :; }
        export READ_MARKER="$2/read" SIGNALS="$2/signals"
        stalker_terminate_full_process_tree 424242 0
        cat "$SIGNALS"
    ' _ "$TMPDIR_/termination.sh" "$TMPDIR_"
    [ "$status" -eq 0 ]
    [ "$output" = '-TERM 424242' ]
}

@test "missing native identity helper makes watchdog failure loud" {
    extract_termination_functions
    run bash -c '
        source "$1"; source "$2"
        STREAM_HELPERS_DIR="$3/missing/lib"
        stalker_process_tree() { echo 424242; }
        export SIGNALS="$3/signals"
        kill() { echo "$*" >> "$SIGNALS"; }
        sleep() { :; }
        log() { echo "$*"; }
        stalker_terminate_full_process_tree 424242 0
    ' _ "$SCRIPT_DIR/lib/stream-helpers.sh" "$TMPDIR_/termination.sh" "$TMPDIR_"
    [ "$status" -eq 0 ]
    [[ "$output" == *WARNING*identity* ]]
    [ ! -e "$TMPDIR_/signals" ]
}
