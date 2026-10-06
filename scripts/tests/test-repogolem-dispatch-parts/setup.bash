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

# AGY persistence consumes raw declarations rather than the secret-resolving stub.
set_agy_registry_servers() {
    jq --argjson servers "$1" '.global.mcps = $servers' "$REGISTRY_FILE" > "$REGISTRY_FILE.next"
    mv "$REGISTRY_FILE.next" "$REGISTRY_FILE"
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

# Every non-bare repoGolem Codex launch disables the app-driving plugins and
# node_repl (cases-08). Exact-argv tests strip these pairs and pin the rest.
# The marketplace is interpolated: a literal plugin id followed by a dotted key matches the
# publish-boundary identity-pii (email) pattern.
CODEX_PLUGIN_MARKETPLACE='openai-bundled'
CODEX_APP_DRIVER_PLUGINS=(computer-use unified-computer-use browser computer-history chrome record-and-replay messages codex-app-tools)
CODEX_APP_DRIVER_OVERRIDES=()
for _codex_plugin in "${CODEX_APP_DRIVER_PLUGINS[@]}"; do
    CODEX_APP_DRIVER_OVERRIDES+=("plugins.${_codex_plugin}@${CODEX_PLUGIN_MARKETPLACE}.enabled=false")
done
unset _codex_plugin
CODEX_APP_DRIVER_OVERRIDES+=(
    'mcp_servers.node_repl={command="/usr/bin/false",enabled=false}'
    'mcp_servers.computer-use={command="/usr/bin/false",enabled=false}'
)
CODEX_APP_DRIVER_ARG_COUNT=$(( ${#CODEX_APP_DRIVER_OVERRIDES[@]} * 2 ))

# Removes each `-c <override>` pair from launch output, in both the per-line
# CODEX_ARG= form and the one-line CODEX_ARGS= form.
strip_codex_app_driver_args() {
    local text="$1" override
    for override in "${CODEX_APP_DRIVER_OVERRIDES[@]}"; do
        text="${text//" -c $override"/}"
        text="${text//"=-c $override "/=}"
        text="${text//"=-c $override"/=}"
    done
    # BSD awk rejects a newline inside -v, so the list travels through ENVIRON.
    CODEX_APP_DRIVERS="$(IFS='|'; printf '%s' "${CODEX_APP_DRIVER_OVERRIDES[*]}")" awk '
      BEGIN { n = split(ENVIRON["CODEX_APP_DRIVERS"], d, "|"); for (i = 1; i <= n; i++) guard["CODEX_ARG=" d[i]] = 1 }
      held { held = 0; if ($0 in guard) next; print "CODEX_ARG=-c" }
      $0 == "CODEX_ARG=-c" { held = 1; next }
      { print }
      END { if (held) print "CODEX_ARG=-c" }
    ' <<< "$text"
}

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

