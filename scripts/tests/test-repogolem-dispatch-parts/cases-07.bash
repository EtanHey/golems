function split_case_123() {
    [ -f "$SOURCE_DISPATCHER" ]
    local registry="$TMPDIR_/registry-prelaunch-shape.json" prelaunch
    # A shell-function agent reports $ZSH_SUBSHELL: 0 means the launcher called
    # it directly, exactly as before this change.
    for prelaunch in ABSENT '[]' '["true"]'; do
        if [ "$prelaunch" = ABSENT ]; then
            cp "$REGISTRY_FILE" "$registry"
        else
            jq --argjson p "$prelaunch" '.global.prelaunch = $p' "$REGISTRY_FILE" > "$registry"
        fi
        run zsh -f -c '
          export RALPH_REGISTRY_FILE="$1"
          source "$2"
          function _ralph_setup_mcps() { return 0; }
          function _ralph_setup_secrets() { return 0; }
          function _golem_setup_env() { return 0; }
          function _golem_setup_title() { return 0; }
          function _golem_reset_title() { return 0; }
          function claude() { print -r -- "SUBSHELL=$ZSH_SUBSHELL ARGS=$*"; }
          testrepoClaude -s
        ' _ "$registry" "$SOURCE_DISPATCHER"
        [ "$status" -eq 0 ]
        case "$prelaunch" in
            '["true"]') grep -F -q -- "SUBSHELL=1 ARGS=" <<< "$output" ;;
            *) [ "$output" = "SUBSHELL=0 ARGS=--dangerously-skip-permissions --effort high --model claude-opus-5-5[1m] --no-chrome" ] \
                 || { echo "[$prelaunch]: $output" >&2; return 1; } ;;
        esac
    done
}

function split_case_124() {
    [ -f "$SOURCE_DISPATCHER" ]
    local launcher prelaunch launcher_pid
    for launcher in "${PRELAUNCH_LAUNCHERS[@]}"; do
        for prelaunch in ABSENT '["export PRELAUNCH_PROBE=set"]'; do
            # The agent is exec'd, so its parent is the launching shell itself:
            # no extra process sits between them to catch or reorder signals.
            run_prelaunch_launch "$prelaunch" "$launcher" -s
            launcher_pid="$(sed -n 's/^LAUNCHER_PID=//p' <<< "$output")"
            grep -F -x -q -- "AGENT_PPID=$launcher_pid" <<< "$output" \
              || { echo "$launcher [$prelaunch]: $output" >&2; return 1; }

            STUB_EXIT=7 run_prelaunch_launch "$prelaunch" "$launcher" -s
            grep -F -x -q -- "RC=7" <<< "$output" \
              || { echo "$launcher [$prelaunch] exit: $output" >&2; return 1; }

            STUB_SIGNAL=TERM run_prelaunch_launch "$prelaunch" "$launcher" -s
            grep -F -x -q -- "RC=143" <<< "$output" \
              || { echo "$launcher [$prelaunch] TERM: $output" >&2; return 1; }
        done
    done
}

function split_case_125() {
    run_worker_role_launch "" testrepoGemini -s -m pro
    [ "$status" -eq 0 ]
    grep -F -q -- "--model Gemini 3.1 Pro (High)" <<< "$output"
}

run_gatherer_launch() {
    run env HOME="$TMPDIR_/gatherer-home" zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"
      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function agy() { print -r -- "AGY_ROLE=${GOLEM_ROLE-unset}"; print -r -- "AGY_ARGS=$*"; }
      source "$2"
      function _golem_setup_env() { return 0; }
      function _golem_sync_agy_workspace() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      shift 2
      testrepoGemini "$@"
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER" "$@"
}

function split_case_126() {
    local agents="$TMPDIR_/gatherer-home/.gemini/antigravity-cli/agents"
    mkdir -p "$agents"
    printf '%s\n' '---' 'name: gatherer' 'mainAgent: true' '---' > "$agents/gatherer.md"
    printf '%s\n' '---' 'name: shell-worker' 'mainAgent: true' '---' > "$agents/shell-worker.md"
    printf '%s\n' '---' 'name: video-qa' 'mainAgent: true' '---' > "$agents/video-qa.md"
    run_gatherer_launch --worker -s
    [ "$status" -eq 0 ]
    grep -F -q -- "--agent shell-worker" <<< "$output"
    for role in gatherer implementor worker reviewer; do
      GOLEM_AGENT_ROLE="$role" run_gatherer_launch -s
      [ "$status" -eq 0 ]
      local expected=shell-worker
      [ "$role" != gatherer ] || expected=gatherer
      grep -F -q -- "--agent $expected" <<< "$output"
    done
    for profile in shell-worker video-qa arbitrary; do
      GOLEM_AGENT_ROLE=gatherer GOLEM_AGY_AGENT="$profile" run_gatherer_launch --worker -s
      [ "$status" -ne 0 ]
      grep -F -q -- "conflicts" <<< "$output"
      refute_contains "AGY_ARGS=" "$output"
    done
    GOLEM_AGENT_ROLE=implementor GOLEM_AGY_AGENT=video-qa run_gatherer_launch --worker -s
    [ "$status" -eq 0 ]
    grep -F -q -- "--agent video-qa" <<< "$output"
    GOLEM_AGY_AGENT=video-qa run_gatherer_launch -s
    [ "$status" -eq 0 ]
    grep -F -q -- "--agent video-qa" <<< "$output"
    GOLEM_ROLE=worker run_gatherer_launch -s
    [ "$status" -eq 0 ]
    grep -F -q -- "--agent shell-worker" <<< "$output"
    run_gatherer_launch -s
    [ "$status" -eq 0 ]
    refute_contains "--agent" "$output"
}

function split_case_127() {
    for role in '' gatherer implementor; do
      GOLEM_AGENT_ROLE="$role" run_gatherer_launch --worker -s
      [ "$status" -ne 0 ]
      grep -F -q -- "profile" <<< "$output"
      refute_contains "AGY_ARGS=" "$output"
    done
    GOLEM_AGY_AGENT=unknown run_gatherer_launch --worker -s
    [ "$status" -ne 0 ]
    refute_contains "AGY_ARGS=" "$output"
    # Reject path escapes even when the target exists outside the agents dir.
    mkdir -p "$TMPDIR_/gatherer-home/.gemini/antigravity-cli/agents"
    printf '%s\n' 'name: outside' > "$TMPDIR_/gatherer-home/.gemini/antigravity-cli/outside.md"
    GOLEM_AGY_AGENT=../outside run_gatherer_launch --worker -s
    [ "$status" -ne 0 ]
    refute_contains "AGY_ARGS=" "$output"
}

function split_case_128() {
    local fake_home="$TMPDIR_/persona-home"
    mkdir -p "$fake_home/.claude/agents"
    printf '%s\n' 'DEFAULT_LEAD' > "$fake_home/.claude/agents/default-lead.md"
    printf '%s\n' 'GEMINI_LEAD' > "$fake_home/.claude/agents/gemini-lead.md"
    jq '.projects.testrepo.agent="default-lead" | .projects.testrepo.agentByCli.gemini="gemini-lead"' \
      "$REGISTRY_FILE" > "$TMPDIR_/persona-registry.json"
    run env HOME="$fake_home" zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"
      source "$2"
      for cli in gemini cursor codex; do
        file=$(_golem_inject_agent_context testrepo "$cli")
        print -r -- "$cli:$(cat "$file")"
        _golem_cleanup_agent_context "$file"
      done
      GOLEM_ROLE=worker
      print -r -- "WORKER:$(_golem_inject_agent_context testrepo gemini)"
    ' _ "$TMPDIR_/persona-registry.json" "$SOURCE_DISPATCHER"
    [ "$status" -eq 0 ]
    grep -F -x -q -- 'gemini:GEMINI_LEAD' <<< "$output"
    grep -F -x -q -- 'cursor:DEFAULT_LEAD' <<< "$output"
    grep -F -x -q -- 'codex:DEFAULT_LEAD' <<< "$output"
    grep -F -x -q -- 'WORKER:' <<< "$output"
}

function split_case_129() {
    for launch in 'testrepoCodex "task"' 'testrepoCodex -p "task"' 'testrepoCodex --worker' 'testrepoCodexWorker' 'GOLEM_ROLE=worker testrepoCodex' 'testrepoCodex -- --raw-option task'; do
        run zsh -f -c '
          unset GOLEM_EFFORT
          export RALPH_REGISTRY_FILE="$1"
          source "$2"
          function codex() { print -r -- "UNEXPECTED_CODEX"; }
          eval "$3"
        ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER" "$launch"
        [ "$status" -eq 2 ]
        [[ "$output" == *"low, medium, high, xhigh, max, ultra"* ]]
        [[ "$output" == *"choose per plan phase (see /agent-routing)"* ]]
        refute_contains UNEXPECTED_CODEX "$output"
    done
}

function split_case_130() {
    for launch in 'testrepoCodex -E high "task"' 'GOLEM_EFFORT=high testrepoCodex -p "task"' 'GOLEM_EFFORT=high testrepoCodexWorker'; do
        run zsh -f -c '
          unset GOLEM_EFFORT
          export RALPH_REGISTRY_FILE="$1"
          source "$2"
          function _golem_setup_env() { return 0; }
          function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
          function codex() { print -r -- "CODEX_ARGS=$*"; }
          eval "$3"
        ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER" "$launch"
        [ "$status" -eq 0 ]
        [[ "$output" == *'model_reasoning_effort="high"'* ]]
    done
}

function split_case_131() {
    run env GOLEM_EFFORT=invalid zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"
      source "$2"
      testrepoCodex --help || exit $?
      _golem_parse_codex_flags -E high || exit $?
      [[ "$_flag_codex_effort" == high ]]
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Codex launcher options:"* ]]
}

run_codex_ambient_effort() {
    local ambient="$1"; shift
    run env GOLEM_EFFORT="$ambient" zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"
      source "$2"
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function codex() { print -r -- "CODEX_ARGS=$*"; }
      shift 2
      testrepoCodex "$@"
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER" "$@"
}

function split_case_132() {
    for ambient in low bogus; do
      run_codex_ambient_effort "$ambient" resume --last
      [ "$status" -eq 0 ] || return 1
      grep -F -q -- 'model_reasoning_effort="high"' <<< "$output" || return 1
    done
}

function split_case_133() {
    for ambient in low bogus; do
      run_codex_ambient_effort "$ambient" -c
      [ "$status" -eq 0 ] || return 1
      grep -F -q -- 'model_reasoning_effort="high"' <<< "$output" || return 1
    done
}

function split_case_134() {
    for ambient in low bogus; do
      run_codex_ambient_effort "$ambient"
      [ "$status" -eq 0 ] || return 1
      [[ "$output" == *CODEX_ARGS=* ]]
      refute_contains 'model_reasoning_effort=' "$output" || return 1
    done
}

function split_case_135() {
    run_codex_ambient_effort bogus "task"
    [ "$status" -eq 2 ]
    [[ "$output" == *"Invalid Codex effort: bogus"* ]]
    refute_contains CODEX_ARGS= "$output"
}
