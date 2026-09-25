#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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

# Gate eval suites (evals/run_suite.py): contract tables for the hook gates.
# GO-5: no CI job ran them, so a contract change drifted silently (#223).
EVAL_SUITES=()
while IFS= read -r -d '' suite; do
  EVAL_SUITES+=("$suite")
done < <(
  find skills/golem-powers -path 'skills/golem-powers/_archive' -prune -o \
    -path '*/evals/run_suite.py' -type f -print0 | sort -z
)

if [[ "${RUN_SKILL_TESTS_LIST_ONLY:-}" == "1" ]]; then
  printf '%s\n' "${PYTEST_SUITES[@]}"
  printf '%s\n' "${EVAL_SUITES[@]}"
  exit 0
fi

if [[ "${#PYTEST_SUITES[@]}" -eq 0 ]]; then
  echo "No Python skill test suites found under skills/golem-powers." >&2
  exit 1
fi

printf 'Running %d golem-powers Python skill test suite(s):\n' "${#PYTEST_SUITES[@]}"
printf '  %s\n' "${PYTEST_SUITES[@]}"

"$PYTHON_BIN" -m pytest "${PYTEST_SUITES[@]}" -q

eval_failures=0
for suite in "${EVAL_SUITES[@]}"; do
  printf '\n== %s\n' "$suite"
  if output="$("$PYTHON_BIN" "$suite" 2>&1)"; then
    printf '%s\n' "$output" | tail -1
  else
    printf '%s\n' "$output"
    eval_failures=$((eval_failures + 1))
  fi
done
if [[ "$eval_failures" -ne 0 ]]; then
  echo "Gate eval suites failing: $eval_failures" >&2
  exit 1
fi
