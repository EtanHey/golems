#!/usr/bin/env bash
# Queue the touched CI suites without consuming their pre-push ref input.
set -euo pipefail
if ! command -v node >/dev/null; then
  echo 'prepush-touched: node not installed here; touched suites will run in CI' >&2
  exit 0
fi
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
HS="$HOME/Gits/golems/.worktrees/hooks-live/scripts/hooks/heavy-suite.py"
if [[ -f "$HS" ]] && command -v python3 >/dev/null; then
  exec env GOLEMS_HEAVY_PRE_PUSH=0 python3 "$HS" -- node scripts/ci/prepush-touched.mjs "$@"
fi
echo 'heavy-suite: helper missing; running touched suites unqueued' >&2
exec node scripts/ci/prepush-touched.mjs "$@"
