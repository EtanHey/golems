#!/usr/bin/env bats
# Tests for scripts/sync/sync-config.sh's secret-in-args guard.
#
# AIDEV-NOTE: Claude Code expands ${VAR} inside mcpServers.<name>.args, so a
# secret written there lands in the MCP child's argv and is readable by every
# local process through `ps`. MCP secrets belong in mcpServers.<name>.env.
# sync-config must refuse such a definition in every mode, and its error must
# name the server and the arg index, never the value. Every token below is an
# obviously fake fixture value.

setup() {
  SCRIPT="$BATS_TEST_DIRNAME/../../scripts/sync/sync-config.sh"
  REPOS="$BATS_TEST_TMPDIR/repos"
  CONFIG="$BATS_TEST_TMPDIR/config.yaml"
  mkdir -p "$REPOS/demo"
}

# write_config <args-json> [<env-json>] [<server-name>]
# JSON flow collections are valid YAML, so each case states its args verbatim.
write_config() {
  local args_json="$1" env_json="${2:-}" name="${3:-svc}"
  [[ -n "$env_json" ]] || env_json='{}'
  cat > "$CONFIG" <<EOF
reposPath: "$REPOS"
mcpServers:
  harmless:
    command: harmless-mcp
  $name:
    command: npx
    args: $args_json
    env: $env_json
contextProfiles:
  demo:
    mcps:
      allow: [harmless, $name]
    skills:
      allow: [alpha]
EOF
}

run_sync() {
  run bash "$SCRIPT" --config "$CONFIG" "$@"
}

# expect_rejected <index> <leaked-substring>...
# Checks all three modes: each exits 1, names the server and index, never
# echoes the value, and --enforce writes nothing.
expect_rejected() {
  local index="$1" mode needle
  shift
  for mode in --validate --diff --enforce; do
    run_sync "$mode"
    [ "$status" -eq 1 ] || { echo "mode $mode exited $status: $output"; return 1; }
    [[ "$output" == *"mcpServers.svc.args[$index]"* ]] || { echo "mode $mode: no index: $output"; return 1; }
    [[ "$output" == *"env"* ]] || { echo "mode $mode: no env remedy: $output"; return 1; }
    for needle in "$@"; do
      [[ "$output" != *"$needle"* ]] || { echo "mode $mode leaked '$needle': $output"; return 1; }
    done
  done
  [ ! -e "$REPOS/demo/.mcp.json" ] || { echo "--enforce wrote a secret-bearing .mcp.json"; return 1; }
}

expect_accepted() {
  local mode
  for mode in --validate --diff --enforce; do
    run_sync "$mode"
    [ "$status" -eq 0 ] || { echo "mode $mode exited $status: $output"; return 1; }
    [[ "$output" != *"secret-bearing"* ]] || { echo "mode $mode flagged: $output"; return 1; }
  done
  [ -f "$REPOS/demo/.mcp.json" ] || { echo "--enforce did not write .mcp.json"; return 1; }
}

@test "rejects --access-token \${SUPABASE_ACCESS_TOKEN} in args" {
  write_config '["-y", "@supabase/mcp-server-supabase@0.10.0", "--access-token", "${SUPABASE_ACCESS_TOKEN}"]'
  expect_rejected 2 'SUPABASE_ACCESS_TOKEN'
}

@test "rejects --api-key=op://... in args" {
  write_config '["-y", "some-mcp", "--api-key=op://fake-vault/fake-item/credential"]'
  expect_rejected 2 'op://' 'fake-vault' '--api-key='
}

@test "rejects a bare sbp_ literal in args" {
  write_config '["-y", "some-mcp", "sbp_FAKE0000"]'
  expect_rejected 2 'sbp_FAKE0000' 'FAKE0000'
}

@test "rejects every secret-bearing flag and value shape" {
  local case
  for case in \
    '["--token", "FAKEVALUE0000"]' \
    '["--password=FAKEVALUE0000"]' \
    '["--client-secret", "FAKEVALUE0000"]' \
    '["--api_key", "FAKEVALUE0000"]' \
    '["--apikey=FAKEVALUE0000"]' \
    '["op://fake-vault/fake-item/field"]' \
    '["${GITHUB_TOKEN}"]' \
    '["${my_api_key}"]' \
    '["prefix-${Client_Secret}"]' \
    '["${DB_PASSWORD}"]' \
    '["sk-FAKE0000"]' \
    '["ghp_FAKE0000"]' \
    '["github_pat_FAKE0000"]' \
    '["xoxb-FAKE0000"]' \
    '["--header=sbp_FAKE0000"]' \
    '["Authorization:Bearer op://fake-vault/fake-item/field"]'; do
    rm -f "$REPOS/demo/.mcp.json"
    write_config "$case"
    expect_rejected 0 'FAKEVALUE0000' 'FAKE0000' 'op://' 'fake-vault' || { echo "case: $case"; return 1; }
  done
}

@test "accepts tokens carried in env" {
  write_config '["-y", "@supabase/mcp-server-supabase@0.10.0"]' \
    '{"SUPABASE_ACCESS_TOKEN": "op://fake-vault/fake-item/credential"}'
  expect_accepted
}

@test "accepts harmless flags such as --user-data-dir" {
  write_config '["--user-data-dir", "/x", "--monkey", "banana", "--keychain-path", "/k", "--port", "8080"]'
  expect_accepted
}

@test "the error names the offending server and index, never the value" {
  write_config '["-y", "pkg", "--port", "1", "--access-token", "sbp_FAKE0000"]' '{}' 'leaky'
  run_sync --validate
  [ "$status" -eq 1 ]
  [[ "$output" == *"mcpServers.leaky.args[4]"* ]] || false
  [[ "$output" == *"mcpServers.leaky.env"* ]] || false
  [[ "$output" != *"sbp_FAKE0000"* ]] || false
  [[ "$output" != *"harmless"* ]] || false
  [[ "$output" != *"args[0]"* ]] || false
  [[ "$output" != *"args[2]"* ]] || false
  [[ "$output" != *"args[3]"* ]] || false
}
