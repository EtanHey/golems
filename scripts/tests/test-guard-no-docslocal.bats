#!/usr/bin/env bats

setup() {
  GUARD="$BATS_TEST_DIRNAME/../guard-no-docslocal.sh"
  mkdir -p "$BATS_TEST_DIRNAME/../../docs.local/g1a"
  TEST_ROOT="$(mktemp -d "$BATS_TEST_DIRNAME/../../docs.local/g1a/fixture.XXXXXX")"
  mkdir "$TEST_ROOT/repo"
  cd "$TEST_ROOT/repo"
  git init -q
  git config user.name Fixture
  git config user.email fixture@example.invalid
  git -c core.hooksPath=/dev/null commit -qm initial --allow-empty
  BASE="$(git rev-parse HEAD)"
}
teardown() { rm -rf "$TEST_ROOT"; }
add_private() {
  mkdir -p "$(dirname "$1")"
  printf 'synthetic\n' > "$1"
  git add -f -- "$1"
}
commit_fixture() { git -c core.hooksPath=/dev/null commit -qm "$1"; }

@test "subdirectory invocation still scans the repository root" {
  add_private docs.local/synthetic
  mkdir subdir; cd subdir
  run bash "$GUARD"
  [ "$status" -ne 0 ]
}
@test "nested docs.local component is rejected" {
  add_private pkg/docs.local/synthetic
  run bash "$GUARD"
  [ "$status" -ne 0 ]
}
@test "outside a repository fails closed" {
  mkdir "$TEST_ROOT/outside"; cd "$TEST_ROOT/outside"
  run env GIT_CEILING_DIRECTORIES="$TEST_ROOT" bash "$GUARD"
  [ "$status" -ne 0 ]
  [[ "$output" == *'git repository'* ]]
}
@test "range catches a private addition removed in a later commit" {
  add_private pkg/docs.local/synthetic; commit_fixture add
  git rm -q pkg/docs.local/synthetic; commit_fixture remove
  run bash "$GUARD" --range "$BASE..HEAD"
  [ "$status" -ne 0 ]
  [[ "$output" == *'pkg/docs.local/synthetic'* ]]
}
@test "baseline grandfathering allows existing paths in index and range" {
  add_private docs.local/synthetic
  printf 'docs.local/synthetic\n' > .docslocal-baseline
  commit_fixture add
  run bash "$GUARD" --range "$BASE..HEAD"
  [ "$status" -eq 0 ]
  [[ "$output" == *'WARNING'* ]]
}
@test "invalid or missing ranges fail closed" {
  run bash "$GUARD" --range "$BASE..missing"
  [ "$status" -ne 0 ]
  run bash "$GUARD" --range
  [ "$status" -ne 0 ]
}
@test "clean range ignores similar component names" {
  add_private pkg/docs.localish/synthetic; commit_fixture ordinary
  run bash "$GUARD" --range "$BASE..HEAD"
  [ "$status" -eq 0 ]
}
@test "initial push zero base scans all reachable history" {
  add_private docs.local/synthetic; commit_fixture add
  git rm -q docs.local/synthetic; commit_fixture remove
  run bash "$GUARD" --range "0000000000000000000000000000000000000000..HEAD"
  [ "$status" -ne 0 ]
}
@test "moving an ordinary file into docs.local cannot hide as a rename" {
  add_private ordinary; commit_fixture ordinary
  mkdir docs.local; git mv ordinary docs.local/synthetic; commit_fixture move
  git rm -q docs.local/synthetic; commit_fixture remove
  run bash "$GUARD" --range "$BASE..HEAD"
  [ "$status" -ne 0 ]
}
@test "baseline does not allow a different nested path" {
  printf 'docs.local/old\n' > .docslocal-baseline
  add_private pkg/docs.local/new
  run bash "$GUARD"
  [ "$status" -ne 0 ]
}
@test "range scans side-branch additions removed before a merge" {
  git checkout -qb side
  add_private docs.local/synthetic; commit_fixture add
  git rm -q docs.local/synthetic; commit_fixture remove
  git checkout -q -
  git -c core.hooksPath=/dev/null merge -q --no-ff side -m merge
  run bash "$GUARD" --range "$BASE..HEAD"
  [ "$status" -ne 0 ]
}
@test "unusable push bases fall back to full history on a clean branch" {
  git checkout -qb old-before
  git -c core.hooksPath=/dev/null commit -qm before --allow-empty
  before="$(git rev-parse HEAD)"
  git checkout -q -
  for base in '' 0000000000000000000000000000000000000000 missing "$before"; do
    run bash "$GUARD" --range "$base..HEAD"
    [ "$status" -eq 0 ]
    [[ "$output" == *'full history'* ]]
  done
}
@test "unusable push bases still reject deleted private additions" {
  git checkout -qb old-before
  git -c core.hooksPath=/dev/null commit -qm before --allow-empty
  before="$(git rev-parse HEAD)"
  git checkout -q -
  add_private pkg/docs.local/synthetic; commit_fixture add
  git rm -q pkg/docs.local/synthetic; commit_fixture remove
  for base in '' 0000000000000000000000000000000000000000 missing "$before"; do
    run bash "$GUARD" --range "$base..HEAD"
    [ "$status" -ne 0 ]
    [[ "$output" == *'pkg/docs.local/synthetic'* ]]
  done
}
