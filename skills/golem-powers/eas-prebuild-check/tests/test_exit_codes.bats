#!/usr/bin/env bats

load helpers/test-helper.bash

@test "eval 12: failing project exits 1" {
  run_skill "missing-easignore"

  [ "$status" -eq 1 ]
}

@test "eval 13: warn-only happy path exits 0" {
  run_skill "happy-path"

  [ "$status" -eq 0 ]
}

@test "eval 14: non-Expo project exits 2 with clear message" {
  export PROJECT_DIR
  PROJECT_DIR="$TEST_TMPDIR/not-expo"
  mkdir -p "$PROJECT_DIR"
  export PATH="$SKILL_DIR/tests/helpers:$PATH"
  cd "$PROJECT_DIR" || return 1

  run bash "$SKILL_DIR/scripts/check.sh"

  [ "$status" -eq 2 ]
  [[ "$output" == *"Not an Expo project"* ]]
}
