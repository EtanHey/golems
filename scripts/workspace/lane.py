#!/usr/bin/env python3
"""Open/close an owned direct-Git lane. Release every consumer before close.

Close stages ignored evidence locally; it does not upload or establish remote Git
coverage. The parent must authorize retirement and exclude uncontrolled writers
under the workspace lifecycle contract before calling. T3 roots use settle and
T3's cleanup instead. Failures keep their lease/archive recovery evidence.
"""
import argparse
import json
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import uuid

import lease
import retire


def direct_path(value):
    path = Path(value).expanduser().absolute()
    managed = Path.home() / ".t3/worktrees"
    if path.is_relative_to(managed) or path.resolve().is_relative_to(managed.resolve()):
        raise ValueError("T3-managed roots retire by settle plus T3's cleanup (#858; CONTRACT.md)")
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError("path or parent is a symlink")
    return path.resolve()


def git(repo, *args):
    result = retire.git(repo, *args)
    if result.returncode:
        raise ValueError(result.stderr.strip())
    return result.stdout.rstrip("\n")


def open_lane(args):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}", args.name):
        raise ValueError("name must be a short path component")
    repo = Path(args.repo).expanduser().resolve()
    if Path(retire.worktrees(repo)[0]["worktree"]).resolve() != repo:
        raise ValueError("--repo must name the main checkout")
    path = direct_path(repo / ".worktrees" / args.name)
    common = git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir")
    base = git(repo, "rev-parse", "--verify", "--end-of-options", args.base + "^{commit}")
    branch = None if args.detach else args.branch or args.name
    lease_id = args.name + "-" + uuid.uuid4().hex
    reservation = ["reserve", "--lease-id", lease_id, "--allocator", "direct-git",
                   "--ownership", "created", "--kind", "worktree", "--repo", common,
                   "--owner", args.owner, "--base-sha", base]
    if branch:
        reservation += ["--branch", branch]
    directory = lease.ledger_directory()
    lease.mutate(directory, lease.parser().parse_args(reservation))
    try:
        git(repo, "worktree", "add", *(["--detach"] if args.detach else ["-b", branch]),
            "--", str(path), base)
        head = git(path, "rev-parse", "HEAD")
        binding = ["bind", "--lease-id", lease_id, "--path", str(path), "--head", head]
        if branch:
            binding += ["--branch", branch]
        lease.mutate(directory, lease.parser().parse_args(binding))
    except (OSError, ValueError) as error:
        raise ValueError(f"lease {lease_id} remains reserved; recovery required at {path}: {error}") from error
    return dict(lease_id=lease_id, path=str(path), head=head), 0


def archive_files(path, entries, destination, record):
    destination.mkdir(parents=True, exist_ok=False)
    manifest = dict(archive_root=str(destination), lease_id=record["lease_id"],
                    host_environment=record["host_environment"], path=str(path),
                    repo_common_dir=record["repo_common_dir"], entries=[])

    def copy(relative):
        source = path / relative
        info = source.lstat()
        if stat.S_ISDIR(info.st_mode):
            if not info.st_mode & 0o444 or not info.st_mode & 0o111:
                raise ValueError("unreadable ignored directory: " + relative.as_posix())
            for child in source.iterdir():
                copy(child.relative_to(path))
        else:
            digest, size = retire.regular_hash(source)
            archived = destination / "files" / relative
            archived.parent.mkdir(parents=True, exist_ok=True)
            with source.open("rb") as incoming, archived.open("xb") as outgoing:
                shutil.copyfileobj(incoming, outgoing)
            if retire.regular_hash(archived) != (digest, size):
                raise ValueError("archive readback failed: " + relative.as_posix())
            manifest["entries"].append(dict(path=relative.as_posix(), sha256=digest,
                                            size=size, archived_to=str(archived)))

    patterns = retire.regenerable_patterns()
    for kind, name in entries:
        if kind == "!!" and not retire.is_regenerable(name, patterns):
            copy(Path(name))
    target = destination / "manifest.json"
    retire.write_receipt(target, json.dumps(manifest) + "\n")
    evidence = dict(path=str(path), quarantine_path=None, quarantine_container=None,
                    receipt_out=str(destination / "receipt.json"), archive_manifest_sha256=None)
    retire.verified_archive(evidence, path, target)
    return target


def close_lane(args):
    directory = lease.ledger_directory()
    target = lease.lease_file(directory, args.lease_id)
    # Keep consumer add/release/bind/close serialized through retirement and persistence.
    with lease.writer_lock(directory):
        record = lease.read_json(target)
        if record.get("schema") != lease.SCHEMA or record.get("lease_id") != args.lease_id:
            raise ValueError("invalid lease record identity/schema")
        lease.require_open(record)
        lease.require_no_consumers(record)
        if record["resource_kind"] != "worktree" or record["ownership"] != "created":
            raise ValueError("retirement requires a created worktree lease")
        if not record["path"] or not record.get("head"):
            raise ValueError("lease has no bound path/head; recovery required")
        path = direct_path(record["path"])
        if Path.cwd().resolve().is_relative_to(path):
            raise ValueError("caller is inside retiring worktree; parent must close it")
        repo = Path(retire.worktrees(record["repo_common_dir"])[0]["worktree"]).resolve()
        root = Path(args.archive_root).expanduser().absolute() if args.archive_root else repo / "docs.local/worktree-archive"
        if root.resolve().is_relative_to(path):
            raise ValueError("archive root is inside retiring worktree")
        retire.require_persistent_archive(root)
        if any(p.is_symlink() for p in (root, *root.parents)):
            raise ValueError("archive root or parent is a symlink")
        summary = dict(lease_id=args.lease_id, path=str(path), disposition="RETAINED")
        receipt = manifest = None
        try:
            entries, status = retire.local_files(path)
            if any(line and not line.startswith("!! ") for line in status.split("\0")):
                raise ValueError("uncommitted tracked changes or untracked files; worktree retained")
            destination = root / args.lease_id
            manifest = archive_files(path, entries, destination, record)
            receipt = destination / "receipt.json"
            result = subprocess.run([sys.executable, str(Path(retire.__file__)),
                                     "--repo", str(repo), "--path", str(path),
                                     "--expect-head", record["head"], "--archive-manifest", str(manifest),
                                     "--receipt-out", str(receipt)], capture_output=True, text=True)
            evidence = lease.read_json(receipt)
            summary.update(disposition=evidence["disposition"], reason=evidence["reason"],
                           archive_manifest=str(manifest), receipt=str(receipt))
            if evidence["disposition"] == "REMOVED" and result.returncode != 0:
                raise ValueError("retire reported REMOVED with a nonzero exit; recovery required")
        except (OSError, ValueError) as error:
            summary.update(disposition="RETAINED", reason=str(error))
        close = ["close", "--lease-id", args.lease_id]
        close += (["--receipt", str(receipt)] if summary["disposition"] == "REMOVED"
                  else ["--retained", summary["reason"]])
        try:
            lease.close_lease(record, lease.parser().parse_args(close))
        finally:
            lease.persist(target, record)
        return summary, 0 if summary["disposition"] == "REMOVED" else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    opening = commands.add_parser("open")
    for flag in ("--repo", "--name", "--owner"):
        opening.add_argument(flag, required=True)
    opening.add_argument("--base", default="HEAD")
    mode = opening.add_mutually_exclusive_group()
    mode.add_argument("--branch")
    mode.add_argument("--detach", action="store_true")
    closing = commands.add_parser("close")
    closing.add_argument("--lease-id", required=True)
    closing.add_argument("--archive-root")
    args = parser.parse_args()
    try:
        summary, code = open_lane(args) if args.command == "open" else close_lane(args)
        print(json.dumps(summary, sort_keys=True))
        return code
    except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
        print("lane refused: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
