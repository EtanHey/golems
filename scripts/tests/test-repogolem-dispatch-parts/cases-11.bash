# The repogolem registry can declare an MCP server as a `claude mcp add`
# argument string ({"transport":"command","value":"--transport http NAME URL"}).
# Rendered as-is it gave codex an [mcp_servers.X] table with no command and no
# url, and codex aborted EVERY launch for that project ("invalid transport").

run_codex_transport_launch() {
    run env -u GOLEM_ROLE -u GOLEM_EFFORT zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"
      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() {
        print -r -- "{\"mcpServers\":{
          \"figma-local\":{\"transport\":\"command\",\"value\":\"--transport http figma http://127.0.0.1:3845/mcp\"},
          \"figma-remote\":{\"transport\":\"command\",\"value\":\"--transport sse figma-remote https://mcp.figma.com/mcp\"},
          \"stdio-string\":{\"transport\":\"command\",\"value\":\"stdio-string -- npx some-mcp\"},
          \"empty\":{},
          \"harmless\":{\"command\":\"harmless-mcp\",\"args\":[\"--stdio\"]}
        }}"
      }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function codex() {
        local p
        print -r -- "CODEX_STARTED"
        for p in "$CODEX_HOME"/repogolem-*.config.toml(N); do
          python3 -c "import json,sys,tomllib; print(\"PROFILE=\"+json.dumps(tomllib.load(open(sys.argv[1],\"rb\")).get(\"mcp_servers\",{}),sort_keys=True))" "$p"
        done
      }
      source "$2"
      testrepoCodex -s -E low --worker
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER"
}

function split_case_160() {
    run_codex_transport_launch
    [ "$status" -eq 0 ] || { echo "status=$status: $output" >&2; return 1; }
    grep -F -x -q -- 'CODEX_STARTED' <<< "$output"
    local profile
    profile="$(sed -n 's/^PROFILE=//p' <<< "$output")"
    [ -n "$profile" ] || { echo "no profile: $output" >&2; return 1; }
    # http/sse argument strings become url servers.
    [ "$(jq -r '."figma-local".url' <<< "$profile")" = "http://127.0.0.1:3845/mcp" ]
    [ "$(jq -r '."figma-remote".url' <<< "$profile")" = "https://mcp.figma.com/mcp" ]
    # Anything codex cannot express is skipped, never rendered transport-less.
    [ "$(jq -r 'has("stdio-string")' <<< "$profile")" = "false" ]
    [ "$(jq -r 'has("empty")' <<< "$profile")" = "false" ]
    [ "$(jq -r '.harmless.command' <<< "$profile")" = "harmless-mcp" ]
    # Every rendered server has exactly one transport.
    [ "$(jq '[.[] | select((has("command") or has("url")) | not)] | length' <<< "$profile")" = "0" ]
    grep -F -q -- 'repoGolem: skipping MCP server "stdio-string"' <<< "$output"
    grep -F -q -- 'repoGolem: skipping MCP server "empty"' <<< "$output"
}

# claudeSettings: a ~-relative path to a Claude --settings file. Coach seats use
# it to clear the CLIProxyAPI env so claude.ai connectors stay enabled.
run_claude_settings_launch() {
    local registry="$TMPDIR_/registry-claude-settings.json"
    if [ -n "$1" ]; then
        jq --arg s "$1" '.projects.testrepo.claudeSettings = $s' "$REGISTRY_FILE" > "$registry"
    else
        cp "$REGISTRY_FILE" "$registry"
    fi
    run zsh -f -c '
      export RALPH_REGISTRY_FILE="$1" HOME="$3"
      source "$2"
      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function claude() { print -r -- "ARGS=$*"; }
      testrepoClaude -s
    ' _ "$registry" "$SOURCE_DISPATCHER" "$TMPDIR_/settings-home"
}

function split_case_161() {
    [ -f "$SOURCE_DISPATCHER" ]
    local home="$TMPDIR_/settings-home"
    mkdir -p "$home/.config/tokenlayer"
    printf '%s\n' '{"env":{"ANTHROPIC_BASE_URL":"","ANTHROPIC_AUTH_TOKEN":""}}' > "$home/.config/tokenlayer/direct.json"

    run_claude_settings_launch '~/.config/tokenlayer/direct.json'
    [ "$status" -eq 0 ]
    grep -F -q -- "--settings $home/.config/tokenlayer/direct.json" <<< "$output" \
      || { echo "set: $output" >&2; return 1; }

    run_claude_settings_launch ''
    [ "$status" -eq 0 ]
    refute_contains "--settings" "$output" "no claudeSettings field means no --settings"
    refute_contains "warning" "$output"

    run_claude_settings_launch '~/.config/tokenlayer/missing.json'
    [ "$status" -eq 0 ]
    grep -F -q -- "ARGS=" <<< "$output" || { echo "missing: $output" >&2; return 1; }
    refute_contains "--settings" "$output" "a missing settings file is skipped"
    grep -F -q -- "claudeSettings file not found: $home/.config/tokenlayer/missing.json" <<< "$output" \
      || { echo "missing warning: $output" >&2; return 1; }
}
