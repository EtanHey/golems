#!/usr/bin/env bash
# Live behaviour proof for the INSTALLED tmp-block guard. $1 = installed hook.
# Run by _shared/install-wired-hook.sh; a non-zero exit fails the install,
# because an installed-but-dead guard is worse than the symlink it replaced.
set -uo pipefail
HOOK="${1:?usage: probes.sh <installed-hook-path>}"
REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"

fail=0
probe() { # probe <label> <expected-exit> <payload>
  local label="$1" want="$2" payload="$3" got
  printf '%s' "$payload" | python3 "$HOOK" >/dev/null 2>&1
  got=$?
  if [[ "$got" == "$want" ]]; then
    echo "  PASS  $label (exit=$got)"
  else
    echo "  FAIL  $label (exit=$got, expected $want)"
    fail=1
  fi
}

probe "/tmp write DENIES" 2 \
  '{"tool_name":"Write","tool_input":{"file_path":"/tmp/foo.txt","content":"x"},"session_id":"verify"}'
# shellcheck disable=SC2016 # The payload must contain literal command substitution.
probe "\$(mktemp) write DENIES" 2 \
  '{"tool_name":"Bash","tool_input":{"command":"echo x > $(mktemp)"},"session_id":"verify"}'
probe "harness scratchpad ALLOWS" 0 \
  '{"tool_name":"Write","tool_input":{"file_path":"/private/tmp/claude-501/-Users-example-Gits-golems/00000000-0000-0000-0000-000000000000/scratchpad/probe.md","content":"x"},"session_id":"verify"}'
probe "repo write ALLOWS" 0 \
  "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$REPO_ROOT/probe.md\",\"content\":\"x\"},\"session_id\":\"verify\"}"
probe "off-convention worktree DENIES" 2 \
  '{"tool_name":"Bash","tool_input":{"command":"git worktree add /workspace/golems.wt/probe -b probe"},"session_id":"verify"}'
probe ".worktrees/ worktree ALLOWS" 0 \
  '{"tool_name":"Bash","tool_input":{"command":"git worktree add /workspace/golems/.worktrees/probe -b probe"},"session_id":"verify"}'
probe "Cursor Shell into /tmp DENIES" 2 \
  '{"tool_name":"Shell","tool_input":{"command":"printf x > /tmp/probe.txt","cwd":"","timeout":30000},"session_id":"verify"}'

exit $fail
