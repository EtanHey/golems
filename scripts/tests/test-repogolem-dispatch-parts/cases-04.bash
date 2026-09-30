function split_case_061() {
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
      testrepoCodex --worker -s "Implement brief"
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    refute_contains "Worker mode" "$output" "--worker prompt must not add launcher text"
    grep -F -q -- "CODEX_ARG=Implement brief" <<< "$output"
    assert_no_worker_persona_markers "$output"
}

function split_case_062() {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home/.claude/agents"
    printf '%s\n' \
      "# Full orchestrator protocol" \
      "BrainLayer-first boot searches." \
      > "$fake_home/.claude/agents/test-agent.md"
    jq '.projects.testrepo.agent = "test-agent"' \
      "$REGISTRY_FILE" > "$TMPDIR_/registry-with-agent.json"

    run zsh -f -c '
      unset GOLEM_ROLE
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function cursor() { print -r -- "CURSOR_ARGS=$*"; }

      source "$3"
      testrepoCursor --worker -s -p "Implement brief"
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "CURSOR_ARGS=agent" <<< "$output"
    grep -F -q -- "Implement brief" <<< "$output"
    assert_no_worker_persona_markers "$output"
}

function split_case_063() {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home/.claude/agents"
    printf '%s\n' \
      "# Full orchestrator protocol" \
      "BrainLayer-first boot searches." \
      > "$fake_home/.claude/agents/test-agent.md"
    jq '.projects.testrepo.agent = "test-agent"' \
      "$REGISTRY_FILE" > "$TMPDIR_/registry-with-agent.json"

    run zsh -f -c '
      unset GOLEM_ROLE
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_sync_agy_workspace() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function agy() { print -r -- "AGY_ARGS=$*"; }

      source "$3"
      testrepoGemini --worker -s -p "Implement brief"
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "AGY_ARGS=" <<< "$output"
    grep -F -q -- "Implement brief" <<< "$output"
    assert_no_worker_persona_markers "$output"
}

function split_case_064() {
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
      testrepoCodex --worker -- --raw-option raw-value
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "CODEX_ARG=--raw-option" <<< "$output"
    grep -F -q -- "CODEX_ARG=raw-value" <<< "$output"
    refute_contains "Worker mode" "$output" "raw worker arguments must not add a positional prompt"
    assert_no_worker_persona_markers "$output"
}

function split_case_065() {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home/.claude/agents"
    printf '%s\n' '%s' > "$fake_home/.claude/agents/test-agent.md"
    jq '.projects.testrepo.agent = "test-agent"' \
      "$REGISTRY_FILE" > "$TMPDIR_/registry-with-agent.json"

    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function codex() {
        print -r -- "CODEX_ARG_COUNT=$#"
        local arg
        for arg in "$@"; do print -r -- "CODEX_ARG=$arg"; done
      }

      source "$3"
      _golem_register_wrappers
      testrepoCodex -s "baseline prompt"
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    local normalized_output
    normalized_output=$(printf '%s' "$output" \
      | grep -Fv -- 'CODEX_ARG=-c' \
      | grep -Fv -- 'CODEX_ARG=model_reasoning_effort="medium"' \
      | grep -Fv -- 'CODEX_ARG=--model' \
      | grep -Fv -- 'CODEX_ARG=gpt-6.1-sol' \
      | sed 's/^CODEX_ARG_COUNT=5$/CODEX_ARG_COUNT=1/')
    local actual_hash
    actual_hash=$(printf '%s' "$normalized_output" | shasum -a 256 | awk '{print $1}')
    [ "$actual_hash" = "86fcc2203e54cd62dc8947c3ead7051facb01184610f36346bb72c665cddf5fd" ]
}

function split_case_066() {
    [ -f "$DISPATCHER" ] || fail "repoGolem dispatcher fixture not found at $DISPATCHER"

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }

      function codex() {
        print -r -- "PWD=$PWD"
        print -r -- "ARGS=$*"
      }

      source "$3"
      _golem_register_wrappers
      testrepoCodex -s -w "$2"
    ' _ "$REGISTRY_FILE" "$WORKTREE_DIR" "$DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q "PWD=$WORKTREE_DIR" <<< "$output"
    ! grep -F -q -- "--dangerously-bypass-approvals-and-sandbox" <<< "$output" || false
    grep -F -q -- "--model gpt-6.1-sol" <<< "$output"
    ! grep -F -q -- "--worktree" <<< "$output" || false
    ! grep -F -q "unexpected argument" <<< "$output"
}

function split_case_067() {
    [ -f "$DISPATCHER" ] || fail "repoGolem dispatcher fixture not found at $DISPATCHER"

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }

      function codex() {
        print -r -- "PWD=$PWD"
        print -r -- "ARGS=$*"
      }

      source "$2"
      _golem_register_wrappers
      testrepoCodex -s
    ' _ "$REGISTRY_FILE" "$DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q "PWD=$PROJECT_DIR" <<< "$output"
    ! grep -F -q -- "--dangerously-bypass-approvals-and-sandbox" <<< "$output" || false
    grep -F -q -- "--model gpt-6.1-sol" <<< "$output"
    ! grep -F -q -- "--worktree" <<< "$output"
}

function split_case_068() {
    [ -f "$DISPATCHER" ] || fail "repoGolem dispatcher fixture not found at $DISPATCHER"

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home/.claude/agents"
    cat > "$fake_home/.claude/agents/test-agent.md" <<'AGENT'
---
name: test-agent
description: Test agent context.
---

# test-agent

Use repository context.
AGENT

    jq '.projects.testrepo.agent = "test-agent" | .projects.testrepo.mcps = ["brainlayer"]' \
      "$REGISTRY_FILE" > "$TMPDIR_/registry-with-agent.json"
    mkdir -p "$TMPDIR_/bin"
    cat > "$TMPDIR_/bin/agy" <<'AGY'
#!/usr/bin/env zsh
print -r -- "ARGS=$*"
AGY
    chmod +x "$TMPDIR_/bin/agy"
    cat > "$TMPDIR_/bin/npx" <<'NPX'
#!/usr/bin/env zsh
print -r -- "ARGS=$*"
NPX
    chmod +x "$TMPDIR_/bin/npx"

    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"
      export PATH="$3:$PATH"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{\"brainlayer\":{\"command\":\"brainlayer-mcp\"}}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_sync_agy_workspace() { return 0; }

      source "$5"
      _golem_register_wrappers
      testrepoGemini -s "Prep examplechannel voice pairs"
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$TMPDIR_/bin" "$WORKTREE_DIR" "$DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "BrainLayer-first ambiguity gate" <<< "$output"
    grep -F -q -- "resolve them from BrainLayer context and existing voice artifacts" <<< "$output"
    grep -F -q -- "BLOCKED_BRAINLAYER_UNAVAILABLE" <<< "$output"
}

function split_case_069() {
    [ -f "$DISPATCHER" ] || fail "repoGolem dispatcher fixture not found at $DISPATCHER"

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }

      function claude() { print -r -- "ARGS=$*"; }

      source "$2"
      _golem_register_wrappers
      testrepoClaude -s
    ' _ "$REGISTRY_FILE" "$DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "--model claude-opus-5-5[1m]" <<< "$output"
    grep -F -q -- "--dangerously-skip-permissions" <<< "$output"
}

function split_case_070() {
    [ -f "$DISPATCHER" ] || fail "repoGolem dispatcher fixture not found at $DISPATCHER"

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }

      function claude() { print -r -- "ARGS=$*"; }

      source "$2"
      _golem_register_wrappers
      testrepoClaude -s -S
    ' _ "$REGISTRY_FILE" "$DISPATCHER"

    [ "$status" -eq 2 ]
    grep -F -q -- "refuse Sonnet-tier models for full panes" <<< "$output"
    ! grep -F -q -- "ARGS=" <<< "$output"
}

function split_case_071() {
    [ -f "$DISPATCHER" ] || fail "repoGolem dispatcher fixture not found at $DISPATCHER"

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }

      function claude() { print -r -- "ARGS=$*"; }

      source "$2"
      _golem_register_wrappers
      testrepoClaude -s -m claude-opus-4-8
    ' _ "$REGISTRY_FILE" "$DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "--model claude-opus-4-8" <<< "$output"
    ! grep -F -q -- "repoGolem bare-launcher law" <<< "$output"
}

function split_case_072() {
    [ -f "$DISPATCHER" ] || fail "repoGolem dispatcher fixture not found at $DISPATCHER"

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }

      function claude() { print -r -- "ARGS=$*"; }

      source "$2"
      _golem_register_wrappers
      testrepoClaude -s --model claude-opus-4-8
    ' _ "$REGISTRY_FILE" "$DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "--model claude-opus-4-8" <<< "$output"
    ! grep -F -q -- "repoGolem bare-launcher law" <<< "$output"
}

function split_case_073() {
    [ -f "$DISPATCHER" ] || fail "repoGolem dispatcher fixture not found at $DISPATCHER"

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }

      function claude() { print -r -- "ARGS=$*"; }

      source "$2"
      _golem_register_wrappers
      testrepoClaude -s -p "one shot" -m claude-opus-4-8
    ' _ "$REGISTRY_FILE" "$DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "--print" <<< "$output"
    grep -F -q -- "--model claude-opus-4-8" <<< "$output"
    ! grep -F -q -- "claude-opus-4-8[1m]" <<< "$output"
}

function split_case_074() {
    [ -f "$DISPATCHER" ] || fail "repoGolem dispatcher fixture not found at $DISPATCHER"

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"
      export REPOGOLEM_ALLOW_MODEL=0

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }

      function claude() { print -r -- "ARGS=$*"; }

      source "$2"
      _golem_register_wrappers
      testrepoClaude -s -m claude-opus-4-8
    ' _ "$REGISTRY_FILE" "$DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "--model claude-opus-4-8" <<< "$output"
    ! grep -F -q -- "claude-opus-4-8[1m]" <<< "$output"
}

function split_case_075() {
    [ -f "$DISPATCHER" ] || fail "repoGolem dispatcher fixture not found at $DISPATCHER"

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }

      function codex() { print -r -- "ARGS=$*"; }

      source "$2"
      _golem_register_wrappers
      testrepoCodex -s -m gpt-5.4
    ' _ "$REGISTRY_FILE" "$DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "--model gpt-5.4" <<< "$output"
    ! grep -F -q -- "repoGolem bare-launcher law" <<< "$output"
}

function split_case_076() {
    [ -f "$DISPATCHER" ] || fail "repoGolem dispatcher fixture not found at $DISPATCHER"

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }

      function cursor() { print -r -- "ARGS=$*"; }

      source "$2"
      _golem_register_wrappers
      testrepoCursor -s -m auto
    ' _ "$REGISTRY_FILE" "$DISPATCHER"

    [ "$status" -eq 2 ]
    grep -F -q -- "repoGolem bare-launcher law" <<< "$output"
    grep -F -q -- "REPOGOLEM_ALLOW_MODEL=1" <<< "$output"
    ! grep -F -q -- "ARGS=" <<< "$output"
}

function split_case_077() {
    [ -f "$SOURCE_DISPATCHER" ]

    local codex_home="$TMPDIR_/codex-home-profile"
    mkdir -p "$codex_home/sessions"

    cat > "$PROJECT_DIR/.mcp.json" <<'JSON'
{
  "mcpServers": {
    "linear": {
      "command": "linear-mcp",
      "args": ["--stdio"],
      "env": { "LINEAR_API_TOKEN": "lin_api_SUPERSECRET_VALUE" },
      "timeout": 30
    }
  }
}
JSON

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"
      export CODEX_HOME="$3"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      '"$CODEX_STUB_SNAPSHOT"'

      source "$2"
      testrepoCodex -s
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER" "$codex_home"

    [ "$status" -eq 0 ]
    # argv must carry no MCP config keys and no secret value.
    # NOTE: `! grep ...` is exempt from errexit in bats, so negative assertions
    # must be written as `if grep ...; then fail; fi` to actually gate.
    refute_contains "mcp_servers." "$output" "codex argv must not carry MCP config keys"
    refute_contains "lin_api_SUPERSECRET_VALUE" "$output" "codex argv must not carry MCP secrets"
    # argv points codex at the rendered per-project profile instead
    grep -E -q -- "--profile repogolem-testrepo-[0-9a-f]{8}" <<< "$output"
    # while codex was running the profile was on disk at 0600 ...
    grep -F -q -- "CAPTURED_MODE=600" <<< "$output"
    # ... and it must be VALID TOML with the exact Codex schema — a file that
    # merely contains the right substrings can still be a config Codex refuses
    # to load.
    run python3 - "$codex_home/captured.toml" <<'PYCHECK'
import sys, tomllib
with open(sys.argv[1], "rb") as fh:
    cfg = tomllib.load(fh)
srv = cfg["mcp_servers"]["linear"]
assert set(cfg) == {"mcp_servers"}, f"unexpected top-level keys: {sorted(cfg)}"
assert srv["command"] == "linear-mcp", srv
assert srv["args"] == ["--stdio"], srv
assert srv["timeout"] == 30, srv
assert srv["env"] == {"LINEAR_API_TOKEN": "lin_api_SUPERSECRET_VALUE"}, srv
print("PROFILE_TOML_OK")
PYCHECK
    [ "$status" -eq 0 ]
    grep -F -q -- "PROFILE_TOML_OK" <<< "$output"
}

function split_case_078() {
    [ -f "$SOURCE_DISPATCHER" ]

    local codex_home="$TMPDIR_/codex-home-explicit-profile"
    mkdir -p "$codex_home/sessions"

    cat > "$PROJECT_DIR/.mcp.json" <<'JSON'
{
  "mcpServers": {
    "linear": {
      "command": "linear-mcp",
      "env": { "LINEAR_API_TOKEN": "lin_api_SUPERSECRET_VALUE" }
    }
  }
}
JSON

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"
      export CODEX_HOME="$3"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function codex() { print -r -- "CODEX_ARGS=$*"; }

      source "$2"
      testrepoCodex -s -- --profile custom-profile
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER" "$codex_home"

    [ "$status" -eq 0 ]
    # codex-cli refuses `--profile` twice:
    #   error: the argument '--profile <CONFIG_PROFILE_V2>' cannot be used multiple times
    # so a caller-supplied profile must win outright, never be doubled up.
    local argv_line
    argv_line="$(grep -F -- 'CODEX_ARGS=' <<< "$output")"
    [ "$(grep -o -- '--profile' <<< "$argv_line" | wc -l | tr -d ' ')" = "1" ]
    grep -F -q -- "--profile custom-profile" <<< "$argv_line"
    refute_contains "--profile repogolem-" "$argv_line" "caller-supplied --profile must not be doubled"
    # and no unrequested secret file is written behind their back
    [ "$(ls "$codex_home"/repogolem-*.config.toml 2>/dev/null | wc -l | tr -d ' ')" = "0" ]
    refute_contains "mcp_servers." "$argv_line" "codex argv must not carry MCP config keys"
    refute_contains "lin_api_SUPERSECRET_VALUE" "$output" "MCP secrets must not surface anywhere in launcher output"
}

function split_case_079() {
    [ -f "$SOURCE_DISPATCHER" ]

    local codex_home="$TMPDIR_/codex-home-worktree"
    mkdir -p "$codex_home/sessions"

    cat > "$PROJECT_DIR/.mcp.json" <<'JSON'
{ "mcpServers": { "fromProject": { "command": "project-mcp" } } }
JSON
    cat > "$WORKTREE_DIR/.mcp.json" <<'JSON'
{ "mcpServers": { "fromWorktree": { "command": "worktree-mcp" } } }
JSON

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"
      export CODEX_HOME="$3"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      # Snapshot under a per-launch name so the two runs cannot overwrite each
      # other'"'"'s evidence — the point of the test.
      typeset -gi run_no=0
      function codex() {
        (( run_no += 1 ))
        print -r -- "CODEX_ARGS=$*"
        local p
        for p in "$CODEX_HOME"/repogolem-*.config.toml(N); do
          cp "$p" "$CODEX_HOME/captured-${run_no}.toml"
          print -r -- "PROFILE_${run_no}=${p:t}"
        done
      }

      source "$2"
      testrepoCodex -s
      testrepoCodex -s -w "$4"
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER" "$codex_home" "$WORKTREE_DIR"

    [ "$status" -eq 0 ]
    # two launches of the SAME registry project from different directories must
    # not resolve to the same profile file, or a parallel worktree agent loads
    # the wrong repo's MCP servers and credentials
    local p1 p2
    p1="$(grep -o -- 'PROFILE_1=.*' <<< "$output" | head -1)"
    p2="$(grep -o -- 'PROFILE_2=.*' <<< "$output" | head -1)"
    [ -n "$p1" ]
    [ -n "$p2" ]
    [ "${p1#PROFILE_1=}" != "${p2#PROFILE_2=}" ]
    grep -F -q -- 'command = "project-mcp"' "$codex_home/captured-1.toml"
    grep -F -q -- 'command = "worktree-mcp"' "$codex_home/captured-2.toml"
    refute_contains "worktree-mcp" "$(cat "$codex_home/captured-1.toml")" "project launch must not see the worktree's servers"
    refute_contains "project-mcp" "$(cat "$codex_home/captured-2.toml")" "worktree launch must not see the project's servers"
}

function split_case_080() {
    local codex_home="$TMPDIR_/codex-home-release-deadline"
    mkdir -p "$codex_home"
    local sentinel="$codex_home/release-NEVER"
    [ ! -e "$sentinel" ]

    # Unbounded, this call never returns; the whole point is that it does.
    local started=$SECONDS
    run zsh -f -c '
      '"$CODEX_STUB_AWAIT_RELEASE"'
      _await_release "$1" "$2"
    ' _ "$sentinel" "$CODEX_STUB_RELEASE_DEADLINE"
    local elapsed=$(( SECONDS - started ))

    [ "$status" -eq 89 ]
    grep -F -q -- "CODEX_STUB_RELEASE_TIMEOUT" <<< "$output"
    grep -F -q -- "sentinel=$sentinel" <<< "$output"
    grep -F -q -- "deadline=$CODEX_STUB_RELEASE_DEADLINE" <<< "$output"
    # bounded well under the workflow's per-file cap, not merely "eventually"
    [ "$elapsed" -lt 30 ]
}

