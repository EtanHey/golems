#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"

cd "$ROOT"

PYTEST_SUITES=()
while IFS= read -r -d '' suite; do
  if find "$suite" -maxdepth 1 -type f -name 'test*.py' -print -quit | grep -q .; then
    PYTEST_SUITES+=("$suite")
  fi
done < <(
  # __tests__ dirs hold pytest suites too (weave, cursor-workflows,
  # convention-audit); ones with no test*.py are dropped by the check above.
  # _archive/ is retired code and is not collected.
  find skills/golem-powers -path 'skills/golem-powers/_archive' -prune -o -type d \
    \( -path '*/tests' -o -path '*/hooks/tests' -o -path '*/checks/tests' -o -name '__tests__' \) \
    -print0 \
    | sort -z
  # The repo's own Python tests, including this runner's.
  printf '%s\0' scripts/tests
)

if [[ "${RUN_SKILL_TESTS_LIST_ONLY:-}" == "1" ]]; then
  printf '%s\n' "${PYTEST_SUITES[@]}"
  exit 0
fi

if [[ "${#PYTEST_SUITES[@]}" -eq 0 ]]; then
  echo "No Python skill test suites found under skills/golem-powers." >&2
  exit 1
fi

printf 'Running %d golem-powers Python skill test suite(s):\n' "${#PYTEST_SUITES[@]}"
printf '  %s\n' "${PYTEST_SUITES[@]}"

"$PYTHON_BIN" -m pytest "${PYTEST_SUITES[@]}" -q
