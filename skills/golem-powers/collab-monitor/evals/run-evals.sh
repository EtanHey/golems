#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$SKILL_DIR/../../.." && pwd)"
FIXTURES="$SCRIPT_DIR/fixtures"
MONITOR="$SKILL_DIR/scripts/collab-monitor.sh"
LARGE_PLAN="$REPO_ROOT/skills/golem-powers/large-plan/SKILL.md"
LARGE_PLAN_CODEX_ADAPTER="$REPO_ROOT/skills/golem-powers/large-plan/adapters/codex.md"
LARGE_PLAN_CAPABILITIES="$REPO_ROOT/skills/golem-powers/large-plan/adapters/capabilities.yaml"
LARGE_PLAN_CLAUDE_ADAPTER="$REPO_ROOT/skills/golem-powers/large-plan/adapters/claude.md"
LARGE_PLAN_COLLAB_WORKFLOW="$REPO_ROOT/skills/golem-powers/large-plan/workflows/collab.md"
LARGE_PLAN_EXECUTE_PHASE="$REPO_ROOT/skills/golem-powers/large-plan/workflows/execute-phase.md"
MODE="${1:-candidate}"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT INT TERM

pass_count=0
fail_count=0

pass() {
  pass_count=$((pass_count + 1))
  printf 'ok %s\n' "$1"
}

fail() {
  fail_count=$((fail_count + 1))
  printf 'not ok %s :: %s\n' "$1" "$2"
}

alert_count() {
  local output_file="$1"
  grep -c '^NEW-FOR-' "$output_file" 2>/dev/null || true
}

self_post_count() {
  local output_file="$1"
  grep -c '^SELF-POST-' "$output_file" 2>/dev/null || true
}

append_fixture() {
  local fixture="$1"
  local destination="$2"
  awk '{ print }' "$fixture" >> "$destination"
}

run_once() {
  local state_dir="$1"
  local output_file="$2"
  local listen_name="$3"
  shift 3
  MONITOR_STATE_DIR="$state_dir" /bin/bash "$MONITOR" run --once "$listen_name" "$@" > "$output_file" 2>&1
}

run_baseline() {
  local case_dir output first second rc

  printf 'EVAL_RUNTIME requested=bash effective=%s effort=deterministic source=/bin/bash\n' "$(/bin/bash --version | sed -n '1s/.*version \([^ ]*\).*/bash-\1/p')"

  case_dir="$TMP_ROOT/filter"
  mkdir -p "$case_dir"
  if grep -iE 'TASK_DONE|error|failed|PR ' "$FIXTURES/filter-too-broad.md" > "$case_dir/output"; then
    fail "1 filter-too-broad RED" "documentation text matched the broad event filter"
  else
    pass "1 filter-too-broad unexpectedly absent"
  fi

  case_dir="$TMP_ROOT/self"
  mkdir -p "$case_dir"
  if grep '@skillcreator' "$FIXTURES/self-authored-post.md" > "$case_dir/output"; then
    fail "2 self-signature-match RED" "the listener's own post matched @skillcreator"
  else
    pass "2 self-signature-match unexpectedly absent"
  fi

  case_dir="$TMP_ROOT/dedup"
  mkdir -p "$case_dir"
  cp "$FIXTURES/addressed-event.md" "$case_dir/collab.md"
  first="$(grep '@skillcreator' "$case_dir/collab.md")"
  append_fixture "$FIXTURES/large-plan-unrelated-append.md" "$case_dir/collab.md"
  second="$(grep '@skillcreator' "$case_dir/collab.md")"
  if [[ -n "$first" && "$second" == "$first" ]]; then
    fail "3 no-dedup RED" "the same old hit re-fired after file growth"
  else
    pass "3 no-dedup unexpectedly absent"
  fi

  case_dir="$TMP_ROOT/seed"
  mkdir -p "$case_dir"
  cp "$FIXTURES/addressed-event.md" "$case_dir/collab.md"
  if grep '@skillcreator' "$case_dir/collab.md" > "$case_dir/output"; then
    fail "4 no-seed RED" "the first arm dumped existing history"
  else
    pass "4 no-seed unexpectedly absent"
  fi

  set +e
  /bin/bash -c 'declare -A seen' > "$TMP_ROOT/bash32.out" 2>&1
  rc=$?
  set -e
  if [[ "$rc" -ne 0 ]]; then
    fail "5 bash-3.2-declare-A RED" "declare -A exited $rc under macOS /bin/bash"
  else
    pass "5 bash-3.2-declare-A unexpectedly supported"
  fi

  case_dir="$TMP_ROOT/comm"
  mkdir -p "$case_dir"
  printf '%s\n' 'z-file 1' 'a-file 1' > "$case_dir/prev"
  printf '%s\n' 'a-file 1' 'z-file 1' > "$case_dir/cur"
  comm -13 "$case_dir/prev" "$case_dir/cur" > "$case_dir/output"
  if [[ -s "$case_dir/output" ]]; then
    fail "6 comm-unsorted RED" "comm invented a change for the same unsorted set"
  else
    pass "6 comm-unsorted unexpectedly correct"
  fi

  case_dir="$TMP_ROOT/large-plan"
  mkdir -p "$case_dir"
  cp "$FIXTURES/large-plan-unrelated-append.md" "$case_dir/collab.md"
  first="$(grep 'done' "$case_dir/collab.md")"
  printf '%s\n' 'an unrelated append' >> "$case_dir/collab.md"
  second="$(grep 'done' "$case_dir/collab.md")"
  if [[ -n "$first" && "$second" == "$first" ]]; then
    fail "7 large-plan-grep-done RED" "the exact :244 hit re-fired after one unrelated append"
  else
    pass "7 large-plan-grep-done unexpectedly absent"
  fi

  case_dir="$TMP_ROOT/read-screen-loop"
  mkdir -p "$case_dir"
  read_screen_calls="$(grep -c '^read_screen ' "$FIXTURES/supervisor-read-screen-loop.txt" 2>/dev/null || true)"
  if [[ "$read_screen_calls" -gt 1 ]]; then
    fail "8 repeated-read-screen RED" "one worker outcome triggered $read_screen_calls paid screen reads instead of one process-exit watch"
  else
    pass "8 repeated-read-screen unexpectedly absent"
  fi

  raw_filter_hits="$(grep -cE '^### |BLOCKED|@leadX' "$FIXTURES/ten-posts-three-fires.md" || true)"
  if [[ "$raw_filter_hits" -ge 10 ]]; then
    fail "17 bounded-filter RED" "the taught '^### |BLOCKED|@leadX' grep matched $raw_filter_hits lines of 10 posts where 3 are addressed"
  else
    pass "17 bounded-filter unexpectedly absent"
  fi

  sentence_final_hits="$(grep -cE '@leadX([^[:alnum:]_.-]|$)' "$FIXTURES/arrowed-authors.md" || true)"
  if grep -Fq 'thanks @leadX.' "$FIXTURES/arrowed-authors.md" && [[ "$sentence_final_hits" -eq 1 ]]; then
    fail "18 dot-continues-name RED" "a boundary class that lets '.' continue a name matched $sentence_final_hits line and dropped 'thanks @leadX.'"
  else
    pass "18 dot-continues-name unexpectedly absent"
  fi

  template_old_hits="$(grep -cE '^### |BLOCKED|@leadX' "$FIXTURES/orchestrator-fourteen-posts.md" || true)"
  if [[ "$template_old_hits" -ne 5 ]]; then
    fail "19 template-parity RED" "the original TEMPLATE grep matched $template_old_hits lines of the orchestrator fixture where its one-liner yields 5"
  else
    pass "19 template-parity unexpectedly absent"
  fi

  printf 'BASELINE_SUMMARY expected_red=11 observed_red=%s unexpected_green=%s\n' "$fail_count" "$pass_count"
  return 1
}

run_candidate() {
  local part_status
  python3 "$SCRIPT_DIR/episode-dedup.py"
  source "$SCRIPT_DIR/run-evals-parts/candidate-01.bash"
  part_status=$?
  if [[ "$part_status" -ne 0 ]]; then
    return "$part_status"
  fi
  source "$SCRIPT_DIR/run-evals-parts/candidate-02.bash"
}

case "$MODE" in
  baseline)
    run_baseline
    ;;
  candidate)
    run_candidate
    ;;
  *)
    printf 'usage: %s baseline|candidate\n' "$0" >&2
    exit 2
    ;;
esac
