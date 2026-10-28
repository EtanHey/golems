"""Install the shared global body and the explicitly loaded lead layer.

Usage: python3 scripts/install-global-instructions.py --source-dir DIR --home HOME --dry-run
Use --apply to install, or --check to report drift without writing.
"""
import argparse
from datetime import datetime, timezone
import os
from pathlib import Path
import sys
import tempfile


def safe(path):
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError(f"symlink destination refused: {path}")
    if path.exists() and not path.is_file():
        raise ValueError(f"non-file destination refused: {path}")


def read(path):
    safe(path)
    return path.read_bytes() if path.exists() else None


def stage(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".global-instructions-", dir=path.parent)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    return Path(name)


def install(changes, backup):
    staged, saved, committed = {}, {}, []
    try:
        # Back up and stage every destination before replacing any of them.
        for dest, data, before in changes:
            if read(dest) != before:
                raise ValueError(f"destination changed since planning: {dest}")
            if before is not None:
                target = backup / dest.parent.name / dest.name
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("xb") as stream:
                    os.chmod(target, 0o600)
                    stream.write(before)
                if target.read_bytes() != before:
                    raise ValueError(f"backup verification failed: {target}")
                saved[dest] = stage(dest, before)
            staged[dest] = stage(dest, data)
        for dest, _, before in changes:
            if read(dest) != before:
                raise ValueError(f"destination changed before commit: {dest}")
            os.replace(staged[dest], dest)
            committed.append(dest)
    except (OSError, ValueError):
        for dest in reversed(committed):
            if dest in saved:
                os.replace(saved[dest], dest)
            else:
                dest.unlink()
        raise
    finally:
        for path in (*staged.values(), *saved.values()):
            if path.exists():
                path.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, required=True, help="explicit target HOME")
    parser.add_argument("--source-dir", type=Path,
                        default=os.environ.get("GOLEMS_GLOBAL_SOURCE_DIR"),
                        help="body directory; or set GOLEMS_GLOBAL_SOURCE_DIR")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.source_dir is None:
        parser.error("--source-dir or GOLEMS_GLOBAL_SOURCE_DIR is required")
    home = Path(os.path.abspath(args.home))
    source = Path(args.source_dir)
    payloads = {
        home / ".codex/AGENTS.md": (source / "AGENTS.md").read_bytes(),
        home / ".codex/LEAD.md": (source / "LEAD.md").read_bytes(),
        home / ".claude/CLAUDE.md": b"@~/.codex/AGENTS.md\n",
    }
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    backup = home / ".golems/backups/global-instructions" / stamp
    # Validate all destinations, including the backup tree, before any writes.
    safe(backup / "probe")
    changes = []
    for dest, data in payloads.items():
        before = read(dest)
        if before != data:
            changes.append((dest, data, before))
            print(f"DRIFT {dest}")
    if args.check:
        return int(bool(changes))
    if args.apply and changes:
        install(changes, backup)
        print(f"INSTALLED {len(changes)} file(s); backups: {backup}")
    elif not args.apply:
        print(f"DRY-RUN {len(changes)} file(s) would change")
    else:
        print("IN-SYNC")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError) as error:
        print(f"global-instructions: {error}", file=sys.stderr)
        sys.exit(2)
