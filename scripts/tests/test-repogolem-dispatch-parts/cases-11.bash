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
