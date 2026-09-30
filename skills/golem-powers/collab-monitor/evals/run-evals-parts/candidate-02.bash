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

  if /bin/bash "$SCRIPT_DIR/detached-launch.sh" > "$TMP_ROOT/detached-launch.out" 2>&1; then
    pass "16 detached-launch GREEN"
  else
    fail "16 detached-launch" "monitor did not survive its launcher shell with an independent process group"
  fi

  case_dir="$TMP_ROOT/bounded-filter"
  mkdir -p "$case_dir/state"
  board="$case_dir/collab.md"
  : > "$board"
  run_once "$case_dir/state" "$case_dir/seed.out" '@leadX' "$board"
  append_fixture "$FIXTURES/ten-posts-three-fires.md" "$board"
  run_once "$case_dir/state" "$case_dir/scan.out" '@leadX' "$board"
  sed -n 's/^NEW-FOR-@leadX .* :: //p' "$case_dir/scan.out" > "$case_dir/events.out"
  printf '%s\n' \
    'Before I dispatch, @leadX can you confirm the lane-3 brief path?' \
    '### orcClaude → leadX — routed ask (2026-09-25 09:20)' \
    '> leadX-w1 PR #140 open, evals green. DONE' > "$case_dir/expected.out"
  : > "$case_dir/alias-collab.md"
  run_once "$case_dir/alias-state" "$case_dir/alias-seed.out" '@leadY' "$case_dir/alias-collab.md"
  printf '%s\n' '### orcClaude → seat-1234 — routed to the seat id' 'body' >> "$case_dir/alias-collab.md"
  run_once "$case_dir/alias-state" "$case_dir/no-alias.out" '@leadY' "$case_dir/alias-collab.md"
  MONITOR_STATE_DIR="$case_dir/alias-state2" /bin/bash "$MONITOR" run --once --alias @seat-1234 '@leadY' "$case_dir/alias-collab.md" > "$case_dir/alias-seed2.out" 2>&1
  printf '%s\n' '### orcClaude -> seat-1234 — second routed ask' 'body' >> "$case_dir/alias-collab.md"
  MONITOR_STATE_DIR="$case_dir/alias-state2" /bin/bash "$MONITOR" run --once --alias @seat-1234 '@leadY' "$case_dir/alias-collab.md" > "$case_dir/alias.out" 2>&1
  if [[ "$(alert_count "$case_dir/scan.out")" == "3" ]] && cmp -s "$case_dir/expected.out" "$case_dir/events.out" &&
    [[ "$(self_post_count "$case_dir/scan.out")" == "0" ]] &&
    [[ "$(alert_count "$case_dir/no-alias.out")" == "0" ]] &&
    [[ "$(alert_count "$case_dir/alias.out")" == "1" ]] && grep -Fq 'second routed ask' "$case_dir/alias.out"; then
    pass "17 bounded-filter GREEN"
  else
    fail "17 bounded-filter" "ten posts did not yield exactly the three addressed events in order, or --alias did not route a seat-id recipient"
  fi

  case_dir="$TMP_ROOT/arrowed-authors"
  mkdir -p "$case_dir/state"
  board="$case_dir/collab.md"
  : > "$board"
  run_once "$case_dir/state" "$case_dir/seed.out" '@leadX' "$board"
  append_fixture "$FIXTURES/arrowed-authors.md" "$board"
  run_once "$case_dir/state" "$case_dir/scan.out" '@leadX' "$board"
  sed -n 's/^NEW-FOR-@leadX .* :: //p' "$case_dir/scan.out" > "$case_dir/events.out"
  printf '%s\n' \
    'DONE: shipped the parser.' \
    'Report at docs.local/report.md DONE_LEADX_W2' \
    'Sign-off with trailing punctuation: thanks @leadX.' > "$case_dir/expected.out"
  if cmp -s "$case_dir/expected.out" "$case_dir/events.out"; then
    pass "18 arrowed-authors-and-tokens GREEN"
  else
    fail "18 arrowed-authors-and-tokens" "an arrowed own post fired, an arrowed worker DONE, a DONE_<SEAT> token, or a sentence-final @name was silent, or @name-w2 fired for the lead"
  fi

  case_dir="$TMP_ROOT/orchestrator-parity"
  mkdir -p "$case_dir/state"
  board="$case_dir/collab.md"
  printf '%s\n' '# Fixture collab' '### leadY (2026-09-25 09:00)' 'old history mentioning @leadX that is BEFORE the watermark' > "$board"
  run_once "$case_dir/state" "$case_dir/seed.out" '@leadX' "$board"
  append_fixture "$FIXTURES/orchestrator-fourteen-posts.md" "$board"
  run_once "$case_dir/state" "$case_dir/scan.out" '@leadX' "$board"
  sed -n 's/^NEW-FOR-@leadX .* :: //p' "$case_dir/scan.out" > "$case_dir/events.out"
  printf '%s\n' \
    'F1 body mention: @leadX please review the parser diff.' \
    '### orcClaude → leadX (2026-09-25 10:02)' \
    'F3 Report at docs.local/report.md DONE_LEADX_W1' \
    'F4 sign-off with trailing punctuation: thanks @leadX.' \
    '### orcClaude → orc, leadX (2026-09-25 10:12)' > "$case_dir/expected.out"
  if cmp -s "$case_dir/expected.out" "$case_dir/events.out"; then
    pass "19 orchestrator-one-liner-parity GREEN"
  else
    fail "19 orchestrator-one-liner-parity" "the orchestrator TEMPLATE fixture did not yield exactly its one-liner's five events in order"
  fi

  printf 'CANDIDATE_SUMMARY pass=%s fail=%s\n' "$pass_count" "$fail_count"
  [[ "$fail_count" -eq 0 ]]