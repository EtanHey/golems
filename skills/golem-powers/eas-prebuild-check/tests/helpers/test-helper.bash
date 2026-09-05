setup() {
  export SKILL_DIR="$BATS_TEST_DIRNAME/.."
  export FIXTURE_DIR="$SKILL_DIR/tests/fixtures"
  export PATH="$SKILL_DIR/tests/helpers:$PATH"
  export HOME="${HOME:?HOME environment variable must be set}"
  TEST_TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/eas-prebuild-check.XXXXXX")"
}

teardown() {
  rm -rf "$TEST_TMPDIR"
}

fixture_copy() {
  local fixture_name="$1"
  local target="$TEST_TMPDIR/$fixture_name"

  cp -R "$FIXTURE_DIR/$fixture_name" "$target"
  printf '%s\n' "$target"
}

run_skill() {
  local fixture_name="$1"
  shift

  export PROJECT_DIR
  PROJECT_DIR="$(fixture_copy "$fixture_name")"
  cd "$PROJECT_DIR" || return 1
  run bash "$SKILL_DIR/scripts/check.sh" "$@"
}

assert_file_unchanged() {
  local fixture_name="$1"
  local relative_path="$2"

  cmp -s "$FIXTURE_DIR/$fixture_name/$relative_path" "$PROJECT_DIR/$relative_path"
}
