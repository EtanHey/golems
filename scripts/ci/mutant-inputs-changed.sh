#!/usr/bin/env bash
# Print relevant=true|false: does this PR touch an input of
# `pristine-harness.py mutation-proof` (36 of the Python job's ~54 min)?
# Usage: mutant-inputs-changed.sh <base-sha>   (run from the repo root)
# A failed diff exits non-zero; it never reports false on error.
# Inputs per scripts/ci/pristine-harness.py and
# scripts/tests/fixtures/pristine-harness/semantic-mutants.json.
set -euo pipefail
base="${1:?usage: mutant-inputs-changed.sh <base-sha>}"
paths="$(mktemp)"
trap 'rm -f "$paths"' EXIT
git diff --name-only --no-renames -z "$base"...HEAD > "$paths"
relevant=false
while IFS= read -r -d '' path; do
  case "$path" in
    scripts/ci/pristine-harness.py|scripts/ci/pristine-harness-clock/*|\
    scripts/tests/fixtures/pristine-harness/*|scripts/tests/fixtures/codex-sessions/*|\
    skills/golem-powers/_shared/shell_parse.py|skills/golem-powers/_shared/harness_paths.py|\
    skills/golem-powers/_shared/tests/test_shell_parse.py|skills/golem-powers/_shared/shell_parse_impl/*.py|\
    skills/golem-powers/git-guardian/git_safety.py|skills/golem-powers/git-guardian/hooks/pre_tool_use.py|\
    skills/golem-powers/git-guardian/git_safety_impl/*.py|\
    skills/golem-powers/tmp-block/hooks/tmp-block-pretooluse.py|skills/golem-powers/tmp-block/hooks/tmp_block_impl/*.py|\
    scripts/repogolem/golem-dispatch.zsh|scripts/repogolem/worktree-bootstrap.sh|\
    scripts/ci/mutant-inputs-changed.sh|.github/workflows/golem-powers-skill-tests.yml)
      relevant=true ;;
  esac
done < "$paths"
echo "relevant=$relevant"
