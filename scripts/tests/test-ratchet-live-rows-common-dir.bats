#!/usr/bin/env bats
# Regression for scripts/ratchet/live-rows.sh resolving a relative Git common
# directory from HERE, independent of the caller cwd.

setup() {
    REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
    LIVE_ROWS="$REPO_ROOT/scripts/ratchet/live-rows.sh"
    REAL_GIT="$(command -v git)"
    REAL_PYTHON3="$(command -v python3)"
    FIXTURE_ROOT="$(cd "$(mktemp -d)" && pwd -P)"
    MAIN="$FIXTURE_ROOT/fixture-main"
    # External to fixture-main, shaped like ~/.t3/worktrees/golems/<id>.
    APP="$FIXTURE_ROOT/.t3/worktrees/golems/repo-id"
    CALLER="$FIXTURE_ROOT/external-caller"
    BIN="$FIXTURE_ROOT/bin"
    SCRATCH_HOME="$FIXTURE_ROOT/scratch-home"
    EMPTY_TEMPLATES="$FIXTURE_ROOT/empty-templates"
    EMPTY_SYSTEM="$FIXTURE_ROOT/empty-system.gitconfig"
    EMPTY_GLOBAL="$SCRATCH_HOME/empty-global.gitconfig"
    HOSTILE_GLOBAL="$FIXTURE_ROOT/injected-global.gitconfig"
    HOSTILE_SYSTEM="$FIXTURE_ROOT/injected-system.gitconfig"
    HOSTILE_TEMPLATES="$FIXTURE_ROOT/injected-templates"
    HOSTILE_HOOKS="$FIXTURE_ROOT/injected-hooks"
    HOOK_MARKER="$FIXTURE_ROOT/hook-canary.log"
    SIGN_MARKER="$FIXTURE_ROOT/signing-canary.log"
    mkdir -p "$MAIN/scripts/ratchet" "$CALLER" "$BIN" "$(dirname "$APP")" \
      "$SCRATCH_HOME/.config/git" "$EMPTY_TEMPLATES" "$HOSTILE_TEMPLATES/hooks" "$HOSTILE_HOOKS"

    # Harmless hostile Git configuration is confined to this scratch fixture.
    : > "$EMPTY_SYSTEM"
    : > "$EMPTY_GLOBAL"
    printf '[core]\n\thooksPath = %s\n[commit]\n\tgpgSign = true\n[gpg]\n\tprogram = %s/signing-canary\n' \
      "$HOSTILE_HOOKS" "$BIN" > "$HOSTILE_GLOBAL"
    cp "$HOSTILE_GLOBAL" "$HOSTILE_SYSTEM"
    cat > "$HOSTILE_HOOKS/pre-commit" <<HOOK
#!/usr/bin/env bash
echo ran >> "$HOOK_MARKER"
HOOK
    cat > "$HOSTILE_TEMPLATES/hooks/pre-commit" <<HOOK
#!/usr/bin/env bash
echo ran >> "$HOOK_MARKER"
HOOK
    cat > "$BIN/signing-canary" <<SIGNER
#!/usr/bin/env bash
echo ran >> "$SIGN_MARKER"
exit 1
SIGNER
    chmod +x "$HOSTILE_HOOKS/pre-commit" "$HOSTILE_TEMPLATES/hooks/pre-commit" "$BIN/signing-canary"
    export GIT_CONFIG_GLOBAL="$HOSTILE_GLOBAL" GIT_CONFIG_SYSTEM="$HOSTILE_SYSTEM"
    export GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0="$HOSTILE_HOOKS"
    export GIT_CONFIG_KEY_1=commit.gpgSign GIT_CONFIG_VALUE_1=true GIT_TEMPLATE_DIR="$HOSTILE_TEMPLATES"

    # Every Git command, starting with init, runs in the isolated environment.
    fixture_git init --template="$EMPTY_TEMPLATES" -q "$MAIN"
    fixture_git -C "$MAIN" config user.name Fixture
    fixture_git -C "$MAIN" config user.email fixture@example.com

    # Commit the actual fixed source into the scratch fixture tree before tests.
    # This makes the regression independent of the real worktree's commit state.
    cp "$LIVE_ROWS" "$MAIN/scripts/ratchet/live-rows.sh"
    chmod +x "$MAIN/scripts/ratchet/live-rows.sh"
    fixture_git -C "$MAIN" add scripts/ratchet/live-rows.sh
    fixture_git -C "$MAIN" commit -qm 'fixture: fixed live-rows source under test'
    FIXED_HEAD="$(fixture_git -C "$MAIN" rev-parse HEAD)"
    fixture_git -C "$MAIN" worktree add -qb app-shaped "$APP"
    fixture_git -C "$APP" cat-file blob "$FIXED_HEAD:scripts/ratchet/live-rows.sh" | cmp - "$LIVE_ROWS"
    [ -z "$(fixture_git -C "$APP" status --porcelain -- scripts/ratchet/live-rows.sh)" ]
    [ ! -e "$HOOK_MARKER" ]
    [ ! -e "$SIGN_MARKER" ]
    SCRIPT_TO_RUN="$APP/scripts/ratchet/live-rows.sh"
    LEASE_HEAD="$FIXED_HEAD"
    install_stubs
}

fixture_git() {
    env -i PATH="$PATH" HOME="$SCRATCH_HOME" XDG_CONFIG_HOME="$SCRATCH_HOME/.config" \
      GIT_CONFIG_GLOBAL="$EMPTY_GLOBAL" GIT_CONFIG_SYSTEM="$EMPTY_SYSTEM" GIT_CONFIG_NOSYSTEM=1 \
      GIT_CONFIG_COUNT=0 GIT_TEMPLATE_DIR="$EMPTY_TEMPLATES" \
      GIT_AUTHOR_NAME=Fixture GIT_AUTHOR_EMAIL=fixture@example.com \
      GIT_COMMITTER_NAME=Fixture GIT_COMMITTER_EMAIL=fixture@example.com \
      "$REAL_GIT" "$@"
}

teardown() {
    rm -rf "$FIXTURE_ROOT"
}

install_stubs() {
    cat > "$BIN/python3" <<'STUB'
#!/usr/bin/env bash
echo "FIXTURE_STOP_BEFORE_NETWORK_SIGNING_ROWS_RECEIPTS" >&2
exit 0
STUB
    cat > "$BIN/git" <<'STUB'
#!/usr/bin/env bash
if [ "$1" = "-C" ] && [ "$3" = "rev-parse" ] && [ "$4" = "--git-common-dir" ]; then
    common="$("$REAL_GIT" "$@")"
    if [ "${COMMON_DIR_MODE:-real}" = "relative-shim" ]; then
        case "$common" in
          /*) "$REAL_PYTHON3" -c 'import os,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))' "$common" "$2" ;;
          *) printf '%s\n' "$common" ;;
        esac
    else
        printf '%s\n' "$common"
    fi
    exit 0
fi
if [ "$1" = "-C" ] && [[ "$2" == */.worktrees/hooks-live ]]; then
    printf '%s\n' "$2" > "$OBSERVED_MAIN"
    printf '0123456789abcdef0123456789abcdef01234567\n'
    exit 0
fi
exec "$REAL_GIT" "$@"
STUB
    cat > "$BIN/mkdir" <<'STUB'
#!/usr/bin/env bash
if [ "$1" = "-p" ] && [[ "$2" == */docs.local/ratchet-runs/live-pr* ]]; then
    printf '%s\n' "$2" > "$OBSERVED_RUN"
    echo "FIXTURE_STOP_BEFORE_GITHUB_BODY_FETCH"
    exit 97
fi
exec /bin/mkdir "$@"
STUB
    cat > "$BIN/gh" <<'STUB'
#!/usr/bin/env bash
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
    printf '%s fixture-branch\n' "$LEASE_HEAD"
    exit 0
fi
echo "FIXTURE_STOP_BEFORE_GITHUB_NETWORK $*"
exit 97
STUB
    chmod +x "$BIN/python3" "$BIN/git" "$BIN/mkdir" "$BIN/gh"
}

invoke_from_external_caller() {
    (cd "$CALLER" || exit 98
      env -i PATH="$BIN:$PATH" HOME="$SCRATCH_HOME" XDG_CONFIG_HOME="$SCRATCH_HOME/.config" \
      GIT_CONFIG_GLOBAL="$EMPTY_GLOBAL" GIT_CONFIG_SYSTEM="$EMPTY_SYSTEM" GIT_CONFIG_NOSYSTEM=1 \
      GIT_CONFIG_COUNT=0 GIT_TEMPLATE_DIR="$EMPTY_TEMPLATES" \
      REAL_GIT="$REAL_GIT" REAL_PYTHON3="$REAL_PYTHON3" \
      COMMON_DIR_MODE="${COMMON_DIR_MODE:-real}" \
      OBSERVED_MAIN="$FIXTURE_ROOT/observed-main" OBSERVED_RUN="$FIXTURE_ROOT/observed-run" \
      LEASE_HEAD="$LEASE_HEAD" "$SCRIPT_TO_RUN" \
      --merged-pr 1 --lease-pr 2 --lease-repo "$APP"
      script_status=$?
      [ "$PWD" = "$CALLER" ] || exit 98
      exit "$script_status")
}

@test "actual Git and app-shaped external worktree resolve from external caller cwd" {
    run invoke_from_external_caller
    [ "$status" -eq 97 ]
    [[ "$output" == *"FIXTURE_STOP_BEFORE_NETWORK_SIGNING_ROWS_RECEIPTS"* ]]
    [[ "$output" == *"FIXTURE_STOP_BEFORE_GITHUB_BODY_FETCH"* ]]
    [ "$(cat "$FIXTURE_ROOT/observed-main")" = "$MAIN/.worktrees/hooks-live" ]
    [[ "$(cat "$FIXTURE_ROOT/observed-run")" == "$MAIN/docs.local/ratchet-runs/live-pr1-"* ]]
    [ "$(fixture_git -C "$MAIN" rev-parse HEAD)" = "$FIXED_HEAD" ]
    if [ "${LIVE_COMMONDIR_TRACE:-0}" = 1 ]; then
        printf 'SCRATCH_FIXED_HEAD=%s\n' "$FIXED_HEAD"
        printf 'PRIMARY_APP_PATH=%s\n' "$APP"
        echo 'SCRATCH_HOOK_AND_SIGNING_CANARIES=NOT_RUN'
    fi
}

@test "supplemental relative-output shim exercises the relative common-dir contract" {
    COMMON_DIR_MODE=relative-shim run invoke_from_external_caller
    [ "$status" -eq 97 ]
    [[ "$output" == *"FIXTURE_STOP_BEFORE_GITHUB_BODY_FETCH"* ]]
    [ "$(cat "$FIXTURE_ROOT/observed-main")" = "$MAIN/.worktrees/hooks-live" ]
    [ "$(fixture_git -C "$MAIN" rev-parse HEAD)" = "$FIXED_HEAD" ]
}

@test "main checkout keeps its common-dir meaning from an external caller cwd" {
    SCRIPT_TO_RUN="$MAIN/scripts/ratchet/live-rows.sh"
    run invoke_from_external_caller
    [ "$status" -eq 97 ]
    [[ "$output" == *"FIXTURE_STOP_BEFORE_GITHUB_BODY_FETCH"* ]]
    [ "$(cat "$FIXTURE_ROOT/observed-main")" = "$MAIN/.worktrees/hooks-live" ]
}

@test "historical negative control reverses only the resolution block and fails at cd" {
    "$REAL_PYTHON3" - "$SCRIPT_TO_RUN" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
source = path.read_text()
fixed_block = '''COMMON_DIR="$(git -C "$HERE" rev-parse --git-common-dir)"
case "$COMMON_DIR" in
  /*) MAIN="$(cd "$COMMON_DIR/.." && pwd)" ;;
  *) MAIN="$(cd "$HERE/$COMMON_DIR/.." && pwd)" ;;
esac'''
original_line = 'MAIN="$(cd "$(git -C "$HERE" rev-parse --git-common-dir)/.." && pwd)"'
count = source.count(fixed_block)
if count != 1:
    raise SystemExit(f"expected exactly one fixed block, found {count}")
path.write_text(source.replace(fixed_block, original_line, 1))
print("LEGACY_BLOCK_REPLACED_ONCE")
PY
    reconstruct_status=$?
    [ "$reconstruct_status" -eq 0 ]
    COMMON_DIR_MODE=relative-shim run invoke_from_external_caller
    if [ "${LIVE_COMMONDIR_TRACE:-0}" = 1 ]; then
        printf 'LEGACY_NEGATIVE_EXIT=%s\n%s\n' "$status" "$output"
    fi
    [ "$status" -eq 1 ]
    [[ "$output" == *"cd: "*"No such file or directory"* ]]
    [[ "$output" == *"live-rows.sh: line 30"* ]]
    [ ! -e "$FIXTURE_ROOT/observed-main" ]
    [ "$(fixture_git -C "$MAIN" rev-parse HEAD)" = "$FIXED_HEAD" ]
}
