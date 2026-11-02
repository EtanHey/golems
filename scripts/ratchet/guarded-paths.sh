#!/usr/bin/env bash
# Does <base>...<head> touch a path whose Mac rows CI must require?
#   exit 0 = guarded (require the Mac table), 1 = not guarded, 2 = cannot tell (FAIL, never skip).
# The guarded set and the decision live in guarded-set.mjs: static prefixes plus every hook-loaded dir in the manifest
# at either ref, matched as literal prefixes over the full diff (FV3 NoFalseFresh: a hand-written list missed 13 of
# 17 hook-loaded dirs; Codex r1: no generated regex, and an unreadable manifest is "cannot tell"). It reads the
# whole diff before deciding, so a large path list can't be cut short (#689 R1 B1).
set -uo pipefail
base="${1:?base sha}" head="${2:?head sha}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$here/guarded-set.mjs" --check "$base" "$head"
rc=$?
# Internal 3 = a completed "not guarded" verdict. Node's own failures (exit 1 on a syntax error or a missing import)
# must never read as "not guarded" (Codex r2, B3).
case "$rc" in
  0) exit 0 ;;
  3) exit 1 ;;
  *) echo "guarded-paths: cannot decide $base...$head (exit $rc): cannot tell, FAIL" >&2; exit 2 ;;
esac
