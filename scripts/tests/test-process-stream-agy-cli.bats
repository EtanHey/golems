#!/usr/bin/env bats
# Entry point: the original test names call mechanically moved bodies.
load 'test-process-stream-agy-cli-parts/setup.bash'
load 'test-process-stream-agy-cli-parts/cases-01.bash'
load 'test-process-stream-agy-cli-parts/cases-02.bash'

@test "process-stream defaults to four concurrent scorers and merges gems in timestamp order" {
    split_case_001
}

@test "process-stream STALKER_SCORE_PARALLEL=1 keeps the serial fallback" {
    split_case_002
}

@test "process-stream parallel circuit opens once and stops later agy calls" {
    split_case_003
}

@test "process-stream interruption terminates active scorer workers before cleanup" {
    split_case_004
}

@test "SIGTERM during parallel scoring reaps every in-flight worker tree and exits 143" {
    split_case_005
}

@test "SIGINT during parallel scoring reaps every in-flight worker tree and exits 130" {
    split_case_006
}

@test "SIGTERM reaps every in-flight worker tree even when ps is denied" {
    split_case_007
}

@test "SIGINT reaps every in-flight worker tree even when ps is denied" {
    split_case_008
}

@test "SIGTERM between worker fork and PID registration still reaps the worker" {
    split_case_009
}

@test "SIGINT right after the monitor-mode worker launch still reaps the worker" {
    split_case_010
}

@test "SIGKILLed scoring is reconciled from its durable start marker and alerts" {
    split_case_011
}

@test "process-stream scores Stalker gems with headless agy and no API key" {
    split_case_012
}

@test "process-stream labels video.mp4 from recording directory name" {
    split_case_013
}

@test "process-stream keeps legacy twitch channel-date filename labels" {
    split_case_014
}

@test "process-stream fallback labels strip file extensions" {
    split_case_015
}

@test "process-stream preserves JSON chat offsets as stream-relative spikes" {
    split_case_016
}

@test "process-stream parses stream-relative chat spike times when present" {
    split_case_017
}

@test "process-stream rebuilds stale chat velocity before fallback parsing" {
    split_case_018
}

@test "process-stream skips empty directory chat log and uses valid fallback chat" {
    split_case_019
}

@test "process-stream uses directory chat log for legacy velocity rebuilds" {
    split_case_020
}

@test "process-stream generates missing chat velocity before reading spikes" {
    split_case_021
}

@test "process-stream advances post-midnight live chat times before clamping" {
    split_case_022
}

@test "process-stream tracks live chat day rollovers beyond 24 hours" {
    split_case_023
}

@test "process-stream scores volume spikes beyond the saved top 20 display rows" {
    split_case_024
}

@test "process-stream ignores echoed prompt JSON and parses scorer response" {
    split_case_025
}

@test "process-stream prefers final scorer JSON over echoed segment JSON" {
    split_case_026
}

@test "process-stream passes transcript shell metacharacters literally to scorer" {
    split_case_027
}

@test "process-stream skips scorer when diagnostics clean to empty text" {
    split_case_028
}

@test "process-stream does not cache an empty gems file when no candidates are scored" {
    split_case_029
}

@test "process-stream regenerates a header-only gems file when scorers are available" {
    split_case_030
}

@test "process-stream removes incomplete gems file after partial scorer failures" {
    split_case_031
}

@test "process-stream falls back to codex exec when agy errors" {
    split_case_032
}

@test "process-stream passes configured codex model effort and timeout explicitly" {
    split_case_033
}

@test "process-stream counts a codex timeout as a loud scoring failure" {
    split_case_034
}

@test "process-stream scores spikes that occur inside long transcript segments" {
    split_case_035
}

@test "process-stream removes incomplete gems file when all candidate scoring fails" {
    split_case_036
}
