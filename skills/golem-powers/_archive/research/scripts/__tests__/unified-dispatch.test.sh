#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SCRIPT="$ROOT_DIR/scripts/unified-dispatch.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

run_fixture_case() {
  local tmp_dir fixture output
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' RETURN

  fixture="$tmp_dir/fixture.json"
  output="$tmp_dir/output.json"
  cat >"$fixture" <<'EOF'
{
  "folders": {
    "project": "proj-1",
    "context": "ctx-1",
    "prompts": "prm-1",
    "results": "res-1"
  },
  "prompt_number": "82",
  "operations": []
}
EOF

  RESEARCH_UNIFIED_FIXTURE="$fixture" \
    "$SCRIPT" --project brainlayer --topic "Compare BrainLayer vs Mem0 for long-term memory" >"$output"

  python3 - "$fixture" "$output" <<'PY'
import json, pathlib, sys
fixture = json.loads(pathlib.Path(sys.argv[1]).read_text())
summary = json.loads(pathlib.Path(sys.argv[2]).read_text())
assert summary["project"] == "brainlayer"
assert summary["folders"]["context"] == "ctx-1"
assert summary["claude_web"]["folder_id"] == "ctx-1"
assert summary["gemini"]["folder_id"] == "ctx-1"
assert summary["result_paths"]["claude_web"] == "R82-claude-web-result.md"
assert summary["result_paths"]["gemini"] == "R82-gemini-result.md"
ops = fixture["operations"]
assert any(op["op"] == "dispatch_claude_web" and op["folder_id"] == "ctx-1" for op in ops)
assert any(op["op"] == "dispatch_gemini" and op["folder_id"] == "ctx-1" for op in ops)
PY

  trap - RETURN
  rm -rf "$tmp_dir"
}

run_fixture_case

echo "unified-dispatch.test.sh PASS"
