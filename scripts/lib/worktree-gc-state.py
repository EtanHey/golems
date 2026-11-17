#!/usr/bin/env python3
"""Read-only T3 liveness and durable, atomic stale-work owner reports."""
import datetime
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time
from urllib.parse import quote


def t3_threads(path):
    db = os.environ.get("WORKTREE_GC_T3_DB", os.path.expanduser("~/.t3/userdata/statev2.sqlite"))
    active = "('running','starting','queued','waiting','preparing')"
    query = f"""
      WITH bound AS (SELECT thread_id,payload_json,deleted_at FROM orchestration_v2_projection_threads
        WHERE json_extract(payload_json,'$.worktreePath') IS NOT NULL)
      SELECT json_object('id',thread_id,'settled',json_extract(payload_json,'$.settledAt'),
        'payload',json(payload_json),'created',json_extract(payload_json,'$.createdAt'),'deleted_at',deleted_at,
        'owner',coalesce(json_extract(payload_json,'$.lineage.rootThreadId'),
                         json_extract(payload_json,'$.lineage.parentThreadId')),
        'active',EXISTS(SELECT 1 FROM orchestration_v2_projection_runs r
          WHERE r.thread_id=bound.thread_id AND r.status IN {active}) OR
          EXISTS(SELECT 1 FROM orchestration_v2_projection_provider_sessions s
          WHERE s.thread_id=bound.thread_id AND s.status IN {active})) FROM bound;
    """
    result = subprocess.run(["sqlite3", "file:" + quote(os.path.abspath(db), safe="/") + "?mode=ro",
                             ".timeout 3000", query], check=True, capture_output=True, text=True, timeout=10)
    rows = [json.loads(row) for row in result.stdout.splitlines()]
    return [row for row in rows if os.path.realpath(row['payload']['worktreePath']) == os.path.realpath(path)]


def t3_roots():
    roots = ["~/.t3/worktrees", *os.environ.get("WORKTREE_GC_T3_ROOTS", "").splitlines()]
    print("\n".join(os.path.realpath(os.path.expanduser(root.strip()))
                    for root in roots if root.strip()))


def live_symlink(path):
    path = os.path.realpath(path)

    def visit(directory, depth):
        if os.path.islink(directory):
            target = os.path.realpath(directory)
            if target == path or target.startswith(path + os.sep):
                return directory
        if depth == 3 or not os.path.isdir(directory):
            return None
        with os.scandir(directory) as entries:
            for entry in entries:
                found = visit(entry.path, depth + 1)
                if found:
                    return found
        return None

    for root in ("~/.agents", "~/.codex", "~/.claude/skills", "~/.claude/hooks", "~/.golems"):
        found = visit(os.path.expanduser(root), 0)
        if found:
            print("live-symlink-target " + found)
            return True
    return False


def add_report(journal, repo, path, branch, reason, detail, stage="processing"):
    if reason == "ERROR":
        detail = " ".join(detail.split())[:400]
        with open(journal, "a") as out:
            out.write(json.dumps(dict(owner=repo, repo=repo, path=path, branch=branch,
                                     size_bytes=None, reason=reason, detail=detail,
                                     birth_epoch=None, stage=stage)) + "\n")
        return
    try:
        admin = subprocess.check_output(["git", "-C", path, "rev-parse", "--absolute-git-dir"], text=True).strip()
    except (OSError, subprocess.SubprocessError):
        if reason != "KEEP-undetermined":
            raise
        admin, branch = None, "unknown"
    # Birth time, never mtime: status/fetch must not make stale work look new.
    birth = None
    for flags in (["-f", "%B"], ["-c", "%W"]) if admin else ():
        value = subprocess.run(["stat", *flags, admin], capture_output=True, text=True)
        if value.returncode == 0 and value.stdout.strip().isdigit():
            birth = int(value.stdout.strip())
            break
    if reason not in ("KEEP-undetermined", "KEEP-busy") and (not birth or time.time() - birth < 72 * 3600):
        return
    owner = repo
    try:
        threads = t3_threads(path)
        owners = {t["owner"] or t["id"] for t in threads}
        if len(owners) == 1:
            owner = owners.pop()
    except (OSError, ValueError, subprocess.SubprocessError):
        pass  # Reporting falls back to repo; the removal gate fails closed.
    size = None
    try:
        measured = subprocess.run(["du", "-sk", path], capture_output=True, text=True)
        if measured.returncode == 0:
            size = int(measured.stdout.split()[0]) * 1024
    except (OSError, ValueError, IndexError):
        pass
    if size is None:
        print(f"report size unknown: {path} (du failed or returned invalid output)", file=sys.stderr)
    with open(journal, "a") as out:
        out.write(json.dumps(dict(owner=owner, repo=repo, path=path, branch=branch,
                                 size_bytes=size, reason=reason, detail=detail,
                                 birth_epoch=birth)) + "\n")


def finish_report(journal, directory, run_status, publish):
    import fcntl
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    owners = {}
    t3_managed_skips = {}
    checkouts = []
    for line in Path(journal).read_text().splitlines():
        row = json.loads(line)
        if row.get("kind") == "checkout":
            checkouts.append(row)
        elif row.get("kind") == "t3-managed":
            t3_managed_skips[row["repo"]] = row["count"]
        else:
            owners.setdefault(row.pop("owner"), []).append(row)
    by_path = {}
    for row in checkouts:
        previous = by_path.get(row["path"], {})
        if row["size_bytes"] is None:
            row["size_bytes"] = previous.get("size_bytes")
        by_path[row["path"]] = row
    checkouts = list(by_path.values())
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    error_count = sum(row["reason"] == "ERROR" for rows in owners.values() for row in rows)
    status = "partial" if error_count or int(run_status) not in (0, 3) else "complete"
    report = dict(generated_at=now, status=status, error_count=error_count,
                  exit_status=int(run_status), owners=owners,
                  t3_managed_skips=t3_managed_skips, checkouts=checkouts)
    md = [f"# Worktree GC owner report\n\n{now}; status={status}; errors={error_count}; exit={run_status}\n"]
    md.append("## Checkout census\n")
    for row in checkouts:
        md.append(f"- `{row['path']}` · {row['size_bytes']} bytes · {row['verdict']}: {row['detail']}\n")
    for repo, count in sorted(t3_managed_skips.items()):
        md.append(f"- `{repo}`: {count} skip - t3-managed (T3 storageCleanup owns it)\n")
    for owner, rows in sorted(owners.items()):
        md.append(f"## {owner}\n")
        for row in rows:
            stage = f" [{row['stage']}]" if row['reason'] == "ERROR" else ""
            md.append(f"- `{row['path']}` · `{row['branch']}` · {row['size_bytes']} bytes · {row['reason']}{stage}: {row['detail']}\n")
    if not owners:
        md.append("No undetermined stalls or stale KEEP rows older than 72 hours.\n")
    # Serialize publishers, not deletion decisions; readers see complete files.
    with (directory / ".report.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        json_content = json.dumps(report, indent=2) + "\n"
        md_content = "\n".join(md)
        # JSON is authoritative: replace markdown first, JSON last. Matching
        # generated_at values let readers detect a pair read across publication.
        artifacts = (("latest.md", md_content), ("latest.json", json_content)) if int(publish) else ()
        current = (("last-run.md", md_content), ("last-run.json", json_content))
        for name, content in (*artifacts, *current):
            stage = directory / f".{name}.{os.getpid()}"
            try:
                stage.write_text(content)
                os.replace(stage, directory / name)
            finally:
                stage.unlink(missing_ok=True)
        with (directory / "receipts.jsonl").open("a") as out:
            out.write(json.dumps(dict(at=now, exit_status=int(run_status),
                                     retained=sum(map(len, owners.values())), journal=journal)) + "\n")


if __name__ == "__main__":
    try:
        command, *args = sys.argv[1:]
        if command == "roots":
            t3_roots()
        elif command == "t3-finished":
            threads = t3_threads(args[0])
            if not threads:
                raise ValueError("no bound thread")
            for t in threads:
                p = t["payload"]
                # Shell-derived active/pending fields are checked in projection tables below.
                # t3code apps/server/src/storageCleanup.ts:191-203, heldForLimitRecovery:
                # archived or explicitly settled threads are never recovery-held.
                recovery_held = (not p.get('archivedAt') and p.get('settledOverride') != 'settled'
                                 and bool(p.get('limitRecovery')))
                if (p.get("pinnedAt") or not (t["settled"] or p.get("archivedAt")) or
                    t["active"] or recovery_held):
                    raise ValueError("binding unsettled, active, pending or recovery-held")
            db = os.environ.get("WORKTREE_GC_T3_DB", os.path.expanduser("~/.t3/userdata/statev2.sqlite"))
            with sqlite3.connect("file:" + quote(os.path.abspath(db), safe="/") + "?mode=ro", uri=True, timeout=3) as conn:
                for (project_root,) in conn.execute("SELECT workspace_root FROM projection_projects"):
                    real = os.path.realpath(project_root)
                    if real == args[0] or real.startswith(args[0] + os.sep):
                        raise ValueError("contains a T3 project checkout")
                for t in threads:
                    # Missing tables/columns are errors, never permission to remove.
                    for table, condition in (
                        ("runs", "status NOT IN ('completed','cancelled','failed','interrupted','rolled_back')"),
                        ("provider_sessions", "status NOT IN ('stopped','ready')"),
                        ("runtime_requests", "status='pending'"),
                        ("provider_threads", "status NOT IN ('idle','not_loaded') OR coalesce(json_array_length(payload_json,'$.pendingBackgroundTasks'),0)>0"),
                        ("turn_items", "status NOT IN ('completed','failed','interrupted','cancelled')"),
                    ):
                        if conn.execute("SELECT 1 FROM orchestration_v2_projection_" + table +
                                        " WHERE thread_id=? AND (" + condition + ") LIMIT 1", (t["id"],)).fetchone():
                            raise ValueError("pending or active " + table)
                    if conn.execute("SELECT 1 FROM scheduled_tasks WHERE thread_id=? AND enabled=1", (t["id"],)).fetchone():
                        raise ValueError("enabled scheduled task")
                    # Settlement and thread updates must predate the inactivity window too.
                    p = t["payload"]
                    for field in ("settledAt", "archivedAt", "updatedAt", "snoozedUntil"):
                        value = p.get(field)
                        if value and time.time() - datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(datetime.timezone.utc).timestamp() <= 72 * 3600:
                            raise ValueError("recent or future thread activity")
        elif command == "census":
            journal, repo, path, branch, verdict, detail = args
            size = None
            if os.path.isdir(path):
                result = subprocess.run(["du", "-sk", path], capture_output=True, text=True)
                if result.returncode == 0:
                    size = int(result.stdout.split()[0]) * 1024
            print("size_bytes=" + str(size))
            with open(journal, "a") as out:
                out.write(json.dumps(dict(kind="checkout", repo=repo, path=path, branch=branch,
                    verdict=verdict, detail=detail, size_bytes=size)) + "\n")
        elif command == "live-symlink":
            sys.exit(3 if live_symlink(args[0]) else 0)
        elif command == "t3-summary":
            with open(args[0], "a") as out:
                out.write(json.dumps(dict(kind="t3-managed", repo=args[1], count=int(args[2]))) + "\n")
        elif command == "t3":
            live = [{k: v for k, v in t.items() if k != "payload"}
                    for t in t3_threads(args[0]) if not (t["settled"] or t["payload"].get("archivedAt")) or t["active"]]
            if live:
                print("T3 binding live: " + json.dumps(live))
            sys.exit(3 if live else 0)
        elif command == "pins":
            for line in Path(args[0]).read_text().splitlines():
                pin = line.strip().rstrip("/") or "/"
                if not line.strip() or pin.startswith("#"):
                    continue
                print(pin)
                expanded = os.path.expanduser(pin)
                print(os.path.realpath(expanded) if os.path.exists(expanded) else expanded)
        elif command == "add":
            add_report(*args)
        elif command == "finish":
            finish_report(*args)
    except (OSError, ValueError, sqlite3.Error, subprocess.SubprocessError) as error:
        print(f"worktree-gc state: {error}", file=sys.stderr)
        sys.exit(1)
