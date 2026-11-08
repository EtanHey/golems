#!/usr/bin/env bats

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  INSTALLER="$REPO_ROOT/skills/golem-powers/_shared/install-wired-hook.sh"
  TEST_ROOT="$(mktemp -d)"
}

teardown() {
  rm -rf "$TEST_ROOT"
}

@test "refuses to rsync into a hook dir that scripts/hooks/install-hooks.sh symlinked" {
  mkdir -p "$TEST_ROOT/hooks-live/tmp-block" "$TEST_ROOT/hooks"
  printf 'pinned\n' > "$TEST_ROOT/hooks-live/tmp-block/marker"
  ln -s "$TEST_ROOT/hooks-live/tmp-block" "$TEST_ROOT/hooks/tmp-block"

  WIRED_HOOKS_ROOT="$TEST_ROOT/hooks" run "$INSTALLER" --skill tmp-block --hook hooks/tmp-block-pretooluse.py

  [ "$status" -ne 0 ] &&
    [[ "$output" == *"install-hooks.sh"* ]] &&
    [ "$(ls "$TEST_ROOT/hooks-live/tmp-block")" = "marker" ]
}

@test "check detects shared-only content, missing-file and extra-package drift" {
  export WIRED_HOOKS_ROOT="$TEST_ROOT/hooks"
  run "$INSTALLER" --skill tmp-block --hook hooks/tmp-block-pretooluse.py
  [ "$status" -eq 0 ]
  for path in shell_parse.py harness_paths.py shell_parse_impl/tokens.py; do
    run "$INSTALLER" --skill tmp-block --hook hooks/tmp-block-pretooluse.py --check
    [ "$status" -eq 0 ] || { echo "$output" >&3; false; }
    printf '\n# drift\n' >> "$TEST_ROOT/hooks/_shared/$path"
    run "$INSTALLER" --skill tmp-block --hook hooks/tmp-block-pretooluse.py --check
    [ "$status" -eq 1 ]
    [[ "$output" == *"DRIFT:"* ]] || false
    [[ "$output" == *"_shared/$path"* ]] || false
    cp "$REPO_ROOT/skills/golem-powers/_shared/$path" "$TEST_ROOT/hooks/_shared/$path"
    rm "$TEST_ROOT/hooks/_shared/$path"
    run "$INSTALLER" --skill tmp-block --hook hooks/tmp-block-pretooluse.py --check
    [ "$status" -eq 1 ]
    cp "$REPO_ROOT/skills/golem-powers/_shared/$path" "$TEST_ROOT/hooks/_shared/$path"
  done
  touch "$TEST_ROOT/hooks/_shared/shell_parse_impl/extra.py"
  run "$INSTALLER" --skill tmp-block --hook hooks/tmp-block-pretooluse.py --check
  [ "$status" -eq 1 ]
  rm "$TEST_ROOT/hooks/_shared/shell_parse_impl/extra.py"
  mkdir -p "$TEST_ROOT/hooks/_shared/shell_parse_impl/__pycache__"
  touch "$TEST_ROOT/hooks/_shared/shell_parse_impl/__pycache__/ignored.pyc"
  touch "$TEST_ROOT/hooks/_shared/shell_parse.py"
  run "$INSTALLER" --skill tmp-block --hook hooks/tmp-block-pretooluse.py --check
  [ "$status" -eq 0 ]
}
