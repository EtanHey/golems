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
      function agy() { print -r -- "AGY_ARGS=$*"; }
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
    mkdir -p "$TMPDIR_/gatherer-home/.gemini/antigravity-cli/agents"
    printf '%s\n' '---' 'name: gatherer' 'mainAgent: true' '---' > \
      "$TMPDIR_/gatherer-home/.gemini/antigravity-cli/agents/gatherer.md"
    run_gatherer_launch --worker -s
    [ "$status" -eq 0 ]
    grep -F -q -- "--agent gatherer" <<< "$output"
    run_gatherer_launch -s
    [ "$status" -eq 0 ]
    refute_contains "--agent gatherer" "$output"
}

function split_case_127() {
    run_gatherer_launch --worker -s
    [ "$status" -eq 0 ]
    grep -F -q -- "gatherer agent is not installed" <<< "$output"
    refute_contains "--agent gatherer" "$output"
    grep -F -q -- "--model Gemini 3.8 Flash (High)" <<< "$output"
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
