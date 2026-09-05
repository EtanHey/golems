#!/usr/bin/env bats
#
# W27 — the 2026-09-05 mass-kill shape, driven through git-guardian's real entry
# point (`dangerous_shell_reason`) rather than an in-test reimplementation.
# Incident: docs.local/incidents/2026-09-05-mass-claude-kill.md (fleet orchestrator repo)

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GUARD_LIB="$REPO_ROOT/skills/golem-powers/git-guardian"
}

# Prints the guard's reason for "$1", or nothing when the command is allowed.
guard_reason() {
  GIT_GUARDIAN_LIB="$GUARD_LIB" python3 -c '
import os, sys
sys.path.insert(0, os.environ["GIT_GUARDIAN_LIB"])
from git_safety import dangerous_shell_reason
print(dangerous_shell_reason(sys.argv[1]) or "")
' "$1"
}

@test "the literal 2026-09-05 command is denied" {
  run guard_reason "pkill -f 'inbox.jsonl' -P 1"
  [ "$status" -eq 0 ]
  [[ "$output" == *"options must precede the pattern"* ]]
  [[ "$output" == *"pgrep -f 'pattern'"* ]]
}

@test "the full original line, redirections and trailing kill included, is denied" {
  run guard_reason "pkill -f 'inbox.jsonl' -P 1 2>/dev/null; kill 40955 2>/dev/null && echo done"
  [ "$status" -eq 0 ]
  [[ "$output" == *"options must precede the pattern"* ]]
}

@test "a -f pattern of 3 chars or fewer after folding is denied" {
  for command in \
    "pkill -f '1'" \
    "pkill -f 'ab'" \
    "pkill -f 'abc'" \
    "pkill -f 501" \
    "killall -m -f '1'"
  do
    run guard_reason "$command"
    [ "$status" -eq 0 ]
    [[ "$output" == *"matches nearly every process"* ]] || {
      echo "not denied: $command -- $output" >&2
      return 1
    }
  done
}

@test "a -f pattern carrying a folded alternation is denied" {
  for command in \
    "pkill -f 'inbox.jsonl|-P|1'" \
    "pkill -f 'inbox.jsonl|1'" \
    "killall -f 'bar|-m'" \
    "pkill -f inbox.jsonl extra-operand"
  do
    run guard_reason "$command"
    [ "$status" -eq 0 ]
    [[ "$output" == *"matches nearly every process"* ]] || {
      echo "not denied: $command -- $output" >&2
      return 1
    }
  done
}

@test "the correct forms stay allowed" {
  for command in \
    "pkill -f -P 1 'inbox.jsonl'" \
    "pgrep -f 'inbox.jsonl' -P 1" \
    "kill 40955" \
    "killall Dock" \
    "pkill -HUP -f '/opt/svc/daemon.py'" \
    "pkill -- -weird-pattern" \
    "pkill -f 'foo|bar'"
  do
    run guard_reason "$command"
    [ "$status" -eq 0 ]
    [ -z "$output" ] || {
      echo "false block: $command -- $output" >&2
      return 1
    }
  done
}
