#!/usr/bin/env python3
"""Retire one separately authorized worktree; never force, prune or retry.

The caller owns consumer/lease and content-preservation checks. This primitive
retains worktrees containing ignored or untracked files, or missing status evidence.
Callers must hold the W2 lease with all consumers released before calling; W4
must enforce that precondition. Handle scans and repeated inventories reduce
the race window but cannot exclude a brand-new writer in the milliseconds
between the last check and Git's delete. The caller must exclude those writers.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import tempfile


def git(repo, *args):
    # Ambient Git overrides must not redirect the explicit repository identity.
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, env=env)
    # Decode without universal-newline translation: preserve Git's stderr verbatim.
    result.stdout = result.stdout.decode("utf-8", errors="surrogateescape")
    result.stderr = result.stderr.decode("utf-8", errors="surrogateescape")
    return result


def worktrees(repo):
    result = git(repo, "worktree", "list", "--porcelain", "-z")
    if result.returncode:
        raise ValueError("worktree list failed: " + result.stderr)
    rows = []
    for block in result.stdout.split("\0\0"):
        row = dict(field.partition(" ")[::2] for field in block.split("\0") if field)
        if row:
            if "worktree" not in row:
                raise ValueError("worktree list evidence malformed")
            rows.append(row)
    if not rows:
        raise ValueError("worktree list evidence empty")
    return rows


def observe(receipt, repo, path):
    errors = []
    try:
        rows = worktrees(repo)
        receipt["registered_after"] = any(Path(r["worktree"]) == path for r in rows)
    except (OSError, ValueError) as error:
        errors.append(str(error))
    try:
        os.lstat(path)
        receipt["physical_after"] = True
    except FileNotFoundError:
        receipt["physical_after"] = False
    except OSError as error:
        errors.append("lstat failed: " + str(error))
    return errors


def local_files(path):
    status = git(path, "status", "--porcelain=v1", "--ignored=matching",
                 "--untracked-files=all", "-z")
    if status.returncode:
        raise ValueError("status evidence incomplete: " + status.stderr)
    paths = []
    entries = iter(status.stdout.split("\0"))
    for entry in entries:
        if not entry:
            continue
        if len(entry) < 4 or entry[2] != " ":
            raise ValueError("status evidence incomplete: malformed entry")
        if entry[:2] in ("!!", "??"):
            paths.append(entry[3:])
        elif "R" in entry[:2] or "C" in entry[:2]:
            # Porcelain -z emits a second path for tracked renames/copies.
            if not next(entries, None):
                raise ValueError("status evidence incomplete: missing source path")
    return paths, status.stdout


def inventory(receipt, path):
    files, status = local_files(path)
    receipt["local_files_count"], receipt["local_files"] = len(files), files[:20]
    if files:
        raise ValueError(f"local files present (ignored/untracked): {len(files)}")
    index = git(path, "ls-files", "-v", "-z")
    if index.returncode:
        raise ValueError("index evidence incomplete: " + index.stderr)
    hidden = []
    for entry in index.stdout.split("\0"):
        if not entry:
            continue
        if len(entry) < 3 or entry[1] != " ":
            raise ValueError("index evidence incomplete: malformed entry")
        if entry[0].islower() or entry[0] == "S":
            hidden.append(entry[2:])
    receipt["index_flag_count"], receipt["index_flag_paths"] = len(hidden), hidden[:20]
    if hidden:
        raise ValueError(f"index flags hide tracked changes: {len(hidden)}")
    return status, index.stdout


def open_handles(path):
    try:
        result = subprocess.run(["lsof", "+D", str(path), "-Fpc"],
                                capture_output=True, timeout=20)
        stdout = result.stdout.decode("utf-8")
        stderr = result.stderr.decode("utf-8")
    except (OSError, subprocess.TimeoutExpired, UnicodeError) as error:
        raise ValueError("open-handle evidence incomplete: " + str(error)) from error
    # lsof's documented no-match result is exit 1 with no output or warnings.
    if result.returncode == 1 and not stdout and not stderr:
        return []
    # Some macOS scans exit 1 alongside positive matches. Those handles still
    # prove retention is necessary; only empty, warning-free exit 1 proves none.
    if result.returncode not in (0, 1) or stderr:
        raise ValueError(f"open-handle evidence incomplete: lsof exited {result.returncode}: " + stderr)
    handles, pid = [], None
    for field in stdout.splitlines():
        if field.startswith("p") and field[1:].isdigit() and int(field[1:]) > 0 and pid is None:
            pid = int(field[1:])
        elif field.startswith("c") and len(field) > 1 and pid is not None:
            handles.append({"pid": pid, "command": field[1:]})
            pid = None
        elif field.startswith("f") and len(field) > 1 and handles and pid is None:
            # macOS includes file descriptors (e.g. fcwd) even with -Fpc.
            continue
        else:
            raise ValueError("open-handle evidence incomplete: unparseable lsof output")
    if not handles or pid is not None:
        raise ValueError("open-handle evidence incomplete: missing pid/command")
    return handles


def retire(args):
    lexical = Path(args.path).absolute()
    path = lexical.resolve()
    receipt = dict(schema="workspace-lifecycle/receipt/v1", disposition="RETAINED",
                   path=str(path), repo=None, branch=None, head=None, remove_rc=None,
                   remove_stderr="", registered_after=None, physical_after=None,
                   branch_retained=True)
    repo = Path(args.repo).resolve()
    refused = True
    try:
        common = git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir")
        if common.returncode:
            raise ValueError("repo identity unavailable: " + common.stderr)
        repo = Path(common.stdout.rstrip("\n")).resolve()
        receipt["repo"] = str(repo)
        if any(p.is_symlink() for p in (lexical, *lexical.parents)):
            raise ValueError("path or parent is a symlink")
        if args.receipt_out and Path(args.receipt_out).resolve().is_relative_to(path):
            raise ValueError("receipt destination is inside retiring path")
        rows = worktrees(repo)
        if Path(rows[0]["worktree"]) == path:
            raise ValueError("main checkout cannot be retired")
        row = next((r for r in rows if Path(r["worktree"]) == path), None)
        if row is None:
            raise ValueError("path is not registered to this repo")
        branch = row.get("branch")
        receipt["branch"] = branch.removeprefix("refs/heads/") if branch else None
        receipt["head"] = row.get("HEAD")
        if args.expect_branch is not None and args.expect_branch != receipt["branch"]:
            raise ValueError("expected branch differs from observed branch")
        if args.expect_head is not None and args.expect_head != receipt["head"]:
            raise ValueError("expected head differs from observed head")
        before = inventory(receipt, path)
        handles = open_handles(path)
        receipt["open_handles"] = handles
        if handles:
            raise ValueError("open handles: " + ", ".join(
                f"{h['pid']}/{h['command']}" for h in handles))
        if inventory(receipt, path) != before:
            raise ValueError("worktree inventory changed since first read")
        refused = False
        removed = git(repo, "worktree", "remove", str(path))
        receipt["remove_rc"], receipt["remove_stderr"] = removed.returncode, removed.stderr
    except (OSError, ValueError) as error:
        receipt["reason"] = str(error)

    errors = observe(receipt, repo, path)
    if errors:
        receipt["reason"] = "; ".join(filter(None, [receipt.get("reason"), *errors]))
    if (not refused and not errors and receipt["remove_rc"] == 0
            and receipt["registered_after"] is False and receipt["physical_after"] is False):
        receipt["disposition"] = "REMOVED"
        receipt["reason"] = "remove succeeded; registration and physical path absent"
    elif "reason" not in receipt:
        receipt["reason"] = "remove failed or absence proofs incomplete"
    receipt["observed_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return receipt, 0 if receipt["disposition"] == "REMOVED" else (2 if refused else 1)


def write_receipt(destination, payload):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    staged = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=destination.parent,
                                         prefix=".retire-", delete=False) as out:
            staged = Path(out.name)
            out.write(payload)
            out.flush()
            os.fsync(out.fileno())
        os.replace(staged, destination)
    finally:
        if staged is not None and staged.exists():
            staged.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--path", required=True)
    parser.add_argument("--expect-branch")
    parser.add_argument("--expect-head")
    parser.add_argument("--receipt-out")
    args = parser.parse_args()
    receipt, code = retire(args)
    payload = json.dumps(receipt, ensure_ascii=True) + "\n"
    if args.receipt_out:
        try:
            # A refused nested destination must not add files to the target.
            if Path(args.receipt_out).resolve().is_relative_to(Path(receipt["path"])):
                raise ValueError("receipt destination is inside retiring path")
            write_receipt(args.receipt_out, payload)
        except (OSError, ValueError) as error:
            receipt["disposition"] = "RETAINED"
            receipt["reason"] += "; receipt write failed: " + str(error)
            payload = json.dumps(receipt, ensure_ascii=True) + "\n"
            code = code or 1
    print(payload, end="")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
