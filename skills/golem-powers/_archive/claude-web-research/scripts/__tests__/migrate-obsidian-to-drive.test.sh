#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SCRIPT="$ROOT_DIR/scripts/migrate-obsidian-to-drive.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

make_source_tree() {
  local root="$1"
  local batch_dir="$root/batch-cmux"

  mkdir -p "$batch_dir/context"
  cat >"$batch_dir/project-description.md" <<'EOF'
cmux project description
EOF
  cat >"$batch_dir/project-instructions.md" <<'EOF'
cmux project instructions
EOF
  cat >"$batch_dir/R84-vector-db-options.md" <<'EOF'
# R84
prompt content
EOF
  cat >"$batch_dir/R84-claude-web-result.md" <<'EOF'
result content
EOF
  cat >"$batch_dir/context/00-code-map.md" <<'EOF'
context content
EOF
}

run_dry_run_case() {
  local tmp_dir stdout_file drive_root
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' RETURN

  make_source_tree "$tmp_dir/source"
  stdout_file="$tmp_dir/stdout.json"
  drive_root="$tmp_dir/drive"

  CLAUDE_WEB_OBSIDIAN_ROOT="$tmp_dir/source" \
    CLAUDE_WEB_DRIVE_MIRROR_DIR="$drive_root" \
    "$SCRIPT" batch-cmux --dry-run >"$stdout_file"

  python3 - "$stdout_file" "$drive_root" <<'PY'
import json, pathlib, sys
summary = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert summary["dry_run"] is True
assert summary["batches"][0]["project"] == "cmux"
assert summary["batches"][0]["actions"]["planned"] == 5
assert not pathlib.Path(sys.argv[2]).exists()
PY

  trap - RETURN
  rm -rf "$tmp_dir"
}

run_real_migration_case() {
  local tmp_dir stdout_file drive_root batch_dir deprecated_file
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' RETURN

  make_source_tree "$tmp_dir/source"
  stdout_file="$tmp_dir/stdout.json"
  drive_root="$tmp_dir/drive"
  batch_dir="$tmp_dir/source/batch-cmux"
  deprecated_file="$batch_dir/DEPRECATED.md"

  CLAUDE_WEB_OBSIDIAN_ROOT="$tmp_dir/source" \
    CLAUDE_WEB_DRIVE_MIRROR_DIR="$drive_root" \
    "$SCRIPT" batch-cmux >"$stdout_file"

  python3 - "$stdout_file" "$drive_root" "$deprecated_file" <<'PY'
import json, pathlib, sys
summary = json.loads(pathlib.Path(sys.argv[1]).read_text())
drive_root = pathlib.Path(sys.argv[2])
deprecated = pathlib.Path(sys.argv[3])
project_root = drive_root / "Research" / "cmux"
assert summary["dry_run"] is False
assert summary["batches"][0]["actions"]["uploaded"] == 5
assert summary["batches"][0]["actions"]["skipped"] == 0
assert (project_root / "description.md").read_text().strip() == "cmux project description"
assert (project_root / "instructions.md").read_text().strip() == "cmux project instructions"
assert (project_root / "prompts" / "R84-vector-db-options.md").read_text().strip() == "# R84\nprompt content"
assert (project_root / "results" / "R84-claude-web-result.md").read_text().strip() == "result content"
assert (project_root / "context" / "00-code-map.md").read_text().strip() == "context content"
assert "Brain Drive/Research/cmux/" in deprecated.read_text()
PY

  CLAUDE_WEB_OBSIDIAN_ROOT="$tmp_dir/source" \
    CLAUDE_WEB_DRIVE_MIRROR_DIR="$drive_root" \
    "$SCRIPT" batch-cmux >"$stdout_file"

  python3 - "$stdout_file" <<'PY'
import json, pathlib, sys
summary = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert summary["batches"][0]["actions"]["uploaded"] == 0
assert summary["batches"][0]["actions"]["skipped"] == 5
PY

  trap - RETURN
  rm -rf "$tmp_dir"
}

run_dry_run_case
run_real_migration_case

echo "migrate-obsidian-to-drive.test.sh PASS"
