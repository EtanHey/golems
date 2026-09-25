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
