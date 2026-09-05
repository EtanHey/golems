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

  printf 'BASELINE_SUMMARY expected_red=8 observed_red=%s unexpected_green=%s\n' "$fail_count" "$pass_count"
  return 1
}

run_candidate() {
  local case_dir board output output2 count pid_file foreign_pid duplicate_rc stale_rc foreign_status_rc monitor_pid index sleep_pid sleep_survived_rc invalid_name_rc invalid_poll_rc zero_poll_rc recovery_status_rc zombie_status_rc zombie_stop_rc

  if [[ ! -f "$MONITOR" ]]; then
    printf 'candidate entrypoint missing: %s\n' "$MONITOR" >&2
    return 1
  fi

  printf 'EVAL_RUNTIME requested=bash effective=%s effort=deterministic source=/bin/bash\n' "$(/bin/bash --version | sed -n '1s/.*version \([^ ]*\).*/bash-\1/p')"

  case_dir="$TMP_ROOT/filter"
  mkdir -p "$case_dir/state"
  board="$case_dir/collab.md"
  : > "$board"
  run_once "$case_dir/state" "$case_dir/seed.out" '@skillcreator' "$board"
  append_fixture "$FIXTURES/filter-too-broad.md" "$board"
  run_once "$case_dir/state" "$case_dir/scan.out" '@skillcreator' "$board"
  count="$(alert_count "$case_dir/scan.out")"
  : > "$case_dir/code-collab.md"
  run_once "$case_dir/code-state" "$case_dir/code-seed.out" '@skillcreator' "$case_dir/code-collab.md"
  append_fixture "$FIXTURES/routing-code-examples.md" "$case_dir/code-collab.md"
  append_fixture "$FIXTURES/routing-list-nested-fence.md" "$case_dir/code-collab.md"
  append_fixture "$FIXTURES/routing-compact-list-fence.md" "$case_dir/code-collab.md"
  set +e
  run_once "$case_dir/code-state" "$case_dir/code.out" '@skillcreator' "$case_dir/code-collab.md"
  code_rc=$?
  set -e
  append_fixture "$FIXTURES/addressed-event.md" "$case_dir/code-collab.md"
  set +e
  run_once "$case_dir/code-state" "$case_dir/code-future.out" '@skillcreator' "$case_dir/code-collab.md"
  code_future_rc=$?
  set -e
  : > "$case_dir/inline-collab.md"
  run_once "$case_dir/inline-state" "$case_dir/inline-seed.out" '@skillcreator' "$case_dir/inline-collab.md"
  append_fixture "$FIXTURES/routing-backtick-inline-span.md" "$case_dir/inline-collab.md"
  set +e
  run_once "$case_dir/inline-state" "$case_dir/inline.out" '@skillcreator' "$case_dir/inline-collab.md"
  inline_rc=$?
  set -e
  : > "$case_dir/unclosed-collab.md"
  run_once "$case_dir/unclosed-state" "$case_dir/unclosed-seed.out" '@skillcreator' "$case_dir/unclosed-collab.md"
  append_fixture "$FIXTURES/routing-unclosed-fence.md" "$case_dir/unclosed-collab.md"
  set +e
  MONITOR_STATE_DIR="$case_dir/unclosed-state" /bin/bash "$MONITOR" run --once '@skillcreator' "$case_dir/unclosed-collab.md" > "$case_dir/unclosed.out" 2>&1
  unclosed_rc=$?
  set -e
  printf '%s\n' '```' >> "$case_dir/unclosed-collab.md"
  append_fixture "$FIXTURES/addressed-event.md" "$case_dir/unclosed-collab.md"
  append_fixture "$FIXTURES/addressed-event-two.md" "$case_dir/unclosed-collab.md"
  run_once "$case_dir/unclosed-state" "$case_dir/unclosed-recovered.out" '@skillcreator' "$case_dir/unclosed-collab.md"
  : > "$case_dir/list-collab.md"
  run_once "$case_dir/list-state" "$case_dir/list-seed.out" '@skillcreator' "$case_dir/list-collab.md"
  append_fixture "$FIXTURES/routing-list-reply.md" "$case_dir/list-collab.md"
  run_once "$case_dir/list-state" "$case_dir/list.out" '@skillcreator' "$case_dir/list-collab.md"
  : > "$case_dir/recipient-collab.md"
  run_once "$case_dir/recipient-skillcreator-state" "$case_dir/recipient-skillcreator-seed.out" '@skillcreator' "$case_dir/recipient-collab.md"
  run_once "$case_dir/recipient-other-state" "$case_dir/recipient-other-seed.out" '@other-listener' "$case_dir/recipient-collab.md"
  append_fixture "$FIXTURES/routing-summary-mention.md" "$case_dir/recipient-collab.md"
  append_fixture "$FIXTURES/routing-embedded-recipient.md" "$case_dir/recipient-collab.md"
  run_once "$case_dir/recipient-skillcreator-state" "$case_dir/recipient-skillcreator.out" '@skillcreator' "$case_dir/recipient-collab.md"
  run_once "$case_dir/recipient-other-state" "$case_dir/recipient-other.out" '@other-listener' "$case_dir/recipient-collab.md"
  : > "$case_dir/invalid-closer-collab.md"
  run_once "$case_dir/invalid-closer-state" "$case_dir/invalid-closer-seed.out" '@skillcreator' "$case_dir/invalid-closer-collab.md"
  append_fixture "$FIXTURES/routing-invalid-fence-closer.md" "$case_dir/invalid-closer-collab.md"
  set +e
  MONITOR_STATE_DIR="$case_dir/invalid-closer-state" /bin/bash "$MONITOR" run --once '@skillcreator' "$case_dir/invalid-closer-collab.md" > "$case_dir/invalid-closer.out" 2>&1
  invalid_closer_rc=$?
  set -e
  printf '%s\n' '```' >> "$case_dir/invalid-closer-collab.md"
  append_fixture "$FIXTURES/addressed-event.md" "$case_dir/invalid-closer-collab.md"
  set +e
  MONITOR_STATE_DIR="$case_dir/invalid-closer-state" /bin/bash "$MONITOR" run --once '@skillcreator' "$case_dir/invalid-closer-collab.md" > "$case_dir/invalid-closer-recovered.out" 2>&1
  invalid_closer_recovery_rc=$?
  set -e
  if [[ "$count" == "0" ]] &&
    [[ "$code_rc" -eq 0 ]] &&
    [[ "$code_future_rc" -eq 0 ]] &&
    [[ "$inline_rc" -eq 0 ]] &&
    [[ "$(alert_count "$case_dir/inline.out")" == "1" ]] &&
    [[ "$(alert_count "$case_dir/code.out")" == "0" ]] &&
    [[ "$(alert_count "$case_dir/code-future.out")" == "1" ]] &&
    [[ "$unclosed_rc" -ne 0 ]] &&
    grep -Fq 'WATCH-WARN' "$case_dir/unclosed.out" &&
    grep -Fq 'reason=unclosed-fence' "$case_dir/unclosed.out" &&
    [[ "$(alert_count "$case_dir/unclosed-recovered.out")" == "2" ]] &&
    [[ "$(alert_count "$case_dir/list.out")" == "1" ]] &&
    [[ "$(alert_count "$case_dir/recipient-skillcreator.out")" == "0" ]] &&
    [[ "$(alert_count "$case_dir/recipient-other.out")" == "1" ]] &&
    [[ "$invalid_closer_rc" -ne 0 ]] &&
    grep -Fq 'reason=unclosed-fence' "$case_dir/invalid-closer.out" &&
    [[ "$(alert_count "$case_dir/invalid-closer.out")" == "0" ]] &&
    [[ "$invalid_closer_recovery_rc" -eq 0 ]] &&
    [[ "$(alert_count "$case_dir/invalid-closer-recovered.out")" == "1" ]] &&
    grep -Fq 'Fenced and indented code' "$SKILL_DIR/SKILL.md" &&
    grep -Fq 'unclosed fence' "$SKILL_DIR/SKILL.md"; then
    pass "1 filter-too-broad GREEN"
  else
    fail "1 filter-too-broad" "documentation or code examples emitted an alert, or the later real event disappeared"
  fi

  case_dir="$TMP_ROOT/self"
  mkdir -p "$case_dir/state"
  board="$case_dir/collab.md"
  : > "$board"
  run_once "$case_dir/state" "$case_dir/seed.out" '@skillcreator' "$board"
  append_fixture "$FIXTURES/self-authored-post.md" "$board"
  run_once "$case_dir/state" "$case_dir/scan.out" '@skillcreator' "$board"
  count="$(alert_count "$case_dir/scan.out")"
  : > "$case_dir/signed-collab.md"
  run_once "$case_dir/signed-state" "$case_dir/signed-seed.out" '@review-638' "$case_dir/signed-collab.md"
  append_fixture "$FIXTURES/self-signature-body.md" "$case_dir/signed-collab.md"
  run_once "$case_dir/signed-state" "$case_dir/body-only.out" '@review-638' "$case_dir/signed-collab.md"
  append_fixture "$FIXTURES/self-signature-line.md" "$case_dir/signed-collab.md"
  run_once "$case_dir/signed-state" "$case_dir/with-signature.out" '@review-638' "$case_dir/signed-collab.md"
  : > "$case_dir/context-collab.md"
  run_once "$case_dir/context-state" "$case_dir/context-seed.out" '@review-638' "$case_dir/context-collab.md"
  append_fixture "$FIXTURES/self-signature-with-context.md" "$case_dir/context-collab.md"
  run_once "$case_dir/context-state" "$case_dir/context.out" '@review-638' "$case_dir/context-collab.md"
  : > "$case_dir/mixed-collab.md"
  run_once "$case_dir/mixed-state" "$case_dir/mixed-seed.out" '@review-638' "$case_dir/mixed-collab.md"
  append_fixture "$FIXTURES/foreign-event-in-self-block.md" "$case_dir/mixed-collab.md"
  run_once "$case_dir/mixed-state" "$case_dir/mixed-held.out" '@review-638' "$case_dir/mixed-collab.md"
  printf '%s\n' '— @orc' >> "$case_dir/mixed-collab.md"
  run_once "$case_dir/mixed-state" "$case_dir/mixed.out" '@review-638' "$case_dir/mixed-collab.md"
  : > "$case_dir/foreign-collab.md"
  run_once "$case_dir/foreign-state" "$case_dir/foreign-seed.out" '@review-638' "$case_dir/foreign-collab.md"
  append_fixture "$FIXTURES/foreign-signature-with-cc.md" "$case_dir/foreign-collab.md"
  run_once "$case_dir/foreign-state" "$case_dir/foreign-held.out" '@review-638' "$case_dir/foreign-collab.md"
  printf '%s\n' '— @orc' >> "$case_dir/foreign-collab.md"
  run_once "$case_dir/foreign-state" "$case_dir/foreign-closed.out" '@review-638' "$case_dir/foreign-collab.md"
  if [[ "$count" == "0" ]] && [[ "$(self_post_count "$case_dir/scan.out")" == "1" ]] && [[ "$(alert_count "$case_dir/body-only.out")" == "0" ]] && [[ "$(alert_count "$case_dir/with-signature.out")" == "0" ]] && [[ "$(self_post_count "$case_dir/with-signature.out")" == "1" ]] && [[ "$(alert_count "$case_dir/context.out")" == "0" ]] && [[ "$(self_post_count "$case_dir/context.out")" == "1" ]] && [[ "$(alert_count "$case_dir/mixed-held.out")" == "0" ]] && [[ "$(self_post_count "$case_dir/mixed-held.out")" == "1" ]] && [[ "$(alert_count "$case_dir/mixed.out")" == "1" ]] && [[ "$(alert_count "$case_dir/foreign-held.out")" == "0" ]] && [[ "$(alert_count "$case_dir/foreign-closed.out")" == "1" ]]; then
    pass "2 self-signature-match GREEN"
  else
    fail "2 self-signature-match" "signature parsing flushed context early, misclassified authorship, or consumed a split-write inbound hash before closure"
  fi

  case_dir="$TMP_ROOT/dedup"
  mkdir -p "$case_dir/state"
  board="$case_dir/collab.md"
  : > "$board"
  run_once "$case_dir/state" "$case_dir/seed.out" '@skillcreator' "$board"
  append_fixture "$FIXTURES/addressed-event.md" "$board"
  run_once "$case_dir/state" "$case_dir/first.out" '@skillcreator' "$board"
  append_fixture "$FIXTURES/large-plan-unrelated-append.md" "$board"
  run_once "$case_dir/state" "$case_dir/second.out" '@skillcreator' "$board"
  first="$(alert_count "$case_dir/first.out")"
  second="$(alert_count "$case_dir/second.out")"
  if [[ "$first" == "1" && "$second" == "0" ]]; then
    pass "3 content-hash-dedup GREEN"
  else
    fail "3 content-hash-dedup" "expected 1 then 0 alerts, got $first then $second"
  fi

  case_dir="$TMP_ROOT/seed"
  mkdir -p "$case_dir/state"
  board="$case_dir/collab.md"
  cp "$FIXTURES/addressed-event.md" "$board"
  run_once "$case_dir/state" "$case_dir/seed.out" '@skillcreator' "$board"
  count="$(alert_count "$case_dir/seed.out")"
  append_fixture "$FIXTURES/addressed-event-two.md" "$board"
  run_once "$case_dir/state" "$case_dir/future.out" '@skillcreator' "$board"
  persistence_case="$TMP_ROOT/seed-persistence"
  mkdir -p "$persistence_case/state" "$persistence_case/bin"
  cp "$FIXTURES/fake-failing-seen-mv.sh" "$persistence_case/bin/mv"
  chmod +x "$persistence_case/bin/mv"
  cp "$FIXTURES/addressed-event.md" "$persistence_case/collab.md"
  set +e
  PATH="$persistence_case/bin:$PATH" COLLAB_MONITOR_FAIL_SEEN_MV=1 MONITOR_STATE_DIR="$persistence_case/state" /bin/bash "$MONITOR" run --once '@skillcreator' "$persistence_case/collab.md" > "$persistence_case/failed.out" 2>&1
  persistence_failed_rc=$?
  set -e
  persistence_baseline_count="$(find "$persistence_case/state/skillcreator/sizes" -type f -name '*.size' 2>/dev/null | wc -l | tr -d '[:space:]')"
  run_once "$persistence_case/state" "$persistence_case/reseed.out" '@skillcreator' "$persistence_case/collab.md"
  append_fixture "$FIXTURES/large-plan-unrelated-append.md" "$persistence_case/collab.md"
  run_once "$persistence_case/state" "$persistence_case/growth.out" '@skillcreator' "$persistence_case/collab.md"
  persistence_ok=0
  if [[ "$persistence_failed_rc" -ne 0 && "$persistence_baseline_count" == "0" ]] &&
    grep -Fq 'reason=state-failed' "$persistence_case/failed.out" &&
    [[ "$(alert_count "$persistence_case/reseed.out")" == "0" ]] &&
    [[ "$(alert_count "$persistence_case/growth.out")" == "0" ]]; then
    persistence_ok=1
  fi
  missing_seen_case="$TMP_ROOT/missing-seen"
  mkdir -p "$missing_seen_case/state"
  cp "$FIXTURES/addressed-event.md" "$missing_seen_case/collab.md"
  run_once "$missing_seen_case/state" "$missing_seen_case/seed.out" '@skillcreator' "$missing_seen_case/collab.md"
  cp "$missing_seen_case/state/skillcreator/seen.sha256" "$missing_seen_case/seen.backup"
  rm -f "$missing_seen_case/state/skillcreator/seen.sha256"
  append_fixture "$FIXTURES/large-plan-unrelated-append.md" "$missing_seen_case/collab.md"
  set +e
  run_once "$missing_seen_case/state" "$missing_seen_case/missing.out" '@skillcreator' "$missing_seen_case/collab.md"
  missing_seen_rc=$?
  set -e
  mv "$missing_seen_case/seen.backup" "$missing_seen_case/state/skillcreator/seen.sha256"
  run_once "$missing_seen_case/state" "$missing_seen_case/recovered.out" '@skillcreator' "$missing_seen_case/collab.md"
  missing_seen_ok=0
  if [[ "$missing_seen_rc" -ne 0 ]] &&
    grep -Fq 'reason=state-failed' "$missing_seen_case/missing.out" &&
    [[ "$(alert_count "$missing_seen_case/missing.out")" == "0" ]] &&
    [[ "$(alert_count "$missing_seen_case/recovered.out")" == "0" ]]; then
    missing_seen_ok=1
  fi
  if [[ "$count" == "0" ]] && [[ "$(alert_count "$case_dir/future.out")" == "1" ]] && [[ "$persistence_ok" -eq 1 ]] && [[ "$missing_seen_ok" -eq 1 ]]; then
    pass "4 silent-seed GREEN"
  else
    fail "4 silent-seed" "historical seed, persisted/missing seen-state recovery, or later-event visibility failed"
  fi

  case_dir="$TMP_ROOT/bash32"
  mkdir -p "$case_dir/state"
  board="$case_dir/collab.md"
  : > "$board"
  set +e
  MONITOR_STATE_DIR="$case_dir/state" /bin/bash "$MONITOR" run --once '@..' "$board" > "$case_dir/invalid-name.out" 2>&1
  invalid_name_rc=$?
  MONITOR_STATE_DIR="$case_dir/state" POLL_SECONDS='1.2.3' /bin/bash "$MONITOR" run --once '@skillcreator' "$board" > "$case_dir/invalid-poll.out" 2>&1
  invalid_poll_rc=$?
  MONITOR_STATE_DIR="$case_dir/state" POLL_SECONDS='0' /bin/bash "$MONITOR" run --once '@skillcreator' "$board" > "$case_dir/zero-poll.out" 2>&1
  zero_poll_rc=$?
  MONITOR_STATE_DIR="$case_dir/timeout-state" START_TIMEOUT_SECONDS='0' /bin/bash "$MONITOR" start '@skillcreator' "$board" > "$case_dir/zero-timeout.out" 2>&1
  zero_timeout_rc=$?
  MONITOR_STATE_DIR="$case_dir/invalid-timeout-state" START_TIMEOUT_SECONDS='1.2' /bin/bash "$MONITOR" start '@skillcreator' "$board" > "$case_dir/invalid-timeout.out" 2>&1
  invalid_timeout_rc=$?
  MONITOR_STATE_DIR="$case_dir/state" POLL_SECONDS='invalid' /bin/bash "$MONITOR" status '@not-running' > "$case_dir/recovery-status.out" 2>&1
  recovery_status_rc=$?
  set -e
  if grep -Eq 'declare[[:space:]]+-A' "$MONITOR"; then
    fail "5 bash-3.2-safe" "implementation contains declare -A"
  elif [[ "$invalid_name_rc" -ne 0 ]] && [[ "$invalid_poll_rc" -ne 0 ]] && [[ "$zero_poll_rc" -ne 0 ]] &&
    [[ "$zero_timeout_rc" -eq 2 ]] && grep -Fq 'COLLAB-MONITOR-ERROR :: invalid START_TIMEOUT_SECONDS: 0' "$case_dir/zero-timeout.out" && [[ ! -e "$case_dir/timeout-state" ]] &&
    [[ "$invalid_timeout_rc" -eq 2 ]] && grep -Fq 'COLLAB-MONITOR-ERROR :: invalid START_TIMEOUT_SECONDS: 1.2' "$case_dir/invalid-timeout.out" && [[ ! -e "$case_dir/invalid-timeout-state" ]] &&
    [[ "$recovery_status_rc" -eq 1 ]] && grep -Fq 'NOT_RUNNING' "$case_dir/recovery-status.out" && run_once "$case_dir/state" "$case_dir/output" '@skillcreator' "$board" && [[ -f "$case_dir/state/skillcreator/seen.sha256" ]] && find "$case_dir/state/skillcreator/sizes" -type f -name '*.size' -print -quit | grep -q .; then
    pass "5 bash-3.2-safe GREEN"
  else
    fail "5 bash-3.2-safe" "Bash 3.2 run/state, invalid name/poll/start-timeout rejection, or recovery-command isolation failed"
  fi

  case_dir="$TMP_ROOT/comm"
  mkdir -p "$case_dir/state"
  : > "$case_dir/z-file.md"
  : > "$case_dir/a-file.md"
  run_once "$case_dir/state" "$case_dir/seed.out" '@skillcreator' "$case_dir/z-file.md" "$case_dir/a-file.md"
  append_fixture "$FIXTURES/addressed-event.md" "$case_dir/a-file.md"
  run_once "$case_dir/state" "$case_dir/scan.out" '@skillcreator' "$case_dir/z-file.md" "$case_dir/a-file.md"
  count="$(alert_count "$case_dir/scan.out")"
  if grep -Eq '(^|[[:space:]])comm([[:space:]]|$)' "$MONITOR"; then
    fail "6 comm-unsorted" "implementation calls comm"
  elif [[ "$count" == "1" ]]; then
    pass "6 comm-unsorted GREEN"
  else
    fail "6 comm-unsorted" "expected 1 real alert, got $count"
  fi

  case_dir="$TMP_ROOT/large-plan"
  mkdir -p "$case_dir/state"
  board="$case_dir/collab.md"
  : > "$board"
  run_once "$case_dir/state" "$case_dir/seed.out" '@skillcreator' "$board"
  append_fixture "$FIXTURES/addressed-event.md" "$board"
  run_once "$case_dir/state" "$case_dir/first.out" '@skillcreator' "$board"
  append_fixture "$FIXTURES/large-plan-unrelated-append.md" "$board"
  run_once "$case_dir/state" "$case_dir/second.out" '@skillcreator' "$board"
  first="$(alert_count "$case_dir/first.out")"
  second="$(alert_count "$case_dir/second.out")"
  first_arm_line="$(grep -n 'collab-monitor/scripts/collab-monitor.sh start @<listen-name> collab.md' "$LARGE_PLAN" | sed -n '1s/:.*//p' || true)"
  second_arm_line="$(grep -n 'collab-monitor/scripts/collab-monitor.sh start @<listen-name> collab.md' "$LARGE_PLAN" | sed -n '2s/:.*//p' || true)"
  first_spawn_line="$(grep -n 'Spawns one agent per phase' "$LARGE_PLAN" | sed -n '1s/:.*//p' || true)"
  second_spawn_line="$(grep -En 'Spawn agents with (the )?collab path' "$LARGE_PLAN" | sed -n '1s/:.*//p' || true)"
  first_liveness_line="$(grep -n 'MUST NOT be the only worker-liveness guard' "$LARGE_PLAN" | sed -n '1s/:.*//p' || true)"
  second_liveness_line="$(grep -n 'MUST NOT be the only worker-liveness guard' "$LARGE_PLAN" | sed -n '2s/:.*//p' || true)"
  arm_before_spawn=0
  if [[ -n "$first_arm_line" && -n "$second_arm_line" && -n "$first_spawn_line" && -n "$second_spawn_line" ]] &&
    [[ -n "$first_liveness_line" && -n "$second_liveness_line" ]] &&
    [[ "$first_arm_line" -lt "$first_liveness_line" ]] && [[ "$first_liveness_line" -lt "$first_spawn_line" ]] &&
    [[ "$second_arm_line" -lt "$second_liveness_line" ]] && [[ "$second_liveness_line" -lt "$second_spawn_line" ]]; then
    arm_before_spawn=1
  fi
  if [[ "$first" == "1" && "$second" == "0" ]] &&
    [[ "$arm_before_spawn" -eq 1 ]] &&
    ! grep -Fq 'grep done collab.md' "$LARGE_PLAN" &&
    ! grep -Fq 'kill <bg-monitor-pid>' "$LARGE_PLAN" &&
    [[ "$(grep -Fc '→ @<listen-name> — [ISO-timestamp] Phase N done' "$LARGE_PLAN")" -ge 2 ]] &&
    [[ "$(grep -Fc '→ @<listen-name> — [ISO-timestamp] Phase N blocked' "$LARGE_PLAN")" -ge 2 ]] &&
    ! grep -Fq '→ @<listen-name> — Phase N done' "$LARGE_PLAN" &&
    ! grep -Fq '→ @<listen-name> — Phase N blocked' "$LARGE_PLAN" &&
    [[ "$(grep -c 'follow @<listen-name>' "$LARGE_PLAN")" -ge 3 ]] &&
    [[ "$(grep -c 'collab-monitor/scripts/collab-monitor.sh' "$LARGE_PLAN")" -ge 4 ]] &&
    grep -Fq '| **Worker liveness** |' "$LARGE_PLAN" &&
    grep -Fq 'codex-workflows/scripts/codex-workflows.sh watch --run-id <run-id>' "$LARGE_PLAN" &&
    ! grep -Eiq 'collab monitor (is|may be|can be|as) (the )?only worker-liveness guard' "$LARGE_PLAN" &&
    ! grep -Eq 'grep -E.*done|/tmp/collab-monitor[.]pid' "$LARGE_PLAN_CODEX_ADAPTER" &&
    grep -Fq 'collab-monitor/scripts/collab-monitor.sh' "$LARGE_PLAN_CODEX_ADAPTER" &&
    grep -Fq 'follow @<listen-name>' "$LARGE_PLAN_CODEX_ADAPTER" &&
    grep -Fq 'stop @<listen-name>' "$LARGE_PLAN_CODEX_ADAPTER" &&
    grep -Fq '→ @<listen-name> — [ISO-timestamp] Phase N done' "$LARGE_PLAN_CODEX_ADAPTER" &&
    grep -Fq '→ @<listen-name> — [ISO-timestamp] Phase N blocked' "$LARGE_PLAN_CODEX_ADAPTER" &&
    ! grep -Fq '→ @<listen-name> — Phase N done' "$LARGE_PLAN_CODEX_ADAPTER" &&
    ! grep -Fq '→ @<listen-name> — Phase N blocked' "$LARGE_PLAN_CODEX_ADAPTER" &&
    grep -Fq 'MUST NOT be the only worker-liveness guard' "$LARGE_PLAN_CODEX_ADAPTER" &&
    ! grep -Eq 'grep -E.*done|kill <bg-monitor-pid>' "$LARGE_PLAN_CAPABILITIES" &&
    grep -Fq 'collab-monitor/scripts/collab-monitor.sh start @<listen-name>' "$LARGE_PLAN_CAPABILITIES" &&
    grep -Fq 'collab-monitor/scripts/collab-monitor.sh follow @<listen-name>' "$LARGE_PLAN_CAPABILITIES" &&
    grep -Fq 'collab-monitor/scripts/collab-monitor.sh stop @<listen-name>' "$LARGE_PLAN_CAPABILITIES" &&
    ! grep -Eq 'grep -E.*done|grep -E.*blocked' "$LARGE_PLAN_CLAUDE_ADAPTER" &&
    grep -Fq 'collab-monitor/scripts/collab-monitor.sh run --once @<listen-name>' "$LARGE_PLAN_CLAUDE_ADAPTER" &&
    ! grep -Eq 'grep -E.*done|grep -E.*blocked' "$LARGE_PLAN_COLLAB_WORKFLOW" &&
    grep -Fq 'collab-monitor/scripts/collab-monitor.sh run --once @<listen-name>' "$LARGE_PLAN_COLLAB_WORKFLOW" &&
    grep -Fq '### @<agent> → @<listen-name> — [ISO-timestamp] Phase N done' "$LARGE_PLAN_COLLAB_WORKFLOW" &&
    grep -Fq '### @<agent> → @<listen-name> — [ISO-timestamp] Phase N blocked' "$LARGE_PLAN_COLLAB_WORKFLOW" &&
    ! grep -Fq '### @<agent> → @<listen-name> — Phase N done' "$LARGE_PLAN_COLLAB_WORKFLOW" &&
    ! grep -Fq '### @<agent> → @<listen-name> — Phase N blocked' "$LARGE_PLAN_COLLAB_WORKFLOW" &&
    grep -Fq '### @<agent> → @<listen-name> — [ISO-timestamp] Phase N done' "$LARGE_PLAN_EXECUTE_PHASE" &&
    grep -Fq '### @<agent> → @<listen-name> — [ISO-timestamp] Phase N blocked' "$LARGE_PLAN_EXECUTE_PHASE" &&
    ! grep -Fq '### @<agent> → @<listen-name> — Phase N done' "$LARGE_PLAN_EXECUTE_PHASE" &&
    ! grep -Fq '### @<agent> → @<listen-name> — Phase N blocked' "$LARGE_PLAN_EXECUTE_PHASE" &&
    grep -Fq 'MUST NOT be the only worker-liveness guard' "$LARGE_PLAN_COLLAB_WORKFLOW"; then
    pass "7 large-plan-teaching GREEN"
  else
    fail "7 large-plan-teaching" "expected 1 then 0 alerts plus pre-spawn arming, routed done/blocked headings, and an attached start/follow consumer"
  fi

  case_dir="$TMP_ROOT/shrink"
  mkdir -p "$case_dir/state"
  board="$case_dir/collab.md"
  cp "$FIXTURES/addressed-event.md" "$board"
  run_once "$case_dir/state" "$case_dir/seed.out" '@skillcreator' "$board"
  : > "$board"
  run_once "$case_dir/state" "$case_dir/scan.out" '@skillcreator' "$board"
  if grep -Fq 'SHRINK' "$case_dir/scan.out" && grep -Eq 'delta_bytes=[0-9]+' "$case_dir/scan.out" && [[ "$(alert_count "$case_dir/scan.out")" == "0" ]]; then
    pass "8 shrink-detection GREEN"
  else
    fail "8 shrink-detection" "expected SHRINK with delta_bytes and no NEW-FOR record"
  fi

  case_dir="$TMP_ROOT/limits"
  mkdir -p "$case_dir/state"
  board="$case_dir/collab.md"
  : > "$board"
  run_once "$case_dir/state" "$case_dir/output" '@skillcreator' "$board"
  if grep -Fq 'WILL-NOT-CATCH' "$case_dir/output" && grep -Fqi 'rewrite' "$case_dir/output" && grep -Fqi 'registry' "$case_dir/output" && grep -Fqi 'unclosed' "$case_dir/output"; then
    pass "9 explicit-limitations GREEN"
  else
    fail "9 explicit-limitations" "startup output did not name rewrite, registry, and unclosed-message limits"
  fi

  case_dir="$TMP_ROOT/lifecycle"
  mkdir -p "$case_dir/state"
  board="$case_dir/collab.md"
  : > "$board"
  output="$case_dir/start.out"
  output2="$case_dir/status.out"
  mkdir -p "$case_dir/state/skillcreator/start.lock"
  printf '%s\n' '999999' > "$case_dir/state/skillcreator/start.lock/owner.pid"
  MONITOR_STATE_DIR="$case_dir/state" /bin/bash "$MONITOR" start '@skillcreator' "$board" > "$output" 2>&1
  pid_file="$case_dir/state/skillcreator/monitor.pid"
  ready_file="$case_dir/state/skillcreator/ready.pid"
  monitor_pid="$(sed -n '1p' "$pid_file")"
  ready_matches=0
  if [[ -f "$ready_file" ]] && [[ "$(sed -n '1p' "$ready_file")" == "$monitor_pid" ]]; then
    ready_matches=1
  fi
  sleep_pid=''
  index=0
  while [[ "$index" -lt 20 && -z "$sleep_pid" ]]; do
    sleep_pid="$(pgrep -P "$monitor_pid" 2>/dev/null | sed -n '1p')"
    [[ -n "$sleep_pid" ]] || sleep 0.1
    index=$((index + 1))
  done
  append_fixture "$FIXTURES/addressed-event.md" "$board"
  if [[ -n "$sleep_pid" ]]; then
    kill "$sleep_pid"
  fi
  index=0
  while [[ "$index" -lt 30 ]] && ! grep -q '^NEW-FOR-' "$case_dir/state/skillcreator/monitor.log" 2>/dev/null; do
    sleep 0.1
    index=$((index + 1))
  done
  MONITOR_STATE_DIR="$case_dir/state" /bin/bash "$MONITOR" follow '@skillcreator' > "$case_dir/follow.out" 2>&1 &
  follow_pid=$!
  index=0
  while [[ "$index" -lt 30 ]] && { ! grep -q '^FOLLOWING ' "$case_dir/follow.out" 2>/dev/null || ! grep -q '^NEW-FOR-' "$case_dir/follow.out" 2>/dev/null; }; do
    sleep 0.1
    index=$((index + 1))
  done
  follow_replayed=0
  if grep -q '^FOLLOWING ' "$case_dir/follow.out" 2>/dev/null && [[ "$(grep -c '^NEW-FOR-' "$case_dir/follow.out" 2>/dev/null || true)" == "1" ]]; then
    follow_replayed=1
  fi
  stream_sleep_pid=''
  index=0
  while [[ "$index" -lt 20 && -z "$stream_sleep_pid" ]]; do
    stream_sleep_pid="$(pgrep -P "$monitor_pid" 2>/dev/null | sed -n '1p')"
    [[ -n "$stream_sleep_pid" ]] || sleep 0.1
    index=$((index + 1))
  done
  append_fixture "$FIXTURES/addressed-event-two.md" "$board"
  if [[ -n "$stream_sleep_pid" ]]; then
    kill "$stream_sleep_pid"
  fi
  index=0
  while [[ "$index" -lt 30 && "$(grep -c '^NEW-FOR-' "$case_dir/follow.out" 2>/dev/null || true)" -lt 2 ]]; do
    sleep 0.1
    index=$((index + 1))
  done
  follow_streamed=0
  [[ "$(grep -c '^NEW-FOR-' "$case_dir/follow.out" 2>/dev/null || true)" == "2" ]] && follow_streamed=1
  set +e
  MONITOR_STATE_DIR="$case_dir/state" /bin/bash "$MONITOR" status '@skillcreator' > "$case_dir/sleeper-status.out" 2>&1
  sleep_survived_rc=$?
  set -e
  set +e
  MONITOR_STATE_DIR="$case_dir/state" /bin/bash "$MONITOR" start '@skillcreator' "$board" > "$case_dir/duplicate.out" 2>&1
  duplicate_rc=$?
  set -e
  lifecycle_ok=0
  if [[ "$ready_matches" -eq 1 && "$follow_replayed" -eq 1 && "$follow_streamed" -eq 1 ]] && [[ -n "$sleep_pid" && -n "$stream_sleep_pid" ]] && [[ "$sleep_survived_rc" -eq 0 ]] && [[ -s "$pid_file" ]] && [[ "$duplicate_rc" -ne 0 ]] && grep -Fq 'ALREADY_RUNNING' "$case_dir/duplicate.out" && MONITOR_STATE_DIR="$case_dir/state" /bin/bash "$MONITOR" status '@skillcreator' > "$output2" 2>&1 && MONITOR_STATE_DIR="$case_dir/state" /bin/bash "$MONITOR" stop '@skillcreator' > "$case_dir/stop.out" 2>&1; then
    index=0
    while [[ "$index" -lt 30 ]] && kill -0 "$follow_pid" 2>/dev/null; do
      sleep 0.1
      index=$((index + 1))
    done
    follow_exited=0
    kill -0 "$follow_pid" 2>/dev/null || follow_exited=1
    MONITOR_STATE_DIR="$case_dir/state" /bin/bash "$MONITOR" start '@skillcreator2' "$board" > "$case_dir/foreign-start.out" 2>&1
    foreign_pid="$(sed -n '1p' "$case_dir/state/skillcreator2/monitor.pid")"
    printf '%s\n' "$foreign_pid" > "$pid_file"
    set +e
    MONITOR_STATE_DIR="$case_dir/state" /bin/bash "$MONITOR" stop '@skillcreator' > "$case_dir/stale-stop.out" 2>&1
    stale_rc=$?
    mkdir -p "$case_dir/bin"
    awk '{ print }' "$FIXTURES/fake-zombie-ps.sh" > "$case_dir/bin/ps"
    chmod +x "$case_dir/bin/ps"
    PATH="$case_dir/bin:$PATH" COLLAB_MONITOR_FAKE_ZOMBIE_PID="$foreign_pid" MONITOR_STATE_DIR="$case_dir/state" /bin/bash "$MONITOR" status '@skillcreator2' > "$case_dir/zombie-status.out" 2>&1
    zombie_status_rc=$?
    MONITOR_STATE_DIR="$case_dir/state" /bin/bash "$MONITOR" status '@skillcreator2' > "$case_dir/foreign-status.out" 2>&1
    foreign_status_rc=$?
    PATH="$case_dir/bin:$PATH" COLLAB_MONITOR_FAKE_ZOMBIE_PID="$foreign_pid" MONITOR_STATE_DIR="$case_dir/state" /bin/bash "$MONITOR" stop '@skillcreator2' > "$case_dir/zombie-stop.out" 2>&1
    zombie_stop_rc=$?
    set -e
    if [[ "$foreign_status_rc" -eq 0 ]]; then
      kill "$foreign_pid" 2>/dev/null || true
    else
      kill "$foreign_pid" 2>/dev/null || true
    fi
    if [[ "$follow_exited" -eq 1 && "$stale_rc" -ne 0 && "$zombie_status_rc" -ne 0 && "$foreign_status_rc" -eq 0 && "$zombie_stop_rc" -eq 0 ]] && grep -Fq 'STALE_PID' "$case_dir/zombie-status.out" && grep -Fq 'state=zombie' "$case_dir/zombie-stop.out"; then
      lifecycle_ok=1
    fi
  fi
  kill "$follow_pid" 2>/dev/null || true
  if [[ -s "$pid_file" ]]; then
    kill "$(sed -n '1p' "$pid_file")" 2>/dev/null || true
  fi

  corrupt_case="$TMP_ROOT/corrupt-readiness"
  mkdir -p "$corrupt_case/state"
  : > "$corrupt_case/collab.md"
  run_once "$corrupt_case/state" "$corrupt_case/seed.out" '@corrupt' "$corrupt_case/collab.md"
  corrupt_size="$(find "$corrupt_case/state/corrupt/sizes" -type f -name '*.size' -print -quit)"
  printf '%s\n' 'not-a-number' > "$corrupt_size"
  set +e
  MONITOR_STATE_DIR="$corrupt_case/state" /bin/bash "$MONITOR" start '@corrupt' "$corrupt_case/collab.md" > "$corrupt_case/start.out" 2>&1
  corrupt_start_rc=$?
  MONITOR_STATE_DIR="$corrupt_case/state" /bin/bash "$MONITOR" status '@corrupt' > "$corrupt_case/status.out" 2>&1
  corrupt_status_rc=$?
  set -e
  corrupt_rejected=0
  if [[ "$corrupt_start_rc" -ne 0 && "$corrupt_status_rc" -ne 0 ]] && grep -Fq 'START_FAILED' "$corrupt_case/start.out"; then
    corrupt_rejected=1
  fi
  if [[ -s "$corrupt_case/state/corrupt/monitor.pid" ]]; then
    kill "$(sed -n '1p' "$corrupt_case/state/corrupt/monitor.pid")" 2>/dev/null || true
  fi

  interrupt_case="$TMP_ROOT/interrupted-start"
  mkdir -p "$interrupt_case/state"
  cp "$FIXTURES/routing-unclosed-fence.md" "$interrupt_case/collab.md"
  MONITOR_STATE_DIR="$interrupt_case/state" /bin/bash "$MONITOR" start '@interrupted' "$interrupt_case/collab.md" > "$interrupt_case/start.out" 2>&1 &
  interrupt_parent_pid=$!
  interrupt_child_pid=''
  index=0
  while [[ "$index" -lt 50 && -z "$interrupt_child_pid" ]]; do
    if [[ -f "$interrupt_case/state/interrupted/run.lock/owner.pid" ]]; then
      interrupt_child_pid="$(sed -n '1p' "$interrupt_case/state/interrupted/run.lock/owner.pid")"
    fi
    [[ -n "$interrupt_child_pid" ]] || sleep 0.1
    index=$((index + 1))
  done
  kill -TERM "$interrupt_parent_pid" 2>/dev/null || true
  set +e
  wait "$interrupt_parent_pid"
  interrupt_parent_rc=$?
  set -e
  index=0
  while [[ "$index" -lt 50 && -n "$interrupt_child_pid" ]] && kill -0 "$interrupt_child_pid" 2>/dev/null; do
    sleep 0.1
    index=$((index + 1))
  done
  interrupt_child_exited=0
  if [[ -n "$interrupt_child_pid" ]] && ! kill -0 "$interrupt_child_pid" 2>/dev/null; then
    interrupt_child_exited=1
  fi
  interrupt_lock_cleared=0
  [[ ! -d "$interrupt_case/state/interrupted/run.lock" ]] && interrupt_lock_cleared=1
  printf '%s\n' '```' >> "$interrupt_case/collab.md"
  set +e
  MONITOR_STATE_DIR="$interrupt_case/state" /bin/bash "$MONITOR" start '@interrupted' "$interrupt_case/collab.md" > "$interrupt_case/recovery-start.out" 2>&1
  interrupt_recovery_rc=$?
  set -e
  interrupt_ok=0
  if [[ "$interrupt_parent_rc" -ne 0 && "$interrupt_child_exited" -eq 1 && "$interrupt_lock_cleared" -eq 1 && "$interrupt_recovery_rc" -eq 0 ]]; then
    interrupt_ok=1
  fi
  if [[ "$interrupt_recovery_rc" -eq 0 ]]; then
    MONITOR_STATE_DIR="$interrupt_case/state" /bin/bash "$MONITOR" stop '@interrupted' > "$interrupt_case/stop.out" 2>&1 || true
  elif [[ -n "$interrupt_child_pid" ]]; then
    kill "$interrupt_child_pid" 2>/dev/null || true
  fi

  identity_case="$TMP_ROOT/instance-identity"
  mkdir -p "$identity_case/state-a" "$identity_case/state-b"
  : > "$identity_case/collab-a.md"
  : > "$identity_case/collab-b.md"
  MONITOR_STATE_DIR="$identity_case/state-a" /bin/bash "$MONITOR" start '@same-name' "$identity_case/collab-a.md" > "$identity_case/start-a.out" 2>&1
  MONITOR_STATE_DIR="$identity_case/state-b" /bin/bash "$MONITOR" start '@same-name' "$identity_case/collab-b.md" > "$identity_case/start-b.out" 2>&1
  identity_pid_a="$(sed -n '1p' "$identity_case/state-a/same-name/monitor.pid")"
  identity_pid_b="$(sed -n '1p' "$identity_case/state-b/same-name/monitor.pid")"
  identity_token_a="$(sed -n '1p' "$identity_case/state-a/same-name/monitor.instance" 2>/dev/null || true)"
  identity_token_b="$(sed -n '1p' "$identity_case/state-b/same-name/monitor.instance" 2>/dev/null || true)"
  identity_corrupt_token='ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  [[ "$identity_token_a" == "$identity_corrupt_token" ]] && identity_corrupt_token='eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  printf '%s\n' "$identity_corrupt_token" > "$identity_case/state-a/same-name/monitor.instance"
  set +e
  MONITOR_STATE_DIR="$identity_case/state-a" /bin/bash "$MONITOR" stop '@same-name' > "$identity_case/conflict-stop.out" 2>&1
  identity_conflict_stop_rc=$?
  MONITOR_STATE_DIR="$identity_case/state-a" /bin/bash "$MONITOR" start '@same-name' "$identity_case/collab-a.md" > "$identity_case/conflict-start.out" 2>&1
  identity_conflict_start_rc=$?
  set -e
  identity_conflict_ok=0
  if [[ "$identity_conflict_stop_rc" -ne 0 && "$identity_conflict_start_rc" -ne 0 ]] &&
    [[ "$(sed -n '1p' "$identity_case/state-a/same-name/monitor.pid" 2>/dev/null || true)" == "$identity_pid_a" ]] &&
    [[ "$(sed -n '1p' "$identity_case/state-a/same-name/monitor.instance" 2>/dev/null || true)" == "$identity_corrupt_token" ]] &&
    kill -0 "$identity_pid_a" 2>/dev/null &&
    grep -Fq 'STATE_CONFLICT' "$identity_case/conflict-stop.out" &&
    grep -Fq 'state=preserved' "$identity_case/conflict-stop.out" &&
    grep -Fq 'STATE_CONFLICT' "$identity_case/conflict-start.out"; then
    identity_conflict_ok=1
  fi
  printf '%s\n' "$identity_token_a" > "$identity_case/state-a/same-name/monitor.instance"
  kill "$identity_pid_a" 2>/dev/null || true
  index=0
  while [[ "$index" -lt 50 ]] && kill -0 "$identity_pid_a" 2>/dev/null; do
    sleep 0.1
    index=$((index + 1))
  done
  mkdir -p "$identity_case/state-a/same-name"
  printf '%s\n' "$identity_pid_b" > "$identity_case/state-a/same-name/monitor.pid"
  printf '%s\n' "$identity_token_a" > "$identity_case/state-a/same-name/monitor.instance"
  set +e
  MONITOR_STATE_DIR="$identity_case/state-a" /bin/bash "$MONITOR" stop '@same-name' > "$identity_case/stale-stop.out" 2>&1
  identity_stale_rc=$?
  MONITOR_STATE_DIR="$identity_case/state-b" /bin/bash "$MONITOR" status '@same-name' > "$identity_case/live-status.out" 2>&1
  identity_live_rc=$?
  set -e
  identity_ok=0
  if [[ -n "$identity_token_a" && -n "$identity_token_b" && "$identity_token_a" != "$identity_token_b" && "$identity_conflict_ok" -eq 1 && "$identity_stale_rc" -ne 0 && "$identity_live_rc" -eq 0 ]] &&
    [[ "$(sed -n '1p' "$identity_case/state-a/same-name/monitor.pid" 2>/dev/null || true)" == "$identity_pid_b" ]] &&
    [[ "$(sed -n '1p' "$identity_case/state-a/same-name/monitor.instance" 2>/dev/null || true)" == "$identity_token_a" ]] &&
    grep -Fq 'action=not-signaled' "$identity_case/stale-stop.out" &&
    grep -Fq 'state=preserved' "$identity_case/stale-stop.out"; then
    identity_ok=1
  fi
  MONITOR_STATE_DIR="$identity_case/state-b" /bin/bash "$MONITOR" stop '@same-name' > "$identity_case/stop-b.out" 2>&1 || kill "$identity_pid_b" 2>/dev/null || true

  hash_case="$TMP_ROOT/hash-readiness"
  mkdir -p "$hash_case/state" "$hash_case/bin"
  cp "$FIXTURES/fake-failing-event-shasum.sh" "$hash_case/bin/shasum"
  chmod +x "$hash_case/bin/shasum"
  cp "$FIXTURES/addressed-event.md" "$hash_case/collab.md"
  set +e
  PATH="$hash_case/bin:$PATH" START_TIMEOUT_SECONDS=2 MONITOR_STATE_DIR="$hash_case/state" /bin/bash "$MONITOR" start '@skillcreator' "$hash_case/collab.md" > "$hash_case/start.out" 2>&1
  hash_start_rc=$?
  MONITOR_STATE_DIR="$hash_case/state" /bin/bash "$MONITOR" status '@skillcreator' > "$hash_case/status.out" 2>&1
  hash_status_rc=$?
  set -e
  hash_rejected=0
  if [[ "$hash_start_rc" -ne 0 && "$hash_status_rc" -ne 0 ]] && grep -Fq 'START_FAILED' "$hash_case/start.out" && [[ ! -s "$hash_case/state/skillcreator/seen.sha256" ]]; then
    hash_rejected=1
  fi
  if [[ "$hash_start_rc" -eq 0 ]]; then
    MONITOR_STATE_DIR="$hash_case/state" /bin/bash "$MONITOR" stop '@skillcreator' > "$hash_case/stop.out" 2>&1 || true
  fi

  slow_seed_case="$TMP_ROOT/slow-seed-readiness"
  mkdir -p "$slow_seed_case/state" "$slow_seed_case/bin"
  cp "$FIXTURES/fake-slow-shasum.sh" "$slow_seed_case/bin/shasum"
  chmod +x "$slow_seed_case/bin/shasum"
  : > "$slow_seed_case/collab.md"
  index=1
  while [[ "$index" -le 500 ]]; do
    printf '### @agent-%s → @slow-seed — Phase %s done: historical\n\n- verified\n\n@agent-%s\n\n' "$index" "$index" "$index" >> "$slow_seed_case/collab.md"
    index=$((index + 1))
  done
  set +e
  PATH="$slow_seed_case/bin:$PATH" COLLAB_MONITOR_SLOW_SHASUM_SECONDS=0.025 START_TIMEOUT_SECONDS=60 MONITOR_STATE_DIR="$slow_seed_case/state" /bin/bash "$MONITOR" start '@slow-seed' "$slow_seed_case/collab.md" > "$slow_seed_case/start.out" 2>&1
  slow_seed_start_rc=$?
  set -e
  slow_seed_ok=0
  if [[ "$slow_seed_start_rc" -eq 0 ]] && grep -Fq 'STARTED name=@slow-seed' "$slow_seed_case/start.out"; then
    slow_seed_ok=1
    MONITOR_STATE_DIR="$slow_seed_case/state" /bin/bash "$MONITOR" stop '@slow-seed' > "$slow_seed_case/stop.out" 2>&1 || true
  elif [[ -s "$slow_seed_case/state/slow-seed/monitor.pid" ]]; then
    kill "$(sed -n '1p' "$slow_seed_case/state/slow-seed/monitor.pid")" 2>/dev/null || true
  fi

  if [[ "$lifecycle_ok" -eq 1 && "$corrupt_rejected" -eq 1 && "$interrupt_ok" -eq 1 && "$hash_rejected" -eq 1 && "$identity_ok" -eq 1 && "$slow_seed_ok" -eq 1 ]]; then
    pass "10 durable-start-stop GREEN"
  else
    fail "10 durable-start-stop" "readiness, slow seeding, interrupted-start cleanup, hash/state failure, follow consumption, lifecycle, stale PID, or zombie handling failed"
  fi

  case_dir="$TMP_ROOT/name-boundary"
  mkdir -p "$case_dir/state"
  board="$case_dir/collab.md"
  : > "$board"
  run_once "$case_dir/state" "$case_dir/seed.out" '@review' "$board"
  append_fixture "$FIXTURES/prefix-listener-event.md" "$board"
  run_once "$case_dir/state" "$case_dir/scan.out" '@review' "$board"
  if [[ "$(alert_count "$case_dir/scan.out")" == "0" ]]; then
    pass "11 exact-listener-boundary GREEN"
  else
    fail "11 exact-listener-boundary" "@review fired on an event addressed to @review-638"
  fi

  case_dir="$TMP_ROOT/mention-heading"
  mkdir -p "$case_dir/state"
  board="$case_dir/collab.md"
  : > "$board"
  run_once "$case_dir/state" "$case_dir/seed.out" '@skillcreator' "$board"
  append_fixture "$FIXTURES/direct-event-under-mention-heading.md" "$board"
  run_once "$case_dir/state" "$case_dir/scan.out" '@skillcreator' "$board"
  if [[ "$(alert_count "$case_dir/scan.out")" == "1" ]]; then
    pass "12 heading-mention-is-not-authorship GREEN"
  else
    fail "12 heading-mention-is-not-authorship" "a heading that mentioned the listener swallowed a foreign-authored direct event"
  fi

  case_dir="$TMP_ROOT/path-alias"
  mkdir -p "$case_dir/state"
  board="$case_dir/collab.md"
  : > "$board"
  (
    cd "$case_dir"
    MONITOR_STATE_DIR="$case_dir/state" /bin/bash "$MONITOR" run --once '@skillcreator' collab.md > "$case_dir/seed.out" 2>&1
  )
  append_fixture "$FIXTURES/addressed-event.md" "$board"
  run_once "$case_dir/state" "$case_dir/scan.out" '@skillcreator' "$board"
  if [[ "$(alert_count "$case_dir/scan.out")" == "1" ]] && [[ "$(find "$case_dir/state/skillcreator/sizes" -type f -name '*.size' | wc -l | tr -d '[:space:]')" == "1" ]]; then
    pass "13 canonical-path-state GREEN"
  else
    fail "13 canonical-path-state" "relative and absolute spellings created separate state and swallowed a pending event"
  fi

  case_dir="$TMP_ROOT/transient-vanish"
  mkdir -p "$case_dir/state" "$case_dir/watched"
  board="$case_dir/watched/collab.md"
  : > "$board"
  MONITOR_STATE_DIR="$case_dir/state" POLL_SECONDS=0.1 /bin/bash "$MONITOR" start '@skillcreator' "$board" > "$case_dir/start.out" 2>&1
  monitor_pid="$(sed -n '1p' "$case_dir/state/skillcreator/monitor.pid")"
  mv "$case_dir/watched" "$case_dir/watched.away"
  index=0
  while [[ "$index" -lt 10 ]]; do
    sleep 0.1
    index=$((index + 1))
  done
  set +e
  MONITOR_STATE_DIR="$case_dir/state" /bin/bash "$MONITOR" status '@skillcreator' > "$case_dir/status.out" 2>&1
  foreign_status_rc=$?
  set -e
  mv "$case_dir/watched.away" "$case_dir/watched"
  append_fixture "$FIXTURES/addressed-event.md" "$board"
  index=0
  while [[ "$index" -lt 50 ]] && ! grep -q '^NEW-FOR-' "$case_dir/state/skillcreator/monitor.log" 2>/dev/null; do
    sleep 0.1
    index=$((index + 1))
  done
  if [[ "$foreign_status_rc" -eq 0 ]]; then
    MONITOR_STATE_DIR="$case_dir/state" /bin/bash "$MONITOR" stop '@skillcreator' > "$case_dir/stop.out" 2>&1 || true
  else
    kill "$monitor_pid" 2>/dev/null || true
  fi
  vanish_recovered=0
  if [[ "$foreign_status_rc" -eq 0 ]] && grep -q '^NEW-FOR-' "$case_dir/state/skillcreator/monitor.log" && grep -Fq "WATCH-WARN file=$board reason=temporarily-absent action=retry" "$case_dir/state/skillcreator/monitor.log"; then
    vanish_recovered=1
  fi

  case_dir="$TMP_ROOT/transient-read-failure"
  mkdir -p "$case_dir/state" "$case_dir/bin"
  cp "$FIXTURES/fake-failing-wc.sh" "$case_dir/bin/wc"
  chmod +x "$case_dir/bin/wc"
  board="$case_dir/collab.md"
  : > "$board"
  set +e
  PATH="$case_dir/bin:$PATH" COLLAB_MONITOR_WC_FAIL_ONCE_MARKER="$case_dir/wc.failed" MONITOR_STATE_DIR="$case_dir/state" POLL_SECONDS=0.1 /bin/bash "$MONITOR" start '@skillcreator' "$board" > "$case_dir/start.out" 2>&1
  read_start_rc=$?
  set -e
  read_failure_recovered=0
  if [[ "$read_start_rc" -eq 0 ]]; then
    index=0
    while [[ "$index" -lt 50 ]] && ! find "$case_dir/state/skillcreator/sizes" -type f -name '*.size' -print -quit 2>/dev/null | grep -q .; do
      sleep 0.1
      index=$((index + 1))
    done
    append_fixture "$FIXTURES/addressed-event.md" "$board"
    index=0
    while [[ "$index" -lt 50 ]] && ! grep -q '^NEW-FOR-' "$case_dir/state/skillcreator/monitor.log" 2>/dev/null; do
      sleep 0.1
      index=$((index + 1))
    done
    set +e
    MONITOR_STATE_DIR="$case_dir/state" /bin/bash "$MONITOR" status '@skillcreator' > "$case_dir/status.out" 2>&1
    read_status_rc=$?
    set -e
    MONITOR_STATE_DIR="$case_dir/state" /bin/bash "$MONITOR" stop '@skillcreator' > "$case_dir/stop.out" 2>&1 || true
    if [[ "$read_status_rc" -eq 0 ]] && grep -q '^WATCH-WARN .*reason=read-failed action=retry$' "$case_dir/state/skillcreator/monitor.log" && grep -q '^NEW-FOR-' "$case_dir/state/skillcreator/monitor.log"; then
      read_failure_recovered=1
    fi
  fi

  once_case="$TMP_ROOT/transient-read-failure-once"
  mkdir -p "$once_case/state" "$once_case/bin"
  cp "$FIXTURES/fake-failing-wc.sh" "$once_case/bin/wc"
  chmod +x "$once_case/bin/wc"
  : > "$once_case/collab.md"
  set +e
  PATH="$once_case/bin:$PATH" COLLAB_MONITOR_WC_FAIL_ONCE_MARKER="$once_case/wc.failed" MONITOR_STATE_DIR="$once_case/state" /bin/bash "$MONITOR" run --once '@skillcreator' "$once_case/collab.md" > "$once_case/run.out" 2>&1
  once_read_rc=$?
  set -e
  once_failure_reported=0
  if [[ "$once_read_rc" -ne 0 ]] && grep -q '^WATCH-WARN .*reason=read-failed action=retry$' "$once_case/run.out"; then
    once_failure_reported=1
  fi

  if [[ "$vanish_recovered" -eq 1 && "$read_failure_recovered" -eq 1 && "$once_failure_reported" -eq 1 ]]; then
    pass "14 transient-vanish-retry GREEN"
  else
    fail "14 transient-vanish-retry" "a temporarily absent or unreadable watched file killed the monitor or hid the later event"
  fi

  repeated_read_screen_calls="$(grep -c '^read_screen ' "$FIXTURES/supervisor-read-screen-loop.txt" 2>/dev/null || true)"
  watched_read_screen_calls="$(grep -c '^read_screen ' "$FIXTURES/supervisor-watch-once.txt" 2>/dev/null || true)"
  if [[ "$repeated_read_screen_calls" -gt 1 ]] && [[ "$watched_read_screen_calls" -eq 1 ]] &&
    grep -Eq '^skills/golem-powers/codex-workflows/scripts/codex-workflows\.sh watch --run-id [[:alnum:]_.-]+$' "$FIXTURES/supervisor-watch-once.txt" &&
    grep -Fq "MUST NOT poll \`read_screen\` in a loop" "$SKILL_DIR/SKILL.md" &&
    grep -Fq "\`codex-workflows\`" "$SKILL_DIR/SKILL.md" && grep -Fq "\`watch\`" "$SKILL_DIR/SKILL.md"; then
    pass "15 supervisor-watch-not-poll GREEN"
  else
    fail "15 supervisor-watch-not-poll" "repeated read_screen polling was not rejected or codex-workflows watch was not taught"
  fi

  printf 'CANDIDATE_SUMMARY pass=%s fail=%s\n' "$pass_count" "$fail_count"
  [[ "$fail_count" -eq 0 ]]
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
