#!/usr/bin/env bash
# Does <base>...<head> touch a path whose Mac rows CI must require?
#   exit 0 = guarded (require the Mac table), 1 = not guarded, 2 = cannot tell (FAIL, never skip).
# The diff is captured first and checked: a pipe into an early-exiting `grep -q` SIGPIPEs git on a
# large path list, and under pipefail that read as "not guarded" (#689 R1 B1).
set -uo pipefail
base="${1:?base sha}" head="${2:?head sha}"
guarded='^(scripts/hooks/|skills/golem-powers/(human-confirm-gate|git-guardian|tmp-block)/|scripts/repogolem/|scripts/ratchet/)'
if ! changed="$(git diff --name-only "$base...$head")"; then
  echo "guarded-paths: git diff $base...$head failed: cannot tell, FAIL" >&2
  exit 2
fi
if grep -Eq "$guarded" <<<"$changed"; then
  echo "guarded path touched: Mac rows required"
  exit 0
fi
echo "no guarded path touched: Mac rows not required"
exit 1
