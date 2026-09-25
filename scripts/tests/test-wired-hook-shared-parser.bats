#!/usr/bin/env bats

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  TEST_ROOT="$(mktemp -d)"
}

teardown() {
  rm -rf "$TEST_ROOT"
}

@test "a copy-installed tmp-block still imports the shared shell parser and passes its live probes" {
  WIRED_HOOKS_ROOT="$TEST_ROOT/hooks" run "$REPO_ROOT/skills/golem-powers/tmp-block/scripts/install.sh"

  [ "$status" -eq 0 ] &&
    [[ "$output" == *"Install verified."* ]] &&
    [ -f "$TEST_ROOT/hooks/_shared/shell_parse.py" ] &&
    cmp -s "$TEST_ROOT/hooks/_shared/shell_parse.py" "$REPO_ROOT/skills/golem-powers/_shared/shell_parse.py" &&
    cmp -s "$TEST_ROOT/hooks/_shared/harness_paths.py" "$REPO_ROOT/skills/golem-powers/_shared/harness_paths.py"
}

@test "a hook dir symlinked into a hooks root (install-hooks layout) resolves the shared parser" {
  mkdir -p "$TEST_ROOT/hooks"
  ln -s "$REPO_ROOT/skills/golem-powers/tmp-block" "$TEST_ROOT/hooks/tmp-block"

  run bash -c "printf '%s' '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"ls\"}}' | python3 '$TEST_ROOT/hooks/tmp-block/hooks/tmp-block-pretooluse.py'"

  [ "$status" -eq 0 ] && [ "$output" = "{}" ]
}

@test "a hook FILE symlinked elsewhere still resolves the shared parser via its real path" {
  ln -s "$REPO_ROOT/skills/golem-powers/tmp-block/hooks/tmp-block-pretooluse.py" "$TEST_ROOT/tmp-block.py"

  run bash -c "printf '%s' '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"ls\"}}' | python3 '$TEST_ROOT/tmp-block.py'"

  [ "$status" -eq 0 ] && [ "$output" = "{}" ]
}
