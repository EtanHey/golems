# Codex computer-use / browser guard: every repoGolem Codex launch disables the
# app-driving plugins and the servers that host them; only a bare interactive
# launch (no launcher args, a TTY, no agent markers) may opt back in with
# GOLEM_CODEX_COMPUTER_USE=1.

CODEX_APP_DRIVER_HATCH_IGNORED='repoGolem: GOLEM_CODEX_COMPUTER_USE=1 ignored'
CODEX_APP_DRIVER_REFUSED='repoGolem: refusing a Codex -c/--config that re-enables an app driver'

# Agent markers the hatch refuses; the harness unsets them so a test seat's own
# environment (CLAUDECODE, CODEX_THREAD_ID, ...) cannot decide the outcome.
CODEX_AGENT_MARKERS=(CODEX_THREAD_ID CLAUDECODE CLAUDE_CODE_SESSION_ID AI_AGENT CLAUDE_WORKER CMUX_AGENT_ID)

# run_codex_plugin_launch <launch> [hatch] [tty]
# tty=1 stubs the TTY probe true; otherwise bats' pipes make it false.
run_codex_plugin_launch() {
    local launch="$1" hatch="${2:-}" tty="${3:-}" marker
    local -a unset_args=(-u GOLEM_ROLE -u GOLEM_EFFORT -u GOLEM_CODEX_COMPUTER_USE)
    for marker in "${CODEX_AGENT_MARKERS[@]}"; do unset_args+=(-u "$marker"); done
    run env "${unset_args[@]}" zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"
      [ -n "$4" ] && export GOLEM_CODEX_COMPUTER_USE="$4"
      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function codex() {
        local arg
        for arg in "$@"; do print -r -- "CODEX_ARG=$arg"; done
      }
      source "$2"
      [ "$5" = 1 ] && function _golem_codex_stdio_is_tty() { return 0; }
      eval "$3"
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER" "$launch" "$hatch" "$tty"
}

# Each override must reach codex as its own `-c <key=value>` pair.
assert_codex_app_drivers_disabled() {
    local launch="$1" launch_output="$2" override pair
    for override in "${CODEX_APP_DRIVER_OVERRIDES[@]}"; do
        pair="$(grep -F -x -B1 -- "CODEX_ARG=$override" <<< "$launch_output" | head -1)"
        if [ "$pair" != "CODEX_ARG=-c" ]; then
            printf 'FAIL [%s]: missing -c %s\n%s\n' "$launch" "$override" "$launch_output" >&2
            return 1
        fi
    done
    # Codex 0.160 keeps the quotes as part of the key, so the quoted form is a
    # silent no-op: it must never be what we rely on.
    refute_contains 'plugins."' "$launch_output" "quoted plugin keys are ignored by codex" || return 1
    refute_contains 'mcp_servers.node_repl.enabled' "$launch_output" "a bare node_repl key aborts codex where node_repl is undeclared" || return 1
}

assert_codex_app_drivers_enabled() {
    local launch="$1" launch_output="$2" override
    for override in "${CODEX_APP_DRIVER_OVERRIDES[@]}"; do
        refute_contains "$override" "$launch_output" "[$launch] bare hatch launch must keep app drivers" || return 1
    done
}

hatch_ignored_count() {
    grep -F -c -- "$CODEX_APP_DRIVER_HATCH_IGNORED" <<< "$1" || true
}

# cmuxlayer's buildLaunchCommand spawns a Codex lead as
# `<repo>Codex -s -m <model> -E <effort> [-w <path>]` and a worker with --worker.
codex_cmux_spawn_launches() {
    printf '%s\n' \
      'testrepoCodex -s -m gpt-6.1-sol -E high' \
      "testrepoCodex -s -m gpt-6.1-sol -E high -w '$WORKTREE_DIR'" \
      'testrepoCodex -s --worker -m gpt-6.1-sol -E medium'
}

codex_guarded_launches() {
    printf '%s\n' \
      'testrepoCodex' \
      'testrepoCodex -E low --worker' \
      'testrepoCodexWorker -E low' \
      'GOLEM_ROLE=worker testrepoCodex -E low' \
      'testrepoCodex -E low -p "task"' \
      'testrepoCodex -E low -p' \
      'testrepoCodex -E low "task"' \
      'testrepoCodex resume --last' \
      'testrepoCodex -c' \
      'testrepoCodex -c "continue task"' \
      'testrepoCodex -E low -- --raw-option raw-value' \
      'testrepoCodex -s -E high -- --profile custom-profile' \
      'testrepoCodex -E low --worker -- --profile custom-profile' \
      'testrepoCodex -E low -- -c model="o3"'
    codex_cmux_spawn_launches
}

function split_case_136() {
    local launch
    while IFS= read -r launch; do
        run_codex_plugin_launch "$launch"
        [ "$status" -eq 0 ] || { echo "[$launch] status=$status: $output" >&2; return 1; }
        assert_codex_app_drivers_disabled "$launch" "$output" || return 1
        [ "$(hatch_ignored_count "$output")" = "0" ] \
          || { echo "[$launch] hatch message without the hatch: $output" >&2; return 1; }
    done < <(codex_guarded_launches)
}

function split_case_137() {
    # A caller profile layers on top of base config; the -c overrides still
    # win over both, and the profile itself is passed through exactly once.
    run_codex_plugin_launch 'testrepoCodex -E low --worker -- --profile custom-profile'
    [ "$status" -eq 0 ]
    [ "$(grep -F -x -c -- 'CODEX_ARG=--profile' <<< "$output")" = "1" ]
    grep -F -x -q -- 'CODEX_ARG=custom-profile' <<< "$output"
    assert_codex_app_drivers_disabled "caller profile" "$output"
}

function split_case_138() {
    # Bare = no launcher args, stdin+stdout on a TTY, no agent markers.
    run_codex_plugin_launch 'testrepoCodex' 1 1
    [ "$status" -eq 0 ]
    assert_codex_app_drivers_enabled "bare hatch" "$output"
    [ "$(hatch_ignored_count "$output")" = "0" ]
}

function split_case_139() {
    # Even on a TTY, any launcher argument makes the launch non-bare: this is
    # what keeps cmuxlayer spawns (which always pass -E) guarded.
    local launch
    while IFS= read -r launch; do
        [ "$launch" = 'testrepoCodex' ] && continue
        run_codex_plugin_launch "$launch" 1 1
        [ "$status" -eq 0 ] || { echo "[$launch] status=$status: $output" >&2; return 1; }
        assert_codex_app_drivers_disabled "$launch" "$output" || return 1
        [ "$(hatch_ignored_count "$output")" = "1" ] \
          || { echo "[$launch] expected one hatch-ignored line: $output" >&2; return 1; }
    done < <(codex_guarded_launches)
}

function split_case_140() {
    # Only the literal value 1 opens the hatch.
    local value
    for value in 0 true yes; do
        run_codex_plugin_launch 'testrepoCodex' "$value" 1
        [ "$status" -eq 0 ] || return 1
        assert_codex_app_drivers_disabled "bare hatch=$value" "$output" || return 1
        [ "$(hatch_ignored_count "$output")" = "0" ] || return 1
    done
}

function split_case_141() {
    # A zero-arg launch is still not bare when an agent marker is set or the
    # session has no TTY.
    local marker launch
    for marker in "${CODEX_AGENT_MARKERS[@]}" GOLEM_ROLE; do
        if [ "$marker" = GOLEM_ROLE ]; then
            launch='GOLEM_ROLE=worker GOLEM_EFFORT=low testrepoCodex'
        else
            launch="$marker=agent-1 testrepoCodex"
        fi
        run_codex_plugin_launch "$launch" 1 1
        [ "$status" -eq 0 ] || { echo "[$launch] status=$status: $output" >&2; return 1; }
        assert_codex_app_drivers_disabled "$launch" "$output" || return 1
        [ "$(hatch_ignored_count "$output")" = "1" ] \
          || { echo "[$launch] expected one hatch-ignored line: $output" >&2; return 1; }
    done
    run_codex_plugin_launch 'testrepoCodex' 1
    [ "$status" -eq 0 ]
    assert_codex_app_drivers_disabled "no tty" "$output"
    [ "$(hatch_ignored_count "$output")" = "1" ]
}

function split_case_142() {
    # Codex lets the last -c win, so a caller -c/--config touching a guarded key
    # would silently re-enable it: refuse it before codex starts.
    local m="$CODEX_PLUGIN_MARKETPLACE" launch
    local -a refused=(
        "testrepoCodex -E low --worker --config plugins.browser@${m}.enabled=true \"task\""
        "testrepoCodex -E low -- -c plugins.computer-use@${m}.enabled=true"
        "testrepoCodex -E low -- -cplugins.computer-history@${m}.enabled=true"
        "testrepoCodex -E low -- --config=plugins.chrome@${m}.enabled=true"
        "testrepoCodex -E low -- -c 'plugins.\"browser@${m}\".enabled=true'"
        "testrepoCodex -E low -- -c 'plugins={}'"
        "testrepoCodex -E low -- -c mcp_servers.node_repl.enabled=true"
        "testrepoCodex -E low -- -c 'mcp_servers.computer-use={command=\"x\"}'"
        "testrepoCodex -E low -- -c 'mcp_servers={}'"
        "testrepoCodex resume --last --config plugins.browser@${m}.enabled=true"
        # clap strips the `=` after a short flag, so codex honours -c=K=V (R2 B1).
        "testrepoCodex -E low --worker -c=plugins.browser@${m}.enabled=true \"task\""
        "testrepoCodex -E low -- -c=mcp_servers.node_repl.enabled=true"
        "testrepoCodex -E low -- -c='plugins.\"computer-use@${m}\".enabled=true'"
    )
    for launch in "${refused[@]}"; do
        run_codex_plugin_launch "$launch"
        [ "$status" -eq 2 ] || { echo "[$launch] status=$status: $output" >&2; return 1; }
        grep -F -q -- "$CODEX_APP_DRIVER_REFUSED" <<< "$output" \
          || { echo "[$launch] missing refusal: $output" >&2; return 1; }
        refute_contains 'CODEX_ARG=' "$output" "[$launch] codex must not start" || return 1
    done
}

function split_case_143() {
    # Exact argv of a worker launch: the overrides come after the effort pair
    # and before --model, in a fixed order.
    run_codex_plugin_launch 'testrepoCodex -E low --worker'
    [ "$status" -eq 0 ]
    local expected override
    expected=$'CODEX_ARG=-c\nCODEX_ARG=model_reasoning_effort="low"'
    for override in "${CODEX_APP_DRIVER_OVERRIDES[@]}"; do
        expected+=$'\nCODEX_ARG=-c\nCODEX_ARG='"$override"
    done
    expected+=$'\nCODEX_ARG=--model\nCODEX_ARG=gpt-6.1-sol'
    [ "$(grep '^CODEX_ARG=' <<< "$output")" = "$expected" ] \
      || { diff <(echo "$expected") <(grep '^CODEX_ARG=' <<< "$output") >&2; return 1; }
}
