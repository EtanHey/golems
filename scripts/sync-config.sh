#!/usr/bin/env bash
# Sync repo MCP config from ~/.golems/config.yaml contextProfiles.
# Requires PyYAML: install with `python3 -m pip install PyYAML`.
set -euo pipefail

CONFIG_FILE="${GOLEMS_CONFIG:-$HOME/.golems/config.yaml}"
REPOS_BASE="${GOLEMS_REPOS_PATH:-$HOME/Gits}"
MODE="diff"
TARGET_REPO=""
VERBOSE=false

usage() {
  cat <<'USAGE'
Usage: scripts/sync-config.sh [--diff|--enforce|--validate] [--repo NAME] [--config PATH] [--verbose]

Reads ~/.golems/config.yaml:
  - mcpServers: reusable server definitions
  - contextProfiles.<repo>.mcps.allow: per-repo allow-list

Modes:
  --diff      Print per-repo server additions/removals without writing (default)
  --enforce   Overwrite profiled repo .mcp.json files to match the allow-list
  --validate  Validate config structure and profile references
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --diff) MODE="diff"; shift ;;
    --enforce) MODE="enforce"; shift ;;
    --validate) MODE="validate"; shift ;;
    --repo) TARGET_REPO="${2:-}"; shift 2 ;;
    --config) CONFIG_FILE="${2:-}"; shift 2 ;;
    --verbose) VERBOSE=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "[sync-config] ERROR: unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

python3 - "$CONFIG_FILE" "$REPOS_BASE" "$MODE" "$TARGET_REPO" "$VERBOSE" <<'PY'
import copy
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import yaml
except ModuleNotFoundError as exc:
    if exc.name == "yaml":
        print(
            "[sync-config] ERROR: missing Python dependency PyYAML. "
            "Install it with: python3 -m pip install PyYAML",
            file=sys.stderr,
        )
        sys.exit(1)
    raise

config_file = Path(sys.argv[1]).expanduser()
repos_base_arg = Path(sys.argv[2]).expanduser()
mode = sys.argv[3]
target_repo = sys.argv[4] or None
verbose = sys.argv[5] == "true"

if not config_file.exists():
    print(f"[sync-config] ERROR: config not found: {config_file}", file=sys.stderr)
    sys.exit(1)

config = yaml.safe_load(config_file.read_text()) or {}
profiles = config.get("contextProfiles") or {}
mcp_servers = config.get("mcpServers") or {}
repos_base = Path(config.get("reposPath") or repos_base_arg).expanduser().resolve()

errors = []
warnings = []
resolved_repo_paths = {}

if not profiles:
    errors.append("contextProfiles is missing or empty")
if not mcp_servers:
    errors.append("mcpServers is missing or empty")
if not repos_base.exists():
    errors.append(f"reposPath does not exist: {repos_base}")

if target_repo and target_repo not in profiles:
    valid_profiles = ", ".join(sorted(profiles)) or "-"
    print(
        f"[sync-config] ERROR: unknown profile(s): {target_repo}. "
        f"Valid profiles: {valid_profiles}",
        file=sys.stderr,
    )
    sys.exit(1)


def path_is_relative_to(path, base):
    try:
        path.relative_to(base)
        return True
    except ValueError:
        return False


for profile_name, profile in profiles.items():
    if "/" in profile_name or "\\" in profile_name or ".." in profile_name:
        errors.append(f"profile '{profile_name}' must be a repo basename")
        continue
    repo_path = (repos_base / profile_name).resolve()
    if not path_is_relative_to(repo_path, repos_base):
        errors.append(f"profile '{profile_name}' escapes reposPath: {repo_path}")
    resolved_repo_paths.setdefault(repo_path, []).append(profile_name)
    mcps = profile.get("mcps") or {}
    allow = mcps.get("allow") or []
    block = mcps.get("block") or []
    if not isinstance(allow, list):
        errors.append(f"profile '{profile_name}' mcps.allow must be a list")
        continue
    if not isinstance(block, list):
        errors.append(f"profile '{profile_name}' mcps.block must be a list")
        continue
    overlap = sorted(set(allow) & set(block))
    if overlap:
        errors.append(f"profile '{profile_name}' has MCPs in both allow and block: {', '.join(overlap)}")
    for server_name in allow:
        if server_name not in mcp_servers:
            errors.append(f"profile '{profile_name}' allows undefined MCP server '{server_name}'")
    if not (profile.get("skills") or {}).get("allow"):
        warnings.append(f"profile '{profile_name}' has no skills.allow entries")

for repo_path, profile_names in resolved_repo_paths.items():
    if len(profile_names) > 1:
        errors.append(
            f"contextProfiles resolve to the same repo path {repo_path}: {', '.join(profile_names)}"
        )

if mode == "validate":
    for warning in warnings:
        print(f"[sync-config] WARNING: {warning}", file=sys.stderr)
    if errors:
        for error in errors:
            print(f"[sync-config] ERROR: {error}", file=sys.stderr)
        sys.exit(1)
    print(f"[sync-config] Config valid: {len(profiles)} profiles, {len(mcp_servers)} MCP servers, repos={repos_base}")
    sys.exit(0)

if errors:
    for error in errors:
        print(f"[sync-config] ERROR: {error}", file=sys.stderr)
    sys.exit(1)


def generated_mcp(profile_name, profile):
    allow = (profile.get("mcps") or {}).get("allow") or []
    servers = {name: copy.deepcopy(mcp_servers[name]) for name in allow}
    return {
        "_note": f"Generated by scripts/sync-config.sh from ~/.golems/config.yaml (profile: {profile_name})",
        "_generated": True,
        "mcpServers": servers,
    }


class InvalidMcpJsonError(Exception):
    pass


def invalid_json_backup_path(path):
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    candidate = path.with_name(f"{path.name}.invalid.{timestamp}")
    counter = 1
    while candidate.exists():
        candidate = path.with_name(f"{path.name}.invalid.{timestamp}.{counter}")
        counter += 1
    return candidate


def server_keys(path):
    if not path.exists():
        return set()
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise InvalidMcpJsonError(f"{path} is invalid JSON: {exc}") from exc
    return set((data.get("mcpServers") or {}).keys())


changed = []
unchanged = []
missing_repos = []

for profile_name, profile in profiles.items():
    if target_repo and profile_name != target_repo:
        continue

    # Symlink policy: resolve before containment; symlink escapes are rejected.
    repo_path = (repos_base / profile_name).resolve()
    if not path_is_relative_to(repo_path, repos_base):
        print(f"[sync-config] ERROR: profile '{profile_name}' escapes reposPath", file=sys.stderr)
        sys.exit(1)
    if not repo_path.exists():
        missing_repos.append(profile_name)
        if verbose:
            print(f"[sync-config] SKIP missing repo: {repo_path}", file=sys.stderr)
        continue

    mcp_path = repo_path / ".mcp.json"
    if mcp_path.is_symlink():
        print(
            f"[sync-config] ERROR: refusing to follow symlinked target for profile '{profile_name}': {mcp_path}",
            file=sys.stderr,
        )
        sys.exit(1)
    desired = generated_mcp(profile_name, profile)
    desired_text = json.dumps(desired, indent=2) + "\n"
    current_text = mcp_path.read_text() if mcp_path.exists() else ""

    if current_text == desired_text:
        unchanged.append(str(mcp_path))
        continue

    invalid_json_backup = None
    try:
        current_servers = server_keys(mcp_path)
    except InvalidMcpJsonError as exc:
        if mode != "enforce":
            print(f"[sync-config] ERROR: {exc}", file=sys.stderr)
            sys.exit(1)
        invalid_json_backup = invalid_json_backup_path(mcp_path)
        print(
            f"[sync-config] WARNING: {exc}; backing up to {invalid_json_backup} before regeneration",
            file=sys.stderr,
        )
        current_servers = set()
    desired_servers = set(desired["mcpServers"].keys())
    added = sorted(desired_servers - current_servers)
    removed = sorted(current_servers - desired_servers)
    same_keys = not added and not removed and mcp_path.exists()

    if mode == "diff":
        print(f"{mcp_path}")
        print(f"  + {', '.join(added) if added else '-'}")
        print(f"  - {', '.join(removed) if removed else '-'}")
        if same_keys:
            print("  ~ server definitions changed")
        changed.append(str(mcp_path))
    elif mode == "enforce":
        if invalid_json_backup:
            mcp_path.replace(invalid_json_backup)
        mcp_path.write_text(desired_text)
        print(f"[sync-config] WROTE {mcp_path}")
        changed.append(str(mcp_path))
    else:
        print(f"[sync-config] ERROR: unsupported mode: {mode}", file=sys.stderr)
        sys.exit(2)

if target_repo and not changed and not unchanged and missing_repos:
    print(f"[sync-config] ERROR: target repo/profile not found or missing: {target_repo}", file=sys.stderr)
    sys.exit(1)

print(f"[sync-config] Summary: {len(changed)} changed, {len(unchanged)} unchanged, {len(missing_repos)} missing repos")
if missing_repos and verbose:
    print(f"[sync-config] Missing repos: {', '.join(missing_repos)}")
PY
