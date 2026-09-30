#!/usr/bin/env bats

setup() {
    unset WEAVE_ALLOW_TMP GOLEM_ROLE GOLEM_EFFORT
    ROOT=$(mktemp -d)
    export ROOT
    export HOME="$ROOT/home" RALPH_REGISTRY_FILE="$ROOT/registry.json"
    mkdir -p "$HOME/.gemini/config" "$ROOT/a/.agents" "$ROOT/b"
    MODULE="$BATS_TEST_DIRNAME/../repogolem/dispatch/agy.zsh"
    cat > "$RALPH_REGISTRY_FILE" <<'JSON'
{"global":{"mcps":{"common":{"command":"common-mcp"}}},"mcpDefinitions":{"A":{"command":"a-mcp","env":{"EXA_API_KEY":"op://development/fake/credential","PUPPETEER_EXECUTABLE_PATH":"/synthetic/browser"}},"B":{"command":"new-b-mcp"}},"projects":{"a":{"mcps":["A"]},"b":{"mcps":["B"]}}}
JSON
    cat > "$ROOT/a/.mcp.json" <<'JSON'
{"mcpServers":{"localOnly":{"command":"local-mcp"},"israeli-bank-mcp":{"command":"retired"}}}
JSON
    printf '%s\n' '{"marker":1,"mcpServers":{"stale":{"command":"old"}}}' '{"marker":2,"mcpServers":{"whatsapp":{"command":"old"}}}' > "$ROOT/a/.agents/mcp_config.json"
    printf '%s\n' '{"marker":3,"mcpServers":{"B":{"command":"old-b-mcp","env":{"EXA_API_KEY":"FAKE_EXISTING_TOKEN"}},"israeli-bank-mcp":{"command":"retired"},"stale":{"command":"old"}}}' > "$HOME/.gemini/config/mcp_config.json"
}

teardown() { rm -rf "$ROOT"; }

sync_a() {
    run zsh -f -c '
      source "$1"
      function _golem_staging_dir() { print -r -- "$ROOT"; }
      function _ralph_build_mcp_config() {
        print called > "$HOME/builder-called"
        print -r -- "{\"mcpServers\":{\"A\":{\"command\":\"a-mcp\",\"env\":{\"EXA_API_KEY\":\"FAKE_RESOLVED_TOKEN\"}}}}"
      }
      _golem_sync_agy_workspace a "$2/a"
    ' _ "$MODULE" "$ROOT"
    [ "$status" -eq 0 ]
}

@test "agy project sync replaces stale servers in every legacy document" {
    sync_a
    run jq -se 'length == 2 and all(.[]; .mcpServers | keys == ["A","common","localOnly"])' "$ROOT/a/.agents/mcp_config.json"
    [ "$status" -eq 0 ]
    [ "$(jq -s '[.[].marker]' "$ROOT/a/.agents/mcp_config.json" | jq -c .)" = '[1,2]' ]
}

@test "agy global sync preserves another repo declaration but removes stale and bank servers" {
    sync_a
    run jq -e '.marker == 3 and (.mcpServers | keys == ["A","B","common"]) and .mcpServers.B.command == "old-b-mcp"' "$HOME/.gemini/config/mcp_config.json"
    [ "$status" -eq 0 ]
}

@test "agy persistence uses credential placeholders without invoking the resolving builder" {
    sync_a
    [ ! -e "$HOME/builder-called" ]
    for config in "$ROOT/a/.agents/mcp_config.json" "$HOME/.gemini/config/mcp_config.json"; do
        run jq -se 'all(.[]; .mcpServers.A.env.EXA_API_KEY == "${EXA_API_KEY}" and .mcpServers.A.env.PUPPETEER_EXECUTABLE_PATH == "/synthetic/browser")' "$config"
        [ "$status" -eq 0 ]
        if grep -q 'FAKE_\|op://' "$config"; then return 1; fi
    done
}

@test "agy sync canonicalizes declared cmux aliases without duplicate servers" {
    jq '.projects.b.mcps += ["cmux"]' "$RALPH_REGISTRY_FILE" > "$ROOT/reg.next"
    mv "$ROOT/reg.next" "$RALPH_REGISTRY_FILE"
    jq '.mcpServers.cmux={command:"legacy"} | .mcpServers.cmuxlayer={command:"canonical"}' "$HOME/.gemini/config/mcp_config.json" > "$ROOT/config.next"
    mv "$ROOT/config.next" "$HOME/.gemini/config/mcp_config.json"
    sync_a
    run jq -e '.mcpServers.cmux == null and .mcpServers.cmuxlayer.command == "canonical"' "$HOME/.gemini/config/mcp_config.json"
    [ "$status" -eq 0 ]
}

@test "agy sync supports global-only registries with missing or null projects" {
    for projects in absent null; do
        if [[ "$projects" == absent ]]; then
            jq 'del(.projects)' "$RALPH_REGISTRY_FILE" > "$ROOT/reg.next"
        else
            jq '.projects = null' "$RALPH_REGISTRY_FILE" > "$ROOT/reg.next"
        fi
        mv "$ROOT/reg.next" "$RALPH_REGISTRY_FILE"
        sync_a
        run jq -e '.mcpServers | keys == ["common"]' "$HOME/.gemini/config/mcp_config.json"
        [ "$status" -eq 0 ]
    done
}

@test "agy sync failure preserves invalid global bytes and aborts the agent launch" {
    printf 'not JSON\n' > "$HOME/.gemini/config/mcp_config.json"
    run zsh -f -c '
      source "$1"
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function agy() { print AGY_MUST_NOT_RUN; }
      _golem_launch_gemini a "$2/a" --worker -p "ok"
    ' _ "$BATS_TEST_DIRNAME/../repogolem/golem-dispatch.zsh" "$ROOT"
    [ "$status" -ne 0 ]
    [[ "$output" != *AGY_MUST_NOT_RUN* ]]
    [ "$(cat "$HOME/.gemini/config/mcp_config.json")" = 'not JSON' ]
}

@test "agy concurrent writers hold the global lock and keep both declared server updates" {
    run python3 - "$MODULE" "$ROOT" <<'PY'
import fcntl, os, pathlib, select, subprocess, sys
module, root = sys.argv[1:]
home = pathlib.Path(os.environ['HOME'])
ready = pathlib.Path(root) / 'ready'
release = pathlib.Path(root) / 'release'
os.mkfifo(ready); os.mkfifo(release)
ready_fd = os.open(ready, os.O_RDWR | os.O_NONBLOCK)
release_fd = os.open(release, os.O_RDWR)
script = '''
source "$1"
function _golem_staging_dir() { print -r -- "$ROOT"; }
function _ralph_build_mcp_config() { print -r -- "{\\"mcpServers\\":{\\"$LABEL\\":{\\"command\\":\\"$LABEL-mcp\\"}}}"; }
function mv() {
  if [[ "$LABEL" == a && "${argv[-1]}" == "$HOME/.gemini/config/mcp_config.json" ]]; then
    print ready > "$ROOT/ready"
    read reply < "$ROOT/release"
  fi
  command mv "$@"
}
_golem_sync_agy_workspace "$LABEL" "$ROOT/$LABEL"
'''
children = []
try:
    a = subprocess.Popen(['zsh', '-f', '-c', script, '_', module], env={**os.environ, 'ROOT':root, 'LABEL':'a'})
    children.append(a)
    assert select.select([ready_fd], [], [], 8)[0], 'writer never reached global publication'
    assert os.read(ready_fd, 100).strip() == b'ready'
    # While A is paused before rename, the read/filter/write lock must be held.
    lockfile = home / '.gemini/config/.repogolem-mcp.lock'
    assert lockfile.exists(), 'global update has no lock'
    with lockfile.open('a') as lock:
        try:
            fcntl.lockf(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            pass
        else:
            raise AssertionError('global publication is outside the lock')
    b = subprocess.Popen(['zsh', '-f', '-c', script, '_', module], env={**os.environ, 'ROOT':root, 'LABEL':'b'})
    children.append(b)
finally:
    os.write(release_fd, b'release\n')
    for child in children:
        try: assert child.wait(timeout=12) == 0
        except subprocess.TimeoutExpired: child.kill(); child.wait(); raise
    os.close(ready_fd); os.close(release_fd)
import json
servers = json.loads((home / '.gemini/config/mcp_config.json').read_text())['mcpServers']
assert sorted(servers) == ['A','B','common'], sorted(servers)
assert servers['B']['command'] == 'new-b-mcp'
print('LOCKED_UNION_OK')
PY
    [ "$status" -eq 0 ]
    [[ "$output" == *LOCKED_UNION_OK* ]]
}
