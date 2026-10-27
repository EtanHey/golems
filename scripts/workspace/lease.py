#!/usr/bin/env python3
"""Durable workspace ownership ledger. This CLI never allocates or removes workspaces.

Storage: GOLEMS_WORKSPACE_LEASES, default ~/.golems/state/workspace-leases.
Ephemeral storage is refused, including symlink aliases. Tests alone may explicitly
set GOLEMS_WORKSPACE_LEASES_TEST_ALLOW_TMP=1 for isolated pytest tmp_path fixtures.
Never set that override in an allocator or deployment environment.

Transfer ack JSON: {"path": "<exact bound path>", "owner": "<successor>"}.
Receipts use workspace-lifecycle/receipt/v1 with path, repo_common_dir and
disposition. REMOVED requires registered_after=false and physical_after=false;
if remove_rc is present it must be the integer zero. RETAINED requires reason.
Receipt validation trusts the supplied observations; it performs no retirement.
"""

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import socket
import sys
import tempfile


SCHEMA = "workspace-lifecycle/v1"
RECEIPT_SCHEMA = "workspace-lifecycle/receipt/v1"


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def canonical(path):
    return str(Path(path).expanduser().resolve())


def ledger_directory():
    directory = Path(os.environ.get(
        "GOLEMS_WORKSPACE_LEASES", "~/.golems/state/workspace-leases"
    )).expanduser().resolve()
    roots = ["/tmp", "/private/tmp", "/var/folders"]
    if os.environ.get("TMPDIR"):
        roots.append(os.environ["TMPDIR"])
    if os.environ.get("GOLEMS_WORKSPACE_LEASES_TEST_ALLOW_TMP") != "1":
        for root in roots:
            root = Path(root).expanduser().resolve()
            if directory == root or root in directory.parents:
                raise ValueError("ephemeral ledger directory refused")
    return directory


def lease_file(directory, lease_id):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", lease_id):
        raise ValueError("invalid lease_id; use 1-128 letters, digits, dots, underscores or hyphens")
    target = directory / (lease_id + ".json")
    if target.is_symlink():
        raise ValueError("symlink lease file refused")
    return target


def read_json(path):
    with open(path, encoding="utf-8") as stream:
        value = json.load(stream)
    if not isinstance(value, dict):
        raise ValueError("expected a JSON object: " + str(path))
    return value


@contextmanager
def writer_lock(directory):
    directory.mkdir(parents=True, exist_ok=True)
    # POSIX permissions also make the refusal deterministic under privileged tests.
    if directory.stat().st_mode & 0o222 == 0:
        raise PermissionError("ledger directory is not writable")
    with open(directory / ".lock", "a", encoding="utf-8") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def persist(target, record):
    record["last_observed_at"] = utc_now()
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=target.parent,
            prefix=".lease-", suffix=".tmp", delete=False,
        ) as stream:
            temporary = Path(stream.name)
            json.dump(record, stream, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        directory_fd = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def require_open(record):
    if record["state"] == "closed":
        raise ValueError("lease is already closed")


def matching_resource(record, evidence):
    if not record["path"]:
        raise ValueError("lease has no bound path")
    # Compare exact canonical identities captured at bind, without resolving the
    # now possibly absent resource or following a subsequently replaced symlink.
    for field in ("path", "repo_common_dir"):
        if evidence.get(field) != record[field]:
            raise ValueError("receipt " + field + " does not match lease")


def close_lease(record, args):
    attempt = {"at": utc_now(), "success": False}
    try:
        require_open(record)
        if args.receipt:
            attempt["receipt_file"] = canonical(args.receipt)
            receipt = read_json(args.receipt)
            attempt["receipt"] = receipt
            if receipt.get("schema") != RECEIPT_SCHEMA:
                raise ValueError("invalid receipt schema")
            matching_resource(record, receipt)
            disposition = receipt.get("disposition")
            if disposition == "REMOVED":
                if record["ownership"] != "created":
                    raise ValueError("reused/unknown ownership cannot close as REMOVED")
                if (receipt.get("registered_after") is not False or
                        receipt.get("physical_after") is not False):
                    raise ValueError("REMOVED requires registration and physical absence")
                if "remove_rc" in receipt and (
                    type(receipt["remove_rc"]) is not int or receipt["remove_rc"] != 0
                ):
                    raise ValueError("REMOVED requires a successful remove_rc")
            elif disposition == "RETAINED":
                if not isinstance(receipt.get("reason"), str) or not receipt["reason"].strip():
                    raise ValueError("RETAINED receipt requires a reason")
            else:
                raise ValueError("receipt disposition must be REMOVED or RETAINED")
            terminal = receipt
        elif args.retained is not None:
            attempt["reason"] = args.retained
            if not args.retained.strip():
                raise ValueError("RETAINED requires a reason")
            terminal = {"disposition": "RETAINED", "reason": args.retained}
        else:
            attempt["transferred_to"] = args.transferred_to
            if not args.transferred_to.strip() or not args.ack_file:
                raise ValueError("TRANSFERRED requires a successor and --ack-file")
            ack = read_json(args.ack_file)
            attempt["acknowledgment"] = ack
            if (not record["path"] or ack.get("path") != record["path"] or
                    ack.get("owner") != args.transferred_to):
                raise ValueError("acknowledgment must name the same path and successor owner")
            terminal = {"disposition": "TRANSFERRED", "owner": args.transferred_to,
                        "acknowledgment": ack}
        if record["consumers"]:
            raise ValueError("outstanding consumers: " + ", ".join(record["consumers"]))
        record.update(state="closed", disposition=terminal["disposition"],
                      terminal_receipt=terminal, closed_at=utc_now())
        if terminal["disposition"] == "TRANSFERRED":
            record["owner"] = args.transferred_to
        attempt.update(success=True, disposition=terminal["disposition"])
    except (ValueError, OSError) as error:
        attempt["error"] = str(error)
        raise
    finally:
        record["history"].append(attempt)


def mutate(directory, args):
    target = lease_file(directory, args.lease_id)
    with writer_lock(directory):
        if args.command == "reserve":
            if target.exists():
                raise ValueError("lease_id already exists")
            now = utc_now()
            record = {
                "schema": SCHEMA, "lease_id": args.lease_id,
                "host_environment": socket.gethostname(),
                "repo_common_dir": canonical(args.repo), "resource_kind": args.kind,
                "ownership": args.ownership, "allocator": args.allocator, "owner": args.owner,
                "requested_branch": args.branch, "requested_base_sha": args.base_sha,
                "path": None, "state": "reserved", "created_at": now,
                "last_observed_at": now, "consumers": [], "history": [],
            }
        else:
            record = read_json(target)
            if record.get("schema") != SCHEMA or record.get("lease_id") != args.lease_id:
                raise ValueError("invalid lease record identity/schema")
            if args.command == "close":
                try:
                    close_lease(record, args)
                finally:
                    persist(target, record)  # Keep failed close attempts as well.
                return record
            require_open(record)
            if args.command == "bind":
                path = str(Path(args.path).expanduser().resolve(strict=True))
                if record["path"] is not None and record["path"] != path:
                    raise ValueError("rebinding to a different path refused")
                record.update(path=path, state="bound")
                for key in ("branch", "head", "task_id", "thread_id"):
                    value = getattr(args, key)
                    if value is not None:
                        record[key] = value
            elif args.action == "add":
                if args.who not in record["consumers"]:
                    record["consumers"].append(args.who)
            else:
                if args.who not in record["consumers"]:
                    raise ValueError("unknown consumer: " + args.who)
                record["consumers"].remove(args.who)
        persist(target, record)
        return record


def audit(directory):
    observations = []
    now = datetime.now(timezone.utc)
    for path in sorted(directory.glob("*.json")):
        if path.is_symlink():
            raise ValueError("symlink lease file refused")
        record = read_json(path)
        if record.get("schema") != SCHEMA:
            raise ValueError("invalid lease schema: " + path.name)
        if record["state"] != "closed":
            created = datetime.fromisoformat(record["created_at"].replace("Z", "+00:00"))
            observations.append(dict(record, age_seconds=max(0, (now - created).total_seconds())))
    return observations


def parser():
    root = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = root.add_subparsers(dest="command", required=True)
    reserve = commands.add_parser("reserve")
    reserve.add_argument("--allocator", required=True, choices=(
        "t3-delegate", "cmux", "codex-workflows", "repogolem", "direct-git"))
    reserve.add_argument("--owner", required=True)
    reserve.add_argument("--repo", required=True)
    reserve.add_argument("--kind", required=True, choices=("worktree", "clone", "lane-directory"))
    reserve.add_argument("--ownership", required=True, choices=("created", "reused", "unknown"))
    reserve.add_argument("--branch")
    reserve.add_argument("--base-sha")
    bind = commands.add_parser("bind")
    bind.add_argument("--path", required=True)
    for flag in ("--branch", "--head", "--task-id", "--thread-id"):
        bind.add_argument(flag)
    consumer = commands.add_parser("consumer")
    consumer.add_argument("action", choices=("add", "release"))
    consumer.add_argument("--who", required=True)
    close = commands.add_parser("close")
    disposition = close.add_mutually_exclusive_group(required=True)
    disposition.add_argument("--receipt")
    disposition.add_argument("--retained")
    disposition.add_argument("--transferred-to")
    close.add_argument("--ack-file")
    for command in (reserve, bind, consumer, close):
        command.add_argument("--lease-id", required=True)
    audit_parser = commands.add_parser("audit")
    audit_parser.add_argument("--json", action="store_true")
    return root


def main():
    args = parser().parse_args()
    try:
        directory = ledger_directory()
        if args.command == "audit":
            records = audit(directory)
            if args.json:
                print(json.dumps(records, sort_keys=True))
            else:
                for record in records:
                    print("{lease_id}\t{state}\t{age_seconds:.0f}s\t{owner}\t{path}".format(**record))
        else:
            print(json.dumps(mutate(directory, args), sort_keys=True))
        return 0
    except (ValueError, OSError, KeyError, TypeError) as error:
        prefix = "do not allocate: " if args.command == "reserve" else "lease refused: "
        print(prefix + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
