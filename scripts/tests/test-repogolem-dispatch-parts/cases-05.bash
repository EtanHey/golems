function split_case_081() {
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

function split_case_082() {
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

function split_case_083() {
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

function split_case_084() {
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
function split_case_085() {
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

function split_case_086() {
    set_agy_registry_servers '{"supabase":{"command":"npx"}}'
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

function split_case_087() {
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

function split_case_088() {
    set_agy_registry_servers '{"supabase":{"command":"npx"}}'
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

function split_case_089() {
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

function split_case_090() {
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
      testrepoCodex -s -E high -- -pmyprofile
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER" "$codex_home"

    [ "$status" -eq 0 ]
    # clap accepts `-pVALUE` attached, so it is a profile selection too and
    # appending ours on top would abort the launch
    local argv_line
    argv_line="$(grep -F -- 'CODEX_ARGS=' <<< "$output")"
    grep -F -q -- "-pmyprofile" <<< "$argv_line"
    refute_contains "--profile repogolem-" "$argv_line" "attached -p<profile> must suppress our profile too"
}

function split_case_091() {
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

function split_case_092() {
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

function split_case_093() {
    [ -f "$SOURCE_DISPATCHER" ]
    PERSONA_HOME="$TMPDIR_/home-non-codex-worker"
    install_test_shell_worker "$PERSONA_HOME"
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

function split_case_094() {
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

function split_case_095() {
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

function split_case_096() {
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

