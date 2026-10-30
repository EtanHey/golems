#!/usr/bin/env python3
"""Durable workspace ownership ledger. This CLI never allocates or removes workspaces.

Storage: GOLEMS_WORKSPACE_LEASES, default ~/.golems/state/workspace-leases.
Ephemeral storage is always refused, including symlink aliases. Tests use
self-cleaning ledger directories under the repository's docs.local/ scratch.

Transfer ack JSON: {"path": "<exact bound path>", "owner": "<successor>"}.
Receipts use workspace-lifecycle/receipt/v1 with path, repo_common_dir and
disposition. REMOVED requires registered_after=false, physical_after=false and
remove_rc present as the integer zero. RETAINED requires reason.
Receipt validation trusts the supplied observations; it performs no retirement.

Before retirement, begin-close atomically excludes new consumers and binding.
Use its close_token for close or abort-close (which restores the prior state).
The token guards against cross-caller and accidental closes. It is
not a secret from the same OS user: the ledger file is readable.
Only begin-close stdout returns the token; other output and history omit it.
Closing leases never expire; audit reports their closing_age_seconds. Retry an
interrupted close with the original receipt; identical closed receipts are no-ops.
Consumers and closing leases exclude retirement on equal, ancestor or descendant
realpaths across all live leases. Close refusals return 2 and a RETAINED receipt on stdout,
durably journaled in the refusing lease's history. check-close rechecks a token
before resuming retirement; new overlapping binds/consumers are excluded meanwhile.
Close attempts are journaled before updating terminal state. If the ledger is
already unwritable, no attempt can be recorded; the CLI fails without retiring.
"""

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import socket
import sys
import tempfile

import generation


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


def without_close_token(value, token):
    if isinstance(value, dict):
        return {without_close_token(key, token): without_close_token(item, token)
                for key, item in value.items()
                if key != "close_token"}
    if isinstance(value, list):
        return [without_close_token(item, token) for item in value]
    if isinstance(value, str) and token:
        return value.replace(token, "[close-token omitted]")
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


def persist(target, record, *, rollback_new=False):
    if target.parent.stat().st_mode & 0o222 == 0:
        raise PermissionError("ledger directory is not writable")
    record["last_observed_at"] = utc_now()
    temporary = None
    published = False
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=target.parent,
            prefix=".lease-", suffix=".tmp", delete=False,
        ) as stream:
            temporary = Path(stream.name)
            # Keep control state and exact receipt identity internally, while
            # excluding tokens echoed by receipt fields or OS errors from history.
            durable = dict(record, history=without_close_token(
                record["history"], record.get("close_token")))
            json.dump(durable, stream, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        published = True
        directory_fd = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except BaseException:
        # Only a new reservation can be rolled back; updates must preserve the
        # existing lease. The caller still holds the ledger writer lock here.
        if rollback_new and published:
            target.unlink()
        raise
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


def require_no_consumers(record):
    if record["consumers"]:
        raise ValueError("outstanding consumers: " + ", ".join(record["consumers"]))


class SharedHold(ValueError):
    def __init__(self, receipt):
        self.receipt = receipt
        super().__init__(receipt["reason"])


def require_no_shared_holds(directory, record, *, path=None, closing_only=False):
    """Caller holds writer_lock through the check and its state transition."""
    resource = path if path is not None else record["path"]
    if resource is None:
        return
    resource = Path(canonical(resource))
    blockers = []
    for target in sorted(directory.glob("*.json")):
        other = read_json(lease_file(directory, target.stem))
        if other.get("schema") != SCHEMA or other.get("lease_id") != target.stem:
            raise ValueError("invalid lease record identity/schema: " + target.name)
        if other["lease_id"] == record["lease_id"] or other["state"] == "closed" or not other["path"]:
            continue
        candidate = Path(canonical(other["path"]))
        if not (resource == candidate or resource in candidate.parents or candidate in resource.parents):
            continue
        if other["state"] == "closing" or (not closing_only and other["consumers"]):
            blockers.append({key: other[key] for key in ("lease_id", "state", "consumers")})
    if blockers:
        reason = "overlapping leases have outstanding consumers or are closing: " + "; ".join(
            f"{item['lease_id']} ({item['state']}; consumers: {', '.join(item['consumers']) or 'none'})"
            for item in blockers)
        raise SharedHold(dict(schema=RECEIPT_SCHEMA, lease_id=record["lease_id"],
                              path=record["path"], repo_common_dir=record["repo_common_dir"],
                              disposition="RETAINED", reason=reason, blocking_leases=blockers,
                              observed_at=utc_now()))


def require_close_token(record, args):
    if not args.close_token or args.close_token != record.get("close_token"):
        raise ValueError("matching close token required")


def close_lease(directory, record, args, attempt):
    try:
        if record["state"] == "closing":
            require_close_token(record, args)
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
                if type(receipt.get("remove_rc")) is not int or receipt["remove_rc"] != 0:
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
        if record["state"] == "closed":
            if (not args.receipt or json.dumps(terminal, sort_keys=True) !=
                    json.dumps(record["terminal_receipt"], sort_keys=True)):
                raise ValueError("lease is already closed with a different receipt")
            attempt.update(success=True, disposition=terminal["disposition"],
                           message="already closed")
            attempt.pop("error", None)
            return
        require_no_consumers(record)
        require_no_shared_holds(directory, record)
        record.update(state="closed", disposition=terminal["disposition"],
                      terminal_receipt=terminal, closed_at=utc_now())
        if terminal["disposition"] == "TRANSFERRED":
            record["owner"] = args.transferred_to
        attempt.update(success=True, disposition=terminal["disposition"])
        attempt.pop("error", None)
    except (ValueError, OSError) as error:
        attempt["error"] = str(error)
        if isinstance(error, SharedHold):
            attempt["receipt"] = error.receipt
        raise


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
                attempt = {"at": utc_now(), "success": False,
                           "error": "close interrupted before completion"}
                if args.receipt:
                    attempt["receipt_file"] = canonical(args.receipt)
                record["history"].append(attempt)
                # Preserve an interrupted attempt even if the terminal write
                # cannot replace the still-closing record. No retirement here.
                persist(target, record)
                try:
                    close_lease(directory, record, args, attempt)
                finally:
                    try:
                        persist(target, record)
                    except OSError as error:
                        # A post-rename sync failure may have published terminal
                        # state. Preserve the error there when writes still work;
                        # otherwise the prewritten interruption entry survives.
                        attempt.update(success=False, error=str(error))
                        try:
                            persist(target, record)
                        except OSError:
                            pass
                        raise
                return record
            require_open(record)
            if args.command in ("begin-close", "check-close"):
                if args.command == "check-close":
                    if record["state"] != "closing":
                        raise ValueError("lease is not closing")
                    require_close_token(record, args)
                elif record["state"] not in ("bound", "retained"):
                    raise ValueError("begin-close requires a bound or retained lease")
                require_no_consumers(record)
                try:
                    require_no_shared_holds(directory, record)
                except SharedHold as error:
                    record["history"].append(dict(at=utc_now(), success=False,
                                                  error=str(error), receipt=error.receipt))
                    persist(target, record)
                    raise
                if args.command == "check-close":
                    return record
                record.update(closing_previous_state=record["state"], state="closing",
                              closing_since=utc_now(), close_token=secrets.token_hex(32))
            elif args.command == "abort-close":
                if record["state"] != "closing":
                    raise ValueError("lease is not closing")
                require_close_token(record, args)
                record["state"] = record.pop("closing_previous_state")
                del record["closing_since"], record["close_token"]
            elif record["state"] == "closing":
                raise ValueError("lease is closing")
            elif args.command == "bind":
                path = str(Path(args.path).expanduser().resolve(strict=True))
                if record["path"] is not None and record["path"] != path:
                    raise ValueError("rebinding to a different path refused")
                require_no_shared_holds(directory, record, path=path, closing_only=True)
                if record["resource_kind"] == "worktree":
                    if record["path"] is None:
                        record["resource_generation"] = generation.capture(path)
                    elif "resource_generation" in record:
                        generation.verify(path, record["resource_generation"])
                record.update(path=path, state="bound")
                for key in ("branch", "head", "task_id", "thread_id"):
                    value = getattr(args, key)
                    if value is not None:
                        record[key] = value
            elif args.action == "add":
                require_no_shared_holds(directory, record, closing_only=True)
                if args.who not in record["consumers"]:
                    record["consumers"].append(args.who)
            else:
                if args.who not in record["consumers"]:
                    raise ValueError("unknown consumer: " + args.who)
                record["consumers"].remove(args.who)
        persist(target, record, rollback_new=args.command == "reserve")
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
            observation = without_close_token(record, record.get("close_token"))
            observation.pop("closing_previous_state", None)
            observation.update(age_seconds=max(0, (now - created).total_seconds()),
                               closing=record["state"] == "closing")
            if record["state"] == "closing":
                since = datetime.fromisoformat(record["closing_since"].replace("Z", "+00:00"))
                observation["closing_age_seconds"] = max(0, (now - since).total_seconds())
            observations.append(observation)
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
    begin_close = commands.add_parser("begin-close", help="exclude consumers before retirement")
    check_close = commands.add_parser("check-close", help="recheck path holds before resuming retirement")
    check_close.add_argument("--close-token")
    abort_close = commands.add_parser("abort-close", help="restore the state before begin-close")
    abort_close.add_argument("--close-token")
    close = commands.add_parser("close")
    close.add_argument("--close-token")
    disposition = close.add_mutually_exclusive_group(required=True)
    disposition.add_argument("--receipt")
    disposition.add_argument("--retained")
    disposition.add_argument("--transferred-to")
    close.add_argument("--ack-file")
    for command in (reserve, bind, consumer, begin_close, check_close, abort_close, close):
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
                    line = "{lease_id}\t{state}\t{age_seconds:.0f}s\t{owner}\t{path}".format(**record)
                    if record["state"] == "closing":
                        line += ("\tclosing: true\tclosing_since={closing_since}"
                                 "\tclosing_age={closing_age_seconds:.0f}s").format(**record)
                    print(line)
        else:
            record = mutate(directory, args)
            result = ({"close_token": record["close_token"]} if args.command == "begin-close"
                      else without_close_token(record, record.get("close_token")))
            print(json.dumps(result, sort_keys=True))
        return 0
    except SharedHold as error:
        print(json.dumps(error.receipt, sort_keys=True))
        print("lease refused: " + str(error), file=sys.stderr)
        return 2
    except (ValueError, OSError, KeyError, TypeError) as error:
        prefix = "do not allocate: " if args.command == "reserve" else "lease refused: "
        message = without_close_token(str(error), getattr(args, "close_token", None))
        print(prefix + message, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
