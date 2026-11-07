#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SCRIPT="$ROOT_DIR/verify-account.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" != *"$needle"* ]]; then
    fail "expected output to contain: $needle"
  fi
}

make_mock() {
  local path="$1"
  local stdout_text="$2"
  local stderr_text="${3:-}"
  local exit_code="${4:-0}"

  cat >"$path" <<EOF
#!/usr/bin/env bash
if [[ -n "$stderr_text" ]]; then
  printf '%s\n' "$stderr_text" >&2
fi
printf '%s\n' '$stdout_text'
exit $exit_code
EOF
  chmod +x "$path"
}

run_case() {
  local tmp_dir
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' RETURN

  local drive_cmd="$tmp_dir/drive.sh"
  local notebook_cmd="$tmp_dir/notebook.sh"

  make_mock "$drive_cmd" '{"user":{"emailAddress":"research-account@example.com"}}'
  make_mock "$notebook_cmd" '{"email":"research-account@example.com"}'

  local stdout_file="$tmp_dir/stdout"
  local stderr_file="$tmp_dir/stderr"

  RESEARCH_VERIFY_DRIVE_CMD="$drive_cmd" \
    RESEARCH_VERIFY_NOTEBOOKLM_CMD="$notebook_cmd" \
    bash "$SCRIPT" --expect research-account@example.com >"$stdout_file" 2>"$stderr_file"

  python3 - "$stdout_file" <<'PY'
import json, pathlib, sys
data = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert data["drive_account"] == "research-account@example.com"
assert data["notebooklm_account"] == "research-account@example.com"
assert data["expected"] == "research-account@example.com"
assert data["match"] is True
assert data["callSucceeded"] is True
assert data["drive_only"] is False
PY

  local stderr_text
  stderr_text=$(cat "$stderr_file")
  [[ -z "$stderr_text" ]] || fail "expected no stderr on success, got: $stderr_text"

  trap - RETURN
  rm -rf "$tmp_dir"
}

run_drive_only_case() {
  local tmp_dir
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' RETURN

  local drive_cmd="$tmp_dir/drive.sh"
  local notebook_cmd="$tmp_dir/notebook.sh"

  make_mock "$drive_cmd" '{"user":{"emailAddress":"research-account@example.com"}}'
  make_mock "$notebook_cmd" "" "NotebookLM must not be queried in Drive-only mode" 99

  local stdout_file="$tmp_dir/stdout"
  local stderr_file="$tmp_dir/stderr"

  RESEARCH_VERIFY_DRIVE_CMD="$drive_cmd" \
    RESEARCH_VERIFY_NOTEBOOKLM_CMD="$notebook_cmd" \
    bash "$SCRIPT" --expect research-account@example.com --drive-only >"$stdout_file" 2>"$stderr_file"

  python3 - "$stdout_file" <<'PY'
import json, pathlib, sys
data = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert data["drive_account"] == "research-account@example.com"
assert data["notebooklm_account"] is None
assert data["expected"] == "research-account@example.com"
assert data["match"] is True
assert data["callSucceeded"] is True
assert data["drive_only"] is True
PY

  local stderr_text
  stderr_text=$(cat "$stderr_file")
  [[ -z "$stderr_text" ]] || fail "expected no stderr on Drive-only success, got: $stderr_text"

  trap - RETURN
  rm -rf "$tmp_dir"
}

run_mismatch_case() {
  local tmp_dir
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' RETURN

  local drive_cmd="$tmp_dir/drive.sh"
  local notebook_cmd="$tmp_dir/notebook.sh"
  make_mock "$drive_cmd" '{"user":{"emailAddress":"maintainer@example.com"}}'
  make_mock "$notebook_cmd" '{"email":"research-account@example.com"}'

  local stdout_file="$tmp_dir/stdout"
  local stderr_file="$tmp_dir/stderr"

  set +e
  RESEARCH_VERIFY_DRIVE_CMD="$drive_cmd" \
    RESEARCH_VERIFY_NOTEBOOKLM_CMD="$notebook_cmd" \
    bash "$SCRIPT" --expect research-account@example.com >"$stdout_file" 2>"$stderr_file"
  local exit_code=$?
  set -e

  [[ $exit_code -eq 1 ]] || fail "expected mismatch exit 1, got $exit_code"

  python3 - "$stdout_file" <<'PY'
import json, pathlib, sys
data = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert data["drive_account"] == "maintainer@example.com"
assert data["notebooklm_account"] == "research-account@example.com"
assert data["match"] is False
PY

  local stderr_text
  stderr_text=$(cat "$stderr_file")
  assert_contains "$stderr_text" "Run: nlm login switch <profile> && mcp__google-drive__refresh_auth"

  trap - RETURN
  rm -rf "$tmp_dir"
}

run_timeout_case() {
  local tmp_dir
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' RETURN

  local drive_cmd="$tmp_dir/drive.sh"
  local notebook_cmd="$tmp_dir/notebook.sh"
  make_mock "$drive_cmd" "" "drive timeout" 124
  make_mock "$notebook_cmd" '{"email":"research-account@example.com"}'

  local stdout_file="$tmp_dir/stdout"
  local stderr_file="$tmp_dir/stderr"

  set +e
  RESEARCH_VERIFY_DRIVE_CMD="$drive_cmd" \
    RESEARCH_VERIFY_NOTEBOOKLM_CMD="$notebook_cmd" \
    bash "$SCRIPT" --expect research-account@example.com >"$stdout_file" 2>"$stderr_file"
  local exit_code=$?
  set -e

  [[ $exit_code -ne 0 ]] || fail "expected timeout to fail"

  local stderr_text
  stderr_text=$(cat "$stderr_file")
  assert_contains "$stderr_text" "drive timeout"

  trap - RETURN
  rm -rf "$tmp_dir"
}

# Without --expect the account resolves from RESEARCH_ACCOUNT, then the
# RESEARCH_ACCOUNT= line in $HOME/.config/research-lifecycle/research.env.
# HOME is a throwaway fixture inside the worktree, never the real one.
run_account_resolution_case() {
  local tmp_dir
  tmp_dir=$(mktemp -d "$ROOT_DIR/__tests__/.home.XXXXXX")
  trap 'rm -rf "$tmp_dir"' RETURN EXIT

  local drive_cmd="$tmp_dir/drive.sh"
  local config_dir="$tmp_dir/home/.config/research-lifecycle"
  make_mock "$drive_cmd" '{"user":{"emailAddress":"research-account@example.com"}}'
  mkdir -p "$tmp_dir/home"

  local stdout_text stderr_file="$tmp_dir/stderr" exit_code

  # Neither env nor config: fail with a message naming the config file.
  set +e
  stdout_text=$(env -u RESEARCH_ACCOUNT HOME="$tmp_dir/home" RESEARCH_VERIFY_DRIVE_CMD="$drive_cmd" \
    bash "$SCRIPT" --drive-only 2>"$stderr_file")
  exit_code=$?
  set -e
  [[ $exit_code -eq 2 ]] || fail "expected unconfigured exit 2, got $exit_code"
  [[ -z "$stdout_text" ]] || fail "expected no JSON when unconfigured, got: $stdout_text"
  assert_contains "$(cat "$stderr_file")" ".config/research-lifecycle/research.env"
  [[ "$(cat "$stderr_file")" != *"research-account@example.com"* ]] || fail "unconfigured run fell back to the placeholder"

  # Config file only.
  mkdir -p "$config_dir"
  printf '# research account\nRESEARCH_ACCOUNT="research-account@example.com"\n' >"$config_dir/research.env"
  stdout_text=$(env -u RESEARCH_ACCOUNT HOME="$tmp_dir/home" RESEARCH_VERIFY_DRIVE_CMD="$drive_cmd" \
    bash "$SCRIPT" --drive-only)
  python3 -c 'import json,sys; d=json.loads(sys.argv[1]); assert d["expected"]=="research-account@example.com" and d["match"] is True, d' "$stdout_text"

  # Env set: it wins over the config file.
  printf 'RESEARCH_ACCOUNT=other-account@example.com\n' >"$config_dir/research.env"
  stdout_text=$(HOME="$tmp_dir/home" RESEARCH_ACCOUNT=research-account@example.com RESEARCH_VERIFY_DRIVE_CMD="$drive_cmd" \
    bash "$SCRIPT" --drive-only)
  python3 -c 'import json,sys; d=json.loads(sys.argv[1]); assert d["expected"]=="research-account@example.com" and d["match"] is True, d' "$stdout_text"

  trap - RETURN EXIT
  rm -rf "$tmp_dir"
}

run_case
run_drive_only_case
run_account_resolution_case
run_mismatch_case
run_timeout_case

echo "verify-account.test.sh PASS"
