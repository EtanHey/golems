function split_case_041() {
    [ -f "$SOURCE_DISPATCHER" ]

    local codex_home="$TMPDIR_/codex-home"
    stage_codex_session_fixtures "$codex_home" "$PROJECT_DIR" "$TMPDIR_/other-project"
    local malformed_rollout="$codex_home/sessions/2026/08/12/rollout-2026-08-12T04-00-00-019fec96-588d-7000-8000-000000000004.jsonl"
    cat > "$malformed_rollout" <<JSONL
{"timestamp":"2026-08-12T04:00:00.000Z","type":"session_meta","payload":{"id":"019fec96-588d-7000-8000-000000000004","cwd":"$PROJECT_DIR"}}
{"timestamp":"2026-08-12T04:00:01.000Z","type":"turn_context","payload":{"cwd":"$PROJECT_DIR","model":"gpt-broken-rollout","effort":"turbo"}}
JSONL
    touch -t 202608120404 "$malformed_rollout"

    run zsh -f -c '
      export CODEX_HOME="$1"
      export RALPH_REGISTRY_FILE="$2"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      typeset -gi codex_call=0
      function codex() {
        (( codex_call += 1 ))
        print -r -- "CODEX_CALL=$codex_call"
        local arg
        for arg in "$@"; do print -r -- "CODEX_ARG=$arg"; done
      }

      source "$3"
      testrepoCodex -c
      first_status=$?
      testrepoCodex -c -m gpt-5.6-luna
      second_status=$?
      testrepoCodex -c -E max
      third_status=$?
      testrepoCodex resume --last
      fourth_status=$?
      print -r -- "STATUSES=$first_status,$second_status,$third_status,$fourth_status"
      (( first_status == 0 && second_status == 0 && third_status == 0 && fourth_status == 0 ))
    ' _ "$codex_home" "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "STATUSES=0,0,0,0" <<< "$output"
    [ "$(grep -c '^CODEX_CALL=' <<< "$output")" -eq 4 ]
    [ "$(grep -Fxc -- "CODEX_ARG=gpt-5.6-terra" <<< "$output")" -eq 3 ]
    [ "$(grep -Fxc -- "CODEX_ARG=gpt-5.6-luna" <<< "$output")" -eq 1 ]
    [ "$(grep -Fxc -- 'CODEX_ARG=model_reasoning_effort="high"' <<< "$output")" -eq 3 ]
    [ "$(grep -Fxc -- 'CODEX_ARG=model_reasoning_effort="max"' <<< "$output")" -eq 1 ]
    ! grep -F -q -- "gpt-broken-rollout" <<< "$output" || false
    ! grep -F -q -- "turbo" <<< "$output"
}

function split_case_042() {
    [ -f "$SOURCE_DISPATCHER" ]

    local codex_home="$TMPDIR_/codex-home"
    stage_codex_session_fixtures "$codex_home" "$PROJECT_DIR" "$TMPDIR_/other-project"

    run zsh -f -c '
      export CODEX_HOME="$1"
      export RALPH_REGISTRY_FILE="$2"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      typeset -gi codex_call=0
      function codex() {
        (( codex_call += 1 ))
        print -r -- "CODEX_CALL=$codex_call"
        local arg
        for arg in "$@"; do print -r -- "CODEX_ARG=$arg"; done
      }

      source "$3"
      testrepoCodex --full-auto resume 019fec96-588d-7000-8000-000000000000
      testrepoCodex --search resume 019fec96-588d-7000-8000-000000000000
      testrepoCodex -a never resume 019fec96-588d-7000-8000-000000000000
    ' _ "$codex_home" "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    [ "$(grep -c '^CODEX_CALL=' <<< "$output")" -eq 3 ]
    [ "$(grep -Fxc -- "CODEX_ARG=resume" <<< "$output")" -eq 3 ]
    [ "$(grep -Fxc -- "CODEX_ARG=019fec96-588d-7000-8000-000000000000" <<< "$output")" -eq 3 ]
    [ "$(grep -Fxc -- 'CODEX_ARG=model_reasoning_effort="xhigh"' <<< "$output")" -eq 3 ]
    [ "$(grep -Fxc -- "CODEX_ARG=gpt-5.6-sol" <<< "$output")" -eq 3 ]
    grep -F -x -q -- "CODEX_ARG=--full-auto" <<< "$output"
    grep -F -x -q -- "CODEX_ARG=--search" <<< "$output"
    grep -F -x -q -- "CODEX_ARG=-a" <<< "$output"
    grep -F -x -q -- "CODEX_ARG=never" <<< "$output"
}

function split_case_043() {
    [ -f "$SOURCE_DISPATCHER" ]

    local codex_home="$TMPDIR_/codex-home"
    stage_codex_session_fixtures "$codex_home" "$PROJECT_DIR" "$TMPDIR_/other-project"

    run zsh -f -c '
      export CODEX_HOME="$1"
      export RALPH_REGISTRY_FILE="$2"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function codex() { print -r -- "CODEX_LAUNCHED=$*"; }

      source "$3"
      testrepoCodex -c -p "continue prompt"
      continue_status=$?
      testrepoCodex resume 019fec96-588d-7000-8000-000000000000 -p "resume prompt"
      suffix_status=$?
      testrepoCodex -p "resume prompt" resume 019fec96-588d-7000-8000-000000000000
      prefix_status=$?
      print -r -- "STATUSES=$continue_status,$suffix_status,$prefix_status"
      (( continue_status == 2 && suffix_status == 2 && prefix_status == 2 ))
    ' _ "$codex_home" "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    [ "$(grep -Fc -- "Cannot combine Codex resume with -p/--print" <<< "$output")" -eq 3 ]
    grep -F -q -- "STATUSES=2,2,2" <<< "$output"
    ! grep -F -q -- "CODEX_LAUNCHED=" <<< "$output"
}

function split_case_044() {
    [ -f "$SOURCE_DISPATCHER" ]

    local codex_home="$TMPDIR_/codex-home"
    stage_codex_session_fixtures "$codex_home" "$PROJECT_DIR" "$TMPDIR_/other-project"

    run zsh -f -c '
      export CODEX_HOME="$1"
      export RALPH_REGISTRY_FILE="$2"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function codex() { print -r -- "CODEX_LAUNCHED=$*"; }

      source "$3"
      testrepoCodex resume
    ' _ "$codex_home" "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 2 ]
    grep -F -q -- "Cannot honor Codex resume: no session id or --last selector was provided" <<< "$output"
    ! grep -F -q -- "CODEX_LAUNCHED=" <<< "$output"
}

function split_case_045() {
    [ -f "$SOURCE_DISPATCHER" ]

    local codex_home="$TMPDIR_/codex-home"
    mkdir -p "$codex_home/sessions/2026/08/12"
    cat > "$codex_home/sessions/2026/08/12/rollout-2026-08-12T04-00-00-019fec96-588d-7000-8000-000000000004.jsonl" <<JSONL
{"timestamp":"2026-08-12T04:00:00.000Z","type":"session_meta","payload":{"id":"019fec96-588d-7000-8000-000000000004","cwd":"$PROJECT_DIR"}}
JSONL

    run zsh -f -c '
      export CODEX_HOME="$1"
      export RALPH_REGISTRY_FILE="$2"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function codex() { print -r -- "CODEX_LAUNCHED=$*"; }

      source "$3"
      testrepoCodex resume 019fec96-588d-7000-8000-000000000099
      missing_status=$?
      testrepoCodex resume 019fec96-588d-7000-8000-000000000004
      malformed_status=$?
      testrepoCodex -c
      last_status=$?
      print -r -- "STATUSES=$missing_status,$malformed_status,$last_status"
      (( missing_status == 2 && malformed_status == 2 && last_status == 2 ))
    ' _ "$codex_home" "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    [ "$(grep -Fc -- "Cannot honor Codex resume:" <<< "$output")" -eq 3 ]
    grep -F -q -- "STATUSES=2,2,2" <<< "$output"
    ! grep -F -q -- "CODEX_LAUNCHED=" <<< "$output"
}

function split_case_046() {
    [ -f "$SOURCE_DISPATCHER" ]

    local codex_home="$TMPDIR_/codex-home"
    stage_codex_session_fixtures "$codex_home" "$PROJECT_DIR" "$TMPDIR_/other-project"

    run zsh -f -c '
      export CODEX_HOME="$1"
      export RALPH_REGISTRY_FILE="$2"

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

      source "$3"
      testrepoCodex --dangerously-bypass-approvals-and-sandbox resume 019fec96-588d-7000-8000-000000000000
    ' _ "$codex_home" "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]

    output="$(strip_codex_app_driver_args "$output")"
    [ "$(grep '^CODEX_ARG=' <<< "$output")" = $'CODEX_ARG=resume\nCODEX_ARG=019fec96-588d-7000-8000-000000000000\nCODEX_ARG=--dangerously-bypass-approvals-and-sandbox\nCODEX_ARG=-c\nCODEX_ARG=model_reasoning_effort="xhigh"\nCODEX_ARG=--model\nCODEX_ARG=gpt-5.6-sol' ]
    [ "$(grep -Fc -- "Adopt the following launcher agent context" <<< "$output")" -eq 0 ]
}

function split_case_047() {
    [ -f "$SOURCE_DISPATCHER" ]

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

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
      for effort in low medium high xhigh max ultra; do
        testrepoCodex -s -E "$effort"
        testrepoCodex -s --effort "$effort"
      done
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]

    output="$(strip_codex_app_driver_args "$output")"
    for effort in low medium high xhigh max ultra; do
      [ "$(grep -Fxc -- "CODEX_ARG=model_reasoning_effort=\"$effort\"" <<< "$output")" -eq 2 ]
    done
    [ "$(grep -Fxc -- 'CODEX_ARG=-c' <<< "$output")" -eq 12 ]
    ! grep -F -q -- "CODEX_ARG=-E" <<< "$output" || false
    ! grep -F -q -- "CODEX_ARG=--effort" <<< "$output"
}

function split_case_048() {
    [ -f "$SOURCE_DISPATCHER" ]

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

      function codex() { print -r -- "CODEX_LAUNCHED=$*"; }

      source "$2"
      testrepoCodex -E
      short_status=$?
      testrepoCodex --effort light
      long_status=$?
      (( short_status == 2 && long_status == 2 ))
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "-E requires one of: low, medium, high, xhigh, max, ultra" <<< "$output"
    grep -F -q -- "Invalid Codex effort: light (expected: low, medium, high, xhigh, max, ultra)" <<< "$output"
    ! grep -F -q -- "CODEX_LAUNCHED=" <<< "$output"
}

function split_case_049() {
    [ -f "$SOURCE_DISPATCHER" ]

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

      function codex() { print -r -- "CODEX_LAUNCHED=$*"; }

      source "$2"
      testrepoCodex --help
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "Codex launcher options:" <<< "$output"
    grep -F -q -- "-E, --effort <value>" <<< "$output"
    grep -F -q -- "-m, --model <name>" <<< "$output"
    grep -F -q -- "low, medium, high, xhigh, max, ultra" <<< "$output"
    grep -F -q -- "prompted/worker boots require -E or GOLEM_EFFORT" <<< "$output"
    grep -F -q -- "choose per plan phase (see /agent-routing)" <<< "$output"
    ! grep -F -q -- "CODEX_LAUNCHED=" <<< "$output"
}

function split_case_050() {
    [ -f "$SOURCE_DISPATCHER" ]

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

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
      testrepoCodex -E high -- --help -E ultra
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- 'CODEX_ARG=model_reasoning_effort="high"' <<< "$output"
    [ "$(grep -Fxc -- 'CODEX_ARG=--' <<< "$output")" -eq 0 ]
    grep -F -q -- "CODEX_ARG=--help" <<< "$output"
    grep -F -q -- "CODEX_ARG=-E" <<< "$output"
    grep -F -q -- "CODEX_ARG=ultra" <<< "$output"
    ! grep -F -q -- "Codex launcher options:" <<< "$output"
}

function split_case_051() {
    [ -f "$SOURCE_DISPATCHER" ]

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

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
      testrepoCodex -E high -- -c raw-config -p -m raw-model -s -w "$3"
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER" "$WORKTREE_DIR"

    [ "$status" -eq 0 ]

    output="$(strip_codex_app_driver_args "$output")"
    grep -F -q -- 'CODEX_ARG=model_reasoning_effort="high"' <<< "$output"
    [ "$(grep -Fxc -- 'CODEX_ARG=-c' <<< "$output")" -eq 2 ]
    for arg in raw-config -p -m raw-model -s -w "$WORKTREE_DIR"; do
      grep -F -q -- "CODEX_ARG=$arg" <<< "$output"
    done
    [ "$(grep -Fxc -- 'CODEX_ARG=--' <<< "$output")" -eq 0 ]
    ! grep -F -q -- "CODEX_ARG=resume" <<< "$output" || false
    ! grep -F -q -- "CODEX_ARG=exec" <<< "$output"
}

function split_case_052() {
    [ -f "$SOURCE_DISPATCHER" ]

    mkdir -p "$TMPDIR_/bin"
    cat > "$TMPDIR_/bin/agy" <<'AGY'
#!/usr/bin/env zsh
print -r -- "AGY_ARGS=$*"
AGY
    chmod +x "$TMPDIR_/bin/agy"

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"
      export PATH="$2:$PATH"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _golem_setup_env() { return 0; }

      source "$3"
      testrepoGemini -m
    ' _ "$REGISTRY_FILE" "$TMPDIR_/bin" "$SOURCE_DISPATCHER"

    [ "$status" -eq 2 ]
    grep -F -q -- "requires a model name" <<< "$output"
    ! grep -F -q -- "AGY_ARGS=" <<< "$output"
}

function split_case_053() {
    [ -f "$SOURCE_DISPATCHER" ]

    jq '.projects.testrepo.path = "/tmp/repogolem-missing-project-path"' \
      "$REGISTRY_FILE" > "$TMPDIR_/registry-missing-path.json"
    mkdir -p "$TMPDIR_/bin"
    cat > "$TMPDIR_/bin/agy" <<'AGY'
#!/usr/bin/env zsh
print -r -- "AGY_ARGS=$*"
AGY
    chmod +x "$TMPDIR_/bin/agy"

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"
      export PATH="$2:$PATH"

      source "$3"
      testrepoGemini "Prep examplechannel voice pairs"
    ' _ "$TMPDIR_/registry-missing-path.json" "$TMPDIR_/bin" "$SOURCE_DISPATCHER"

    [ "$status" -eq 1 ]
    grep -F -q -- "Project path not found: /tmp/repogolem-missing-project-path" <<< "$output"
    ! grep -F -q -- "AGY_ARGS=" <<< "$output"
}

function split_case_054() {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home/.claude/contexts" "$TMPDIR_/bin"
    printf '%s\n' "large context body" > "$fake_home/.claude/contexts/test-context.md"
    jq '.projects.testrepo.contexts = ["test-context"]' \
      "$REGISTRY_FILE" > "$TMPDIR_/registry-with-context.json"
    cat > "$TMPDIR_/bin/claude" <<'CLAUDE'
#!/usr/bin/env zsh
print -r -- "CLAUDE_ARGS=$*"
CLAUDE
    chmod +x "$TMPDIR_/bin/claude"

    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"
      export PATH="$3:$PATH"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _golem_setup_env() { return 0; }

      source "$4"
      testrepoClaude -s
    ' _ "$fake_home" "$TMPDIR_/registry-with-context.json" "$TMPDIR_/bin" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "--append-system-prompt-file $fake_home/.claude/contexts/test-context.md" <<< "$output"
    ! grep -F -q -- "--append-system-prompt large context body" <<< "$output"
}

function split_case_055() {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home/.claude/agents"
    printf '%s\n' \
      "# Full orchestrator protocol" \
      "BrainLayer-first boot searches." \
      "brain_store boot ceremony result." \
      "Orchestration routing protocol." \
      "Monitor law." \
      "Skill index dumps." \
      > "$fake_home/.claude/agents/test-agent.md"
    jq '.projects.testrepo.agent = "test-agent"' \
      "$REGISTRY_FILE" > "$TMPDIR_/registry-with-agent.json"

    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function codex() {
        local arg
        for arg in "$@"; do print -r -- "CODEX_ARG=$arg"; done
      }

      source "$3"
      _golem_register_wrappers
      testrepoCodexWorker -E high -s "Implement brief"
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    refute_contains "Worker mode" "$output" "CodexWorker prompt must not add launcher text"
    grep -F -q -- "CODEX_ARG=Implement brief" <<< "$output"
    assert_no_worker_persona_markers "$output"
}

function split_case_056() {
    [ -f "$SOURCE_DISPATCHER" ]

    jq '.projects = {
          cmuxlayer: (.projects.testrepo + {path: $project_path}),
          orc: (.projects.testrepo + {path: $project_path, agent: "test-agent"}),
          mimir: (.projects.testrepo + {path: $project_path})
        }' --arg project_path "$PROJECT_DIR" \
      "$REGISTRY_FILE" > "$TMPDIR_/worker-registry.json"

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function codex() {
        print -r -- "CODEX_ARG_COUNT=$#"
        local arg
        for arg in "$@"; do print -r -- "CODEX_ARG=$arg"; done
      }

      source "$2"
      cmuxlayerCodex -E high --worker -s
    ' _ "$TMPDIR_/worker-registry.json" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    refute_contains "Worker mode" "$output" "worker launch without a user prompt must not add a banner"
    grep -F -q -- "CODEX_ARG_COUNT=$(( 4 + CODEX_APP_DRIVER_ARG_COUNT ))" <<< "$output"
}

function split_case_057() {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home/.claude/agents"
    printf '%s\n' "registry agent context" > "$fake_home/.claude/agents/test-agent.md"
    jq '.projects = {
          cmuxlayer: (.projects.testrepo + {path: $project_path}),
          orc: (.projects.testrepo + {path: $project_path, agent: "test-agent"}),
          mimir: (.projects.testrepo + {path: $project_path})
        }' --arg project_path "$PROJECT_DIR" \
      "$REGISTRY_FILE" > "$TMPDIR_/worker-registry.json"

    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function codex() {
        print -r -- "CODEX_ARG_COUNT=$#"
        local arg
        for arg in "$@"; do print -r -- "CODEX_ARG=$arg"; done
      }

      source "$3"
      orcCodex -E high --worker -s
    ' _ "$fake_home" "$TMPDIR_/worker-registry.json" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "CODEX_ARG_COUNT=$(( 4 + CODEX_APP_DRIVER_ARG_COUNT ))" <<< "$output"
    refute_contains "Worker mode" "$output" "worker launch with a registry agent must not add a banner"
    refute_contains "registry agent context" "$output" "worker launch must remain persona-free"
}

function split_case_058() {
    [ -f "$SOURCE_DISPATCHER" ]

    jq '.projects = {
          cmuxlayer: (.projects.testrepo + {path: $project_path}),
          orc: (.projects.testrepo + {path: $project_path, agent: "test-agent"}),
          mimir: (.projects.testrepo + {path: $project_path})
        }' --arg project_path "$PROJECT_DIR" \
      "$REGISTRY_FILE" > "$TMPDIR_/worker-registry.json"

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function codex() {
        print -r -- "CODEX_ARG_COUNT=$#"
        local arg
        for arg in "$@"; do print -r -- "CODEX_ARG=$arg"; done
      }

      source "$2"
      mimirCodex -E high --worker -s "do X"
    ' _ "$TMPDIR_/worker-registry.json" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "CODEX_ARG_COUNT=$(( 5 + CODEX_APP_DRIVER_ARG_COUNT ))" <<< "$output"
    [ "$(grep -Fxc -- "CODEX_ARG=do X" <<< "$output")" -eq 1 ]
    refute_contains "Worker mode" "$output" "worker launch must pass the user prompt through without a banner"
}

function split_case_059() {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home/.claude/agents"
    printf '%s\n' "registry agent context" > "$fake_home/.claude/agents/test-agent.md"
    jq '.projects = {
          orc: (.projects.testrepo + {path: $project_path, agent: "test-agent"})
        }' --arg project_path "$PROJECT_DIR" \
      "$REGISTRY_FILE" > "$TMPDIR_/worker-registry.json"

    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"

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

      source "$3"
      orcCodex -s
    ' _ "$fake_home" "$TMPDIR_/worker-registry.json" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "registry agent context" <<< "$output"
    grep -F -q -- "Adopt the following launcher agent context" <<< "$output"
}

function split_case_060() {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home/.claude/agents"
    printf '%s\n' \
      "# Full orchestrator protocol" \
      "BrainLayer-first boot searches." \
      "brain_store boot ceremony result." \
      "Orchestration routing protocol." \
      "Monitor law." \
      "Skill index dumps." \
      > "$fake_home/.claude/agents/test-agent.md"
    jq '.projects.testrepo.agent = "test-agent"' \
      "$REGISTRY_FILE" > "$TMPDIR_/registry-with-agent.json"

    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function codex() {
        local arg
        for arg in "$@"; do print -r -- "CODEX_ARG=$arg"; done
      }

      source "$3"
      _golem_register_wrappers
      GOLEM_ROLE=worker testrepoCodex -E high -s "Implement brief"
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    refute_contains "Worker mode" "$output" "GOLEM_ROLE worker prompt must not add launcher text"
    grep -F -q -- "CODEX_ARG=Implement brief" <<< "$output"
    assert_no_worker_persona_markers "$output"
}

