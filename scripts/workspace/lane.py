#!/usr/bin/env python3
"""Open/close an owned direct-Git lane. Release every consumer before close.

Close stages ignored evidence locally; it does not upload or establish remote Git
coverage. The parent must authorize retirement and exclude uncontrolled writers
under the workspace lifecycle contract before calling. T3 roots use settle and
T3's cleanup instead. Failures keep their lease/archive recovery evidence.
Close resumes from close-state.json and verifies existing archive bytes rather
than overwriting them. Only direct-git leases in the main repo's .worktrees fit.
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


def write_close_state(destination, state):
    retire.write_receipt(destination / "close-state.json", json.dumps(state) + "\n")


def close_identity(record):
    return dict(schema="workspace-lifecycle/close/v1", **{
        key: record[key] for key in ("lease_id", "path", "repo_common_dir", "head", "host_environment")})


def read_close_state(destination, record):
    if destination.is_symlink():
        raise ValueError("close archive directory is a symlink")
    marker = destination / "close-state.json"
    retire.regular_hash(marker)
    state = lease.read_json(marker)
    if any(state.get(key) != value for key, value in close_identity(record).items()):
        raise ValueError("close-state identity differs from lease")
    if state.get("stage") not in ("preparing", "archived", "retired", "closed"):
        raise ValueError("invalid close-state stage")
    return state


def verify_close_archive(record, path, destination, state, *, source_present):
    manifest = destination / "manifest.json"
    retire.regular_hash(manifest)
    data = lease.read_json(manifest)
    if (data.get("archive_root") != str(destination) or any(
            data.get(key) != record[key]
            for key in ("lease_id", "path", "repo_common_dir", "host_environment"))):
        raise ValueError("archive manifest identity differs from lease")
    evidence = dict(path=str(path), quarantine_path=None, quarantine_container=None,
                    receipt_out=str(destination / "receipt.json"),
                    archive_manifest_sha256=state.get("manifest_sha256"))
    retire.verified_archive(evidence, path, manifest, source_present=source_present)
    state["manifest_sha256"] = evidence["archive_manifest_sha256"]


def verify_removed(record, repo, path, evidence):
    lease.matching_resource(record, evidence)
    if (evidence.get("schema") != lease.RECEIPT_SCHEMA or evidence.get("head") != record["head"]
            or type(evidence.get("remove_rc")) is not int or evidence["remove_rc"] != 0
            or evidence.get("actual_registered_path") is not None):
        raise ValueError("REMOVED receipt lacks exact retirement evidence")
    for candidate, prefix in ((path, ""), (Path(evidence["quarantine_path"]), "quarantine_")):
        observed = {}
        errors = retire.observe(observed, repo, candidate)
        if (errors or any(evidence.get(prefix + key) is not False or observed.get(key) is not False
                          for key in ("registered_after", "physical_after"))):
            raise ValueError("REMOVED absence proofs incomplete: " + "; ".join(errors))


def close_lane(args):
    directory = lease.ledger_directory()
    target = lease.lease_file(directory, args.lease_id)
    # Keep consumer add/release/bind/close serialized through retirement and persistence.
    with lease.writer_lock(directory):
        record = lease.read_json(target)
        if record.get("schema") != lease.SCHEMA or record.get("lease_id") != args.lease_id:
            raise ValueError("invalid lease record identity/schema")
        lease.require_no_consumers(record)
        if record["resource_kind"] != "worktree" or record["ownership"] != "created":
            raise ValueError("retirement requires a created worktree lease")
        if record["allocator"] != "direct-git":
            raise ValueError("lane close requires the direct-git allocator")
        if not record["path"] or not record.get("head"):
            raise ValueError("lease has no bound path/head; recovery required")
        path = direct_path(record["path"])
        if Path.cwd().resolve().is_relative_to(path):
            raise ValueError("caller is inside retiring worktree; parent must close it")
        repo = Path(retire.worktrees(record["repo_common_dir"])[0]["worktree"]).resolve()
        if path.parent != repo / ".worktrees":
            raise ValueError("lane close requires a direct child of the repo's .worktrees directory")
        root = Path(args.archive_root).expanduser().absolute() if args.archive_root else repo / "docs.local/worktree-archive"
        if root.resolve().is_relative_to(path):
            raise ValueError("archive root is inside retiring worktree")
        retire.require_persistent_archive(root)
        if any(p.is_symlink() for p in (root, *root.parents)):
            raise ValueError("archive root or parent is a symlink")
        root = root.resolve()
        summary = dict(lease_id=args.lease_id, path=str(path), disposition="RETAINED")
        if record["state"] == "closed" and record["disposition"] != "REMOVED":
            summary["reason"] = record["terminal_receipt"]["reason"]
            return summary, 1
        destination = root / args.lease_id
        receipt, manifest = destination / "receipt.json", destination / "manifest.json"
        state = None
        retire_code = None
        try:
            if destination.exists() or destination.is_symlink():
                state = read_close_state(destination, record)
            if not receipt.exists():
                lease.require_open(record)
                entries, status = retire.local_files(path)
                if any(line and not line.startswith("!! ") for line in status.split("\0")):
                    raise ValueError("uncommitted tracked changes or untracked files; worktree retained")
                patterns = retire.regenerable_patterns()
                retire.inspect_ignored(dict(path=str(path)), path, [name for kind, name in entries
                    if kind == "!!" and not retire.is_regenerable(name, patterns)])
                identity = list(retire.directory_identity(path))
                if state is None:
                    destination.mkdir(parents=True, mode=0o700, exist_ok=False)
                    state = dict(close_identity(record), stage="preparing", source_identity=identity)
                    write_close_state(destination, state)
                    archive_files(path, entries, destination, record)
                elif state.get("source_identity") != identity:
                    raise ValueError("worktree identity changed since close began")
                verify_close_archive(record, path, destination, state, source_present=True)
                state["stage"] = "archived"
                write_close_state(destination, state)
                result = subprocess.run([sys.executable, str(Path(retire.__file__)),
                    "--repo", str(repo), "--path", str(path), "--expect-head", record["head"],
                    "--archive-manifest", str(manifest), "--receipt-out", str(receipt)],
                    capture_output=True, text=True)
                retire_code = result.returncode
                if result.returncode == 0 and not receipt.exists():
                    raise ValueError("retire succeeded without a durable receipt; recovery required")
            if state is None:
                raise ValueError("retirement receipt has no matching close-state")
            evidence = lease.read_json(receipt)
            if evidence["disposition"] == "REMOVED":
                if retire_code not in (None, 0):
                    raise ValueError("retire reported REMOVED with a nonzero exit; recovery required")
                verify_removed(record, repo, path, evidence)
                verify_close_archive(record, path, destination, state, source_present=False)
            summary.update(disposition=evidence["disposition"], reason=evidence["reason"],
                           archive_manifest=str(manifest), receipt=str(receipt))
            state.update(stage="retired", summary=summary)
            write_close_state(destination, state)
        except (OSError, ValueError) as error:
            summary.update(disposition="RETAINED", reason=str(error))
        close = ["close", "--lease-id", args.lease_id]
        close += (["--receipt", str(receipt)] if summary["disposition"] == "REMOVED"
                  else ["--retained", summary["reason"]])
        if record["state"] != "closed":
            try:
                lease.close_lease(record, lease.parser().parse_args(close))
            finally:
                lease.persist(target, record)
        if state is not None:
            state.update(stage="closed", summary=summary)
            write_close_state(destination, state)
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
