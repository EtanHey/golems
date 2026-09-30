"""Install Gemini gatherer context from a host's resolved repoGolem registry."""
import argparse
from datetime import datetime
import json
import hashlib
import os
from pathlib import Path
import re
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
RITUAL = re.compile(r"\bbrain_recall\s*\(\s*mode\s*=|^\s*(?:#+\s*)?first\s+boot\b(?!\s+(?:of|the)\b)|\bboot[\s_-]*timer\b|\btimer\b[^\n]*\bboot\b", re.I | re.M)
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


def writable(path):
    safe_path(path)
    if path.exists() and (not path.stat().st_mode & 0o222 or not os.access(path, os.W_OK)):
        raise PermissionError(f"destination is not writable: {path}")
    parent = path.parent
    while not parent.exists():
        parent = parent.parent
    if (not parent.is_dir() or not parent.stat().st_mode & 0o222
            or not parent.stat().st_mode & 0o111 or not os.access(parent, os.W_OK | os.X_OK)):
        raise PermissionError(f"directory is not writable: {parent}")


def stage(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".gemini-context-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        return temporary
    except BaseException:
        os.unlink(temporary)
        raise


def apply(plans, backup):
    # Validate every destination and backup directory before creating anything.
    for dest, _, name, original in plans:
        writable(dest)
        if original is not None:
            writable(backup / name)
    staged, restores, committed = {}, {}, []
    try:
        for dest, data, name, original in plans:
            if (read(dest) if dest.exists() else None) != original:
                raise ValueError(f"destination changed since planning: {dest}")
            if original is not None:
                saved = backup / name
                saved.parent.mkdir(parents=True, exist_ok=True)
                fd = os.open(saved, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "wb") as f:
                    f.write(original)
                    f.flush()
                    os.fsync(f.fileno())
                verified = saved.read_bytes()
                if verified != original:
                    raise ValueError(f"backup verification failed: {saved}")
                restores[dest] = stage(dest, verified)
            staged[dest] = stage(dest, data)
        for dest, _, _, original in plans:
            safe_path(dest)
            if (read(dest) if dest.exists() else None) != original:
                raise ValueError(f"destination changed before commit: {dest}")
            os.replace(staged[dest], dest)
            committed.append(dest)
    except (OSError, ValueError):
        failures = []
        for dest in reversed(committed):
            try:
                if dest in restores:
                    os.replace(restores[dest], dest)
                else:
                    dest.unlink()
            except OSError as error:
                failures.append(f"{dest}: {error}")
        print("destination\tresult")
        for dest, _, _, _ in plans:
            print(f"{dest}\t{'ROLLBACK-FAILED' if any(str(dest) + ':' in f for f in failures) else 'ROLLED-BACK' if dest in committed else 'UNCHANGED'}")
        if failures:
            raise OSError("rollback failed; restore verified backups: " + "; ".join(failures))
        raise
    finally:
        for temporary in (*staged.values(), *restores.values()):
            if os.path.exists(temporary):
                os.unlink(temporary)


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
    plans, rows, seen = [], [], set()

    def plan(dest, data, name, before, suffix=".md"):
        digest = hashlib.sha256(os.fsencode(str(dest.resolve()))).hexdigest()
        plans.append((dest, data, name + "-" + digest + suffix, before if dest.exists() else None))

    forced = set()
    for name in a.force_repo:
        raw = projects[name]["path"]
        if not isinstance(raw, str) or not raw:
            raise ValueError(f"invalid project path: {name}")
        repo = home / raw[2:] if raw.startswith("~/") else Path(raw)
        if repo.is_dir():
            forced.add((repo.stat().st_dev, repo.stat().st_ino))

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
        dest = repo / "GEMINI.md"
        if any(path.is_symlink() for path in (dest, *dest.parents)):
            row(name, "SKIP-SYMLINK", b"", b"")
            continue
        if not repo.is_dir():
            row(name, "SKIP-MISSING", b"", b"")
            continue
        dest = repo / "GEMINI.md"
        before = read(dest)
        canonical = (repo.stat().st_dev, repo.stat().st_ino)
        if canonical in seen:
            found_ritual |= row(name, "SKIP-DUPLICATE", before, before)
            continue
        seen.add(canonical)
        # Large matching files can still hold genuine project guidance. Be conservative.
        stale = (dest.exists() and len(before.splitlines()) <= 200
                 and (repo / "CLAUDE.md").is_file() and before == (repo / "CLAUDE.md").read_bytes())
        action = "KEEP" if dest.exists() and before == template else "REPLACE" if dest.exists() else "CREATE"
        if dest.exists() and before != template and not stale and canonical not in forced:
            action = "REVIEW"
        after = before if action in ("REVIEW", "KEEP") else template
        found_ritual |= row(name, action, before, after)
        if action in ("CREATE", "REPLACE"):
            plan(dest, after, name, before, "-GEMINI.md")
    dest = home / ".gemini/antigravity-cli/agents/gatherer.md"
    before = read(dest)
    row("GATHERER", "KEEP" if dest.exists() and before == agent else "INSTALL", before, agent)
    if not dest.exists() or before != agent:
        plan(dest, agent, "gatherer", before)
    if a.lead_persona:
        persona = a.lead_persona.read_bytes()
        dest = home / ".claude/agents" / (a.lead_agent + ".md")
        before = read(dest)
        row("LEAD-PERSONA", "KEEP" if dest.exists() and before == persona else "INSTALL", before, persona)
        if not dest.exists() or before != persona:
            plan(dest, persona, "lead-" + a.lead_agent, before)
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
        apply(plans, backup)
    return int(a.check and found_ritual)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError) as e:
        print(f"gemini-context: {e}", file=sys.stderr)
        sys.exit(2)
