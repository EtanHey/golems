#!/usr/bin/env bats
# Tests for the live repoGolem dispatcher.
# Run with: bats scripts/tests/test-repogolem-dispatch.bats

setup() {
    # The suite assumes a lead environment; a worker seat running it must not
    # leak its own role or effort into the launches under test.
    unset REPOGOLEM_ALLOW_MODEL GOLEM_ROLE GOLEM_EFFORT
    # Exported so CODEX_STUB_SNAPSHOT can source it: the stub runs inside
    # `zsh -f -c`, which inherits the environment but no rc files.
    export PORTABLE_STAT_LIB="$BATS_TEST_DIRNAME/../lib/portable-stat.sh"
    FIXTURES="$BATS_TEST_DIRNAME/fixtures"
    CODEX_SESSION_FIXTURES="$FIXTURES/codex-sessions"
    SOURCE_DISPATCHER="$BATS_TEST_DIRNAME/../repogolem/golem-dispatch.zsh"
    SOURCE_MODULES="$BATS_TEST_DIRNAME/../repogolem/dispatch"
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
        source "$PORTABLE_STAT_LIB"
        local p
        for p in "$CODEX_HOME"/repogolem-*.config.toml(N); do
          cp "$p" "$CODEX_HOME/captured.toml"
          print -r -- "CAPTURED_PROFILE=${p:t}"
          print -r -- "CAPTURED_MODE=$(portable_stat mode "$p")"
        done
      }'

# Stubs that block until a sibling launch releases them must bound the wait.
# An unbounded `while [[ ! -e $sentinel ]]; do sleep 0.02; done` leaks a
# spinning child that holds bats' output pipe open whenever the outer script
# exits before touching the sentinel — which is what hung run 33994495217 for
# 44 minutes on a runner where the BSD-only `stat -f %OLp` assertion failed
# first. Healthy waits are 25-75 ms (24 samples over 12 local runs); 7.5s is
# 100x the slowest observed and clears the outer script's own 2s ready-poll
# ceiling, so it can only trip when the release genuinely never comes.
CODEX_STUB_RELEASE_DEADLINE=7.5
CODEX_STUB_AWAIT_RELEASE='function _await_release() {
        local sentinel="$1"
        local -F deadline_s="$2" waited=0
        zmodload zsh/datetime
        local -F start=$EPOCHREALTIME
        while [[ ! -e "$sentinel" ]]; do
          waited=$(( EPOCHREALTIME - start ))
          if (( waited >= deadline_s )); then
            print -r -- "CODEX_STUB_RELEASE_TIMEOUT sentinel=${sentinel} waited=${waited}s deadline=${deadline_s}s" >&2
            return 89
          fi
          sleep 0.02
        done
        return 0
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

run_non_codex_persona_launch() {
    local cli="$1" role="${2:-}"
    run zsh -f -c '
      unset GOLEM_ROLE
      export HOME="$1"
      export RALPH_REGISTRY_FILE="$2"
      [ -n "$4" ] && export GOLEM_ROLE="$4"
      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_sync_agy_workspace() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function cursor() { print -r -- "CURSOR_ARGS=$*"; }
      function agy() { print -r -- "AGY_ARGS=$*"; }
      source "$3"
      case "$5" in
        cursor) testrepoCursor -s -p "Implement brief" ;;
        gemini) testrepoGemini -s -p "Implement brief" ;;
      esac
    ' _ "$PERSONA_HOME" "$PERSONA_REGISTRY" "$SOURCE_DISPATCHER" "$role" "$cli"
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
    rg -q "BrainLayer-first ambiguity gate|BLOCKED_BRAINLAYER_UNAVAILABLE" \
        "$fake_home/.config/ralphtools/golem-dispatch.zsh" "$fake_home/.config/ralphtools/dispatch"
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

assert_dispatch_fixture_mirror() {
    local fixture_facade="$1" fixture_modules="$2"
    cmp -s "$SOURCE_DISPATCHER" "$fixture_facade" && \
        diff -qr "$SOURCE_MODULES" "$fixture_modules" >/dev/null
}

@test "installed dispatcher fixture and modules match the tracked source" {
    assert_dispatch_fixture_mirror "$FIXTURES/repogolem-dispatch.zsh" "$FIXTURES/dispatch"
    cp -R "$FIXTURES/dispatch" "$TMPDIR_/drift"
    printf '# planted drift\n' >> "$TMPDIR_/drift/core.zsh"
    run assert_dispatch_fixture_mirror "$FIXTURES/repogolem-dispatch.zsh" "$TMPDIR_/drift"
    [ "$status" -ne 0 ]
}

@test "two copied dispatchers load their own modules" {
    local copy_a="$TMPDIR_/copy-a" copy_b="$TMPDIR_/copy-b"
    mkdir -p "$copy_a" "$copy_b"
    cp "$SOURCE_DISPATCHER" "$copy_a/golem-dispatch.zsh"
    cp "$SOURCE_DISPATCHER" "$copy_b/golem-dispatch.zsh"
    cp -R "$SOURCE_MODULES" "$copy_a/dispatch"
    cp -R "$SOURCE_MODULES" "$copy_b/dispatch"
    printf '\ntypeset -g _GOLEM_SOURCE_PROBE=A\n' >> "$copy_a/dispatch/core.zsh"
    printf '\ntypeset -g _GOLEM_SOURCE_PROBE=B\n' >> "$copy_b/dispatch/core.zsh"
    run env RALPH_REGISTRY_FILE="$REGISTRY_FILE" zsh -f -c '
        source "$1" || exit 1
        print -r -- "A=$_GOLEM_SOURCE_PROBE"
        source "$2" || exit 1
        print -r -- "B=$_GOLEM_SOURCE_PROBE"
    ' _ "$copy_a/golem-dispatch.zsh" "$copy_b/golem-dispatch.zsh"
    [ "$status" -eq 0 ]
    [[ "$output" == *$'A=A\nB=B'* ]] || false
}

@test "symlink to a facade without its module directory fails loudly" {
    mkdir -p "$TMPDIR_/bare" "$TMPDIR_/link"
    cp "$SOURCE_DISPATCHER" "$TMPDIR_/bare/golem-dispatch.zsh"
    ln -s "$TMPDIR_/bare/golem-dispatch.zsh" "$TMPDIR_/link/golem-dispatch.zsh"
    run env RALPH_REGISTRY_FILE="$REGISTRY_FILE" zsh -f -c 'source "$1"' _ "$TMPDIR_/link/golem-dispatch.zsh"
    [ "$status" -ne 0 ]
    [[ "$output" == *"Missing dispatcher module:"* ]] || false
}

@test "symlinked facade resolves modules beside its real file" {
    mkdir -p "$TMPDIR_/real" "$TMPDIR_/shadow"
    cp "$SOURCE_DISPATCHER" "$TMPDIR_/real/golem-dispatch.zsh"
    cp -R "$SOURCE_MODULES" "$TMPDIR_/real/dispatch"
    cp -R "$SOURCE_MODULES" "$TMPDIR_/shadow/dispatch"
    printf '\ntypeset -g _GOLEM_SOURCE_PROBE=REAL\n' >> "$TMPDIR_/real/dispatch/core.zsh"
    printf '\ntypeset -g _GOLEM_SOURCE_PROBE=SHADOW\n' >> "$TMPDIR_/shadow/dispatch/core.zsh"
    ln -s "$TMPDIR_/real/golem-dispatch.zsh" "$TMPDIR_/shadow/golem-dispatch.zsh"
    run env RALPH_REGISTRY_FILE="$REGISTRY_FILE" zsh -f -c '
        source "$1" || exit 1
        print -r -- "$_GOLEM_SOURCE_PROBE"
    ' _ "$TMPDIR_/shadow/golem-dispatch.zsh"
    [ "$status" -eq 0 ]
    [ "$output" = REAL ]
}

@test "fresh installed dispatcher runs from unrelated cwd after source tree removal" {
    local source_copy="$TMPDIR_/source-copy" fake_home="$TMPDIR_/isolated-home"
    mkdir -p "$source_copy" "$fake_home" "$TMPDIR_/unrelated"
    cp "$SOURCE_DISPATCHER" "$INSTALL_DISPATCHER" \
        "$BATS_TEST_DIRNAME/../repogolem/worktree-bootstrap.sh" "$source_copy/"
    cp -R "$SOURCE_MODULES" "$source_copy/dispatch"
    run env HOME="$fake_home" zsh "$source_copy/install-golem-dispatch.sh" --force \
        "$fake_home/.config/ralphtools/golem-dispatch.zsh"
    [ "$status" -eq 0 ]
    rm -rf "$source_copy"
    run env HOME="$fake_home" RALPH_REGISTRY_FILE="$REGISTRY_FILE" zsh -f -c '
        cd "$1" || exit 1
        source "$2" || exit 1
        testrepoCodex --help
    ' _ "$TMPDIR_/unrelated" "$fake_home/.config/ralphtools/golem-dispatch.zsh"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Codex launcher options:"* ]] || false
}

@test "installer refuses a missing required module before publishing facade" {
    local source_copy="$TMPDIR_/incomplete-source" fake_home="$TMPDIR_/incomplete-home"
    mkdir -p "$source_copy" "$fake_home"
    cp "$SOURCE_DISPATCHER" "$INSTALL_DISPATCHER" \
        "$BATS_TEST_DIRNAME/../repogolem/worktree-bootstrap.sh" "$source_copy/"
    cp -R "$SOURCE_MODULES" "$source_copy/dispatch"
    rm "$source_copy/dispatch/codex.zsh"
    run env HOME="$fake_home" zsh "$source_copy/install-golem-dispatch.sh" --force \
        "$fake_home/.config/ralphtools/golem-dispatch.zsh"
    [ "$status" -ne 0 ]
    [[ "$output" == *"Missing dispatcher module:"* ]] || false
    [ ! -e "$fake_home/.config/ralphtools/golem-dispatch.zsh" ]
}

@test "a missing late module leaves no wrappers and no partial definitions" {
    mkdir -p "$TMPDIR_/partial"
    cp "$SOURCE_DISPATCHER" "$TMPDIR_/partial/golem-dispatch.zsh"
    cp -R "$SOURCE_MODULES" "$TMPDIR_/partial/dispatch"
    rm "$TMPDIR_/partial/dispatch/gemini.zsh"
    run env RALPH_REGISTRY_FILE="$REGISTRY_FILE" zsh -f -c '
        source "$1"; print -r -- "rc=$?"
        local -a defs=(${(M)${(k)functions}:#_golem_*})
        print -r -- "defs=${#defs}"
        whence -w testrepoClaude >/dev/null && print -r -- WRAPPERS
        true
    ' _ "$TMPDIR_/partial/golem-dispatch.zsh"
    [[ "$output" == *"Missing dispatcher module:"*"/dispatch/gemini.zsh"* ]] || false
    [[ "$output" == *"rc=1"* ]] || false
    [[ "$output" == *"defs=0"* ]] || false
    [[ "$output" != *WRAPPERS* ]] || false
}

@test "a module directory from the cwd is never loaded" {
    mkdir -p "$TMPDIR_/real-cwd" "$TMPDIR_/decoy-cwd"
    cp "$SOURCE_DISPATCHER" "$TMPDIR_/real-cwd/golem-dispatch.zsh"
    cp -R "$SOURCE_MODULES" "$TMPDIR_/real-cwd/dispatch"
    cp -R "$SOURCE_MODULES" "$TMPDIR_/decoy-cwd/dispatch"
    printf '\ntypeset -g _GOLEM_SOURCE_PROBE=REAL\n' >> "$TMPDIR_/real-cwd/dispatch/core.zsh"
    printf '\ntypeset -g _GOLEM_SOURCE_PROBE=DECOY\n' >> "$TMPDIR_/decoy-cwd/dispatch/core.zsh"
    run env RALPH_REGISTRY_FILE="$REGISTRY_FILE" zsh -f -c '
        cd "$1" && source "$2" || exit 1
        print -r -- "$_GOLEM_SOURCE_PROBE"
    ' _ "$TMPDIR_/decoy-cwd" "$TMPDIR_/real-cwd/golem-dispatch.zsh"
    [ "$status" -eq 0 ]
    [ "$output" = REAL ]
}

@test "installer keeps the old facade when installing modules fails" {
    local fake_home="$TMPDIR_/failing-home"
    local target="$fake_home/.config/ralphtools/golem-dispatch.zsh"
    mkdir -p "$fake_home/.config/ralphtools"
    printf '# previous facade\n' > "$target"
    : > "$fake_home/.config/ralphtools/dispatch"
    run env HOME="$fake_home" zsh "$INSTALL_DISPATCHER" --force "$target"
    [ "$status" -ne 0 ]
    [ "$(cat "$target")" = '# previous facade' ]
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
      testrepoGemini -s "Prep examplechannel voice pairs"
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$TMPDIR_/bin" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "AGY_ARGS=" <<< "$output"
    grep -F -q -- "--model Gemini 3.8 Flash (High)" <<< "$output"
    grep -F -q -- "--dangerously-skip-permissions" <<< "$output"
    grep -F -q -- "--prompt-interactive" <<< "$output"
    grep -F -q -- "BrainLayer-first ambiguity gate" <<< "$output"
    grep -F -q -- "BrainLayer/user/project context before public web or popularity inference" <<< "$output"
    grep -F -q -- "BLOCKED_BRAINLAYER_UNAVAILABLE" <<< "$output"
    grep -F -q -- "resolve them from BrainLayer context and existing voice artifacts" <<< "$output"
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
      testrepoGemini -c "Prep examplechannel voice pairs"
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$TMPDIR_/bin" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "--continue" <<< "$output"
    grep -F -q -- "--prompt-interactive" <<< "$output"
    grep -F -q -- "BrainLayer-first ambiguity gate" <<< "$output"
    grep -F -q -- "BLOCKED_BRAINLAYER_UNAVAILABLE" <<< "$output"
    grep -F -q -- "resolve them from BrainLayer context and existing voice artifacts" <<< "$output"
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
    grep -F -q -- "resolve them from BrainLayer context and existing voice artifacts" <<< "$output"
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
      testrepoGemini -c -p "Prep examplechannel voice pairs"
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$TMPDIR_/bin" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "--continue" <<< "$output"
    grep -F -q -- "--print" <<< "$output"
    grep -F -q -- "BrainLayer-first ambiguity gate" <<< "$output"
    grep -F -q -- "BLOCKED_BRAINLAYER_UNAVAILABLE" <<< "$output"
    grep -F -q -- "resolve them from BrainLayer context and existing voice artifacts" <<< "$output"
}

@test "tracked dispatcher source keeps ambiguity gate on Codex and Cursor continue prompts" {
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

      source "$3"
      testrepoCodex -c "Prep examplechannel voice pairs"
      testrepoCursor -c "Prep examplechannel voice pairs"
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "CODEX_ARGS=resume --last" <<< "$output"
    grep -F -q -- "CURSOR_ARGS=agent --continue" <<< "$output"
    grep -F -q -- "BrainLayer-first ambiguity gate" <<< "$output"
    grep -F -q -- "BLOCKED_BRAINLAYER_UNAVAILABLE" <<< "$output"
    grep -F -q -- "resolve them from BrainLayer context and existing voice artifacts" <<< "$output"
}

@test "tracked dispatcher source refuses Codex resume plus print while Cursor keeps print precedence" {
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

      source "$2"
      testrepoCodex -c -p "one shot"
      testrepoCursor -c -p "one shot"
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "Cannot combine Codex resume with -p/--print" <<< "$output"
    grep -F -q -- "CURSOR_ARGS=agent --print --output-format text" <<< "$output"
    ! grep -F -q -- "CODEX_ARGS=" <<< "$output" || false
    ! grep -F -q -- "CODEX_ARGS=resume --last" <<< "$output" || false
    ! grep -F -q -- "CURSOR_ARGS=agent --continue" <<< "$output"
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
    ! grep -F -q -- "CLAUDE_ARG=--print" <<< "$output" || false
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
    ! grep -F -q -- "CLAUDE_ARG=fable" <<< "$output" || false
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
    ! grep -F -q -- "CLAUDE_LAUNCHED=" <<< "$output" || false
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
    ! grep -F -q -- "AFTER_HTTP_TOKEN=http-token" <<< "$output" || false
    ! grep -F -q -- "AFTER_SERVER_TOKEN=server-token" <<< "$output" || false
    ! grep -F -q -- "AFTER_REGISTRY_TOKEN=registry-token" <<< "$output" || false
    ! grep -F -q -- "mcp_servers.httpRemote.env.HTTP_TOKEN" <<< "$output" || false
    ! grep -F -q -- "mcp_servers.serverRemote.env.SERVER_TOKEN" <<< "$output" || false
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
      [ "$(grep -Fxc -- "CODEX_ARG=gpt-6.1-sol" <<< "$call_output")" -eq 1 ]
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
      testrepoCodex -m gpt-6-luna -E max
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    [ "$(grep -Fxc -- "CODEX_ARG=--model" <<< "$output")" -eq 1 ]
    [ "$(grep -Fxc -- "CODEX_ARG=gpt-6-luna" <<< "$output")" -eq 1 ]
    [ "$(grep -Fxc -- 'CODEX_ARG=model_reasoning_effort="max"' <<< "$output")" -eq 1 ]
    ! grep -F -q -- "gpt-5.6-sol" <<< "$output" || false
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
    ! grep -F -q -- "gpt-5.6-luna" <<< "$preserved_output" || false
    [ "$(grep '^CODEX_ARG=' <<< "$preserved_output")" = $'CODEX_ARG=resume\nCODEX_ARG=--last\nCODEX_ARG=-c\nCODEX_ARG=model_reasoning_effort="high"\nCODEX_ARG=--model\nCODEX_ARG=gpt-5.6-terra' ]
    grep -F -q -- "CODEX_ARG=resume" <<< "$model_output"
    grep -F -q -- "CODEX_ARG=--last" <<< "$model_output"
    [ "$(grep -Fxc -- "CODEX_ARG=--model" <<< "$model_output")" -eq 1 ]
    [ "$(grep -Fxc -- "CODEX_ARG=gpt-5.6-luna" <<< "$model_output")" -eq 1 ]
    [ "$(grep -Fxc -- 'CODEX_ARG=model_reasoning_effort="high"' <<< "$model_output")" -eq 1 ]
    ! grep -F -q -- "gpt-5.6-terra" <<< "$model_output" || false
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
    ! grep -F -q -- "CODEX_ARG=--dangerously-bypass-approvals-and-sandbox" <<< "$output" || false
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
    ! grep -F -q -- "gpt-5.6-sol" <<< "$override_output" || false
    ! grep -F -q -- 'model_reasoning_effort="xhigh"' <<< "$override_output" || false
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
    ! grep -F -q -- "RECOVERY_CALLED" <<< "$output" || false
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
    ! grep -F -q -- "gpt-broken-rollout" <<< "$output" || false
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
    ! grep -F -q -- "CODEX_ARG=-E" <<< "$output" || false
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
    ! grep -F -q -- "CODEX_ARG=resume" <<< "$output" || false
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
      testrepoGemini "Prep examplechannel voice pairs"
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

@test "tracked dispatcher source keeps Cursor --worker boot payload persona-free" {
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

@test "tracked dispatcher source keeps Gemini --worker boot payload persona-free" {
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
      | grep -Fv -- 'CODEX_ARG=gpt-6.1-sol' \
      | sed 's/^CODEX_ARG_COUNT=5$/CODEX_ARG_COUNT=1/')
    local actual_hash
    actual_hash=$(printf '%s' "$normalized_output" | shasum -a 256 | awk '{print $1}')
    [ "$actual_hash" = "86fcc2203e54cd62dc8947c3ead7051facb01184610f36346bb72c665cddf5fd" ]
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
    ! grep -F -q -- "--dangerously-bypass-approvals-and-sandbox" <<< "$output" || false
    grep -F -q -- "--model gpt-6.1-sol" <<< "$output"
    ! grep -F -q -- "--worktree" <<< "$output" || false
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
    ! grep -F -q -- "--dangerously-bypass-approvals-and-sandbox" <<< "$output" || false
    grep -F -q -- "--model gpt-6.1-sol" <<< "$output"
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
      testrepoGemini -s "Prep examplechannel voice pairs"
    ' _ "$fake_home" "$TMPDIR_/registry-with-agent.json" "$TMPDIR_/bin" "$WORKTREE_DIR" "$DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -q -- "BrainLayer-first ambiguity gate" <<< "$output"
    grep -F -q -- "resolve them from BrainLayer context and existing voice artifacts" <<< "$output"
    grep -F -q -- "BLOCKED_BRAINLAYER_UNAVAILABLE" <<< "$output"
}

@test "testrepoClaude defaults to Opus 5.5 1M-context (no manual /model flip)" {
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

@test "concurrency stub release wait exits on a deadline naming the sentinel instead of spinning" {
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
      typeset -g CODEX_STUB_RELEASE_DEADLINE="$4"
      source "$PORTABLE_STAT_LIB"

      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      '"$CODEX_STUB_AWAIT_RELEASE"'
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
        _await_release "$CODEX_HOME/release-${GOLEM_TEST_LAUNCH}" "$CODEX_STUB_RELEASE_DEADLINE"
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
      [[ "$(portable_stat mode "$file_a")" == 600 ]] || exit 95
      [[ "$(portable_stat mode "$file_b")" == 600 ]] || exit 96
      print -r -- "CONCURRENT_PROFILES=$profile_a,$profile_b"

      touch "$CODEX_HOME/release-A"
      wait "$launch_a"
      [[ ! -e "$file_a" ]] || exit 97
      [[ -f "$file_b" ]] || exit 98
      print -r -- "LAUNCH_B_PROFILE_SURVIVED=$profile_b"

      touch "$CODEX_HOME/release-B"
      wait "$launch_b"
      [[ ! -e "$file_b" ]] || exit 99
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER" "$codex_home" "$CODEX_STUB_RELEASE_DEADLINE"

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

# Codex and Antigravity hand args to the MCP child as argv, which `ps` shows to
# every local process. Supabase reads SUPABASE_ACCESS_TOKEN from its env, so
# both renderers drop --access-token, in either spelling. Fixture token values
# are obviously fake.
@test "tracked dispatcher source strips supabase --access-token args from the Codex profile" {
    [ -f "$SOURCE_DISPATCHER" ]

    local codex_home="$TMPDIR_/codex-home-supabase"
    mkdir -p "$codex_home/sessions"

    cat > "$PROJECT_DIR/.mcp.json" <<'JSON'
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@0.10.0", "--access-token", "sbp_FAKE0000", "--read-only", "--access-token=sbp_FAKE1111"],
      "env": { "SUPABASE_ACCESS_TOKEN": "sbp_FAKE2222" }
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
    refute_contains "sbp_FAKE" "$output" "launcher output must not carry the supabase token"
    grep -F -q -- "SUPABASE_ACCESS_TOKEN" <<< "$output"
    run python3 - "$codex_home/captured.toml" <<'PYCHECK'
import sys, tomllib
with open(sys.argv[1], "rb") as fh:
    srv = tomllib.load(fh)["mcp_servers"]["supabase"]
assert srv["args"] == ["-y", "@supabase/mcp-server-supabase@0.10.0", "--read-only"], srv["args"]
assert srv["env"] == {"SUPABASE_ACCESS_TOKEN": "sbp_FAKE2222"}, "env must keep the token"
print("SUPABASE_ARGS_STRIPPED")
PYCHECK
    [ "$status" -eq 0 ]
    grep -F -q -- "SUPABASE_ARGS_STRIPPED" <<< "$output"
}

@test "tracked dispatcher source strips supabase --access-token args from Antigravity MCP config" {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home" "$TMPDIR_/bin"
    cat > "$PROJECT_DIR/.mcp.json" <<'JSON'
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@0.10.0", "--access-token", "sbp_FAKE0000", "--read-only", "--access-token=sbp_FAKE1111"],
      "env": { "SUPABASE_ACCESS_TOKEN": "sbp_FAKE2222" }
    }
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
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      source "$4"
      testrepoGemini "Prep supabase"
      jq -c ".mcpServers.supabase" "$5/.agents/mcp_config.json"
      jq -c ".mcpServers.supabase" "$1/.gemini/config/mcp_config.json"
    ' _ "$fake_home" "$REGISTRY_FILE" "$TMPDIR_/bin" "$SOURCE_DISPATCHER" "$PROJECT_DIR"

    [ "$status" -eq 0 ]
    refute_contains "sbp_FAKE" "$output" "Antigravity MCP config must not carry the supabase token"
    [ "$(grep -F -c -- '"args":["-y","@supabase/mcp-server-supabase@0.10.0","--read-only"]' <<< "$output")" = "2" ]
}

# Each row: input args|expected args. The token flag only consumes a following
# arg that is not itself an option, so no neighbouring flag is ever dropped.
SUPABASE_STRIP_CASES='["--access-token","--read-only","--project-ref","demo"]|["--read-only","--project-ref","demo"]
["--read-only","--access-token"]|["--read-only"]
["--access-token","sbp_FAKE0000","--access-token","sbp_FAKE1111","--read-only"]|["--read-only"]
["--access-token","--access-token","sbp_FAKE0000","--read-only"]|["--read-only"]
["--access-token=sbp_FAKE0000","--read-only"]|["--read-only"]
["--access-token","sbp_FAKE0000","--project-ref","demo"]|["--project-ref","demo"]'

@test "tracked dispatcher source strips each supabase --access-token shape from the Codex profile" {
    [ -f "$SOURCE_DISPATCHER" ]

    local args expected codex_home n=0
    while IFS='|' read -r args expected; do
        n=$((n + 1))
        codex_home="$TMPDIR_/codex-home-strip-$n"
        mkdir -p "$codex_home/sessions"
        printf '{"mcpServers":{"supabase":{"command":"npx","args":%s,"env":{"SUPABASE_ACCESS_TOKEN":"sbp_FAKE2222"}}}}\n' \
            "$args" > "$PROJECT_DIR/.mcp.json"

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
        [ "$status" -eq 0 ] || { echo "case $args: launch exited $status: $output"; return 1; }

        run python3 -c 'import json,sys,tomllib;print(json.dumps(tomllib.load(open(sys.argv[1],"rb"))["mcp_servers"]["supabase"]["args"],separators=(",",":")))' \
            "$codex_home/captured.toml"
        [ "$status" -eq 0 ] || { echo "case $args: $output"; return 1; }
        [ "$output" = "$expected" ] || { echo "case $args: got $output, want $expected"; return 1; }
    done <<< "$SUPABASE_STRIP_CASES"
    [ "$n" -eq 6 ]
}

@test "tracked dispatcher source strips each supabase --access-token shape from Antigravity MCP config" {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home" args expected n=0
    mkdir -p "$fake_home" "$TMPDIR_/bin"
    cat > "$TMPDIR_/bin/agy" <<'AGY'
#!/usr/bin/env zsh
print -r -- "AGY_ARGS=$*"
AGY
    chmod +x "$TMPDIR_/bin/agy"

    while IFS='|' read -r args expected; do
        n=$((n + 1))
        printf '{"mcpServers":{"supabase":{"command":"npx","args":%s}}}\n' "$args" > "$PROJECT_DIR/.mcp.json"

        run zsh -f -c '
          export HOME="$1"
          export RALPH_REGISTRY_FILE="$2"
          export PATH="$3:$PATH"
          function _ralph_setup_mcps() { return 0; }
          function _ralph_setup_secrets() { return 0; }
          function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
          function _golem_setup_env() { return 0; }
          function _golem_setup_title() { return 0; }
          function _golem_reset_title() { return 0; }
          source "$4"
          testrepoGemini "Prep supabase" >/dev/null
          jq -c ".mcpServers.supabase.args" "$5/.agents/mcp_config.json"
          jq -c ".mcpServers.supabase.args" "$1/.gemini/config/mcp_config.json"
        ' _ "$fake_home" "$REGISTRY_FILE" "$TMPDIR_/bin" "$SOURCE_DISPATCHER" "$PROJECT_DIR"
        [ "$status" -eq 0 ] || { echo "case $args: exited $status: $output"; return 1; }
        [ "$output" = "$expected"$'\n'"$expected" ] || { echo "case $args: got $output, want $expected (twice)"; return 1; }
    done <<< "$SUPABASE_STRIP_CASES"
    [ "$n" -eq 6 ]
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

@test "tracked dispatcher source keeps lead personas for Cursor and Gemini" {
    [ -f "$SOURCE_DISPATCHER" ]

    PERSONA_HOME="$TMPDIR_/home-non-codex-persona"
    mkdir -p "$PERSONA_HOME/.claude/agents"
    printf '%s\n' \
      "# Full orchestrator protocol" \
      "BrainLayer-first boot searches." \
      "brain_store boot ceremony result." \
      "Orchestration routing protocol." \
      > "$PERSONA_HOME/.claude/agents/test-agent.md"
    jq '.projects.testrepo.agent = "test-agent"' \
      "$REGISTRY_FILE" > "$TMPDIR_/registry-non-codex-agent.json"
    PERSONA_REGISTRY="$TMPDIR_/registry-non-codex-agent.json"

    local cli
    for cli in cursor gemini; do
      run_non_codex_persona_launch "$cli"
      [ "$status" -eq 0 ]
      grep -F -q -- "<agent_context>" <<< "$output"
    done
}

@test "tracked dispatcher source keeps inherited GOLEM_ROLE=worker launches persona-free for Cursor and Gemini" {
    [ -f "$SOURCE_DISPATCHER" ]
    PERSONA_HOME="$TMPDIR_/home-non-codex-worker"
    mkdir -p "$PERSONA_HOME/.claude/agents"
    printf '%s\n' "# Full orchestrator protocol" "BrainLayer-first boot searches." \
      > "$PERSONA_HOME/.claude/agents/test-agent.md"
    jq '.projects.testrepo.agent = "test-agent"' \
      "$REGISTRY_FILE" > "$TMPDIR_/registry-non-codex-worker.json"
    PERSONA_REGISTRY="$TMPDIR_/registry-non-codex-worker.json"

    local cli
    for cli in cursor gemini; do
      run_non_codex_persona_launch "$cli" worker
      [ "$status" -eq 0 ]
      assert_no_worker_persona_markers "$output"
    done
}

@test "tracked dispatcher source defines no Kiro launchers (Q-E)" {
    [ -f "$SOURCE_DISPATCHER" ]
    jq '.projects.testrepo.clis = ["claude", "kiro"] | .projects.testrepo.launcherAliasPrefix = "tr"' \
      "$REGISTRY_FILE" > "$TMPDIR_/registry-with-kiro.json"

    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"
      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function kiro-cli() { print -r -- "KIRO_ARGS=$*"; }
      source "$2"
      (( $+functions[trClaude] )) && print -r -- "PREFIX_LOOP_RAN"
      (( $+functions[testrepoKiro] )) && print -r -- "DEFINED testrepoKiro"
      (( $+functions[trKiro] )) && print -r -- "DEFINED trKiro"
      (( $+functions[_golem_launch_kiro] )) && print -r -- "DEFINED _golem_launch_kiro"
      _golem_dispatch testrepo kiro -p "probe" </dev/null
    ' _ "$TMPDIR_/registry-with-kiro.json" "$SOURCE_DISPATCHER"

    [ "$status" -eq 1 ]
    grep -F -q -- "PREFIX_LOOP_RAN" <<< "$output" || false
    ! grep -F -q -- "DEFINED" <<< "$output" || false
    grep -F -q -- "Unknown CLI: kiro" <<< "$output" || false
    ! grep -F -q -- "kiro, run" <<< "$output"
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
        source "$PORTABLE_STAT_LIB"
        print -r -- "PATTERN_SELFCHECK=$(print -l repogolem-decoy .claude_notify_config_decoy unrelated-decoy | grep -E "$TMP_STAGING_PATTERN" | tr "\n" " ")"
        print -r -- "LIVE_TMP=$(ls -A /tmp 2>/dev/null | grep -E "$TMP_STAGING_PATTERN" | tr "\n" " ")"
        print -r -- "LIVE_STAGING=$(ls -A "$HOME/.cache/repogolem/testrepo" 2>/dev/null | tr "\n" " ")"
        print -r -- "STAGING_MODE=$(portable_stat mode "$HOME/.cache/repogolem/testrepo")"
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

@test "agy flash aliases resolve to a Flash model agy 1.2.9 accepts" {
    [ -f "$SOURCE_DISPATCHER" ]

    run zsh -f -c '
      source "$1"
      for alias in flash flash-high flash-med flash-medium flash-low; do
        print -r -- "$alias=$(_golem_agy_resolve_model "$alias")"
      done
    ' _ "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    grep -F -x -q -- "flash=Gemini 3.8 Flash (High)" <<< "$output"
    grep -F -x -q -- "flash-high=Gemini 3.8 Flash (High)" <<< "$output"
    grep -F -x -q -- "flash-med=Gemini 3.8 Flash (Medium)" <<< "$output"
    grep -F -x -q -- "flash-medium=Gemini 3.8 Flash (Medium)" <<< "$output"
    grep -F -x -q -- "flash-low=Gemini 3.8 Flash (Low)" <<< "$output"
    ! grep -F -q -- "Gemini 3.5 Flash" <<< "$output"
}

# BSD mktemp (macOS) only substitutes TRAILING X's: `name.XXXXXX.json` is
# created literally, so a second concurrent launch for the same project hits
# `mkstemp failed ... File exists` (#268). GNU mktemp substitutes the X run
# wherever it sits, so the shim below reproduces BSD semantics on Linux CI.
# The barrier holds every call until both launches have attempted that
# template, forcing the overlap the real race depends on.
BSD_MKTEMP_SHIM='function mktemp() {
        local tmpl="${@[-1]}"
        print -r -- "$tmpl" >> "$MKTEMP_ATTEMPTS"
        local -i tries=0
        while (( $(grep -c -x -F -- "$tmpl" "$MKTEMP_ATTEMPTS") < 2 && tries < 60 )); do
          sleep 0.05
          (( tries += 1 ))
        done
        local out
        if [[ "$tmpl" == *XXX ]]; then
          out=$(command mktemp "$tmpl") || return 1
        else
          out="$tmpl"
          if ! ( set -o noclobber; : > "$out" ) 2>/dev/null; then
            print -u2 -- "mktemp: mkstemp failed on ${tmpl}: File exists"
            return 1
          fi
        fi
        print -r -- "$out" >> "$MKTEMP_CREATED"
        print -r -- "$out"
      }'

@test "tracked dispatcher source: concurrent agy workspace syncs for one project do not collide on BSD mktemp" {
    [ -f "$SOURCE_DISPATCHER" ]

    local fake_home="$TMPDIR_/home" xdg="$TMPDIR_/xdg-runtime"
    mkdir -p "$fake_home" "$xdg"
    export MKTEMP_ATTEMPTS="$TMPDIR_/mktemp-attempts" MKTEMP_CREATED="$TMPDIR_/mktemp-created"
    : > "$MKTEMP_ATTEMPTS"
    : > "$MKTEMP_CREATED"
    printf '%s\n' '{"mcpServers":{"local":{"command":"true"}}}' > "$PROJECT_DIR/.mcp.json"

    run zsh -f -c '
      export HOME="$1" XDG_RUNTIME_DIR="$2"
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      '"$BSD_MKTEMP_SHIM"'
      source "$3"
      _golem_sync_agy_workspace testrepo "$4" & local pid_a=$!
      _golem_sync_agy_workspace testrepo "$4" & local pid_b=$!
      wait $pid_a; print -r -- "RUN_A=$?"
      wait $pid_b; print -r -- "RUN_B=$?"
    ' _ "$fake_home" "$xdg" "$SOURCE_DISPATCHER" "$PROJECT_DIR"

    [ "$status" -eq 0 ]
    grep -F -x -q -- "RUN_A=0" <<< "$output"
    grep -F -x -q -- "RUN_B=0" <<< "$output"
    ! grep -F -q -- "mkstemp failed" <<< "$output" || false

    # Four temp files per launch, eight in all, and no two launches shared one.
    [ "$(wc -l < "$MKTEMP_CREATED")" -eq 8 ]
    [ -z "$(sort "$MKTEMP_CREATED" | uniq -d)" ]
    ! grep -F -q -- "XXXXXX" "$MKTEMP_CREATED" || false
    [ -z "$(find "$xdg" "$fake_home" "$PROJECT_DIR" -name '*XXXXXX*' -print)" ]

    jq -e '.mcpServers.local.command == "true"' "$PROJECT_DIR/.agents/mcp_config.json"
    jq -e '.mcpServers.local.command == "true"' "$fake_home/.gemini/config/mcp_config.json"
}

@test "tracked dispatcher source ends every mktemp template in X's" {
    [ -f "$SOURCE_DISPATCHER" ]

    # BSD mktemp leaves X's that are followed by anything else unsubstituted.
    run grep -n -E 'mktemp[^)]*XXX[^X"]' "$SOURCE_DISPATCHER"
    if [ "$status" -eq 0 ]; then
        echo "mktemp templates with a suffix after the X's:" >&2
        echo "$output" >&2
        return 1
    fi
}

# ── --worker is the one worker signal: it owns GOLEM_ROLE ──────────
#
# cmuxlayer's spawn_agent used to type GOLEM_ROLE=worker in front of non-Claude
# worker launchers. The dispatcher owns it now: --worker sets it for the call.
#
# The launched stub reports GOLEM_ROLE twice: as the launcher's shell sees it,
# and as a real child process inherits it (the agent CLI is a child process).
# After the launcher returns, the caller's shell must hold what it held before.
run_worker_role_launch() {
    local preset="$1"; shift
    run zsh -f -c '
      unset GOLEM_ROLE
      [ -n "$3" ] && export GOLEM_ROLE="$3"
      export RALPH_REGISTRY_FILE="$1"
      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _role_probe() {
        print -r -- "$1_ROLE_SHELL=${GOLEM_ROLE-unset}"
        print -r -- "$1_ROLE_CHILD=$(command env | sed -n "s/^GOLEM_ROLE=//p")"
        print -r -- "$1_ARGS=${*[2,-1]}"
      }
      function claude() { _role_probe CLAUDE "$@"; }
      function codex() { _role_probe CODEX "$@"; }
      function cursor() { _role_probe CURSOR "$@"; }
      function agy() { _role_probe AGY "$@"; }
      source "$2"
      # After source: the dispatcher defines these, and its title escapes
      # would otherwise run into the AFTER_ lines.
      function _golem_setup_env() { return 0; }
      function _golem_sync_agy_workspace() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      shift 3
      "$@"
      rc=$?
      print -r -- "AFTER_ROLE_SHELL=${GOLEM_ROLE-unset}"
      print -r -- "AFTER_ROLE_ENV=$(command env | sed -n "s/^GOLEM_ROLE=//p")"
      exit $rc
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER" "$preset" "$@"
}

@test "--worker exports GOLEM_ROLE=worker to the launched Codex, Cursor and Gemini CLI" {
    [ -f "$SOURCE_DISPATCHER" ]
    local launcher stub
    for launcher in testrepoCodex testrepoCursor testrepoGemini; do
      case "$launcher" in
        testrepoCodex) stub=CODEX ;;
        testrepoCursor) stub=CURSOR ;;
        testrepoGemini) stub=AGY ;;
      esac
      run_worker_role_launch "" "$launcher" --worker -s
      [ "$status" -eq 0 ]
      grep -F -x -q -- "${stub}_ROLE_SHELL=worker" <<< "$output"
      grep -F -x -q -- "${stub}_ROLE_CHILD=worker" <<< "$output"
    done
}

@test "the CodexWorker launcher exports GOLEM_ROLE=worker like codex --worker" {
    [ -f "$SOURCE_DISPATCHER" ]
    run_worker_role_launch "" testrepoCodexWorker -s
    [ "$status" -eq 0 ]
    grep -F -x -q -- "CODEX_ROLE_CHILD=worker" <<< "$output"
}

@test "--worker does not leak GOLEM_ROLE into the caller's shell after the launch returns" {
    [ -f "$SOURCE_DISPATCHER" ]
    local launcher
    for launcher in testrepoCodex testrepoCursor testrepoGemini testrepoCodexWorker; do
      run_worker_role_launch "" "$launcher" --worker -s
      [ "$status" -eq 0 ]
      grep -E -x -q -- "(CODEX|CURSOR|AGY)_ROLE_CHILD=worker" <<< "$output"
      grep -F -x -q -- "AFTER_ROLE_SHELL=unset" <<< "$output"
      grep -F -x -q -- "AFTER_ROLE_ENV=" <<< "$output"
    done
}

@test "--worker restores the caller's own GOLEM_ROLE after the launch returns" {
    [ -f "$SOURCE_DISPATCHER" ]
    local launcher
    for launcher in testrepoCodex testrepoCursor testrepoGemini; do
      run_worker_role_launch lead "$launcher" --worker -s
      [ "$status" -eq 0 ]
      grep -E -x -q -- "(CODEX|CURSOR|AGY)_ROLE_CHILD=worker" <<< "$output"
      grep -F -x -q -- "AFTER_ROLE_SHELL=lead" <<< "$output"
      grep -F -x -q -- "AFTER_ROLE_ENV=lead" <<< "$output"
    done
}

@test "an explicit GOLEM_ROLE=worker still reaches every launched CLI unchanged" {
    [ -f "$SOURCE_DISPATCHER" ]
    local launcher
    for launcher in testrepoClaude testrepoCodex testrepoCursor testrepoGemini; do
      run_worker_role_launch worker "$launcher" -s
      [ "$status" -eq 0 ]
      grep -E -x -q -- "(CLAUDE|CODEX|CURSOR|AGY)_ROLE_CHILD=worker" <<< "$output"
      grep -F -x -q -- "AFTER_ROLE_ENV=worker" <<< "$output"
    done
}

@test "a lead launch without --worker exports no GOLEM_ROLE" {
    [ -f "$SOURCE_DISPATCHER" ]
    local launcher
    for launcher in testrepoClaude testrepoCodex testrepoCursor testrepoGemini; do
      run_worker_role_launch "" "$launcher" -s
      [ "$status" -eq 0 ]
      grep -E -x -q -- "(CLAUDE|CODEX|CURSOR|AGY)_ROLE_CHILD=" <<< "$output"
    done
}

@test "a --worker passed through after Codex -- is not the launcher flag" {
    [ -f "$SOURCE_DISPATCHER" ]
    run_worker_role_launch "" testrepoCodex -s -- --worker
    [ "$status" -eq 0 ]
    grep -F -x -q -- "CODEX_ROLE_CHILD=" <<< "$output"
    grep -F -q -- "--worker" <<< "$output"
}

# cmuxlayer passes --worker to EVERY worker, Claude included, and deliberately
# keeps GOLEM_ROLE away from Claude: GOLEM_ROLE=worker drops Claude to medium
# effort. So --worker must leave Claude's effort and environment alone, while a
# caller who sets GOLEM_ROLE=worker explicitly keeps today's medium.
@test "Claude --worker keeps the lead effort and exports no GOLEM_ROLE (cmuxlayer contract)" {
    [ -f "$SOURCE_DISPATCHER" ]
    run_worker_role_launch "" testrepoClaude --worker -s
    [ "$status" -eq 0 ]
    grep -F -q -- "--effort high" <<< "$output"
    refute_contains "--effort medium" "$output" "--worker alone must not lower Claude effort"
    grep -F -x -q -- "CLAUDE_ROLE_CHILD=" <<< "$output"
    grep -F -x -q -- "AFTER_ROLE_SHELL=unset" <<< "$output"

    run_worker_role_launch worker testrepoClaude -s
    [ "$status" -eq 0 ]
    grep -F -q -- "--effort medium" <<< "$output"

    run_worker_role_launch "" testrepoClaude --worker -s -E medium
    [ "$status" -eq 0 ]
    grep -F -q -- "--effort medium" <<< "$output"
}

# ── prelaunch: user-owned commands from the repoGolem config ──────
#
# registry.json's global.prelaunch (generated from the user's own 0600 config)
# runs in the shell that then starts the agent, so exports and ulimit changes
# reach the agent process, and never the caller's interactive shell.
#
# The agent stubs here are real executables on PATH, not shell functions: the
# point is what a separate agent process inherits, and who its parent is.
# $1 is the prelaunch JSON list, or ABSENT for a registry with no such key.
run_prelaunch_launch() {
    local prelaunch="$1"; shift
    local registry="$TMPDIR_/registry-prelaunch.json" bin="$TMPDIR_/prelaunch-bin" name
    if [ "$prelaunch" = ABSENT ]; then
        cp "$REGISTRY_FILE" "$registry"
    else
        jq --argjson prelaunch "$prelaunch" '.global.prelaunch = $prelaunch' "$REGISTRY_FILE" > "$registry"
    fi
    mkdir -p "$bin" "$TMPDIR_/home"
    for name in claude codex cursor agy; do
        cat > "$bin/$name" <<'STUB'
#!/bin/sh
echo "AGENT=${0##*/} PROBE=${PRELAUNCH_PROBE-unset} NOFILE=$(ulimit -n)"
echo "AGENT_PPID=$PPID"
[ -n "$STUB_SIGNAL" ] && kill -s "$STUB_SIGNAL" $$
exit "${STUB_EXIT:-0}"
STUB
        chmod +x "$bin/$name"
    done
    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1" PATH="$3:$PATH" HOME="$4"
      unset PRELAUNCH_PROBE
      ulimit -Sn 256
      source "$2"
      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _golem_setup_env() { return 0; }
      function _golem_sync_agy_workspace() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      print -r -- "LAUNCHER_PID=$$"
      shift 4
      "$@"
      print -r -- "RC=$?"
      print -r -- "AFTER_PROBE=${PRELAUNCH_PROBE-unset} AFTER_NOFILE=$(ulimit -Sn)"
    ' _ "$registry" "$SOURCE_DISPATCHER" "$bin" "$TMPDIR_/home" "$@"
}

PRELAUNCH_LAUNCHERS=(testrepoClaude testrepoCodex testrepoCursor testrepoGemini)

@test "prelaunch commands run in order and their exports and ulimit reach the agent process" {
    [ -f "$SOURCE_DISPATCHER" ]
    local launcher
    # shellcheck disable=SC2016 # expanded by the dispatcher, not here
    local prelaunch='["export PRELAUNCH_PROBE=first", "export PRELAUNCH_PROBE=\"$PRELAUNCH_PROBE-second\"", "ulimit -Sn 512"]'
    for launcher in "${PRELAUNCH_LAUNCHERS[@]}"; do
        run_prelaunch_launch "$prelaunch" "$launcher" -s
        [ "$status" -eq 0 ] || { echo "$launcher: $output" >&2; return 1; }
        grep -E -q -- "^AGENT=[a-z]+ PROBE=first-second NOFILE=512$" <<< "$output" \
          || { echo "$launcher: $output" >&2; return 1; }
        grep -F -x -q -- "RC=0" <<< "$output"
    done
}

@test "prelaunch effects never leak into the caller's shell" {
    [ -f "$SOURCE_DISPATCHER" ]
    local launcher
    for launcher in "${PRELAUNCH_LAUNCHERS[@]}"; do
        run_prelaunch_launch '["export PRELAUNCH_PROBE=leaked", "ulimit -Sn 512"]' "$launcher" -s
        [ "$status" -eq 0 ]
        grep -F -q -- "PROBE=leaked NOFILE=512" <<< "$output"
        grep -F -x -q -- "AFTER_PROBE=unset AFTER_NOFILE=256" <<< "$output" \
          || { echo "$launcher: $output" >&2; return 1; }
    done
}

@test "a failing prelaunch command warns by index, never by text, and the launch continues" {
    [ -f "$SOURCE_DISPATCHER" ]
    local launcher
    # A failed test, a command-not-found, a syntax error, and a command that
    # names itself on stderr: none of their text may reach the output.
    local prelaunch='["test PRELAUNCH_TEXT_MARKER = never", "PRELAUNCH_MISSING_MARKER", "if PRELAUNCH_SYNTAX_MARKER then", "echo PRELAUNCH_STDERR_MARKER >&2; false", "export PRELAUNCH_PROBE=after-failures"]'
    local index
    for launcher in "${PRELAUNCH_LAUNCHERS[@]}"; do
        run_prelaunch_launch "$prelaunch" "$launcher" -s
        [ "$status" -eq 0 ]
        for index in 1 2 3 4; do
            grep -F -q -- "repoGolem: prelaunch command $index failed" <<< "$output" \
              || { echo "$launcher [$index]: $output" >&2; return 1; }
        done
        grep -F -q -- "repoGolem: prelaunch command 2 failed (exit 127)" <<< "$output"
        refute_contains "prelaunch command 5" "$output" "command 5 succeeded"
        refute_contains "_MARKER" "$output" "a failed prelaunch command must never print its text"
        grep -F -q -- "PROBE=after-failures" <<< "$output" \
          || { echo "$launcher: $output" >&2; return 1; }
        grep -F -x -q -- "RC=0" <<< "$output"
    done
}

@test "return in a prelaunch command is contained: it warns and the launch continues" {
    [ -f "$SOURCE_DISPATCHER" ]
    local launcher
    for launcher in "${PRELAUNCH_LAUNCHERS[@]}"; do
        run_prelaunch_launch '["return 7", "return 0", "export PRELAUNCH_PROBE=after-return"]' "$launcher" -s
        [ "$status" -eq 0 ]
        grep -F -q -- "repoGolem: prelaunch command 1 failed (exit 7)" <<< "$output" \
          || { echo "$launcher: $output" >&2; return 1; }
        refute_contains "prelaunch command 2" "$output" "return 0 is a success"
        grep -F -q -- "PROBE=after-return" <<< "$output" \
          || { echo "$launcher: $output" >&2; return 1; }
        grep -F -x -q -- "RC=0" <<< "$output"
    done
}

# exit cannot be contained without running the commands in a further subshell,
# which would drop their effects before the agent starts. It is unsupported;
# what it must do is say so, by index, and pass its status back.
@test "exit in a prelaunch command is unsupported but says so by index" {
    [ -f "$SOURCE_DISPATCHER" ]
    local launcher
    for launcher in "${PRELAUNCH_LAUNCHERS[@]}"; do
        run_prelaunch_launch '["true", "exit 3 # PRELAUNCH_EXIT_MARKER"]' "$launcher" -s
        [ "$status" -eq 0 ]
        grep -F -q -- "repoGolem: prelaunch command 2 called exit; the agent was not launched" <<< "$output" \
          || { echo "$launcher: $output" >&2; return 1; }
        refute_contains "AGENT=" "$output" "the agent must not have started"
        refute_contains "PRELAUNCH_EXIT_MARKER" "$output" "the warning must not echo the command"
        grep -F -x -q -- "RC=3" <<< "$output"
    done
}

@test "an absent or empty prelaunch calls the agent directly, with no extra frame and no prelaunch jq" {
    [ -f "$SOURCE_DISPATCHER" ]
    local registry="$TMPDIR_/registry-frames.json" prelaunch launcher stub
    for prelaunch in ABSENT '[]'; do
        if [ "$prelaunch" = ABSENT ]; then
            cp "$REGISTRY_FILE" "$registry"
        else
            jq --argjson p "$prelaunch" '.global.prelaunch = $p' "$REGISTRY_FILE" > "$registry"
        fi
        for launcher in "${PRELAUNCH_LAUNCHERS[@]}"; do
            case "$launcher" in
                testrepoClaude) stub=claude ;; testrepoCodex) stub=codex ;;
                testrepoCursor) stub=cursor ;; testrepoGemini) stub=agy ;;
            esac
            run zsh -f -c '
              export RALPH_REGISTRY_FILE="$1" HOME="$3"; PRELAUNCH_JQ_LOG="$5"
              function jq() { [[ "$*" == *.global.prelaunch* ]] && print -r -- ran >> "$PRELAUNCH_JQ_LOG"; command jq "$@"; }
              source "$2"
              function _ralph_setup_mcps() { return 0; }
              function _ralph_setup_secrets() { return 0; }
              function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
              function _golem_setup_env() { return 0; }
              function _golem_sync_agy_workspace() { return 0; }
              function _golem_setup_title() { return 0; }
              function _golem_reset_title() { return 0; }
              function claude() { print -r -- "FRAMES=${(j:,:)funcstack}"; }
              function codex() { print -r -- "FRAMES=${(j:,:)funcstack}"; }
              function cursor() { print -r -- "FRAMES=${(j:,:)funcstack}"; }
              function agy() { print -r -- "FRAMES=${(j:,:)funcstack}"; }
              "$4" -s
              [[ -s "$PRELAUNCH_JQ_LOG" ]] && print -r -- "PRELAUNCH_JQ_RAN"
              return 0
            ' _ "$registry" "$SOURCE_DISPATCHER" "$TMPDIR_/home" "$launcher" "$TMPDIR_/jq-prelaunch-$launcher-${#prelaunch}.log"
            [ "$status" -eq 0 ] || { echo "$launcher [$prelaunch] status=$status: $output" >&2; return 1; }
            # Exactly the frames #364 produced: the stub, its launcher, dispatch, the wrapper.
            grep -E -x -q -- "FRAMES=${stub},_golem_launch_[a-z]+,_golem_dispatch,${launcher}" <<< "$output" \
              || { echo "$launcher [$prelaunch]: $output" >&2; return 1; }
            if [ "$prelaunch" = ABSENT ]; then
                refute_contains "PRELAUNCH_JQ_RAN" "$output" "no prelaunch key must mean no prelaunch jq"
            else
                # Positive control: the key is present, so the jq read is seen.
                grep -F -x -q -- "PRELAUNCH_JQ_RAN" <<< "$output"
            fi
        done
    done
}

# The dispatcher skips jq when the registry text cannot hold a prelaunch key.
# That shortcut must never miss a real key: JSON may spell it with \u escapes.
# $1 is the registry text; the stub reports the probe variable and its frames,
# and any jq call that reads prelaunch is logged to a file (the dispatcher
# discards that jq's stderr) and reported as PRELAUNCH_JQ_RAN.
run_prelaunch_registry_text() {
    local registry="$TMPDIR_/registry-precheck.json" jq_log="$TMPDIR_/jq-precheck.log"
    rm -f "$jq_log"
    printf '%s\n' "$1" > "$registry"
    jq -e . "$registry" > /dev/null
    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1" HOME="$3"; PRELAUNCH_JQ_LOG="$4"
      unset PRELAUNCH_PROBE
      function jq() { [[ "$*" == *.global.prelaunch* ]] && print -r -- ran >> "$PRELAUNCH_JQ_LOG"; command jq "$@"; }
      source "$2"
      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function claude() { print -r -- "PROBE=${PRELAUNCH_PROBE-unset} FRAMES=${(j:,:)funcstack}"; }
      testrepoClaude -s
      [[ -s "$PRELAUNCH_JQ_LOG" ]] && print -r -- "PRELAUNCH_JQ_RAN"
      return 0
    ' _ "$registry" "$SOURCE_DISPATCHER" "$TMPDIR_/home" "$jq_log"
}

prelaunch_registry_text() {
    # $1: extra top-level JSON members, spliced in before "projects".
    printf '{%s"projects":{"testrepo":{"path":"%s","mcps":[],"clis":["claude"],"disableChrome":true}}}' "$1" "$PROJECT_DIR"
}

PRELAUNCH_DIRECT_FRAMES="FRAMES=claude,_golem_launch_claude,_golem_dispatch,testrepoClaude"
# One JSON unicode-escape introducer (a backslash, then u), built from octal so
# no literal escape sequence lives in this file.
JSON_U="$(printf '\134')u"

@test "a prelaunch key spelled with a JSON unicode escape still runs its commands" {
    [ -f "$SOURCE_DISPATCHER" ]
    local members="\"global\":{\"${JSON_U}0070relaunch\":[\"export PRELAUNCH_PROBE=loaded\"]},"
    [[ "$members" != *'"prelaunch"'* ]]
    jq -e '.global.prelaunch == ["export PRELAUNCH_PROBE=loaded"]' <<< "{$members\"x\":1}"
    run_prelaunch_registry_text "$(prelaunch_registry_text "$members")"
    [ "$status" -eq 0 ]
    grep -F -q -- "PROBE=loaded " <<< "$output" || { echo "$output" >&2; return 1; }
}

@test "a literal prelaunch key runs its commands" {
    [ -f "$SOURCE_DISPATCHER" ]
    run_prelaunch_registry_text "$(prelaunch_registry_text '"global":{"prelaunch":["export PRELAUNCH_PROBE=loaded"]},')"
    [ "$status" -eq 0 ]
    grep -F -q -- "PROBE=loaded " <<< "$output" || { echo "$output" >&2; return 1; }
}

@test "no prelaunch key, or the word only inside unrelated values, takes the direct path without jq" {
    [ -f "$SOURCE_DISPATCHER" ]
    local members
    for members in '' '"global":{"env":{"NOTE":"run prelaunch later"}},'; do
        run_prelaunch_registry_text "$(prelaunch_registry_text "$members")"
        [ "$status" -eq 0 ]
        grep -F -x -q -- "PROBE=unset $PRELAUNCH_DIRECT_FRAMES" <<< "$output" \
          || { echo "[$members]: $output" >&2; return 1; }
        refute_contains "PRELAUNCH_JQ_RAN" "$output" "no possible prelaunch key must mean no jq"
    done
}

@test "a precheck false positive still gives the direct call after the jq read" {
    [ -f "$SOURCE_DISPATCHER" ]
    local members
    # A \u escape anywhere, or "prelaunch" as a whole string value: the text
    # check cannot rule a key out, jq finds none, and the call stays direct.
    for members in "\"global\":{\"env\":{\"NOTE\":\"caf${JSON_U}00e9\"}}," '"global":{"env":{"NOTE":"prelaunch"}},'; do
        run_prelaunch_registry_text "$(prelaunch_registry_text "$members")"
        [ "$status" -eq 0 ]
        grep -F -q -- "PRELAUNCH_JQ_RAN" <<< "$output" || { echo "[$members]: $output" >&2; return 1; }
        grep -F -x -q -- "PROBE=unset $PRELAUNCH_DIRECT_FRAMES" <<< "$output" \
          || { echo "[$members]: $output" >&2; return 1; }
    done
}

@test "an absent or empty prelaunch launches exactly as before: no subshell, no output" {
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

@test "with prelaunch the agent keeps its parent, exit status and signal status" {
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

@test "Gemini explicit -m pro preserves Pro High while bare gathers default to Flash High" {
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

@test "Gemini gatherer agent is selected only for workers when globally installed" {
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

@test "Gemini missing global gatherer keeps the worker launch with a warning" {
    run_gatherer_launch --worker -s
    [ "$status" -eq 0 ]
    grep -F -q -- "gatherer agent is not installed" <<< "$output"
    refute_contains "--agent gatherer" "$output"
    grep -F -q -- "--model Gemini 3.8 Flash (High)" <<< "$output"
}

@test "registry CLI persona mapping selects Gemini lead without changing other leads or workers" {
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
