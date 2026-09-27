#!/bin/bash
# Sourced by ../stream-helpers.sh; keep the public entry as the source path.

# stalker_circuit_should_open — pure decision for the agy scorer circuit breaker.
# Exit 0 (open the breaker → skip agy, use codex exec) once consecutive agy
# failures reach the threshold; exit 1 otherwise. A single agy success resets the
# caller's counter, so a transient blip never permanently trips the breaker.
# Kept side-effect-free here so it can be unit-tested (see test-stream-helpers.bats).
stalker_circuit_should_open() {
    local failures="$1"
    local threshold="${2:-3}"
    [[ "$failures" =~ ^[0-9]+$ ]] || return 1
    [[ "$threshold" =~ ^[0-9]+$ ]] || threshold=3
    [ "$threshold" -lt 1 ] && threshold=1
    [ "$failures" -ge "$threshold" ]
}

# stalker_score_parallel_limit — normalize STALKER_SCORE_PARALLEL.
# A positive integer is preserved (including 1 for the serial safety fallback);
# unset, invalid, and non-positive values use the conservative default of 4.
stalker_score_parallel_limit() {
    local requested="${1:-}"
    if [[ "$requested" =~ ^[1-9][0-9]*$ ]]; then
        printf '%s\n' "$requested"
    else
        printf '4\n'
    fi
}

# stalker_acquire_circuit_lock — acquire the shared scorer-state lock.
# Cleanup may remove the per-run directory while an in-flight scorer is
# returning. Stop retrying in that case so the orphaned worker can exit.
stalker_acquire_circuit_lock() {
    local circuit_dir="$1"
    local lock_dir="$circuit_dir/lock"

    [ -d "$circuit_dir" ] || return 1
    while ! mkdir "$lock_dir" 2>/dev/null; do
        [ -d "$circuit_dir" ] || return 1
        sleep 0.05
    done
}

# stalker_circuit_next_state — pure transition for shared parallel agy state.
# Prints open|consecutive_failures|opened_now. Once open, the circuit is one-way
# for the run: an agy call that was already in flight cannot close it on success.
stalker_circuit_next_state() {
    local open="${1:-0}"
    local failures="${2:-0}"
    local outcome="${3:-}"
    local threshold="${4:-3}"

    case "$open" in
        0|1) ;;
        *) return 2 ;;
    esac
    [[ "$failures" =~ ^[0-9]+$ ]] || failures=0
    [[ "$threshold" =~ ^[0-9]+$ ]] || threshold=3
    [ "$threshold" -lt 1 ] && threshold=1

    if [ "$open" = "1" ]; then
        printf '1|%s|0\n' "$failures"
        return 0
    fi

    case "$outcome" in
        success)
            printf '0|0|0\n'
            ;;
        failure)
            failures=$((failures + 1))
            if stalker_circuit_should_open "$failures" "$threshold"; then
                printf '1|%s|1\n' "$failures"
            else
                printf '0|%s|0\n' "$failures"
            fi
            ;;
        *)
            return 2
            ;;
    esac
}

# stalker_merge_score_results — append worker gem fragments in segment order.
# Workers may finish in any order, but zero-padded result directory names make
# this single-writer merge deterministic and keep concurrent writes out of
# gems.md. Prints the number of gem fragments appended.
stalker_merge_score_results() {
    local results_root="$1"
    local gems_file="$2"
    local result_dir
    local merged=0
    local LC_ALL=C

    [ -d "$results_root" ] || return 1
    for result_dir in "$results_root"/segment-*; do
        [ -d "$result_dir" ] || continue
        [ -s "$result_dir/gem.md" ] || continue
        if ! cat "$result_dir/gem.md" >> "$gems_file"; then
            return 1
        fi
        merged=$((merged + 1))
    done
    printf '%s\n' "$merged"
}

# stalker_gems_complete — exit 0 only if a gems.md represents a scoring run that
# ran to completion. A full run always appends a "Scored: <date>" footer; the
# zero-gem and failure paths remove gems.md entirely. So a surviving gems.md that
# has gem entries but NO footer is a PARTIAL/interrupted run (e.g. the scorer was
# killed mid-stream) and must be re-scored — never silently skipped. This is the
# smarter auto-detection for the scheduled path: "a re-process must re-process."
stalker_gems_complete() {
    local file="$1"
    [ -f "$file" ] || return 1
    # Must contain at least one gem entry ("### [MM:SS] title").
    grep -q '^### \[' "$file" 2>/dev/null || return 1
    # Must contain the completion footer only written when scoring finishes.
    grep -q '^Scored: ' "$file" 2>/dev/null || return 1
    return 0
}
