# Codex connector policy (Etan, 2026-10-06): computer use stays on for every
# launch; the codex_apps connectors and browser-tools are stripped from every
# agent-shaped launch, fail-safe. Only `--lead` or the bare human shape (no
# launcher args, a TTY, no agent markers) keeps them.

# run_codex_policy_launch <launch> [allow] [tty]
# tty=1 stubs the TTY probe true; otherwise bats' pipes make it false.
run_codex_policy_launch() {
    local launch="$1" allow="${2:-}" tty="${3:-}" marker
    local -a unset_args=(-u GOLEM_ROLE -u GOLEM_EFFORT -u GOLEM_CODEX_WORKER_ALLOW)
    for marker in "${CODEX_AGENT_MARKERS[@]}"; do unset_args+=(-u "$marker"); done
    run env "${unset_args[@]}" zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"
      [ -n "$4" ] && export GOLEM_CODEX_WORKER_ALLOW="$4"
      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() {
        print -r -- "{\"mcpServers\":{\"devtools-renamed\":{\"command\":\"npx\",\"args\":[\"@agentdeskai/browser-tools-mcp\"]}}}"
      }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function codex() {
        local arg p
        for arg in "$@"; do print -r -- "CODEX_ARG=$arg"; done
        print -r -- "ALLOW_ENV=${GOLEM_CODEX_WORKER_ALLOW-unset}"
        for p in "$CODEX_HOME"/repogolem-*.config.toml(N); do
          print -r -- "PROFILE_SERVERS=$(python3 -c "import sys,tomllib; print(\",\".join(sorted(tomllib.load(open(sys.argv[1],\"rb\")).get(\"mcp_servers\",{}))))" "$p")"
        done
      }
      source "$2"
      [ "$5" = 1 ] && function _golem_codex_stdio_is_tty() { return 0; }
      eval "$3"
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER" "$launch" "$allow" "$tty"
}

codex_arg_pair_present() {
    local value="$1" launch_output="$2"
    [ "$(grep -F -x -B1 -- "CODEX_ARG=$value" <<< "$launch_output" | head -1)" = "CODEX_ARG=-c" ]
}

# Computer use is never touched by the launcher.
assert_computer_use_untouched() {
    local launch="$1" launch_output="$2" needle
    for needle in 'plugins.' 'mcp_servers.node_repl' 'mcp_servers.computer-use' 'GOLEM_CODEX_COMPUTER_USE'; do
        refute_contains "$needle" "$launch_output" "[$launch] computer use stays on (Etan 2026-10-06)" || return 1
    done
}

assert_connectors_stripped() {
    local launch="$1" launch_output="$2"
    codex_arg_pair_present "$CODEX_WORKER_CONNECTOR_OVERRIDE" "$launch_output" \
      || { echo "[$launch] kept codex_apps connectors: $launch_output" >&2; return 1; }
}

assert_connectors_kept() {
    local launch="$1" launch_output="$2"
    refute_contains "$CODEX_WORKER_CONNECTOR_OVERRIDE" "$launch_output" "[$launch] keeps its connectors" || return 1
    refute_contains 'CODEX_ARG=apps.' "$launch_output" "[$launch] keeps its connectors" || return 1
}

# Every agent-shaped launch, including the ones cmuxlayer builds: a lead spawn
# without --lead, and a resume that carries no worker flag.
codex_stripped_launches() {
    printf '%s\n' \
      'testrepoCodex' \
      'testrepoCodex -s' \
      'testrepoCodex -E low --worker' \
      'testrepoCodexWorker -E low' \
      'GOLEM_ROLE=worker testrepoCodex -E low' \
      'testrepoCodex -E low -p "task"' \
      'testrepoCodex -E low "task"' \
      'CMUX_AGENT_ID=agent-1 testrepoCodex -E low' \
      'testrepoCodex resume --last' \
      'testrepoCodex resume 019fec96-588d-7000-8000-000000000000' \
      'testrepoCodex --dangerously-bypass-approvals-and-sandbox resume 019fec96-588d-7000-8000-000000000000' \
      'testrepoCodex -c' \
      'testrepoCodex -c "continue task"' \
      'testrepoCodex -E low -- --raw-option raw-value' \
      'testrepoCodex -s -m gpt-6.1-sol -E high' \
      "testrepoCodex -s -m gpt-6.1-sol -E high -w '$WORKTREE_DIR'"
}

codex_lead_launches() {
    printf '%s\n' \
      'testrepoCodex --lead -s -m gpt-6.1-sol -E high' \
      "testrepoCodex --lead -s -m gpt-6.1-sol -E high -w '$WORKTREE_DIR'" \
      'testrepoCodex --lead resume --last' \
      'testrepoCodex --lead -c' \
      'testrepoCodex --lead -E low -- --raw-option raw-value'
}

function split_case_136() {
    local launch
    while IFS= read -r launch; do
        run_codex_policy_launch "$launch"
        [ "$status" -eq 0 ] || { echo "[$launch] status=$status: $output" >&2; return 1; }
        assert_connectors_stripped "$launch" "$output" || return 1
        assert_computer_use_untouched "$launch" "$output" || return 1
    done < <(codex_stripped_launches)
}

function split_case_137() {
    local launch
    while IFS= read -r launch; do
        run_codex_policy_launch "$launch"
        [ "$status" -eq 0 ] || { echo "[$launch] status=$status: $output" >&2; return 1; }
        assert_connectors_kept "$launch" "$output" || return 1
        assert_computer_use_untouched "$launch" "$output" || return 1
    done < <(codex_lead_launches)
    # The bare human shape: zero args, a TTY, no agent markers.
    run_codex_policy_launch 'testrepoCodex' "" 1
    [ "$status" -eq 0 ]
    assert_connectors_kept "bare human" "$output"
    assert_computer_use_untouched "bare human" "$output"
}

function split_case_138() {
    # Zero args on a TTY is still agent-shaped when any marker is set.
    local marker launch
    for marker in "${CODEX_AGENT_MARKERS[@]}" GOLEM_ROLE; do
        if [ "$marker" = GOLEM_ROLE ]; then
            launch='GOLEM_ROLE=worker GOLEM_EFFORT=low testrepoCodex'
        else
            launch="$marker=agent-1 testrepoCodex"
        fi
        run_codex_policy_launch "$launch" "" 1
        [ "$status" -eq 0 ] || { echo "[$launch] status=$status: $output" >&2; return 1; }
        assert_connectors_stripped "$launch" "$output" || return 1
    done
}

function split_case_139() {
    # A worker signal beats --lead, with one stderr line.
    local launch
    for launch in 'testrepoCodex --lead -E low --worker' 'GOLEM_ROLE=worker testrepoCodex --lead -E low' 'testrepoCodexWorker --lead -E low'; do
        run_codex_policy_launch "$launch"
        [ "$status" -eq 0 ] || { echo "[$launch] status=$status: $output" >&2; return 1; }
        assert_connectors_stripped "$launch" "$output" || return 1
        [ "$(grep -F -c -- 'repoGolem: --lead ignored' <<< "$output")" = "1" ] \
          || { echo "[$launch] expected one --lead-ignored line: $output" >&2; return 1; }
    done
}

function split_case_140() {
    # Exact argv of a worker launch with no connector cache: the strip sits
    # after the effort pair and before --model.
    run_codex_policy_launch 'testrepoCodex -E low --worker'
    [ "$status" -eq 0 ]
    [ "$(grep '^CODEX_ARG=' <<< "$output")" = $'CODEX_ARG=-c\nCODEX_ARG=model_reasoning_effort="low"\nCODEX_ARG=-c\nCODEX_ARG=features.apps=false\nCODEX_ARG=--model\nCODEX_ARG=gpt-6.1-sol' ] \
      || { echo "$output" >&2; return 1; }
}
