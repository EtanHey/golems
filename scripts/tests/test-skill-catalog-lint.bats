#!/usr/bin/env bats

setup() {
  LINT="$BATS_TEST_DIRNAME/../../skills/golem-powers/golem-install/scripts/lint-skill-catalog.sh"
  CATALOG="$BATS_TEST_TMPDIR/skills"
  mkdir -p "$CATALOG/healthy"
}

run_lint() {
  run bash "$LINT" --skills-root "$CATALOG"
}

@test "clean skill catalog passes" {
  run_lint

  [ "$status" -eq 0 ]
  [[ "$output" == *"skill catalog clean"* ]]
}

@test "dotted directory fails" {
  mkdir -p "$CATALOG/.backup-alpha"

  run_lint

  [ "$status" -eq 1 ]
  [[ "$output" == *"dotted directory: .backup-alpha"* ]]
}

@test "dotted symlink resolving to a directory fails" {
  mkdir -p "$BATS_TEST_TMPDIR/backup-target"
  ln -s "$BATS_TEST_TMPDIR/backup-target" "$CATALOG/.backup-alpha"

  run_lint

  [ "$status" -eq 1 ]
  [[ "$output" == *"dotted directory: .backup-alpha"* ]]
}

@test "dotted plain files are ignored" {
  touch "$CATALOG/.DS_Store" "$CATALOG/.gitkeep"

  run_lint

  [ "$status" -eq 0 ]
  [[ "$output" == *"skill catalog clean"* ]]
}

@test "broken symlink fails regardless of dottedness" {
  ln -s "$BATS_TEST_TMPDIR/missing-alpha" "$CATALOG/alpha"
  ln -s "$BATS_TEST_TMPDIR/missing-backup" "$CATALOG/.backup-alpha"

  run_lint

  [ "$status" -eq 1 ]
  [[ "$output" == *"broken symlink: alpha"* ]]
  [[ "$output" == *"broken symlink: .backup-alpha"* ]]
}

@test "catalog traversal errors fail closed" {
  chmod 000 "$CATALOG"

  run_lint

  chmod 700 "$CATALOG"
  [ "$status" -eq 2 ]
  [[ "$output" == *"could not inspect skill catalog"* ]]
}
