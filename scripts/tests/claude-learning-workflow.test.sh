#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
repo_root=$(cd "$script_dir/../.." && pwd -P)
workflow=${WORKFLOW_UNDER_TEST:-"$repo_root/.github/workflows/claude-learning.yml"}
append_script=${APPEND_SCRIPT_UNDER_TEST:-"$repo_root/scripts/append-claude-learning.sh"}
scratch=$(mktemp -d "${TMPDIR:-/tmp}/claude-learning-test.XXXXXX")

cleanup() {
  case "$scratch" in
    "${TMPDIR:-/tmp}"/claude-learning-test.*) rm -rf -- "$scratch" ;;
    *) printf 'REFUSING unsafe cleanup path: %s\n' "$scratch" >&2 ;;
  esac
}
trap cleanup EXIT

python3 - "$workflow" "$append_script" <<'PY'
import pathlib
import re
import sys
import textwrap

workflow = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
append_script = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")

trigger_block = workflow.split("on:\n", 1)[1].split("\n\npermissions:", 1)[0]
assert textwrap.dedent(trigger_block).strip() == "issue_comment:\n  types: [created]", (
    "workflow trigger set must contain only issue_comment.created"
)

gate_match = re.search(r"    if: >-\n(.*?)    runs-on:", workflow, re.DOTALL)
assert gate_match, "extract-learning job gate is missing"
actual_gate = " ".join(line.strip() for line in gate_match.group(1).splitlines())
expected_gate = " ".join(
    """
    github.event.issue.pull_request &&
    (
      (github.event.comment.user.login == 'coderabbitai' &&
       (contains(github.event.comment.body, 'HIGH') ||
        contains(github.event.comment.body, 'bug') ||
        contains(github.event.comment.body, 'Bug') ||
        contains(github.event.comment.body, 'security') ||
        contains(github.event.comment.body, 'Security')))
      ||
      (github.event.comment.user.login == 'EtanHey' &&
       contains(github.event.comment.body, '@claude'))
    )
    """.split()
)
assert actual_gate == expected_gate, "extract-learning job gate differs from the complete allowlisted expression"

assert not re.search(r"\beval\b", append_script), "append script must never evaluate learning content"

assert "persist-credentials: false" in workflow, "checkout credentials remain persisted"
assert "core.setOutput('source', source);" in workflow, "source output is still unset"

lines = workflow.splitlines()
for index, line in enumerate(lines):
    match = re.match(r"^(\s*)run:\s*(.*)$", line)
    if not match:
        continue
    indent = len(match.group(1))
    body = [match.group(2)]
    for following in lines[index + 1 :]:
        if following.strip() and len(following) - len(following.lstrip()) <= indent:
            break
        body.append(following)
    run_body = "\n".join(body)
    assert "${{" not in run_body, f"Actions expression remains inside run body at line {index + 1}"
    assert not re.search(r"\beval\b", run_body), f"eval remains inside run body at line {index + 1}"
PY

target="$scratch/CLAUDE.md"
marker="$scratch/injected"
subshell_marker="$scratch/subshell-injected"
backtick_marker="$scratch/backtick-injected"
printf '# Fixture\n' > "$target"
payload=$(printf 'safe first line\nENTRY\ntouch %s\n$(touch %s)\n`touch %s`\nsafe last line' "$marker" "$subshell_marker" "$backtick_marker")

TARGET_FILE="$target" LEARNING_ENTRY="$payload" bash "$append_script"

[[ ! -e $marker ]] || {
  printf 'payload command executed: %s\n' "$marker" >&2
  exit 1
}
[[ ! -e $subshell_marker ]] || {
  printf 'subshell payload executed: %s\n' "$subshell_marker" >&2
  exit 1
}
[[ ! -e $backtick_marker ]] || {
  printf 'backtick payload executed: %s\n' "$backtick_marker" >&2
  exit 1
}
grep -Fqx 'ENTRY' "$target"
grep -Fqx "touch $marker" "$target"
grep -Fqx 'safe last line' "$target"

printf 'claude-learning workflow regression: PASS\n'
