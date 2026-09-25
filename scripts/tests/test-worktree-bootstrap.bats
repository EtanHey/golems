#!/usr/bin/env bats
# Tests for scripts/repogolem/worktree-bootstrap.sh and its repoGolem -w wiring.
# Run with: bats scripts/tests/test-worktree-bootstrap.bats
#
# Installers are PATH stubs: each logs "<tool> <args> @ <cwd>" to $CALLS and
# creates what the real tool would (node_modules/, .venv/). STUB_FAIL=1 makes
# them fail loudly.

setup() {
    BOOTSTRAP="$BATS_TEST_DIRNAME/../repogolem/worktree-bootstrap.sh"
    SOURCE_DISPATCHER="$BATS_TEST_DIRNAME/../repogolem/golem-dispatch.zsh"
    INSTALL_DISPATCHER="$BATS_TEST_DIRNAME/../repogolem/install-golem-dispatch.sh"
    TMPDIR_="$(mktemp -d)"
    WT="$TMPDIR_/worktree"
    CALLS="$TMPDIR_/calls.log"
    mkdir -p "$WT" "$TMPDIR_/bin"
    : > "$CALLS"
    export CALLS
    for tool in bun pnpm npm uv; do
        cat > "$TMPDIR_/bin/$tool" <<'STUB'
#!/usr/bin/env bash
tool="$(basename "$0")"
echo "$tool $* @ $PWD" >> "$CALLS"
if [ "${STUB_FAIL:-0}" = 1 ]; then echo "$tool: lockfile out of date" >&2; exit 3; fi
if [ -n "${STUB_SLEEP:-}" ]; then sleep "$STUB_SLEEP"; fi
case "$tool" in
  uv) mkdir -p .venv ;;
  *) mkdir -p node_modules && touch node_modules/.installed ;;
esac
STUB
        chmod +x "$TMPDIR_/bin/$tool"
    done
    STUB_PATH="$TMPDIR_/bin:$PATH"
}

teardown() {
    rm -rf "$TMPDIR_"
}

bootstrap() {
    run env PATH="$STUB_PATH" "$BOOTSTRAP" "$@"
}

# bats runs under /bin/bash 3.2 on macOS, where a failing [[ ]] that is not the
# test's last command does not trip errexit; every [[ ]] assertion ends in || false.

# One timed line: "[worktree-bootstrap] <dir>: <what> (<seconds>s)"
assert_one_timed_line() {
    [ "$(printf '%s\n' "$output" | wc -l | tr -d ' ')" -eq 1 ] || {
        printf 'expected exactly one output line, got:\n%s\n' "$output" >&2
        return 1
    }
    [[ "$output" =~ ^\[worktree-bootstrap\]\ .+\ \([0-9]+s\)$ ]] || {
        printf 'not a timed bootstrap line: %s\n' "$output" >&2
        return 1
    }
}

@test "bun.lock runs bun install --frozen-lockfile in the worktree" {
    touch "$WT/bun.lock"
    bootstrap "$WT"
    [ "$status" -eq 0 ]
    assert_one_timed_line
    [ "$(cat "$CALLS")" = "bun install --frozen-lockfile @ $WT" ]
    [[ "$output" == *"bun install --frozen-lockfile"* ]] || false
}

@test "legacy bun.lockb also means bun" {
    touch "$WT/bun.lockb"
    bootstrap "$WT"
    [ "$status" -eq 0 ]
    [ "$(cat "$CALLS")" = "bun install --frozen-lockfile @ $WT" ]
}

@test "pnpm-lock.yaml runs pnpm install --frozen-lockfile" {
    touch "$WT/pnpm-lock.yaml"
    bootstrap "$WT"
    [ "$status" -eq 0 ]
    assert_one_timed_line
    [ "$(cat "$CALLS")" = "pnpm install --frozen-lockfile @ $WT" ]
}

@test "package-lock.json runs npm ci --prefer-offline" {
    touch "$WT/package-lock.json"
    bootstrap "$WT"
    [ "$status" -eq 0 ]
    assert_one_timed_line
    [ "$(cat "$CALLS")" = "npm ci --prefer-offline @ $WT" ]
}

@test "uv.lock runs uv sync" {
    touch "$WT/uv.lock"
    bootstrap "$WT"
    [ "$status" -eq 0 ]
    assert_one_timed_line
    [ "$(cat "$CALLS")" = "uv sync @ $WT" ]
}

@test "a JS lockfile and uv.lock both install, still one line" {
    touch "$WT/bun.lock" "$WT/uv.lock"
    bootstrap "$WT"
    [ "$status" -eq 0 ]
    assert_one_timed_line
    [ "$(sed -n 1p "$CALLS")" = "bun install --frozen-lockfile @ $WT" ]
    [ "$(sed -n 2p "$CALLS")" = "uv sync @ $WT" ]
}

@test "Package.resolved is a no-op" {
    touch "$WT/Package.resolved"
    bootstrap "$WT"
    [ "$status" -eq 0 ]
    assert_one_timed_line
    [ ! -s "$CALLS" ]
    [[ "$output" == *"Package.resolved"* ]] || false
}

@test "no lockfile is a no-op" {
    bootstrap "$WT"
    [ "$status" -eq 0 ]
    assert_one_timed_line
    [ ! -s "$CALLS" ]
    [[ "$output" == *"no lockfile"* ]] || false
}

@test "a node_modules symlink is replaced by a real install; its target is untouched" {
    touch "$WT/bun.lock"
    mkdir -p "$TMPDIR_/main/node_modules/some-dep"
    ln -s "$TMPDIR_/main/node_modules" "$WT/node_modules"
    bootstrap "$WT"
    [ "$status" -eq 0 ]
    assert_one_timed_line
    [ ! -L "$WT/node_modules" ]
    [ -f "$WT/node_modules/.installed" ]
    [ -d "$TMPDIR_/main/node_modules/some-dep" ]
    [ ! -e "$TMPDIR_/main/node_modules/.installed" ]
    [[ "$output" == *"replaced node_modules symlink"* ]] || false
}

@test "idempotent: a second run succeeds and leaves a real node_modules" {
    touch "$WT/bun.lock"
    bootstrap "$WT"
    [ "$status" -eq 0 ]
    bootstrap "$WT"
    [ "$status" -eq 0 ]
    assert_one_timed_line
    [ ! -L "$WT/node_modules" ]
    [ "$(wc -l < "$CALLS" | tr -d ' ')" -eq 2 ]
}

@test "never creates a node_modules symlink" {
    touch "$WT/package-lock.json"
    bootstrap "$WT"
    [ "$status" -eq 0 ]
    [ -z "$(find "$WT" -name node_modules -type l)" ]
}

@test "an installer failure exits non-zero with its output" {
    touch "$WT/bun.lock"
    run env PATH="$STUB_PATH" STUB_FAIL=1 "$BOOTSTRAP" "$WT"
    [ "$status" -ne 0 ]
    [[ "$output" == *"FAILED"* ]] || false
    [[ "$output" == *"lockfile out of date"* ]] || false
}

@test "a missing or non-directory argument exits 2" {
    run "$BOOTSTRAP"
    [ "$status" -eq 2 ]
    run "$BOOTSTRAP" "$TMPDIR_/nope"
    [ "$status" -eq 2 ]
}

# ── repoGolem wiring ──────────────────────────────────────────────

# launch '<zsh commands>' [ENV=VAL...] — source the tracked dispatcher with the
# registry/MCP/title plumbing stubbed, the stub installers on PATH, and every
# agent CLI replaced by a function that prints its cwd, then run the commands.
launch() {
    local cmds="$1"; shift
    mkdir -p "$TMPDIR_/project"
    cat > "$TMPDIR_/registry.json" <<JSON
{ "projects": { "testrepo": { "path": "$TMPDIR_/project", "mcps": [], "mcpsLight": [],
  "secrets": {}, "disableChrome": true, "clis": ["codex", "claude"] } } }
JSON
    run env PATH="$STUB_PATH" RALPH_REGISTRY_FILE="$TMPDIR_/registry.json" \
        CODEX_HOME="$TMPDIR_/codex-home" WT="$WT" "$@" zsh -f -c '
      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_sync_agy_workspace() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function claude() { print -r -- "CLAUDE_PWD=$PWD"; }
      function codex() { print -r -- "CODEX_PWD=$PWD"; }
      function cursor() { print -r -- "CURSOR_PWD=$PWD"; }
      function agy() { print -r -- "AGY_PWD=$PWD"; }
      source "$1"
      _golem_register_wrappers
      eval "$2"
    ' _ "$SOURCE_DISPATCHER" "$cmds"
}

@test "testrepoClaude -w bootstraps the worktree before launching" {
    touch "$WT/bun.lock"
    ln -s "$TMPDIR_" "$WT/node_modules"
    launch 'testrepoClaude -s -w "$WT"'
    [ "$status" -eq 0 ]
    [ "$(cat "$CALLS")" = "bun install --frozen-lockfile @ $WT" ]
    [ ! -L "$WT/node_modules" ]
    [[ "$output" == *"[worktree-bootstrap] $WT"* ]] || false
    [[ "$output" == *"CLAUDE_PWD=$WT"* ]] || false
}

@test "testrepoCodex -w bootstraps the worktree before launching" {
    touch "$WT/pnpm-lock.yaml"
    launch 'testrepoCodex -s -w "$WT"'
    [ "$status" -eq 0 ]
    [ "$(cat "$CALLS")" = "pnpm install --frozen-lockfile @ $WT" ]
    [[ "$output" == *"CODEX_PWD=$WT"* ]] || false
}

@test "testrepoCursor and testrepoGemini -w bootstrap the worktree too" {
    touch "$WT/package-lock.json"
    launch 'testrepoCursor -s -w "$WT" task; testrepoGemini -s -w "$WT" task'
    [ "$status" -eq 0 ]
    [ "$(sed -n 1p "$CALLS")" = "npm ci --prefer-offline @ $WT" ]
    [ "$(sed -n 2p "$CALLS")" = "npm ci --prefer-offline @ $WT" ]
    [[ "$output" == *"CURSOR_PWD=$WT"* ]] || false
    [[ "$output" == *"AGY_PWD=$WT"* ]] || false
}

@test "a failed bootstrap warns but still launches" {
    touch "$WT/bun.lock"
    launch 'testrepoClaude -s -w "$WT"' STUB_FAIL=1
    [ "$status" -eq 0 ]
    [ "$(cat "$CALLS")" = "bun install --frozen-lockfile @ $WT" ]
    [[ "$output" == *"FAILED"* ]] || false
    [[ "$output" == *"CLAUDE_PWD=$WT"* ]] || false
}

@test "without -w no bootstrap runs" {
    mkdir -p "$TMPDIR_/project" && touch "$TMPDIR_/project/bun.lock"
    launch 'testrepoClaude -s'
    [ "$status" -eq 0 ]
    [ ! -s "$CALLS" ]
    [[ "$output" == *"CLAUDE_PWD=$TMPDIR_/project"* ]] || false
}

@test "the installer ships worktree-bootstrap.sh next to the dispatcher" {
    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home"
    run env HOME="$fake_home" "$INSTALL_DISPATCHER" --force "$fake_home/.config/ralphtools/golem-dispatch.zsh"
    [ "$status" -eq 0 ]
    [ -x "$fake_home/.config/ralphtools/worktree-bootstrap.sh" ]
    cmp -s "$BOOTSTRAP" "$fake_home/.config/ralphtools/worktree-bootstrap.sh"
}

# ── r5's #198 probes, pinned (GO-4 PR-2c) ─────────────────────────

@test "a hung installer is killed at WORKTREE_BOOTSTRAP_TIMEOUT and reported FAILED" {
    touch "$WT/bun.lock"
    local start=$SECONDS
    run env PATH="$STUB_PATH" STUB_SLEEP=47 WORKTREE_BOOTSTRAP_TIMEOUT=1 "$BOOTSTRAP" "$WT"
    [ "$status" -ne 0 ]
    [ $((SECONDS - start)) -lt 10 ]
    # the installer's own children die with it (process-group kill)
    sleep 1
    [ -z "$(pgrep -f 'sleep 47' || true)" ]
    [[ "$output" == *"FAILED: bun install --frozen-lockfile (timed out after 1s)"* ]] || false
}

@test "a trailing-slash link target: the link is replaced, the target keeps its files" {
    touch "$WT/bun.lock"
    mkdir -p "$TMPDIR_/main/node_modules/dep" && touch "$TMPDIR_/main/node_modules/dep/SENTINEL"
    ln -s "$TMPDIR_/main/node_modules/" "$WT/node_modules"
    bootstrap "$WT"
    [ "$status" -eq 0 ]
    [ ! -L "$WT/node_modules" ]
    [ -f "$TMPDIR_/main/node_modules/dep/SENTINEL" ]
    [ ! -e "$TMPDIR_/main/node_modules/.installed" ]
}

@test "a trailing-slash worktree argument: same result" {
    touch "$WT/bun.lock"
    mkdir -p "$TMPDIR_/main/node_modules/dep" && touch "$TMPDIR_/main/node_modules/dep/SENTINEL"
    ln -s "$TMPDIR_/main/node_modules" "$WT/node_modules"
    bootstrap "$WT/"
    [ "$status" -eq 0 ]
    [ ! -L "$WT/node_modules" ]
    [ -f "$TMPDIR_/main/node_modules/dep/SENTINEL" ]
}

@test "a real node_modules directory is left alone" {
    touch "$WT/bun.lock"
    mkdir -p "$WT/node_modules/dep" && touch "$WT/node_modules/dep/SENTINEL"
    bootstrap "$WT"
    [ "$status" -eq 0 ]
    [ -f "$WT/node_modules/dep/SENTINEL" ]
    [[ "$output" != *"replaced node_modules symlink"* ]] || false
}

@test "the INSTALLED dispatcher runs the INSTALLED bootstrap copy, not the repo's" {
    local fake_home="$TMPDIR_/home"
    mkdir -p "$fake_home" "$TMPDIR_/project"
    run env HOME="$fake_home" "$INSTALL_DISPATCHER" --force "$fake_home/.config/ralphtools/golem-dispatch.zsh"
    [ "$status" -eq 0 ]
    printf '#!/usr/bin/env bash\necho INSTALLED_COPY_RAN\n' > "$fake_home/.config/ralphtools/worktree-bootstrap.sh"
    cat > "$TMPDIR_/registry.json" <<JSON
{ "projects": { "testrepo": { "path": "$TMPDIR_/project", "mcps": [], "mcpsLight": [],
  "secrets": {}, "disableChrome": true, "clis": ["claude"] } } }
JSON
    run env HOME="$fake_home" RALPH_REGISTRY_FILE="$TMPDIR_/registry.json" WT="$WT" zsh -f -c '
      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function claude() { print -r -- "CLAUDE_PWD=$PWD"; }
      source "$HOME/.config/ralphtools/golem-dispatch.zsh"
      _golem_register_wrappers
      testrepoClaude -s -w "$WT"
    '
    [ "$status" -eq 0 ]
    [[ "$output" == *"INSTALLED_COPY_RAN"* ]] || false
    [[ "$output" == *"CLAUDE_PWD=$WT"* ]] || false
}
