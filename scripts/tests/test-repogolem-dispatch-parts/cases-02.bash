function split_case_026() {
    set_agy_registry_servers '{"registryRemote":{"url":"https://example.com/registry-mcp"},"urlRemote":{"url":"https://example.com/url-mcp"},"httpRemote":{"httpUrl":"https://example.com/http-mcp"}}'
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

function split_case_027() {
    set_agy_registry_servers '{"registryRemote":{"url":"https://example.com/registry-mcp"}}'
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

function split_case_028() {
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

    output="$(strip_codex_app_driver_args "$output")"
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

function split_case_029() {
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
      testrepoCodex
      testrepoCodex --effort high
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]
    [ "$(grep -Fc -- 'CODEX_ARG=model_reasoning_effort=' <<< "$output")" -eq 1 ]
    [ "$(grep -Fxc -- 'CODEX_ARG=model_reasoning_effort="high"' <<< "$output")" -eq 1 ]
}

function split_case_030() {
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
      testrepoCodex -s -E medium -p "one shot"
      testrepoCodex -s -c "continue"
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"

    [ "$status" -eq 0 ]

    output="$(strip_codex_app_driver_args "$output")"
    for call in 2; do
      local call_output
      call_output=$(awk -v call="$call" '
        $0 == "CODEX_CALL=" call { in_call = 1; next }
        /^CODEX_CALL=/ { in_call = 0 }
        in_call { print }
      ' <<< "$output")
      [ "$(grep -Fxc -- 'CODEX_ARG=model_reasoning_effort="medium"' <<< "$call_output")" -eq 1 ]
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

function split_case_031() {
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
      testrepoCodex -s -E medium -p "one shot"
      testrepoCodex -s -c "continue"
      testrepoCodex -E high --worker -s "Implement brief"
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

function split_case_032() {
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

function split_case_033() {
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

function split_case_034() {
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

    output="$(strip_codex_app_driver_args "$output")"
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

function split_case_035() {
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

function split_case_036() {
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

function split_case_037() {
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

    output="$(strip_codex_app_driver_args "$output")"
    [ "$(grep '^CODEX_ARG=' <<< "$output")" = $'CODEX_ARG=resume\nCODEX_ARG=019fec96-588d-7000-8000-000000000000\nCODEX_ARG=-c\nCODEX_ARG=model_reasoning_effort="xhigh"\nCODEX_ARG=--model\nCODEX_ARG=gpt-5.6-sol' ]
    [ "$(grep -Fc -- "Adopt the following launcher agent context" <<< "$output")" -eq 0 ]
}

function split_case_038() {
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

function split_case_039() {
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

    output="$(strip_codex_app_driver_args "$output")"
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

function split_case_040() {
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

