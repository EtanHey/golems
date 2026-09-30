"""Install Gemini gatherer context from a host's resolved repoGolem registry."""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import re
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
RITUAL = re.compile(r"brain_recall\s*\(\s*mode\s*=|first\s+boot|boot[\s_-]*timer|timer[^\n]*boot", re.I)
NAME = re.compile(r"[A-Za-z0-9._-]+\Z")


def safe_path(path):
    # Never follow a destination or parent symlink, including broken links.
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError(f"symlink destination refused: {path}")
    if path.exists() and not path.is_file():
        raise ValueError(f"non-file destination refused: {path}")


def read(path):
    safe_path(path)
    return path.read_bytes() if path.exists() else b""


def atomic_write(path, data):
    safe_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, stage = tempfile.mkstemp(prefix=".gemini-context-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(stage, path)
    finally:
        if os.path.exists(stage):
            os.unlink(stage)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--host", required=True, choices=("mbp", "m1"), help="target label; run locally on that Mac")
    p.add_argument("--home", type=Path, default=Path.home())
    p.add_argument("--registry", type=Path, help="resolved registry; no secrets are resolved by this installer")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--check", action="store_true")
    p.add_argument("--force-repo", action="append", default=[], metavar="NAME")
    p.add_argument("--lead-persona", type=Path, help="private persona source; never inserted into GEMINI.md")
    p.add_argument("--lead-agent", help="registry agentByCli.gemini name for the private persona")
    a = p.parse_args()
    if bool(a.lead_persona) != bool(a.lead_agent) or (a.lead_agent and not NAME.fullmatch(a.lead_agent)):
        p.error("--lead-persona and a safe --lead-agent name must be supplied together")
    home = a.home.absolute()
    registry = a.registry or Path(os.environ.get("RALPH_REGISTRY_FILE", home / ".config/repogolem/generated/registry.json"))
    if not a.registry and "RALPH_REGISTRY_FILE" not in os.environ and not registry.exists():
        registry = home / ".config/ralphtools/registry.json"
    projects = json.loads(registry.read_bytes())["projects"]
    if not isinstance(projects, dict) or any(not NAME.fullmatch(n) or n in (".", "..") for n in projects):
        raise ValueError("invalid registry project names")
    if set(a.force_repo) - projects.keys():
        p.error("--force-repo names must exist in this registry")
    template = (ROOT / "templates/gemini/GEMINI.md").read_bytes()
    agent = (ROOT / "templates/gemini/agents/gatherer.md").read_bytes()
    plans, rows = [], []

    def row(name, action, before, after):
        ritual = bool(RITUAL.search(before.decode("utf-8", errors="replace")))
        rows.append((name, action, len(before.splitlines()), len(after.splitlines()), "yes" if ritual else "no"))
        return ritual

    global_file = home / ".gemini/GEMINI.md"
    global_bytes = read(global_file)
    global_ritual = row("GLOBAL", "VERIFY" if global_file.exists() else "MISSING", global_bytes, global_bytes)
    found_ritual = global_ritual
    for name, project in sorted(projects.items()):
        raw_path = project["path"]
        if not isinstance(raw_path, str) or not raw_path:
            raise ValueError(f"invalid project path: {name}")
        repo = home / raw_path[2:] if raw_path.startswith("~/") else Path(raw_path)
        if not repo.is_absolute():
            raise ValueError(f"unresolved project path: {name}; use the generated registry")
        if not repo.is_dir():
            row(name, "SKIP-MISSING", b"", b"")
            continue
        dest = repo / "GEMINI.md"
        before = read(dest)
        # Large matching files can still hold genuine project guidance. Be conservative.
        stale = (dest.exists() and len(before.splitlines()) <= 200
                 and (repo / "CLAUDE.md").is_file() and before == (repo / "CLAUDE.md").read_bytes())
        action = "KEEP" if dest.exists() and before == template else "REPLACE" if dest.exists() else "CREATE"
        if dest.exists() and before != template and not stale and name not in a.force_repo:
            action = "REVIEW"
        after = before if action in ("REVIEW", "KEEP") else template
        found_ritual |= row(name, action, before, after)
        if action in ("CREATE", "REPLACE"):
            plans.append((dest, after, name + "-GEMINI.md"))
    dest = home / ".gemini/antigravity-cli/agents/gatherer.md"
    before = read(dest)
    row("GATHERER", "KEEP" if dest.exists() and before == agent else "INSTALL", before, agent)
    if not dest.exists() or before != agent:
        plans.append((dest, agent, "gatherer.md"))
    if a.lead_persona:
        persona = a.lead_persona.read_bytes()
        dest = home / ".claude/agents" / (a.lead_agent + ".md")
        before = read(dest)
        row("LEAD-PERSONA", "KEEP" if dest.exists() and before == persona else "INSTALL", before, persona)
        if not dest.exists() or before != persona:
            plans.append((dest, persona, "lead-" + a.lead_agent + ".md"))
        print(f"Registry mapping required: projects.<lead>.agentByCli.gemini = {a.lead_agent}")
    print(f"host={a.host} mode={'apply' if a.apply else 'check' if a.check else 'dry-run'} registry={registry}")
    print("repo\taction\tlines-before\tlines-after\tritual")
    for r in rows:
        print("\t".join(map(str, r)))
    if global_ritual:
        print("Global GEMINI.md has a ritual; resolve it separately before applying.", file=sys.stderr)
        return 1
    if a.apply:
        backup = home / ".golems/backups/gemini-md" / datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        for dest, _, backup_name in plans:
            safe_path(dest)
            if dest.exists():
                safe_path(backup / backup_name)
        for dest, data, backup_name in plans:
            if dest.exists():
                atomic_write(backup / backup_name, read(dest))
            atomic_write(dest, data)
    return int(a.check and found_ritual)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError) as e:
        print(f"gemini-context: {e}", file=sys.stderr)
        sys.exit(2)
