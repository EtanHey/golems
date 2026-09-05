#!/usr/bin/env bats
# Tests for the live repoGolem dispatcher.
# Run with: bats scripts/tests/test-repogolem-dispatch.bats

setup() {
    unset REPOGOLEM_ALLOW_MODEL
    FIXTURES="$BATS_TEST_DIRNAME/fixtures"
    CODEX_SESSION_FIXTURES="$FIXTURES/codex-sessions"
    SOURCE_DISPATCHER="$BATS_TEST_DIRNAME/../repogolem/golem-dispatch.zsh"
    INSTALL_DISPATCHER="$BATS_TEST_DIRNAME/../repogolem/install-golem-dispatch.sh"
    GOLEM_VALIDATE="$BATS_TEST_DIRNAME/../../skills/golem-powers/golem-install/scripts/validate.sh"
    TMPDIR_="$(mktemp -d)"
    PROJECT_DIR="$TMPDIR_/project"
    WORKTREE_DIR="$TMPDIR_/worktree"
    mkdir -p "$PROJECT_DIR" "$WORKTREE_DIR"
    export CODEX_HOME="$TMPDIR_/codex-home-empty"
    mkdir -p "$CODEX_HOME/sessions"
    stage_codex_session_fixtures "$CODEX_HOME" "$PROJECT_DIR" "$TMPDIR_/other-project"
    DISPATCHER="${REPOGOLEM_DISPATCH:-$FIXTURES/repogolem-dispatch.zsh}"

    REGISTRY_FILE="$TMPDIR_/registry.json"
    cat > "$REGISTRY_FILE" <<JSON
{
  "projects": {
    "testrepo": {
      "path": "$PROJECT_DIR",
      "mcps": [],
      "mcpsLight": [],
      "secrets": {},
      "disableChrome": true,
      "clis": ["codex", "claude"]
    }
  }
}
JSON
}

teardown() {
    rm -rf "$TMPDIR_"
}

WORKER_PERSONA_MARKERS='Adopt the following launcher agent context|<agent_context>|Initial prompt from agent frontmatter|Full orchestrator protocol|Never fabricate:|Search BrainLayer before starting|BrainLayer-first boot|brain_store|Store decisions, learnings, and milestones|Orchestration routing protocol|Monitor law|Skill index dumps'

# The launcher deletes the profile once codex exits — it holds live MCP
# secrets and only needs to exist while codex is starting up. Tests therefore
# snapshot it from inside the stub `codex`, which stands in for the real
# process that reads the file while it is running.
CODEX_STUB_SNAPSHOT='function codex() {
        print -r -- "CODEX_ARGS=$*"
        local p
        for p in "$CODEX_HOME"/repogolem-*.config.toml(N); do
          cp "$p" "$CODEX_HOME/captured.toml"
          print -r -- "CAPTURED_PROFILE=${p:t}"
          print -r -- "CAPTURED_MODE=$(stat -f %OLp "$p")"
        done
      }'

# bats runs with errexit, but `! cmd` is EXEMPT from it — a bare `! grep`
# negative assertion can never fail a test. Use this helper instead.
refute_contains() {
    local needle="$1" haystack="$2" why="${3:-unexpected substring}"
    if grep -F -q -- "$needle" <<< "$haystack"; then
        printf 'FAIL: %s\n  found: %s\n  in: %s\n' "$why" "$needle" "$haystack" >&2
        return 1
    fi
    return 0
}

assert_no_worker_persona_markers() {
    local launch_output="$1"
    if grep -E -q -- "$WORKER_PERSONA_MARKERS" <<< "$launch_output"; then
        grep -E -- "$WORKER_PERSONA_MARKERS" <<< "$launch_output" >&2
        return 1
    fi
}

stage_codex_session_fixtures() {
    local codex_home="$1"
    local matching_cwd="$2"
    local other_cwd="$3"
    local source_file relative_file target_file

    while IFS= read -r source_file; do
        relative_file="${source_file#"$CODEX_SESSION_FIXTURES"/}"
        target_file="$codex_home/sessions/$relative_file"
        mkdir -p "$(dirname "$target_file")"
        sed \
            -e "s|__MATCHING_CWD__|$matching_cwd|g" \
            -e "s|__OTHER_CWD__|$other_cwd|g" \
            "$source_file" > "$target_file"
    done < <(find "$CODEX_SESSION_FIXTURES" -type f -name 'rollout-*.jsonl' | sort)

    touch -t 202608120101 "$codex_home/sessions/2026/08/12/rollout-2026-08-12T01-00-00-019fec96-588d-7000-8000-000000000000.jsonl"
    touch -t 202608120202 "$codex_home/sessions/2026/08/12/rollout-2026-08-12T02-00-00-019fec96-588d-7000-8000-000000000001.jsonl"
    touch -t 202608120303 "$codex_home/sessions/2026/08/12/rollout-2026-08-12T03-00-00-019fec96-588d-7000-8000-000000000002.jsonl"
}

write_unroutable_codex_config() {
    local codex_home="$1"
    cat > "$codex_home/config.toml" <<'TOML'
model = "gpt-5.6-luna"
model_reasoning_effort = "medium"
model_provider = "local-unroutable"

[model_providers.local-unroutable]
name = "Local Unroutable"
base_url = "http://127.0.0.1:1/v1"
wire_api = "responses"
TOML
}

@test "install helper installs tracked dispatcher inside HOME" {
    [ -f "$INSTALL_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home"

    run env HOME="$fake_home" "$INSTALL_DISPATCHER" --force "$fake_home/.config/ralphtools/golem-dispatch.zsh"

    [ "$status" -eq 0 ]
    [ -x "$fake_home/.config/ralphtools/golem-dispatch.zsh" ]
    grep -F -q -- "Installed repoGolem dispatcher:" <<< "$output"
    rg -q "BrainLayer-first ambiguity gate|Theo Brown|BLOCKED_BRAINLAYER_UNAVAILABLE" "$fake_home/.config/ralphtools/golem-dispatch.zsh"
}

@test "install helper refuses targets outside HOME" {
    [ -f "$INSTALL_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home"

    run env HOME="$fake_home" "$INSTALL_DISPATCHER" "$TMPDIR_/outside/golem-dispatch.zsh"

    [ "$status" -eq 1 ]
    grep -F -q -- "Refusing to install outside HOME" <<< "$output"
    [ ! -e "$TMPDIR_/outside/golem-dispatch.zsh" ]
}

@test "installed dispatcher fixture matches the tracked source" {
    cmp -s "$SOURCE_DISPATCHER" "$FIXTURES/repogolem-dispatch.zsh"
}

@test "golem-install validation enforces Codex safety defaults" {
    [ -x "$GOLEM_VALIDATE" ]

    cat > "$TMPDIR_/codex-config.toml" <<'TOML'
approval_policy = "never"
sandbox_mode = "danger-full-access"

[profiles.example]
model = "gpt-5.6-sol"
TOML

    run env CODEX_CONFIG_PATH="$TMPDIR_/codex-config.toml" bash "$GOLEM_VALIDATE" --quick
    grep -E -q -- '\[PASS\].*Codex approval_policy is never' <<< "$output"
    grep -E -q -- '\[PASS\].*Codex sandbox_mode is danger-full-access' <<< "$output"

    cat > "$TMPDIR_/codex-config.toml" <<'TOML'
[profiles.example]
approval_policy = "never"
sandbox_mode = "danger-full-access"
TOML

    run env CODEX_CONFIG_PATH="$TMPDIR_/codex-config.toml" bash "$GOLEM_VALIDATE" --quick
    grep -E -q -- '\[FAIL\].*Codex approval_policy is never' <<< "$output"
    grep -E -q -- '\[FAIL\].*Codex sandbox_mode is danger-full-access' <<< "$output"
}

@test "tracked dispatcher source injects BrainLayer-first ambiguity gate through Gemini/agy" {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home/.claude/agents" "$TMPDIR_/bin"
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
    cat > "$TMPDIR_/bin/agy" <<'AGY'
#!/usr/bin/env zsh
print -r -- "AGY_ARGS=$*"
AGY
    chmod +x "$TMPDIR_/bin/agy"

    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"
      export PATH="$3:$PATH"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{\"brainlayer\":{\"command\":\"brainlayer-mcp\"}}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_sync_agy_workspace() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }

      source "$4"
      testrepoGemini -s "Prep Theo voice pairs"
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$TMPDIR_/bin" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "AGY_ARGS=" <<< "$output"
    grep -F -q -- "--model Gemini 3.1 Pro (High)" <<< "$output"
    grep -F -q -- "--dangerously-skip-permissions" <<< "$output"
    grep -F -q -- "--prompt-interactive" <<< "$output"
    grep -F -q -- "BrainLayer-first ambiguity gate" <<< "$output"
    grep -F -q -- "BrainLayer/user/project context before public web or popularity inference" <<< "$output"
    grep -F -q -- "BLOCKED_BRAINLAYER_UNAVAILABLE" <<< "$output"
    grep -F -q -- "Theo Brown / T3.gg / existing Theo voice artifacts" <<< "$output"
    ! grep -F -q -- "Theo Von" <<< "$output"
}

@test "tracked dispatcher source keeps ambiguity gate on Gemini/agy continue prompts" {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home/.claude/agents" "$TMPDIR_/bin"
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
    cat > "$TMPDIR_/bin/agy" <<'AGY'
#!/usr/bin/env zsh
print -r -- "AGY_ARGS=$*"
AGY
    chmod +x "$TMPDIR_/bin/agy"

    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"
      export PATH="$3:$PATH"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{\"brainlayer\":{\"command\":\"brainlayer-mcp\"}}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_sync_agy_workspace() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }

      source "$4"
      testrepoGemini -c "Prep Theo voice pairs"
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$TMPDIR_/bin" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "--continue" <<< "$output"
    grep -F -q -- "--prompt-interactive" <<< "$output"
    grep -F -q -- "BrainLayer-first ambiguity gate" <<< "$output"
    grep -F -q -- "BLOCKED_BRAINLAYER_UNAVAILABLE" <<< "$output"
    grep -F -q -- "Theo Brown / T3.gg / existing Theo voice artifacts" <<< "$output"
    ! grep -F -q -- "Theo Von" <<< "$output"
}

@test "tracked dispatcher source keeps ambiguity gate on Gemini/agy continue without prompt" {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home/.claude/agents" "$TMPDIR_/bin"
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
    cat > "$TMPDIR_/bin/agy" <<'AGY'
#!/usr/bin/env zsh
print -r -- "AGY_ARGS=$*"
AGY
    chmod +x "$TMPDIR_/bin/agy"

    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"
      export PATH="$3:$PATH"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{\"brainlayer\":{\"command\":\"brainlayer-mcp\"}}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_sync_agy_workspace() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }

      source "$4"
      testrepoGemini -c
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$TMPDIR_/bin" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "--continue" <<< "$output"
    grep -F -q -- "--prompt-interactive" <<< "$output"
    grep -F -q -- "BrainLayer-first ambiguity gate" <<< "$output"
    grep -F -q -- "BLOCKED_BRAINLAYER_UNAVAILABLE" <<< "$output"
    grep -F -q -- "Theo Brown / T3.gg / existing Theo voice artifacts" <<< "$output"
    ! grep -F -q -- "Theo Von" <<< "$output"
}

@test "tracked dispatcher source keeps ambiguity gate on Gemini/agy continue print prompts" {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home/.claude/agents" "$TMPDIR_/bin"
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
    cat > "$TMPDIR_/bin/agy" <<'AGY'
#!/usr/bin/env zsh
print -r -- "AGY_ARGS=$*"
AGY
    chmod +x "$TMPDIR_/bin/agy"

    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"
      export PATH="$3:$PATH"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{\"brainlayer\":{\"command\":\"brainlayer-mcp\"}}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_sync_agy_workspace() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }

      source "$4"
      testrepoGemini -c -p "Prep Theo voice pairs"
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$TMPDIR_/bin" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "--continue" <<< "$output"
    grep -F -q -- "--print" <<< "$output"
    grep -F -q -- "BrainLayer-first ambiguity gate" <<< "$output"
    grep -F -q -- "BLOCKED_BRAINLAYER_UNAVAILABLE" <<< "$output"
    grep -F -q -- "Theo Brown / T3.gg / existing Theo voice artifacts" <<< "$output"
    ! grep -F -q -- "Theo Von" <<< "$output"
}

@test "tracked dispatcher source keeps ambiguity gate on Codex Cursor and Kiro continue prompts" {
    [ -f "$SOURCE_DISPATCHER" ]

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

    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{\"brainlayer\":{\"command\":\"brainlayer-mcp\"}}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function codex() { print -r -- "CODEX_ARGS=$*"; }
      function cursor() { print -r -- "CURSOR_ARGS=$*"; }
      function kiro-cli() { print -r -- "KIRO_ARGS=$*"; }

      source "$3"
      testrepoCodex -c "Prep Theo voice pairs"
      testrepoCursor -c "Prep Theo voice pairs"
      testrepoKiro -c "Prep Theo voice pairs"
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "CODEX_ARGS=resume --last" <<< "$output"
    grep -F -q -- "CURSOR_ARGS=agent --continue" <<< "$output"
    grep -F -q -- "KIRO_ARGS=chat --resume" <<< "$output"
    grep -F -q -- "BrainLayer-first ambiguity gate" <<< "$output"
    grep -F -q -- "BLOCKED_BRAINLAYER_UNAVAILABLE" <<< "$output"
    grep -F -q -- "Theo Brown / T3.gg / existing Theo voice artifacts" <<< "$output"
    ! grep -F -q -- "Theo Von" <<< "$output"
}

@test "tracked dispatcher source refuses Codex resume plus print while Cursor and Kiro keep print precedence" {
    [ -f "$SOURCE_DISPATCHER" ]

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function codex() { print -r -- "CODEX_ARGS=$*"; }
      function cursor() { print -r -- "CURSOR_ARGS=$*"; }
      function kiro-cli() { print -r -- "KIRO_ARGS=$*"; }

      source "$2"
      testrepoCodex -c -p "one shot"
      testrepoCursor -c -p "one shot"
      testrepoKiro -c -p "one shot"
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "Cannot combine Codex resume with -p/--print" <<< "$output"
    grep -F -q -- "CURSOR_ARGS=agent --print --output-format text" <<< "$output"
    grep -F -q -- "KIRO_ARGS=chat --resume --no-interactive" <<< "$output"
    ! grep -F -q -- "CODEX_ARGS=" <<< "$output"
    ! grep -F -q -- "CODEX_ARGS=resume --last" <<< "$output"
    ! grep -F -q -- "CURSOR_ARGS=agent --continue" <<< "$output"
    ! grep -F -q -- "KIRO_ARGS=chat --resume one shot" <<< "$output"
}

@test "tracked dispatcher source run launcher prefers bun when bun.lockb exists" {
    [ -f "$SOURCE_DISPATCHER" ]

    printf '%s\n' '{"scripts":{"dev":"dev"}}' > "$PROJECT_DIR/package.json"
    : > "$PROJECT_DIR/bun.lockb"
    mkdir -p "$TMPDIR_/bin"
    cat > "$TMPDIR_/bin/bun" <<'BUN'
#!/usr/bin/env zsh
print -r -- "BUN_ARGS=$*"
BUN
    chmod +x "$TMPDIR_/bin/bun"
    cat > "$TMPDIR_/bin/npm" <<'NPM'
#!/usr/bin/env zsh
print -r -- "NPM_ARGS=$*"
NPM
    chmod +x "$TMPDIR_/bin/npm"

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"
      export PATH="$2:$PATH"

      source "$3"
      runTestrepo
    ' _ "$REGISTRY_FILE" "$TMPDIR_/bin" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "BUN_ARGS=run dev" <<< "$output"
    ! grep -F -q -- "NPM_ARGS=" <<< "$output"
}

@test "tracked dispatcher source keeps Cursor model refusal for interactive agent sessions" {
    [ -f "$SOURCE_DISPATCHER" ]

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }

      function cursor() { print -r -- "CURSOR_ARGS=$*"; }

      source "$2"
      testrepoCursor -s -m auto
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 2 ]
    grep -F -q -- "repoGolem bare-launcher law" <<< "$output"
    grep -F -q -- "REPOGOLEM_ALLOW_MODEL=1" <<< "$output"
    ! grep -F -q -- "CURSOR_ARGS=" <<< "$output"
}

@test "tracked dispatcher source accepts a bare Claude Opus model for a full pane" {
    [ -f "$SOURCE_DISPATCHER" ]

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function claude() {
        local arg
        for arg in "$@"; do print -r -- "CLAUDE_ARG=$arg"; done
      }

      source "$2"
      testrepoClaude -m claude-opus-4-8
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    [ "$(grep -Fxc -- "CLAUDE_ARG=--model" <<< "$output")" -eq 1 ]
    [ "$(grep -Fxc -- "CLAUDE_ARG=claude-opus-4-8" <<< "$output")" -eq 1 ]
    ! grep -F -q -- "CLAUDE_ARG=--print" <<< "$output"
    ! grep -F -q -- "REPOGOLEM_ALLOW_MODEL" <<< "$output"
}

@test "tracked dispatcher source resolves the fable alias to Fable 5.1 at 1M for a full pane" {
    [ -f "$SOURCE_DISPATCHER" ]

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function claude() {
        local arg
        for arg in "$@"; do print -r -- "CLAUDE_ARG=$arg"; done
      }

      source "$2"
      testrepoClaude -m fable
      print -r -- ""
      print -r -- "RESOLVED=$(_golem_claude_resolve_model fable-5.1)"
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    [ "$(grep -Fxc -- "CLAUDE_ARG=--model" <<< "$output")" -eq 1 ]
    [ "$(grep -Fxc -- "CLAUDE_ARG=claude-fable-5-1[1m]" <<< "$output")" -eq 1 ]
    [ "$(grep -Fxc -- "RESOLVED=claude-fable-5-1[1m]" <<< "$output")" -eq 1 ]
    ! grep -F -q -- "CLAUDE_ARG=fable" <<< "$output"
    ! grep -F -q -- "CLAUDE_ARG=--print" <<< "$output"
}

@test "tracked dispatcher source refuses Sonnet-tier models for Claude full panes" {
    [ -f "$SOURCE_DISPATCHER" ]

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function claude() { print -r -- "CLAUDE_LAUNCHED=$*"; }

      source "$2"
      testrepoClaude -m claude-sonnet-4-6
      model_status=$?
      testrepoClaude -S
      shortcut_status=$?
      (( model_status == 2 && shortcut_status == 2 ))
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    [ "$(grep -Fc -- "refuse Sonnet-tier models for full panes" <<< "$output")" -eq 2 ]
    ! grep -F -q -- "CLAUDE_LAUNCHED=" <<< "$output"
    ! grep -F -q -- "REPOGOLEM_ALLOW_MODEL" <<< "$output"
}

@test "tracked dispatcher source allows Sonnet-tier Claude headless runs" {
    [ -f "$SOURCE_DISPATCHER" ]

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function claude() {
        local arg
        for arg in "$@"; do print -r -- "CLAUDE_ARG=$arg"; done
      }

      source "$2"
      testrepoClaude -p "subagent-style one shot" -m claude-sonnet-4-6
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    [ "$(grep -Fxc -- "CLAUDE_ARG=--print" <<< "$output")" -eq 1 ]
    [ "$(grep -Fxc -- "CLAUDE_ARG=--model" <<< "$output")" -eq 1 ]
    [ "$(grep -Fxc -- "CLAUDE_ARG=claude-sonnet-4-6" <<< "$output")" -eq 1 ]
}

@test "tracked dispatcher source propagates Claude exit status" {
    [ -f "$SOURCE_DISPATCHER" ]

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }

      function claude() {
        print -r -- "CLAUDE_ARGS=$*"
        return 42
      }

      source "$2"
      testrepoClaude -s
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 42 ]
    grep -F -q -- "CLAUDE_ARGS=" <<< "$output"
}

@test "tracked dispatcher source normalizes remote MCP URL keys for Antigravity" {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home" "$TMPDIR_/bin"
    cat > "$PROJECT_DIR/.mcp.json" <<'JSON'
{
  "mcpServers": {
    "urlRemote": { "url": "https://example.com/url-mcp" },
    "httpRemote": { "httpUrl": "https://example.com/http-mcp" }
  }
}
JSON
    cat > "$TMPDIR_/bin/agy" <<'AGY'
#!/usr/bin/env zsh
print -r -- "AGY_ARGS=$*"
AGY
    chmod +x "$TMPDIR_/bin/agy"

    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"
      export PATH="$3:$PATH"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{\"registryRemote\":{\"url\":\"https://example.com/registry-mcp\"}}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }

      source "$4"
      testrepoGemini "Prep remote MCPs"
      jq -r ".mcpServers.registryRemote.serverUrl" "$5/.agents/mcp_config.json"
      jq -r ".mcpServers.urlRemote.serverUrl" "$5/.agents/mcp_config.json"
      jq -r ".mcpServers.httpRemote.serverUrl" "$5/.agents/mcp_config.json"
      jq -r ".mcpServers.urlRemote.url // empty" "$5/.agents/mcp_config.json"
      jq -r ".mcpServers.httpRemote.httpUrl // empty" "$5/.agents/mcp_config.json"
      jq -r ".mcpServers.urlRemote.serverUrl" "$1/.gemini/config/mcp_config.json"
    ' _ "$fake_home" "$REGISTRY_FILE" "$TMPDIR_/bin" "$SOURCE_DISPATCHER" "$PROJECT_DIR"

    [ "$status" -eq 0 ]
    grep -F -q -- "https://example.com/registry-mcp" <<< "$output"
    grep -F -q -- "https://example.com/url-mcp" <<< "$output"
    grep -F -q -- "https://example.com/http-mcp" <<< "$output"
    ! grep -F -q -- ".url" <<< "$output"
}

@test "tracked dispatcher source syncs Antigravity MCP config from selected worktree" {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home" "$TMPDIR_/bin"
    cat > "$PROJECT_DIR/.mcp.json" <<'JSON'
{
  "mcpServers": {
    "projectRemote": { "url": "https://example.com/project-mcp" }
  }
}
JSON
    cat > "$WORKTREE_DIR/.mcp.json" <<'JSON'
{
  "mcpServers": {
    "worktreeRemote": { "url": "https://example.com/worktree-mcp" }
  }
}
JSON
    cat > "$TMPDIR_/bin/agy" <<'AGY'
#!/usr/bin/env zsh
print -r -- "AGY_ARGS=$*"
AGY
    chmod +x "$TMPDIR_/bin/agy"

    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"
      export PATH="$3:$PATH"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{\"registryRemote\":{\"url\":\"https://example.com/registry-mcp\"}}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }

      source "$4"
      testrepoGemini -w "$5" "Prep worktree MCPs"
      jq -r ".mcpServers.registryRemote.serverUrl" "$5/.agents/mcp_config.json"
      jq -r ".mcpServers.worktreeRemote.serverUrl" "$5/.agents/mcp_config.json"
      jq -r ".mcpServers.projectRemote.serverUrl // empty" "$5/.agents/mcp_config.json"
      test ! -e "$6/.agents/mcp_config.json"
    ' _ "$fake_home" "$REGISTRY_FILE" "$TMPDIR_/bin" "$SOURCE_DISPATCHER" "$WORKTREE_DIR" "$PROJECT_DIR"

    [ "$status" -eq 0 ]
    grep -F -q -- "https://example.com/registry-mcp" <<< "$output"
    grep -F -q -- "https://example.com/worktree-mcp" <<< "$output"
    ! grep -F -q -- "https://example.com/project-mcp" <<< "$output"
}

@test "tracked dispatcher source maps alternate remote MCP URL keys for Codex" {
    [ -f "$SOURCE_DISPATCHER" ]

    cat > "$PROJECT_DIR/.mcp.json" <<'JSON'
{
  "mcpServers": {
    "httpRemote": {
      "httpUrl": "https://example.com/http-mcp",
      "env": { "HTTP_TOKEN": "http-token" }
    },
    "serverRemote": {
      "serverUrl": "https://example.com/server-mcp",
      "env": { "SERVER_TOKEN": "server-token" }
    }
  }
}
JSON

    local codex_home="$TMPDIR_/codex-home-remote"
    mkdir -p "$codex_home/sessions"

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"
      export CODEX_HOME="$3"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{\"registryRemote\":{\"serverUrl\":\"https://example.com/registry-mcp\",\"env\":{\"REGISTRY_TOKEN\":\"registry-token\"}}}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function codex() {
        print -r -- "CODEX_ARGS=$*"
        print -r -- "HTTP_TOKEN=${HTTP_TOKEN:-}"
        print -r -- "SERVER_TOKEN=${SERVER_TOKEN:-}"
        print -r -- "REGISTRY_TOKEN=${REGISTRY_TOKEN:-}"
        local p
        for p in "$CODEX_HOME"/repogolem-*.config.toml(N); do cp "$p" "$CODEX_HOME/captured.toml"; done
      }

      source "$2"
      testrepoCodex -s
      print -r -- "AFTER_HTTP_TOKEN=${HTTP_TOKEN:-}"
      print -r -- "AFTER_SERVER_TOKEN=${SERVER_TOKEN:-}"
      print -r -- "AFTER_REGISTRY_TOKEN=${REGISTRY_TOKEN:-}"
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER" "$codex_home"

    [ "$status" -eq 0 ]
    # URL normalization now lands in the 0600 per-project profile, never on argv
    refute_contains "mcp_servers." "$output" "codex argv must not carry MCP config keys"
    grep -E -q -- "--profile repogolem-testrepo-[0-9a-f]{8}" <<< "$output"
    grep -F -q -- 'url = "https://example.com/http-mcp"' "$codex_home/captured.toml"
    grep -F -q -- 'url = "https://example.com/server-mcp"' "$codex_home/captured.toml"
    grep -F -q -- 'url = "https://example.com/registry-mcp"' "$codex_home/captured.toml"
    grep -F -q -- "HTTP_TOKEN=http-token" <<< "$output"
    grep -F -q -- "SERVER_TOKEN=server-token" <<< "$output"
    grep -F -q -- "REGISTRY_TOKEN=registry-token" <<< "$output"
    grep -F -q -- "AFTER_HTTP_TOKEN=" <<< "$output"
    grep -F -q -- "AFTER_SERVER_TOKEN=" <<< "$output"
    grep -F -q -- "AFTER_REGISTRY_TOKEN=" <<< "$output"
    ! grep -F -q -- "AFTER_HTTP_TOKEN=http-token" <<< "$output"
    ! grep -F -q -- "AFTER_SERVER_TOKEN=server-token" <<< "$output"
    ! grep -F -q -- "AFTER_REGISTRY_TOKEN=registry-token" <<< "$output"
    ! grep -F -q -- "mcp_servers.httpRemote.env.HTTP_TOKEN" <<< "$output"
    ! grep -F -q -- "mcp_servers.serverRemote.env.SERVER_TOKEN" <<< "$output"
    ! grep -F -q -- "mcp_servers.registryRemote.env.REGISTRY_TOKEN" <<< "$output"
}

@test "tracked dispatcher source defaults fresh Codex launch modes to high effort and preserves continued effort" {
    [ -f "$SOURCE_DISPATCHER" ]

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

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

      source "$2"
      testrepoCodex -s
      testrepoCodex -s -p "one shot"
      testrepoCodex -s -c "continue"
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    for call in 1 2; do
      local call_output
      call_output=$(awk -v call="$call" '
        $0 == "CODEX_CALL=" call { in_call = 1; next }
        /^CODEX_CALL=/ { in_call = 0 }
        in_call { print }
      ' <<< "$output")
      [ "$(grep -Fxc -- 'CODEX_ARG=model_reasoning_effort="high"' <<< "$call_output")" -eq 1 ]
      [ "$(grep -Fxc -- 'CODEX_ARG=-c' <<< "$call_output")" -eq 1 ]
    done
    local continue_output
    continue_output=$(awk '
      $0 == "CODEX_CALL=3" { in_call = 1; next }
      /^CODEX_CALL=/ { in_call = 0 }
      in_call { print }
    ' <<< "$output")
    [ "$(grep -Fxc -- 'CODEX_ARG=model_reasoning_effort="high"' <<< "$continue_output")" -eq 1 ]
    grep -F -q -- "CODEX_ARG=exec" <<< "$output"
    grep -F -q -- "CODEX_ARG=resume" <<< "$output"
    grep -F -q -- "CODEX_ARG=--last" <<< "$output"
}

@test "tracked dispatcher source pins fresh Codex launch modes to the current top Sol" {
    [ -f "$SOURCE_DISPATCHER" ]

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"

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

      source "$2"
      testrepoCodex -s
      testrepoCodex -s -p "one shot"
      testrepoCodex -s -c "continue"
      testrepoCodex --worker -s "Implement brief"
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    for call in 1 2 4; do
      local call_output
      call_output=$(awk -v call="$call" '
        $0 == "CODEX_CALL=" call { in_call = 1; next }
        /^CODEX_CALL=/ { in_call = 0 }
        in_call { print }
      ' <<< "$output")
      [ "$(grep -Fxc -- "CODEX_ARG=--model" <<< "$call_output")" -eq 1 ]
      [ "$(grep -Fxc -- "CODEX_ARG=gpt-5.6-sol" <<< "$call_output")" -eq 1 ]
    done
    local continue_output
    continue_output=$(awk '
      $0 == "CODEX_CALL=3" { in_call = 1; next }
      /^CODEX_CALL=/ { in_call = 0 }
      in_call { print }
    ' <<< "$output")
    [ "$(grep -Fxc -- "CODEX_ARG=--model" <<< "$continue_output")" -eq 1 ]
    [ "$(grep -Fxc -- "CODEX_ARG=gpt-5.6-terra" <<< "$continue_output")" -eq 1 ]
    [ "$(grep -Fxc -- "CODEX_ARG=gpt-5.6-sol" <<< "$continue_output")" -eq 0 ]
    grep -F -q -- "CODEX_ARG=exec" <<< "$output"
    grep -F -q -- "CODEX_ARG=resume" <<< "$output"
    grep -F -q -- "CODEX_ARG=--last" <<< "$output"
    refute_contains "Worker mode" "$output" "worker prompt must pass through without launcher text"
    grep -F -q -- "CODEX_ARG=Implement brief" <<< "$output"
}

@test "tracked dispatcher source accepts a bare Codex model and effort override" {
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
      testrepoCodex -m gpt-5.6-luna -E max
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    [ "$(grep -Fxc -- "CODEX_ARG=--model" <<< "$output")" -eq 1 ]
    [ "$(grep -Fxc -- "CODEX_ARG=gpt-5.6-luna" <<< "$output")" -eq 1 ]
    [ "$(grep -Fxc -- 'CODEX_ARG=model_reasoning_effort="max"' <<< "$output")" -eq 1 ]
    ! grep -F -q -- "gpt-5.6-sol" <<< "$output"
    ! grep -F -q -- "REPOGOLEM_ALLOW_MODEL" <<< "$output"
}

@test "tracked dispatcher source passes an unknown Codex model through verbatim" {
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
        print -r -- "CODEX_REFUSAL=unknown model from codex"
        return 47
      }

      source "$2"
      testrepoCodex -m future-model-from-provider
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 47 ]
    [ "$(grep -Fxc -- "CODEX_ARG=--model" <<< "$output")" -eq 1 ]
    [ "$(grep -Fxc -- "CODEX_ARG=future-model-from-provider" <<< "$output")" -eq 1 ]
    grep -F -q -- "CODEX_REFUSAL=unknown model from codex" <<< "$output"
    ! grep -F -q -- "gpt-5.6-sol" <<< "$output"
}

@test "tracked dispatcher source restores the newest cwd-matching Codex model and effort on continue" {
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
      testrepoCodex -c
      testrepoCodex -c -m gpt-5.6-luna
      testrepoCodex -c -E max
    ' _ "$codex_home" "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    local preserved_output model_output effort_output
    preserved_output=$(awk '
      $0 == "CODEX_CALL=1" { in_call = 1; next }
      /^CODEX_CALL=/ { in_call = 0 }
      in_call { print }
    ' <<< "$output")
    model_output=$(awk '
      $0 == "CODEX_CALL=2" { in_call = 1; next }
      /^CODEX_CALL=/ { in_call = 0 }
      in_call { print }
    ' <<< "$output")
    effort_output=$(awk '
      $0 == "CODEX_CALL=3" { in_call = 1; next }
      /^CODEX_CALL=/ { in_call = 0 }
      in_call { print }
    ' <<< "$output")
    grep -F -q -- "CODEX_ARG=resume" <<< "$preserved_output"
    grep -F -q -- "CODEX_ARG=--last" <<< "$preserved_output"
    [ "$(grep -Fxc -- "CODEX_ARG=--model" <<< "$preserved_output")" -eq 1 ]
    [ "$(grep -Fxc -- "CODEX_ARG=gpt-5.6-terra" <<< "$preserved_output")" -eq 1 ]
    [ "$(grep -Fxc -- 'CODEX_ARG=model_reasoning_effort="high"' <<< "$preserved_output")" -eq 1 ]
    ! grep -F -q -- "gpt-5.6-luna" <<< "$preserved_output"
    [ "$(grep '^CODEX_ARG=' <<< "$preserved_output")" = $'CODEX_ARG=resume\nCODEX_ARG=--last\nCODEX_ARG=-c\nCODEX_ARG=model_reasoning_effort="high"\nCODEX_ARG=--model\nCODEX_ARG=gpt-5.6-terra' ]
    grep -F -q -- "CODEX_ARG=resume" <<< "$model_output"
    grep -F -q -- "CODEX_ARG=--last" <<< "$model_output"
    [ "$(grep -Fxc -- "CODEX_ARG=--model" <<< "$model_output")" -eq 1 ]
    [ "$(grep -Fxc -- "CODEX_ARG=gpt-5.6-luna" <<< "$model_output")" -eq 1 ]
    [ "$(grep -Fxc -- 'CODEX_ARG=model_reasoning_effort="high"' <<< "$model_output")" -eq 1 ]
    ! grep -F -q -- "gpt-5.6-terra" <<< "$model_output"
    grep -F -q -- "CODEX_ARG=resume" <<< "$effort_output"
    grep -F -q -- "CODEX_ARG=--last" <<< "$effort_output"
    [ "$(grep -Fxc -- "CODEX_ARG=--model" <<< "$effort_output")" -eq 1 ]
    [ "$(grep -Fxc -- "CODEX_ARG=gpt-5.6-terra" <<< "$effort_output")" -eq 1 ]
    [ "$(grep -Fxc -- 'CODEX_ARG=model_reasoning_effort="max"' <<< "$effort_output")" -eq 1 ]
}

@test "tracked dispatcher source resolves Codex --last with one metadata parser process" {
    [ -f "$SOURCE_DISPATCHER" ]

    local codex_home="$TMPDIR_/codex-home"
    local jq_call_log="$TMPDIR_/jq-calls.log"
    stage_codex_session_fixtures "$codex_home" "$PROJECT_DIR" "$TMPDIR_/other-project"

    run zsh -f -c '
      export CODEX_HOME="$1"
      export RALPH_REGISTRY_FILE="$2"
      export JQ_CALL_LOG="$4"

      function jq() {
        print -r -- call >> "$JQ_CALL_LOG"
        command jq "$@"
      }

      source "$3"
      : > "$JQ_CALL_LOG"
      _golem_find_codex_resume_rollout --last "$5"
      print -r -- "JQ_CALLS=$(wc -l < "$JQ_CALL_LOG" | tr -d " ")"
    ' _ "$codex_home" "$REGISTRY_FILE" "$SOURCE_DISPATCHER" "$jq_call_log" "$PROJECT_DIR"

    [ "$status" -eq 0 ]
    grep -F -q -- "019fec96-588d-7000-8000-000000000001.jsonl" <<< "$output"
    grep -F -x -q -- "JQ_CALLS=1" <<< "$output"
}

@test "tracked dispatcher source treats Codex skip permissions as a compatibility no-op" {
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
        print -r -- "CODEX_LAUNCHED=1"
        local arg
        for arg in "$@"; do print -r -- "CODEX_ARG=$arg"; done
      }

      source "$2"
      testrepoCodex -s
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    [ "$(grep -Fxc -- "CODEX_LAUNCHED=1" <<< "$output")" -eq 1 ]
    ! grep -F -q -- "CODEX_ARG=--dangerously-bypass-approvals-and-sandbox" <<< "$output"
    ! grep -F -q -- "CODEX_ARG=--dangerously-bypass-hook-trust" <<< "$output"
}

@test "tracked dispatcher source restores the last model and effort for an explicit Codex session" {
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
      testrepoCodex -s resume 019fec96-588d-7000-8000-000000000000
    ' _ "$codex_home" "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    [ "$(grep '^CODEX_ARG=' <<< "$output")" = $'CODEX_ARG=resume\nCODEX_ARG=019fec96-588d-7000-8000-000000000000\nCODEX_ARG=-c\nCODEX_ARG=model_reasoning_effort="xhigh"\nCODEX_ARG=--model\nCODEX_ARG=gpt-5.6-sol' ]
    [ "$(grep -Fc -- "Adopt the following launcher agent context" <<< "$output")" -eq 0 ]
}

@test "tracked dispatcher source reuses the requested Codex session id with the real CLI" {
    [ -f "$SOURCE_DISPATCHER" ]
    local real_codex
    real_codex="$(command -v codex || true)"
    [ -n "$real_codex" ] || skip "codex CLI is not installed"

    local codex_home="$TMPDIR_/codex-home"
    stage_codex_session_fixtures "$codex_home" "$PROJECT_DIR" "$TMPDIR_/other-project"
    write_unroutable_codex_config "$codex_home"

    run zsh -f -c '
      export CODEX_HOME="$1"
      export RALPH_REGISTRY_FILE="$2"
      typeset -g REAL_CODEX_PATH="$4"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function codex() {
        local continuity_output
        continuity_output=$(timeout 5 "$REAL_CODEX_PATH" exec "$@" --skip-git-repo-check "ping" 2>&1)
        print -r -- "$continuity_output"
        return 0
      }

      source "$3"
      testrepoCodex -s resume 019fec96-588d-7000-8000-000000000000
    ' _ "$codex_home" "$REGISTRY_FILE" "$SOURCE_DISPATCHER" "$real_codex"

    [ "$status" -eq 0 ]
    grep -F -x -q -- "session id: 019fec96-588d-7000-8000-000000000000" <<< "$output"
}

@test "tracked dispatcher source restores raw --last and keeps explicit resume overrides authoritative" {
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
      testrepoCodex resume --last
      testrepoCodex resume 019fec96-588d-7000-8000-000000000000 -m gpt-5.6-luna -E max
    ' _ "$codex_home" "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    local last_output override_output
    last_output=$(awk '
      $0 == "CODEX_CALL=1" { in_call = 1; next }
      /^CODEX_CALL=/ { in_call = 0 }
      in_call { print }
    ' <<< "$output")
    override_output=$(awk '
      $0 == "CODEX_CALL=2" { in_call = 1; next }
      /^CODEX_CALL=/ { in_call = 0 }
      in_call { print }
    ' <<< "$output")

    grep -F -q -- "CODEX_ARG=resume" <<< "$last_output"
    grep -F -q -- "CODEX_ARG=--last" <<< "$last_output"
    [ "$(grep -Fxc -- 'CODEX_ARG=--model' <<< "$last_output")" -eq 1 ]
    [ "$(grep -Fxc -- 'CODEX_ARG=gpt-5.6-terra' <<< "$last_output")" -eq 1 ]
    [ "$(grep -Fxc -- 'CODEX_ARG=model_reasoning_effort="high"' <<< "$last_output")" -eq 1 ]
    [ "$(grep '^CODEX_ARG=' <<< "$last_output")" = $'CODEX_ARG=resume\nCODEX_ARG=--last\nCODEX_ARG=-c\nCODEX_ARG=model_reasoning_effort="high"\nCODEX_ARG=--model\nCODEX_ARG=gpt-5.6-terra' ]

    grep -F -q -- "CODEX_ARG=019fec96-588d-7000-8000-000000000000" <<< "$override_output"
    [ "$(grep -Fxc -- 'CODEX_ARG=--model' <<< "$override_output")" -eq 1 ]
    [ "$(grep -Fxc -- 'CODEX_ARG=gpt-5.6-luna' <<< "$override_output")" -eq 1 ]
    [ "$(grep -Fxc -- 'CODEX_ARG=model_reasoning_effort="max"' <<< "$override_output")" -eq 1 ]
    ! grep -F -q -- "gpt-5.6-sol" <<< "$override_output"
    ! grep -F -q -- 'model_reasoning_effort="xhigh"' <<< "$override_output"
    [ "$(grep '^CODEX_ARG=' <<< "$override_output")" = $'CODEX_ARG=resume\nCODEX_ARG=019fec96-588d-7000-8000-000000000000\nCODEX_ARG=-c\nCODEX_ARG=model_reasoning_effort="max"\nCODEX_ARG=--model\nCODEX_ARG=gpt-5.6-luna' ]
}

@test "tracked dispatcher source skips rollout recovery when Codex resume model and effort are both explicit" {
    [ -f "$SOURCE_DISPATCHER" ]

    local codex_home="$TMPDIR_/codex-home"
    mkdir -p "$codex_home/sessions"

    run zsh -f -c '
      export CODEX_HOME="$1"
      export RALPH_REGISTRY_FILE="$2"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }

      source "$3"
      function _golem_find_codex_resume_rollout() {
        print -u2 -r -- "RECOVERY_CALLED"
        return 1
      }
      typeset -gi codex_call=0
      function codex() {
        (( codex_call += 1 ))
        print -r -- "CODEX_CALL=$codex_call"
        local arg
        for arg in "$@"; do print -r -- "CODEX_ARG=$arg"; done
      }

      testrepoCodex resume 019fec96-588d-7000-8000-000000000099 -m gpt-5.6-luna -E max
      explicit_status=$?
      testrepoCodex -c -m gpt-5.6-luna -E max
      last_status=$?
      print -r -- "STATUSES=$explicit_status,$last_status"
      (( explicit_status == 0 && last_status == 0 ))
    ' _ "$codex_home" "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    ! grep -F -q -- "RECOVERY_CALLED" <<< "$output"
    grep -F -q -- "STATUSES=0,0" <<< "$output"
    [ "$(grep -Fxc -- "CODEX_CALL=1" <<< "$output")" -eq 1 ]
    [ "$(grep -Fxc -- "CODEX_CALL=2" <<< "$output")" -eq 1 ]
    [ "$(grep -Fxc -- 'CODEX_ARG=model_reasoning_effort="max"' <<< "$output")" -eq 2 ]
    [ "$(grep -Fxc -- "CODEX_ARG=gpt-5.6-luna" <<< "$output")" -eq 2 ]
}

@test "tracked dispatcher source skips a malformed newest Codex --last rollout for the next usable session" {
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
    ! grep -F -q -- "gpt-broken-rollout" <<< "$output"
    ! grep -F -q -- "turbo" <<< "$output"
}

@test "tracked dispatcher source detects explicit Codex resume after root option prefixes" {
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

@test "tracked dispatcher source refuses every Codex resume combined with a headless prompt" {
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

@test "tracked dispatcher source refuses a resume picker it cannot honor" {
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

@test "tracked dispatcher source fails loudly when resume rollout state is missing or malformed" {
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

@test "tracked dispatcher source preserves cmuxlayer's canonical Codex recovery command" {
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
    [ "$(grep '^CODEX_ARG=' <<< "$output")" = $'CODEX_ARG=resume\nCODEX_ARG=019fec96-588d-7000-8000-000000000000\nCODEX_ARG=--dangerously-bypass-approvals-and-sandbox\nCODEX_ARG=-c\nCODEX_ARG=model_reasoning_effort="xhigh"\nCODEX_ARG=--model\nCODEX_ARG=gpt-5.6-sol' ]
    [ "$(grep -Fc -- "Adopt the following launcher agent context" <<< "$output")" -eq 0 ]
}

@test "tracked dispatcher source accepts the full verified Codex effort ladder through both aliases" {
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
    for effort in low medium high xhigh max ultra; do
      [ "$(grep -Fxc -- "CODEX_ARG=model_reasoning_effort=\"$effort\"" <<< "$output")" -eq 2 ]
    done
    [ "$(grep -Fxc -- 'CODEX_ARG=-c' <<< "$output")" -eq 12 ]
    ! grep -F -q -- "CODEX_ARG=-E" <<< "$output"
    ! grep -F -q -- "CODEX_ARG=--effort" <<< "$output"
}

@test "tracked dispatcher source rejects missing and invalid Codex efforts before launch" {
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

@test "tracked dispatcher source exposes Codex effort launcher help without launching" {
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
    grep -F -q -- "default: Codex high; Claude -E > GOLEM_EFFORT > worker medium > high" <<< "$output"
    grep -F -q -- "set it per dispatch" <<< "$output"
    ! grep -F -q -- "CODEX_LAUNCHED=" <<< "$output"
}

@test "tracked dispatcher source stops parsing Codex effort flags after double dash" {
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
      testrepoCodex -- --help -E ultra
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    [ "$(grep -Fxc -- 'CODEX_ARG=model_reasoning_effort="high"' <<< "$output")" -eq 1 ]
    [ "$(grep -Fxc -- 'CODEX_ARG=--' <<< "$output")" -eq 0 ]
    grep -F -q -- "CODEX_ARG=--help" <<< "$output"
    grep -F -q -- "CODEX_ARG=-E" <<< "$output"
    grep -F -q -- "CODEX_ARG=ultra" <<< "$output"
    ! grep -F -q -- "Codex launcher options:" <<< "$output"
}

@test "tracked dispatcher source stops unified Codex flag parsing after double dash" {
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
      testrepoCodex -- -c raw-config -p -m raw-model -s -w "$3"
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER" "$WORKTREE_DIR"

    [ "$status" -eq 0 ]
    [ "$(grep -Fxc -- 'CODEX_ARG=model_reasoning_effort="high"' <<< "$output")" -eq 1 ]
    [ "$(grep -Fxc -- 'CODEX_ARG=-c' <<< "$output")" -eq 2 ]
    for arg in raw-config -p -m raw-model -s -w "$WORKTREE_DIR"; do
      grep -F -q -- "CODEX_ARG=$arg" <<< "$output"
    done
    [ "$(grep -Fxc -- 'CODEX_ARG=--' <<< "$output")" -eq 0 ]
    ! grep -F -q -- "CODEX_ARG=resume" <<< "$output"
    ! grep -F -q -- "CODEX_ARG=exec" <<< "$output"
}

@test "tracked dispatcher source rejects missing model names before launch" {
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

@test "tracked dispatcher source rejects missing project directories before launch" {
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
      testrepoGemini "Prep Theo voice pairs"
    ' _ "$TMPDIR_/registry-missing-path.json" "$TMPDIR_/bin" "$SOURCE_DISPATCHER"

    [ "$status" -eq 1 ]
    grep -F -q -- "Project path not found: /tmp/repogolem-missing-project-path" <<< "$output"
    ! grep -F -q -- "AGY_ARGS=" <<< "$output"
}

@test "tracked dispatcher source passes Claude contexts by file path" {
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

@test "tracked dispatcher source keeps CodexWorker launcher persona-free" {
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
      testrepoCodexWorker -s "Implement brief"
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    refute_contains "Worker mode" "$output" "CodexWorker prompt must not add launcher text"
    grep -F -q -- "CODEX_ARG=Implement brief" <<< "$output"
    assert_no_worker_persona_markers "$output"
}

@test "cmuxlayerCodex --worker launches without a positional prompt" {
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
      cmuxlayerCodex --worker -s
    ' _ "$TMPDIR_/worker-registry.json" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    refute_contains "Worker mode" "$output" "worker launch without a user prompt must not add a banner"
    grep -F -q -- "CODEX_ARG_COUNT=4" <<< "$output"
}

@test "orcCodex --worker ignores registry agent when no prompt is supplied" {
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
      orcCodex --worker -s
    ' _ "$fake_home" "$TMPDIR_/worker-registry.json" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "CODEX_ARG_COUNT=4" <<< "$output"
    refute_contains "Worker mode" "$output" "worker launch with a registry agent must not add a banner"
    refute_contains "registry agent context" "$output" "worker launch must remain persona-free"
}

@test "mimirCodex --worker passes the user prompt through unchanged" {
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
      mimirCodex --worker -s "do X"
    ' _ "$TMPDIR_/worker-registry.json" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "CODEX_ARG_COUNT=5" <<< "$output"
    [ "$(grep -Fxc -- "CODEX_ARG=do X" <<< "$output")" -eq 1 ]
    refute_contains "Worker mode" "$output" "worker launch must pass the user prompt through without a banner"
}

@test "orcCodex non-worker launch still injects its registry agent context" {
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

@test "tracked dispatcher source honors GOLEM_ROLE worker mode without persona injection" {
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
      GOLEM_ROLE=worker testrepoCodex -s "Implement brief"
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    refute_contains "Worker mode" "$output" "GOLEM_ROLE worker prompt must not add launcher text"
    grep -F -q -- "CODEX_ARG=Implement brief" <<< "$output"
    assert_no_worker_persona_markers "$output"
}

@test "tracked dispatcher source honors the long --worker flag without persona injection" {
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

@test "tracked dispatcher source adds no worker prompt to raw Codex arguments" {
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

@test "tracked dispatcher source keeps default Codex output byte-stable" {
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
      | grep -Fv -- 'CODEX_ARG=model_reasoning_effort="high"' \
      | grep -Fv -- 'CODEX_ARG=--model' \
      | grep -Fv -- 'CODEX_ARG=gpt-5.6-sol' \
      | sed 's/^CODEX_ARG_COUNT=5$/CODEX_ARG_COUNT=1/')
    local actual_hash
    actual_hash=$(printf '%s' "$normalized_output" | shasum -a 256 | awk '{print $1}')
    [ "$actual_hash" = "521e5aac195a56df8db3ad8778287dc14f8f123f046e075213a4947d588b1cb2" ]
}

@test "testrepoCodex consumes -w and launches from the requested worktree" {
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
    ! grep -F -q -- "--dangerously-bypass-approvals-and-sandbox" <<< "$output"
    grep -F -q -- "--model gpt-5.6-sol" <<< "$output"
    ! grep -F -q -- "--worktree" <<< "$output"
    ! grep -F -q "unexpected argument" <<< "$output"
}

@test "testrepoCodex without -w still launches from the project path" {
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
    ! grep -F -q -- "--dangerously-bypass-approvals-and-sandbox" <<< "$output"
    grep -F -q -- "--model gpt-5.6-sol" <<< "$output"
    ! grep -F -q -- "--worktree" <<< "$output"
}

@test "testrepoGemini injects BrainLayer-first ambiguity gate for named people and private voices" {
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
      testrepoGemini -s "Prep Theo voice pairs"
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$TMPDIR_/bin" "$WORKTREE_DIR" "$DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "BrainLayer-first ambiguity gate" <<< "$output"
    grep -F -q -- "Theo Brown / T3.gg / existing Theo voice artifacts" <<< "$output"
    grep -F -q -- "BLOCKED_BRAINLAYER_UNAVAILABLE" <<< "$output"
    ! grep -F -q -- "Theo Von" <<< "$output"
}

@test "testrepoClaude defaults to Opus 5 1M-context (no manual /model flip)" {
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
    grep -F -q -- "--model claude-opus-5[1m]" <<< "$output"
    grep -F -q -- "--dangerously-skip-permissions" <<< "$output"
}

@test "testrepoClaude -S refuses Sonnet for a full pane" {
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

@test "testrepoClaude -m accepts an explicit Opus model for a full pane" {
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

@test "testrepoClaude --model accepts an explicit Opus model for a full pane" {
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

@test "testrepoClaude -m is allowed for scripted one-shots" {
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

@test "testrepoClaude -m does not require the legacy model escape hatch" {
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

@test "testrepoCodex -m accepts an explicit model for a full pane" {
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

@test "testrepoCursor -m refuses agent sessions" {
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

@test "tracked dispatcher source keeps Codex MCP config and secrets off argv" {
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

@test "tracked dispatcher source honors an explicit Codex profile instead of appending a second one" {
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

@test "tracked dispatcher source scopes the Codex profile per launch directory" {
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

@test "tracked dispatcher source isolates concurrent Codex profiles for the same project" {
    [ -f "$SOURCE_DISPATCHER" ]

    local codex_home="$TMPDIR_/codex-home-concurrent-profiles"
    mkdir -p "$codex_home/sessions"

    cat > "$PROJECT_DIR/.mcp.json" <<'JSON'
{ "mcpServers": { "linear": { "command": "linear-mcp" } } }
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
      function codex() {
        local profile="" previous=""
        local arg
        for arg in "$@"; do
          if [[ "$previous" == "--profile" ]]; then
            profile="$arg"
            break
          fi
          previous="$arg"
        done
        [[ -n "$profile" ]] || return 90
        local profile_file="$CODEX_HOME/${profile}.config.toml"
        [[ -f "$profile_file" ]] || return 91
        print -r -- "$profile" > "$CODEX_HOME/ready-${GOLEM_TEST_LAUNCH}"
        while [[ ! -e "$CODEX_HOME/release-${GOLEM_TEST_LAUNCH}" ]]; do
          sleep 0.02
        done
      }

      source "$2"
      GOLEM_TEST_LAUNCH=A testrepoCodex -s &
      launch_a=$!
      GOLEM_TEST_LAUNCH=B testrepoCodex -s &
      launch_b=$!

      integer attempt
      for attempt in {1..100}; do
        [[ -f "$CODEX_HOME/ready-A" && -f "$CODEX_HOME/ready-B" ]] && break
        sleep 0.02
      done
      if [[ ! -f "$CODEX_HOME/ready-A" || ! -f "$CODEX_HOME/ready-B" ]]; then
        touch "$CODEX_HOME/release-A" "$CODEX_HOME/release-B"
        wait "$launch_a" "$launch_b"
        print -r -- "CONCURRENT_READY_TIMEOUT"
        exit 92
      fi

      profile_a=$(<"$CODEX_HOME/ready-A")
      profile_b=$(<"$CODEX_HOME/ready-B")
      if [[ "$profile_a" == "$profile_b" ]]; then
        touch "$CODEX_HOME/release-A" "$CODEX_HOME/release-B"
        wait "$launch_a" "$launch_b"
        print -r -- "PROFILE_COLLISION=$profile_a"
        exit 93
      fi

      file_a="$CODEX_HOME/${profile_a}.config.toml"
      file_b="$CODEX_HOME/${profile_b}.config.toml"
      [[ -f "$file_a" && -f "$file_b" ]] || exit 94
      [[ "$(stat -f %OLp "$file_a")" == 600 ]] || exit 95
      [[ "$(stat -f %OLp "$file_b")" == 600 ]] || exit 96
      print -r -- "CONCURRENT_PROFILES=$profile_a,$profile_b"

      touch "$CODEX_HOME/release-A"
      wait "$launch_a"
      [[ ! -e "$file_a" ]] || exit 97
      [[ -f "$file_b" ]] || exit 98
      print -r -- "LAUNCH_B_PROFILE_SURVIVED=$profile_b"

      touch "$CODEX_HOME/release-B"
      wait "$launch_b"
      [[ ! -e "$file_b" ]] || exit 99
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER" "$codex_home"

    if [ "$status" -ne 0 ]; then
      printf '%s\n' "$output" >&2
    fi
    [ "$status" -eq 0 ]
    grep -F -q -- "CONCURRENT_PROFILES=" <<< "$output"
    grep -F -q -- "LAUNCH_B_PROFILE_SURVIVED=" <<< "$output"
}

@test "tracked dispatcher source refuses a Codex profile when launch id generation fails" {
    [ -f "$SOURCE_DISPATCHER" ]

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"
      export CODEX_HOME="$3"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function head() { return 1; }
      function codex() { print -r -- "CODEX_LAUNCHED"; }

      source "$2"
      function _golem_setup_title() { print -r -- "TITLE_SET"; }
      function _golem_reset_title() { print -r -- "TITLE_RESET"; }
      testrepoCodex -s
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER" "$CODEX_HOME"

    if [ "$status" -ne 1 ]; then
      printf '%s\n' "$output" >&2
    fi
    [ "$status" -eq 1 ]
    grep -F -q -- "could not generate a unique Codex profile id" <<< "$output"
    grep -F -q -- "TITLE_RESET" <<< "$output"
    refute_contains "CODEX_LAUNCHED" "$output" "Codex must not launch with an unverified profile id"
}

@test "tracked dispatcher source renders valid TOML for a non-numeric MCP timeout" {
    [ -f "$SOURCE_DISPATCHER" ]

    local codex_home="$TMPDIR_/codex-home-timeout"
    mkdir -p "$codex_home/sessions"

    cat > "$PROJECT_DIR/.mcp.json" <<'JSON'
{ "mcpServers": { "slow": { "command": "slow-mcp", "timeout": "30s" } } }
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
    # `timeout = 30s` is not valid TOML — codex aborts the whole launch with
    # "string values must be quoted", pointing at a generated file
    run python3 -c 'import sys,tomllib;tomllib.load(open(sys.argv[1],"rb"));print("TOML_OK")' "$codex_home/captured.toml"
    [ "$status" -eq 0 ]
    grep -F -q -- "TOML_OK" <<< "$output"
}

@test "tracked dispatcher source renders valid TOML for non-string MCP args" {
    [ -f "$SOURCE_DISPATCHER" ]

    local codex_home="$TMPDIR_/codex-home-args"
    mkdir -p "$codex_home/sessions"

    cat > "$PROJECT_DIR/.mcp.json" <<'JSON'
{ "mcpServers": { "odd": { "command": "odd-mcp", "args": ["--flag", {"nested": 1}, null] } } }
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
    run python3 -c 'import sys,tomllib;print(tomllib.load(open(sys.argv[1],"rb"))["mcp_servers"]["odd"]["args"])' "$codex_home/captured.toml"
    [ "$status" -eq 0 ]
    grep -F -q -- "['--flag']" <<< "$output"
}

@test "tracked dispatcher source removes the Codex MCP profile once the session exits" {
    [ -f "$SOURCE_DISPATCHER" ]

    local codex_home="$TMPDIR_/codex-home-lifecycle"
    mkdir -p "$codex_home/sessions"

    cat > "$PROJECT_DIR/.mcp.json" <<'JSON'
{
  "mcpServers": {
    "linear": { "command": "linear-mcp", "env": { "LINEAR_API_TOKEN": "lin_api_SUPERSECRET_VALUE" } }
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
    # it existed while codex was running ...
    grep -F -q -- "CAPTURED_PROFILE=" <<< "$output"
    grep -F -q -- "lin_api_SUPERSECRET_VALUE" "$codex_home/captured.toml"
    # ... and the live secret is not left sitting on disk afterwards
    [ "$(ls "$codex_home"/repogolem-*.config.toml 2>/dev/null | wc -l | tr -d ' ')" = "0" ]
    # nor are the staging temp files
    [ "$(ls -A "$codex_home"/.repogolem-codex-* 2>/dev/null | wc -l | tr -d ' ')" = "0" ]
}

@test "tracked dispatcher source detects an attached Codex -p<profile> short flag" {
    [ -f "$SOURCE_DISPATCHER" ]

    local codex_home="$TMPDIR_/codex-home-attached-p"
    mkdir -p "$codex_home/sessions"

    cat > "$PROJECT_DIR/.mcp.json" <<'JSON'
{ "mcpServers": { "linear": { "command": "linear-mcp" } } }
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
      testrepoCodex -s -- -pmyprofile
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER" "$codex_home"

    [ "$status" -eq 0 ]
    # clap accepts `-pVALUE` attached, so it is a profile selection too and
    # appending ours on top would abort the launch
    local argv_line
    argv_line="$(grep -F -- 'CODEX_ARGS=' <<< "$output")"
    grep -F -q -- "-pmyprofile" <<< "$argv_line"
    refute_contains "--profile repogolem-" "$argv_line" "attached -p<profile> must suppress our profile too"
}

@test "tracked dispatcher source preserves a multi-line MCP env value" {
    [ -f "$SOURCE_DISPATCHER" ]

    local codex_home="$TMPDIR_/codex-home-multiline"
    mkdir -p "$codex_home/sessions"

    cat > "$PROJECT_DIR/.mcp.json" <<'JSON'
{
  "mcpServers": {
    "certs": {
      "command": "certs-mcp",
      "env": { "CLIENT_PEM": "-----BEGIN KEY-----\nLINE2SECRET\n-----END KEY-----" }
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
    # a truncated key authenticates as garbage with no diagnostic, and the
    # trailing fragment used to land as a bogus TOML key of its own
    run python3 -c 'import sys,tomllib;e=tomllib.load(open(sys.argv[1],"rb"))["mcp_servers"]["certs"]["env"];print(sorted(e));print(repr(e["CLIENT_PEM"]))' "$codex_home/captured.toml"
    [ "$status" -eq 0 ]
    grep -F -q -- "['CLIENT_PEM']" <<< "$output"
    grep -F -q -- "LINE2SECRET" <<< "$output"
    grep -F -q -- "-----END KEY-----" <<< "$output"
}

@test "tracked dispatcher source keeps GOLEM_ROLE=worker Cursor launches persona-free" {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home-cursor-worker"
    mkdir -p "$fake_home/.claude/agents"
    printf '%s\n' \
      "# Full orchestrator protocol" \
      "BrainLayer-first boot searches." \
      "brain_store boot ceremony result." \
      "Orchestration routing protocol." \
      > "$fake_home/.claude/agents/test-agent.md"
    jq '.projects.testrepo.agent = "test-agent"' \
      "$REGISTRY_FILE" > "$TMPDIR_/registry-cursor-agent.json"

    # RED half: without GOLEM_ROLE the persona must still be injected, or this
    # test proves nothing. A gate that cannot go RED is not wired.
    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"
      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function cursor() { print -r -- "ARGS=$*"; }
      source "$3"
      _golem_register_wrappers
      testrepoCursor -s
    ' _ "$fake_home" "$TMPDIR_/registry-cursor-agent.json" "$SOURCE_DISPATCHER"
    [ "$status" -eq 0 ]
    grep -E -q -- "$WORKER_PERSONA_MARKERS" <<< "$output" \
      || fail "lead Cursor launch lost its persona; the worker assertion below would be vacuous"

    # GREEN half: GOLEM_ROLE=worker suppresses it at the shared injection point.
    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"
      export GOLEM_ROLE=worker
      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function cursor() { print -r -- "ARGS=$*"; }
      source "$3"
      _golem_register_wrappers
      testrepoCursor -s
    ' _ "$fake_home" "$TMPDIR_/registry-cursor-agent.json" "$SOURCE_DISPATCHER"
    [ "$status" -eq 0 ]
    assert_no_worker_persona_markers "$output"
}

@test "tracked dispatcher source sets claude --effort by seat: lead high, worker medium, -E wins" {
    [ -f "$SOURCE_DISPATCHER" ]
    run_claude() {
      zsh -f -c '
        export RALPH_REGISTRY_FILE="$1"; [ -n "$2" ] && export GOLEM_ROLE="$2"; [ -n "$3" ] && export GOLEM_EFFORT="$3"
        function _ralph_setup_mcps() { return 0; }
        function _ralph_setup_secrets() { return 0; }
        function _golem_setup_env() { return 0; }
        function claude() { print -r -- "ARGS=$*"; }
        source "$4"; _golem_register_wrappers
        shift 4; testrepoClaude -s "$@"
      ' _ "$REGISTRY_FILE" "$1" "$2" "$SOURCE_DISPATCHER" "${@:3}"
    }
    run run_claude "" ""
    [ "$status" -eq 0 ]; grep -F -q -- "--effort high" <<< "$output"
    run run_claude worker ""
    [ "$status" -eq 0 ]; grep -F -q -- "--effort medium" <<< "$output"
    run run_claude worker low
    [ "$status" -eq 0 ]; grep -F -q -- "--effort low" <<< "$output"
    run run_claude worker low -E xhigh
    [ "$status" -eq 0 ]; grep -F -q -- "--effort xhigh" <<< "$output"
    # RED half: a lead must NOT come out medium, or the precedence is broken
    run run_claude "" ""
    ! grep -F -q -- "--effort medium" <<< "$output"
}

# ── W23: launcher staging must never touch a shared /tmp ──────────
#
# The fleet's TMP-BLOCK guard denies agents any /tmp write, fail-closed
# (skills/golem-powers/tmp-block). A launcher that staged its persona context,
# agy MCP merges, or notify config through /tmp could not be driven by an agent
# at all. Backlog #24 ruling: the LAUNCHER moves, the guard stays fail-closed.
#
# These files are created AND removed inside a single launch, so an ls-before /
# ls-after diff cannot see them on its own — the stub CLI snapshots /tmp and the
# staging dir from inside the launch, while the launch's files are still live.
TMP_STAGING_PATTERN='^(repogolem-|\.claude_notify_config_)'

snapshot_tmp_staging_entries() {
    ls -A /tmp 2>/dev/null | grep -E "$TMP_STAGING_PATTERN" | sort
}

@test "tracked dispatcher source stages Claude launches outside /tmp" {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home"
    local before_tmp; before_tmp="$(snapshot_tmp_staging_entries)"

    run env TMP_STAGING_PATTERN="$TMP_STAGING_PATTERN" zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"
      unset XDG_RUNTIME_DIR

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }

      # Stands in for the real claude process, which reads the notify config
      # while it runs. Snapshots both trees while the launch files are live.
      # The pattern arrives via the environment: inlining it here would have to
      # survive bats single-quoting AND zsh double-quoting, and an anchor lost to
      # either layer silently turns the /tmp assertion below into a no-op.
      function claude() {
        print -r -- "PATTERN_SELFCHECK=$(print -l repogolem-decoy .claude_notify_config_decoy unrelated-decoy | grep -E "$TMP_STAGING_PATTERN" | tr "\n" " ")"
        print -r -- "LIVE_TMP=$(ls -A /tmp 2>/dev/null | grep -E "$TMP_STAGING_PATTERN" | tr "\n" " ")"
        print -r -- "LIVE_STAGING=$(ls -A "$HOME/.cache/repogolem/testrepo" 2>/dev/null | tr "\n" " ")"
        print -r -- "STAGING_MODE=$(stat -f %OLp "$HOME/.cache/repogolem/testrepo" 2>/dev/null)"
      }

      source "$3"
      _golem_register_wrappers
      testrepoClaude -s -QN
    ' _ "$fake_home" "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    # The anchor has to survive bats single-quoting and zsh double-quoting, or
    # the /tmp assertion below matches nothing and silently passes forever.
    grep -F -q -- "PATTERN_SELFCHECK=repogolem-decoy .claude_notify_config_decoy" <<< "$output"
    # The notify config must exist somewhere while claude runs...
    grep -E -q -- 'LIVE_STAGING=.*\.claude_notify_config_testrepo\.json' <<< "$output"
    # ...and that somewhere must not be /tmp.
    refute_contains ".claude_notify_config_testrepo.json" \
      "$(grep -E '^LIVE_TMP=' <<< "$output")" \
      "notify config must not be staged in a shared /tmp"
    grep -F -q -- "STAGING_MODE=700" <<< "$output"

    [ "$(snapshot_tmp_staging_entries)" = "$before_tmp" ]
}

@test "tracked dispatcher source stages persona and agy merges outside /tmp" {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home/.claude/agents" "$TMPDIR_/bin"
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
    cat > "$TMPDIR_/bin/agy" <<'AGY'
#!/usr/bin/env zsh
print -r -- "LIVE_TMP=$(ls -A /tmp 2>/dev/null | grep -E '^(repogolem-|\.claude_notify_config_)' | tr '\n' ' ')"
print -r -- "LIVE_STAGING=$(ls -A "$HOME/.cache/repogolem/testrepo" 2>/dev/null | tr '\n' ' ')"
AGY
    chmod +x "$TMPDIR_/bin/agy"

    local before_tmp; before_tmp="$(snapshot_tmp_staging_entries)"

    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"
      export PATH="$3:$PATH"
      unset XDG_RUNTIME_DIR

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{\"brainlayer\":{\"command\":\"brainlayer-mcp\"}}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }

      source "$4"
      testrepoGemini -s "stage check"
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$TMPDIR_/bin" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    # The persona context file is live while agy runs and must be staged outside /tmp.
    grep -E -q -- 'LIVE_STAGING=.*repogolem-gemini-testrepo-agent\.' <<< "$output"
    refute_contains "repogolem-gemini-testrepo-agent." \
      "$(grep -E '^LIVE_TMP=' <<< "$output")" \
      "persona context must not be staged in a shared /tmp"

    [ "$(snapshot_tmp_staging_entries)" = "$before_tmp" ]
}

@test "tracked dispatcher source hardcodes no /tmp staging paths" {
    [ -f "$SOURCE_DISPATCHER" ]

    run grep -n -E '(mktemp|>)[^|]*"?/tmp/' "$SOURCE_DISPATCHER"
    if [ "$status" -eq 0 ]; then
        echo "launcher still stages through /tmp:" >&2
        echo "$output" >&2
        return 1
    fi
}

@test "tracked dispatcher source honors XDG_RUNTIME_DIR for staging" {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home" xdg="$TMPDIR_/xdg-runtime"
    mkdir -p "$fake_home" "$xdg"

    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"
      export XDG_RUNTIME_DIR="$3"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function claude() {
        print -r -- "LIVE_STAGING=$(ls -A "$XDG_RUNTIME_DIR/repogolem/testrepo" 2>/dev/null | tr "\n" " ")"
      }

      source "$4"
      _golem_register_wrappers
      testrepoClaude -s -QN
    ' _ "$fake_home" "$REGISTRY_FILE" "$xdg" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -E -q -- 'LIVE_STAGING=.*\.claude_notify_config_testrepo\.json' <<< "$output"
    [ ! -d "$fake_home/.cache/repogolem" ]
}

@test "tracked dispatcher source keeps the notify cleanup quiet under nounset" {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home"

    # zsh tears function locals down BEFORE a localtraps EXIT trap runs, so an
    # EXIT trap that reads a local both fails to clean up and — under nounset —
    # prints `parameter not set` on every launch. Caught by the W23 spawn proof.
    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"
      unset XDG_RUNTIME_DIR
      setopt nounset

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function claude() { print -r -- "CLAUDE-RAN"; }

      source "$3"
      _golem_register_wrappers
      testrepoClaude -s -QN
    ' _ "$fake_home" "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "CLAUDE-RAN" <<< "$output"
    refute_contains "parameter not set" "$output" \
      "notify cleanup must not read a torn-down local under nounset"
}

@test "tracked dispatcher source removes the notify config when a launch is interrupted" {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home"

    # An INT trap DOES see the local (it fires while the function is still on
    # the stack), which is the whole point of the trap: an interrupted launch
    # must not leave its notify config behind.
    run zsh -f -c '
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"
      unset XDG_RUNTIME_DIR

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      # Stands in for a claude session the user Ctrl-Cs.
      function claude() {
        print -r -- "STAGED_BEFORE_INT=$(ls -A "$HOME/.cache/repogolem/testrepo" 2>/dev/null | tr "\n" " ")"
        kill -INT $$
        sleep 1
      }

      source "$3"
      _golem_register_wrappers
      testrepoClaude -s -QN
      print -r -- "STAGED_AFTER_INT=$(ls -A "$HOME/.cache/repogolem/testrepo" 2>/dev/null | tr "\n" " ")"
    ' _ "$fake_home" "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    grep -E -q -- 'STAGED_BEFORE_INT=.*\.claude_notify_config_testrepo\.json' <<< "$output"
    grep -E -q -- 'STAGED_AFTER_INT= *$' <<< "$output"
}
