#!/usr/bin/env bash
set -euo pipefail

EXPECT="${RESEARCH_ACCOUNT:-research-account@example.com}"
REMEDIATION="Run: nlm login switch <profile> && mcp__google-drive__refresh_auth"
DRIVE_ONLY=false

usage() {
  cat <<'EOF'
Usage: verify-account.sh [--expect <email>] [--drive-only]

Checks the active Google account used by the local Drive and NotebookLM auth state.
Use --drive-only when the project has no NotebookLM notebook.
Outputs JSON to stdout:
  {"callSucceeded": true, "drive_account": "...", "notebooklm_account": "..."|null, "expected": "...", "match": true|false, "drive_only": true|false}
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --expect)
      EXPECT="${2:-}"
      shift 2
      ;;
    --drive-only)
      DRIVE_ONLY=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

run_override_or_fail() {
  local command_text="$1"
  local label="$2"

  if [[ -n "$command_text" ]]; then
    bash -lc "$command_text"
    return
  fi

  echo "$label override command not configured" >&2
  exit 2
}

get_drive_json() {
  if [[ -n "${RESEARCH_VERIFY_DRIVE_CMD:-}" ]]; then
    run_override_or_fail "$RESEARCH_VERIFY_DRIVE_CMD" "drive"
    return
  fi

  local token_file="${GOOGLE_DRIVE_TOKENS_FILE:-$HOME/.config/google-drive-mcp/tokens.json}"
  if [[ ! -f "$token_file" ]]; then
    echo "Drive token file not found: $token_file" >&2
    exit 2
  fi

  local helper_path access_token
  helper_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/drive-paths.py"
  access_token=$(python3 - "$helper_path" <<'PY'
import importlib.util
import pathlib
import sys

helper_path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("research_drive_paths", helper_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
print(module._load_access_token())
PY
)

  curl -fsS \
    -H "Authorization: Bearer $access_token" \
    "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)"
}

get_notebook_json() {
  if [[ -n "${RESEARCH_VERIFY_NOTEBOOKLM_CMD:-}" ]]; then
    run_override_or_fail "$RESEARCH_VERIFY_NOTEBOOKLM_CMD" "notebooklm"
    return
  fi

  python3 - <<'PY'
import json
import pathlib
import tomllib

config_path = pathlib.Path.home() / ".notebooklm-mcp-cli" / "config.toml"
if not config_path.exists():
    raise SystemExit(f"NotebookLM config not found: {config_path}")

config = tomllib.loads(config_path.read_text())
profile = config.get("auth", {}).get("default_profile", "default")
metadata_path = pathlib.Path.home() / ".notebooklm-mcp-cli" / "profiles" / profile / "metadata.json"
if not metadata_path.exists():
    raise SystemExit(f"NotebookLM metadata not found for profile '{profile}': {metadata_path}")

print(metadata_path.read_text())
PY
}

extract_email() {
  python3 - "$1" <<'PY'
import json
import sys

raw = sys.argv[1]
data = json.loads(raw)
candidates = [
    data.get("email"),
    data.get("emailAddress"),
    data.get("user", {}).get("emailAddress") if isinstance(data.get("user"), dict) else None,
    data.get("account", {}).get("email") if isinstance(data.get("account"), dict) else None,
    data.get("connected_account", {}).get("email") if isinstance(data.get("connected_account"), dict) else None,
]

for candidate in candidates:
    if candidate:
        print(candidate)
        break
else:
    raise SystemExit("no email field found in JSON payload")
PY
}

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

drive_json=""
notebook_json=""

if ! drive_json=$(get_drive_json 2>"$tmp_dir/drive.err"); then
  cat "$tmp_dir/drive.err" >&2
  exit 1
fi

drive_account=$(extract_email "$drive_json")
notebooklm_account=""

if [[ "$DRIVE_ONLY" != "true" ]]; then
  if ! notebook_json=$(get_notebook_json 2>"$tmp_dir/notebook.err"); then
    cat "$tmp_dir/notebook.err" >&2
    exit 1
  fi
  notebooklm_account=$(extract_email "$notebook_json")
fi

match=false
if [[ "$drive_account" == "$EXPECT" &&
      ( "$DRIVE_ONLY" == "true" || "$notebooklm_account" == "$EXPECT" ) ]]; then
  match=true
fi

python3 - "$drive_account" "$notebooklm_account" "$EXPECT" "$match" "$DRIVE_ONLY" <<'PY'
import json
import sys

payload = {
    "callSucceeded": True,
    "drive_account": sys.argv[1],
    "notebooklm_account": sys.argv[2] or None,
    "expected": sys.argv[3],
    "match": sys.argv[4].lower() == "true",
    "drive_only": sys.argv[5].lower() == "true",
}
print(json.dumps(payload))
PY

if [[ "$match" != "true" ]]; then
  if [[ "$DRIVE_ONLY" == "true" ]]; then
    REMEDIATION="Run: mcp__google-drive__refresh_auth"
  fi
  echo "Active account mismatch. $REMEDIATION" >&2
  exit 1
fi
