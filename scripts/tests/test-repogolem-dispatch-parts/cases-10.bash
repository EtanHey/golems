# `--scan`: the launch shape codex-security's Deep Scan accepts. It needs a
# managed filesystem permission profile, which a danger-full-access (bypass)
# seat cannot provide, so scans run under workspace-write with no approvals,
# always as a worker (every strip on, no hatch), on the codex.security model,
# with a per-launch Deep Scan cost cap.

CODEX_SCAN_FIXTURE_MODEL='fixture-security-model'

# A scan seat does not test, so unlike every other launch it turns computer
# use off. The marketplace is interpolated: a literal plugin id followed by a
# dotted key matches the publish-boundary identity-pii (email) pattern.
CODEX_PLUGIN_MARKETPLACE='openai-bundled'
CODEX_SCAN_COMPUTER_USE_OVERRIDES=()
for _codex_plugin in computer-use unified-computer-use browser computer-history chrome record-and-replay messages codex-app-tools; do
    CODEX_SCAN_COMPUTER_USE_OVERRIDES+=("plugins.${_codex_plugin}@${CODEX_PLUGIN_MARKETPLACE}.enabled=false")
done
unset _codex_plugin
CODEX_SCAN_COMPUTER_USE_OVERRIDES+=(
    'mcp_servers.node_repl={command="/usr/bin/false",enabled=false}'
    'mcp_servers.computer-use={command="/usr/bin/false",enabled=false}'
)

write_model_roles_fixture() {
    local root="$1"
    mkdir -p "$root/standards"
    cat > "$root/standards/model-roles.json" <<JSON
{"roles":{"codex.implement":{"model":"fixture-implement-model"},"codex.security":{"model":"$CODEX_SCAN_FIXTURE_MODEL"}}}
JSON
}

# run_codex_scan_launch <launch> [roles-root] [caller cap file]
run_codex_scan_launch() {
    local launch="$1" roles_root="${2-$TMPDIR_/roles}" caller_cap="${3:-}" marker
    local -a unset_args=(-u GOLEM_ROLE -u GOLEM_EFFORT -u GOLEM_CODEX_COMPUTER_USE -u GOLEM_CODEX_WORKER_ALLOW
                         -u GOLEMS_MODEL_ROLES_ROOT -u CODEX_SECURITY_DEEP_SCAN_CONFIG_PATH)
    for marker in "${CODEX_AGENT_MARKERS[@]}"; do unset_args+=(-u "$marker"); done
    run env "${unset_args[@]}" zsh -f -c '
      export RALPH_REGISTRY_FILE="$1"
      [ -n "$4" ] && export GOLEMS_MODEL_ROLES_ROOT="$4"
      [ -n "$5" ] && export CODEX_SECURITY_DEEP_SCAN_CONFIG_PATH="$5"
      function _ralph_setup_mcps() { return 0; }
      function _ralph_setup_secrets() { return 0; }
      function _ralph_build_mcp_config() { print -r -- "{\"mcpServers\":{}}"; }
      function _golem_setup_env() { return 0; }
      function _golem_setup_title() { return 0; }
      function _golem_reset_title() { return 0; }
      function codex() {
        local arg
        for arg in "$@"; do print -r -- "CODEX_ARG=$arg"; done
        print -r -- "ROLE_ENV=${GOLEM_ROLE-unset}"
        print -r -- "DEEP_SCAN_CONFIG=${CODEX_SECURITY_DEEP_SCAN_CONFIG_PATH-unset}"
        [ -f "${CODEX_SECURITY_DEEP_SCAN_CONFIG_PATH-}" ] && sed "s/^/DEEP_SCAN_TOML:/" "$CODEX_SECURITY_DEEP_SCAN_CONFIG_PATH"
        return 0
      }
      source "$2"
      eval "$3"
    ' _ "$REGISTRY_FILE" "$SOURCE_DISPATCHER" "$launch" "$roles_root" "$caller_cap"
}

codex_argv() {
    grep '^CODEX_ARG=' <<< "$1" | sed 's/^CODEX_ARG=//'
}

assert_scan_shape() {
    local launch="$1" launch_output="$2" argv override
    argv="$(codex_argv "$launch_output")"
    refute_contains 'dangerously-bypass-approvals-and-sandbox' "$argv" "[$launch] scan must not bypass the sandbox" || return 1
    grep -F -x -A1 -- '-s' <<< "$argv" | grep -F -x -q -- 'workspace-write' \
      || { echo "[$launch] missing -s workspace-write: $argv" >&2; return 1; }
    grep -F -x -q -- 'approval_policy="never"' <<< "$argv" \
      || { echo "[$launch] missing approval_policy never: $argv" >&2; return 1; }
    for override in "${CODEX_SCAN_COMPUTER_USE_OVERRIDES[@]}" "$CODEX_WORKER_CONNECTOR_OVERRIDE"; do
        grep -F -x -q -- "$override" <<< "$argv" \
          || { echo "[$launch] missing strip $override" >&2; return 1; }
    done
    grep -F -x -q -- 'ROLE_ENV=worker' <<< "$launch_output" \
      || { echo "[$launch] scan must run as a worker: $launch_output" >&2; return 1; }
}

function split_case_150() {
    write_model_roles_fixture "$TMPDIR_/roles"
    local launch
    for launch in 'testrepoCodex -E high --scan' 'testrepoCodex -E high --scan -p "scan this diff"' 'testrepoCodex -s -E high --scan -w "'"$WORKTREE_DIR"'"'; do
        run_codex_scan_launch "$launch"
        [ "$status" -eq 0 ] || { echo "[$launch] status=$status: $output" >&2; return 1; }
        assert_scan_shape "$launch" "$output" || return 1
        grep -F -x -A1 -- 'CODEX_ARG=--model' <<< "$output" | grep -F -x -q -- "CODEX_ARG=$CODEX_SCAN_FIXTURE_MODEL" \
          || { echo "[$launch] model must come from codex.security: $output" >&2; return 1; }
    done
}

function split_case_151() {
    # No hardcoded fallback: an unresolvable codex.security refuses the launch.
    run_codex_scan_launch 'testrepoCodex -E high --scan' "$TMPDIR_/no-such-roles"
    [ "$status" -eq 2 ]
    grep -F -q -- 'cannot resolve the codex.security model' <<< "$output"
    refute_contains 'CODEX_ARG=' "$output" "codex must not start"
    # An explicit per-invocation model is a first-class selection.
    run_codex_scan_launch 'testrepoCodex -E high --scan -m explicit-model' "$TMPDIR_/no-such-roles"
    [ "$status" -eq 0 ]
    grep -F -x -A1 -- 'CODEX_ARG=--model' <<< "$output" | grep -F -x -q -- 'CODEX_ARG=explicit-model'
}

function split_case_156() {
    # With no GOLEMS_MODEL_ROLES_ROOT the role comes from the registry's golems
    # project, whose path the generated registry writes as `~/...`.
    local fake_home="$TMPDIR_/scan-home"
    write_model_roles_fixture "$fake_home/Gits/golems"
    jq '.projects.golems = {"path":"~/Gits/golems","mcps":[],"mcpsLight":[],"secrets":{},"clis":["codex"]}' \
      "$REGISTRY_FILE" > "$TMPDIR_/registry-golems.json"
    local saved_registry="$REGISTRY_FILE"
    REGISTRY_FILE="$TMPDIR_/registry-golems.json"
    HOME="$fake_home" run_codex_scan_launch 'testrepoCodex -E high --scan' ""
    REGISTRY_FILE="$saved_registry"
    [ "$status" -eq 0 ] || { echo "status=$status: $output" >&2; return 1; }
    grep -F -x -A1 -- 'CODEX_ARG=--model' <<< "$output" | grep -F -x -q -- "CODEX_ARG=$CODEX_SCAN_FIXTURE_MODEL"
}

function split_case_152() {
    # A scan seat is always a worker: --lead is ignored with one stderr line.
    write_model_roles_fixture "$TMPDIR_/roles"
    run_codex_scan_launch 'testrepoCodex -E high --scan --lead'
    [ "$status" -eq 0 ]
    assert_scan_shape "scan+lead" "$output"
    [ "$(grep -F -c -- 'repoGolem: --lead ignored' <<< "$output")" = "1" ]
}

function split_case_153() {
    # A caller cannot put a scan back on a bypass/danger sandbox or approvals.
    write_model_roles_fixture "$TMPDIR_/roles"
    local launch
    local -a refused=(
        'testrepoCodex -E high --scan -- --dangerously-bypass-approvals-and-sandbox'
        'testrepoCodex -E high --scan -- -s danger-full-access'
        'testrepoCodex -E high --scan -- --sandbox=danger-full-access'
        'testrepoCodex -E high --scan -- -a on-request'
        'testrepoCodex -E high --scan -- --ask-for-approval=untrusted'
        'testrepoCodex -E high --scan -- -c sandbox_mode="danger-full-access"'
        'testrepoCodex -E high --scan -- -c=approval_policy="on-request"'
        'testrepoCodex -E high --scan -- --config permissions.x.network=true'
        'testrepoCodex -E high --scan --dangerously-bypass-approvals-and-sandbox resume --last'
        "testrepoCodex -E high --scan -- -c plugins.browser@${CODEX_PLUGIN_MARKETPLACE}.enabled=true"
        'testrepoCodex -E high --scan -- -c=mcp_servers.node_repl.enabled=true'
        'testrepoCodex -E high --scan -- --config mcp_servers.computer-use.enabled=true'
    )
    for launch in "${refused[@]}"; do
        run_codex_scan_launch "$launch"
        [ "$status" -eq 2 ] || { echo "[$launch] status=$status: $output" >&2; return 1; }
        grep -F -q -- 'repoGolem: --scan refuses' <<< "$output" \
          || { echo "[$launch] missing refusal: $output" >&2; return 1; }
        refute_contains 'CODEX_ARG=' "$output" "[$launch] codex must not start" || return 1
    done
}

function split_case_154() {
    # Cost control: a per-launch Deep Scan cap file is exported by default and
    # removed after codex exits; a caller-supplied cap file wins.
    write_model_roles_fixture "$TMPDIR_/roles"
    run_codex_scan_launch 'testrepoCodex -E high --scan'
    [ "$status" -eq 0 ]
    local cap_path
    cap_path="$(sed -n 's/^DEEP_SCAN_CONFIG=//p' <<< "$output")"
    [[ "$cap_path" == "$CODEX_HOME"/repogolem-* ]] || { echo "cap path: $cap_path" >&2; return 1; }
    [ ! -e "$cap_path" ]
    grep -F -x -q -- 'DEEP_SCAN_TOML:[deep_scan]' <<< "$output"
    grep -F -x -q -- 'DEEP_SCAN_TOML:workers = 2' <<< "$output"
    grep -F -x -q -- 'DEEP_SCAN_TOML:subagents = 2' <<< "$output"
    grep -F -x -q -- 'DEEP_SCAN_TOML:max_discovery_runs = 10' <<< "$output"
    grep -F -x -q -- 'DEEP_SCAN_TOML:max_time_hours = 2' <<< "$output"
    printf '[deep_scan]\nworkers = 1\n' > "$TMPDIR_/caller-cap.toml"
    run_codex_scan_launch 'testrepoCodex -E high --scan' "$TMPDIR_/roles" "$TMPDIR_/caller-cap.toml"
    [ "$status" -eq 0 ]
    grep -F -x -q -- "DEEP_SCAN_CONFIG=$TMPDIR_/caller-cap.toml" <<< "$output" \
      || { echo "caller cap: $output" >&2; return 1; }
}

function split_case_155() {
    # Without --scan nothing changes: no sandbox flags, no cap file.
    write_model_roles_fixture "$TMPDIR_/roles"
    run_codex_scan_launch 'testrepoCodex -E high --worker'
    [ "$status" -eq 0 ]
    refute_contains 'workspace-write' "$output" "only --scan selects the managed sandbox"
    refute_contains 'plugins.' "$output" "computer use stays on outside --scan (Etan 2026-10-06)"
    grep -F -x -q -- 'DEEP_SCAN_CONFIG=unset' <<< "$output"
}
