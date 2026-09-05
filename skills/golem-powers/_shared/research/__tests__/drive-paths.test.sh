#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SCRIPT="$ROOT_DIR/drive-paths.py"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

write_fixture() {
  local path="$1"
  cat >"$path" <<'EOF'
{
  "next_id": 100,
  "folders": [
    {"id": "root", "name": "root", "parent": null},
    {"id": "brain-drive", "name": "Brain Drive", "parent": "root"},
    {"id": "research", "name": "Research", "parent": "brain-drive"},
    {"id": "brainlayer", "name": "brainlayer", "parent": "research"},
    {"id": "context", "name": "context", "parent": "brainlayer"},
    {"id": "prompts", "name": "prompts", "parent": "brainlayer"},
    {"id": "results", "name": "results", "parent": "brainlayer"}
  ],
  "files": [
    {"id": "ctx-1", "name": "00-code-map.md", "parent": "context", "mimeType": "text/markdown"},
    {"id": "ctx-2", "name": "40-sample.json.txt", "parent": "context", "mimeType": "text/plain"},
    {"id": "prompt-1", "name": "R82-enrichment-quality.md", "parent": "prompts", "mimeType": "text/markdown"},
    {"id": "prompt-2", "name": "notes.txt", "parent": "prompts", "mimeType": "text/plain"},
    {"id": "result-1", "name": "R82-gemini-result.md", "parent": "results", "mimeType": "text/markdown"},
    {"id": "result-2", "name": "scratch.md", "parent": "results", "mimeType": "text/markdown"}
  ]
}
EOF
}

run_existing_folder_case() {
  local tmp_dir fixture output
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' RETURN
  fixture="$tmp_dir/fixture.json"
  write_fixture "$fixture"

  output=$(DRIVE_PATHS_FIXTURE="$fixture" python3 "$SCRIPT" resolve-project-folder brainlayer)
  [[ "$output" == "brainlayer" ]] || fail "expected existing folder id 'brainlayer', got '$output'"

  trap - RETURN
  rm -rf "$tmp_dir"
}

run_create_missing_case() {
  local tmp_dir fixture output
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' RETURN
  fixture="$tmp_dir/fixture.json"
  write_fixture "$fixture"

  output=$(DRIVE_PATHS_FIXTURE="$fixture" python3 "$SCRIPT" ensure-project-folders voicelayer)

  python3 - "$output" "$fixture" <<'PY'
import json, pathlib, sys
data = json.loads(sys.argv[1])
fixture = json.loads(pathlib.Path(sys.argv[2]).read_text())
assert data["project"] == "voicelayer"
assert set(data["folders"]) == {"project", "context", "prompts", "results"}
folder_names = {folder["name"] for folder in fixture["folders"]}
assert "voicelayer" in folder_names
assert "context" in folder_names
assert "prompts" in folder_names
assert "results" in folder_names
PY

  trap - RETURN
  rm -rf "$tmp_dir"
}

run_listing_case() {
  local tmp_dir fixture prompts results context
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' RETURN
  fixture="$tmp_dir/fixture.json"
  write_fixture "$fixture"

  prompts=$(DRIVE_PATHS_FIXTURE="$fixture" python3 "$SCRIPT" list-prompts brainlayer)
  results=$(DRIVE_PATHS_FIXTURE="$fixture" python3 "$SCRIPT" list-results brainlayer)
  context=$(DRIVE_PATHS_FIXTURE="$fixture" python3 "$SCRIPT" list-context-files brainlayer)

  python3 - "$prompts" "$results" "$context" <<'PY'
import json, sys
prompts = json.loads(sys.argv[1])
results = json.loads(sys.argv[2])
context = json.loads(sys.argv[3])
assert [item["name"] for item in prompts] == ["R82-enrichment-quality.md"]
assert [item["name"] for item in results] == ["R82-gemini-result.md"]
assert [item["name"] for item in context] == ["00-code-map.md", "40-sample.json.txt"]
PY

  trap - RETURN
  rm -rf "$tmp_dir"
}

run_timeout_case() {
  local tmp_dir fixture stderr_file
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' RETURN
  fixture="$tmp_dir/fixture.json"
  stderr_file="$tmp_dir/stderr"
  write_fixture "$fixture"

  set +e
  DRIVE_PATHS_FIXTURE="$fixture" \
    DRIVE_PATHS_SIMULATE_TIMEOUT=1 \
    python3 "$SCRIPT" resolve-project-folder brainlayer >/dev/null 2>"$stderr_file"
  local exit_code=$?
  set -e

  [[ $exit_code -ne 0 ]] || fail "expected timeout to fail"
  grep -q "timed out" "$stderr_file" || fail "expected timeout message"

  trap - RETURN
  rm -rf "$tmp_dir"
}

run_refresh_token_case() {
  local tmp_dir fixture tokens oauth output
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' RETURN
  fixture="$tmp_dir/fixture.json"
  tokens="$tmp_dir/tokens.json"
  oauth="$tmp_dir/gcp-oauth.keys.json"
  mkdir -p "$tmp_dir/bin"
  write_fixture "$fixture"

  cat >"$tokens" <<'EOF'
{
  "access_token": "expired-token",
  "refresh_token": "refresh-me",
  "token_type": "Bearer",
  "expiry_date": 0
}
EOF

  cat >"$oauth" <<'EOF'
{
  "installed": {
    "client_id": "client-id",
    "client_secret": "client-secret",
    "token_uri": "https://oauth2.googleapis.com/token"
  }
}
EOF

  cat >"$tmp_dir/bin/curl" <<'EOF'
#!/usr/bin/env python3
import json
import pathlib
import sys

args = sys.argv[1:]
joined = " ".join(args)
if "oauth2.googleapis.com/token" in joined:
    print(json.dumps({"access_token": "fresh-token", "expires_in": 3600, "token_type": "Bearer"}))
    raise SystemExit(0)

auth = None
for index, arg in enumerate(args):
    if arg == "-H" and index + 1 < len(args) and args[index + 1].startswith("Authorization: Bearer "):
        auth = args[index + 1].split("Authorization: Bearer ", 1)[1]
        break

if auth != "fresh-token":
    print("curl: (56) The requested URL returned error: 401", file=sys.stderr)
    raise SystemExit(56)

print(json.dumps({"files": [{"id": "brainlayer", "name": "brainlayer", "mimeType": "application/vnd.google-apps.folder"}]}))
EOF
  chmod +x "$tmp_dir/bin/curl"

  output=$(PATH="$tmp_dir/bin:$PATH" \
    GOOGLE_DRIVE_TOKENS_FILE="$tokens" \
    GOOGLE_DRIVE_OAUTH_KEYS_FILE="$oauth" \
    python3 "$SCRIPT" resolve-project-folder brainlayer)

  [[ "$output" == "brainlayer" ]] || fail "expected refreshed folder id 'brainlayer', got '$output'"

  python3 - "$tokens" <<'PY'
import json, pathlib, sys
tokens = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert tokens["access_token"] == "fresh-token"
assert tokens["token_type"] == "Bearer"
assert tokens["expiry_date"] > 0
PY

  trap - RETURN
  rm -rf "$tmp_dir"
}

run_existing_folder_case
run_create_missing_case
run_listing_case
run_timeout_case
run_refresh_token_case

echo "drive-paths.test.sh PASS"
