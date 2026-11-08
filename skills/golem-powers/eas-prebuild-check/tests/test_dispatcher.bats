#!/usr/bin/env bats
load helpers/test-helper.bash
bats_require_minimum_version 1.5.0

setup() {
  export SKILL_DIR="$BATS_TEST_DIRNAME/.."
  TEST_TMPDIR="$(mktemp -d)"
  cp -R "$SKILL_DIR" "$TEST_TMPDIR/skill"
  export SKILL_DIR="$TEST_TMPDIR/skill"
  export FIXTURE_DIR="$SKILL_DIR/tests/fixtures"
  export PATH="$SKILL_DIR/tests/helpers:$PATH"
}

@test "missing required module fails instead of all-clear" {
  rm "$SKILL_DIR/scripts/checks/04-bundle-id.sh"
  run_skill happy-path
  [ "$status" -eq 1 ]
  [[ "$output" == *"Required check script not found"* ]] || false
  [[ "$output" != *"All critical checks passed"* ]]
}

@test "unknown result status fails" {
  echo 'record_result "bad module" "TYPO" "oops"' > "$SKILL_DIR/scripts/checks/04-bundle-id.sh"
  run_skill happy-path
  [ "$status" -eq 1 ]
  [[ "$output" == *"Invalid check status"* ]]
}

@test "production legitimately skips ad-hoc device check" {
  run_skill happy-path --profile production
  [ "$status" -eq 0 ]
  [[ "$output" == *"ad-hoc distribution not required"* ]]
}

@test "no timeout implementation reports unavailable without executing command" {
  # Load the real helper definitions, without running the dispatcher.
  sed -n '/^run_with_timeout()/,/^# Export for check scripts/p' "$SKILL_DIR/scripts/check.sh" | sed '$d' > "$TEST_TMPDIR/helpers.bash"
  source "$TEST_TMPDIR/helpers.bash"
  command() {
    if [[ "$1" == "-v" && ( "$2" == timeout || "$2" == gtimeout || "$2" == perl ) ]]; then return 1; fi
    builtin command "$@"
  }
  run -127 run_with_timeout 1 bash -c 'echo unbounded'
  [ "$status" -eq 127 ]
  [[ "$output" == *"timeout unavailable"* ]] || false
  [[ "$output" != *"unbounded"* ]]
}

@test "unavailable timeout makes the full dispatcher fail" {
  local script="$SKILL_DIR/scripts/check.sh"
  { printf '%s\n' 'command() { if [[ "$1" == -v && ( "$2" == timeout || "$2" == gtimeout || "$2" == perl ) ]]; then return 1; fi; builtin command "$@"; }'; cat "$script"; } > "$TEST_TMPDIR/check.sh"
  cp "$TEST_TMPDIR/check.sh" "$script"
  run_skill happy-path
  [ "$status" -eq 1 ]
  [[ "$output" == *"timeout unavailable; remote checks cannot run safely"* ]] || false
  [[ "$output" != *"All critical checks passed"* ]]
}

load_timeout_helper() {
  sed -n '/^run_with_timeout()/,/^# Export for check scripts/p' "$SKILL_DIR/scripts/check.sh" | sed '$d' > "$TEST_TMPDIR/helpers.bash"
  source "$TEST_TMPDIR/helpers.bash"
  mkdir "$TEST_TMPDIR/bin"
  for tool in perl bash sleep; do
    ln -s "$(command -v "$tool")" "$TEST_TMPDIR/bin/$tool"
  done
  export -f run_with_timeout
}

@test "perl fallback preserves output and exit status" {
  load_timeout_helper
  run -7 env PATH="$TEST_TMPDIR/bin" bash -c 'run_with_timeout 5 bash -c "echo bounded; exit 7"'
  [ "$output" = bounded ]
}

@test "perl alarm returns 124 and kills the child process group" {
  load_timeout_helper
  run -124 env PATH="$TEST_TMPDIR/bin" bash -c 'run_with_timeout 1 bash -c '"'"'sleep 30 & echo $! > "$1"; wait'"'"' bash "$1"' bash "$TEST_TMPDIR/child.pid"
  local child_pid
  child_pid="$(cat "$TEST_TMPDIR/child.pid")"
  # A killed descendant can briefly remain as a zombie awaiting system reaping.
  run ps -o stat= -p "$child_pid"
  [[ -z "$output" || "$output" == *Z* ]]
}

@test "version query uses the bounded runner" {
  run_with_timeout() { echo "$*" >> "$TEST_TMPDIR/calls"; echo 'eas-cli/18.1.0'; }
  record_result() { :; }
  source "$SKILL_DIR/scripts/checks/03-eas-cli-version.sh"
  run head -1 "$TEST_TMPDIR/calls"
  [ "$output" = "5 eas --version" ]
}
