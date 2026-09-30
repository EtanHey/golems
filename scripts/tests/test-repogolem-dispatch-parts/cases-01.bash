function split_case_001() {
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

function split_case_002() {
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

function split_case_003() {
    assert_dispatch_fixture_mirror "$FIXTURES/repogolem-dispatch.zsh" "$FIXTURES/dispatch"
    cp -R "$FIXTURES/dispatch" "$TMPDIR_/drift"
    printf '# planted drift\n' >> "$TMPDIR_/drift/core.zsh"
    run assert_dispatch_fixture_mirror "$FIXTURES/repogolem-dispatch.zsh" "$TMPDIR_/drift"
    [ "$status" -ne 0 ]
}

function split_case_004() {
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

function split_case_005() {
    mkdir -p "$TMPDIR_/bare" "$TMPDIR_/link"
    cp "$SOURCE_DISPATCHER" "$TMPDIR_/bare/golem-dispatch.zsh"
    ln -s "$TMPDIR_/bare/golem-dispatch.zsh" "$TMPDIR_/link/golem-dispatch.zsh"
    run env RALPH_REGISTRY_FILE="$REGISTRY_FILE" zsh -f -c 'source "$1"' _ "$TMPDIR_/link/golem-dispatch.zsh"
    [ "$status" -ne 0 ]
    [[ "$output" == *"Missing dispatcher module:"* ]] || false
}

function split_case_006() {
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

function split_case_007() {
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

function split_case_008() {
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

function split_case_009() {
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

function split_case_010() {
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

function split_case_011() {
    local fake_home="$TMPDIR_/failing-home"
    local target="$fake_home/.config/ralphtools/golem-dispatch.zsh"
    mkdir -p "$fake_home/.config/ralphtools"
    printf '# previous facade\n' > "$target"
    : > "$fake_home/.config/ralphtools/dispatch"
    run env HOME="$fake_home" zsh "$INSTALL_DISPATCHER" --force "$target"
    [ "$status" -ne 0 ]
    [ "$(cat "$target")" = '# previous facade' ]
}

function split_case_012() {
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

function split_case_013() {
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

function split_case_014() {
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

function split_case_015() {
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

function split_case_016() {
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

function split_case_017() {
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

function split_case_018() {
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

function split_case_019() {
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

function split_case_020() {
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

function split_case_021() {
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

function split_case_022() {
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

function split_case_023() {
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

function split_case_024() {
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

function split_case_025() {
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

