#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SCRIPT="$ROOT_DIR/scripts/drive-sync.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

make_fixture() {
  local path="$1"
  cat >"$path" <<'EOF'
{
  "next_notebook_id": 11,
  "next_task_id": 21,
  "drive_context_files": [
    {"id": "ctx-1", "name": "00-code-map.md", "mime": "text/markdown"},
    {"id": "ctx-2", "name": "01-search.py.txt", "mime": "text/plain"}
  ],
  "prompts": [
    {"id": "prompt-82", "name": "R82-memory.md", "content": "# R82\nCompare BrainLayer vs Mem0"}
  ],
  "results": [],
  "notebooks": {},
  "operations": []
}
EOF
}

run_new_project_case() {
  local tmp_dir fixture state_file output result_file
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' RETURN

  fixture="$tmp_dir/fixture.json"
  state_file="$tmp_dir/research-state.json"
  output="$tmp_dir/output.json"
  make_fixture "$fixture"

  GEMINI_DRIVE_SYNC_FIXTURE="$fixture" \
    GEMINI_RESEARCH_STATE_FILE="$state_file" \
    "$SCRIPT" --project brainlayer --prompt R82-memory.md >"$output"

  python3 - "$output" "$fixture" "$state_file" <<'PY'
import json, pathlib, sys
summary = json.loads(pathlib.Path(sys.argv[1]).read_text())
fixture = json.loads(pathlib.Path(sys.argv[2]).read_text())
state = json.loads(pathlib.Path(sys.argv[3]).read_text())

assert summary["project"] == "brainlayer"
assert summary["notebook_id"] == "nb-11"
assert summary["prompt"] == "R82-memory.md"
assert summary["result"]["name"] == "R82-gemini-result.md"
assert state["brainlayer"]["notebook_id"] == "nb-11"
ops = fixture["operations"]
assert ops[0]["op"] == "verify-account"
assert any(op["op"] == "notebook_create" for op in ops)
assert any(op["op"] == "source_add_drive" and op["document_id"] == "ctx-1" for op in ops)
assert any(op["op"] == "source_add_drive" and op["document_id"] == "ctx-2" for op in ops)
assert any(op["op"] == "research_start" and op["source"] == "drive" for op in ops)
assert any(op["op"] == "research_import" for op in ops)
assert any(op["op"] == "write_result" and op["name"] == "R82-gemini-result.md" for op in ops)
PY

  trap - RETURN
  rm -rf "$tmp_dir"
}

run_existing_project_case() {
  local tmp_dir fixture state_file output
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' RETURN

  fixture="$tmp_dir/fixture.json"
  state_file="$tmp_dir/research-state.json"
  output="$tmp_dir/output.json"
  make_fixture "$fixture"
  cat >"$state_file" <<'EOF'
{"brainlayer":{"notebook_id":"nb-existing"}}
EOF

  GEMINI_DRIVE_SYNC_FIXTURE="$fixture" \
    GEMINI_RESEARCH_STATE_FILE="$state_file" \
    "$SCRIPT" --project brainlayer --prompt R82-memory.md >"$output"

  python3 - "$fixture" <<'PY'
import json, pathlib, sys
fixture = json.loads(pathlib.Path(sys.argv[1]).read_text())
ops = fixture["operations"]
assert not any(op["op"] == "notebook_create" for op in ops)
assert any(op["op"] == "research_start" and op["notebook_id"] == "nb-existing" for op in ops)
PY

  trap - RETURN
  rm -rf "$tmp_dir"
}

run_account_failure_case() {
  local tmp_dir fixture state_file stderr_file
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' RETURN

  fixture="$tmp_dir/fixture.json"
  state_file="$tmp_dir/research-state.json"
  stderr_file="$tmp_dir/stderr"
  make_fixture "$fixture"

  set +e
  GEMINI_DRIVE_SYNC_FIXTURE="$fixture" \
    GEMINI_DRIVE_SYNC_FAIL_VERIFY=1 \
    GEMINI_RESEARCH_STATE_FILE="$state_file" \
    "$SCRIPT" --project brainlayer --prompt R82-memory.md >/dev/null 2>"$stderr_file"
  exit_code=$?
  set -e

  [[ $exit_code -ne 0 ]] || fail "expected account verification failure"
  grep -q "account verification failed" "$stderr_file" || fail "expected explicit account failure"

  trap - RETURN
  rm -rf "$tmp_dir"
}

run_new_project_case
run_existing_project_case
run_account_failure_case

echo "drive-sync.test.sh PASS"
