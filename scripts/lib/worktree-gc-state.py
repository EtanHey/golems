#!/usr/bin/env python3
"""Read-only T3 liveness and durable, atomic stale-work owner reports."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.parse import quote


def t3_threads(path):
    db = os.environ.get("WORKTREE_GC_T3_DB", os.path.expanduser("~/.t3/userdata/statev2.sqlite"))
    literal = "'" + path.replace("'", "''") + "'"
    active = "('running','starting','queued','waiting','preparing')"
    query = f"""
      WITH bound AS (SELECT thread_id,payload_json,deleted_at FROM orchestration_v2_projection_threads
        WHERE json_extract(payload_json,'$.worktreePath')={literal})
      SELECT json_object('id',thread_id,'settled',json_extract(payload_json,'$.settledAt'),
        'created',json_extract(payload_json,'$.createdAt'),'deleted_at',deleted_at,
        'owner',coalesce(json_extract(payload_json,'$.lineage.rootThreadId'),
                         json_extract(payload_json,'$.lineage.parentThreadId')),
        'active',EXISTS(SELECT 1 FROM orchestration_v2_projection_runs r
          WHERE r.thread_id=bound.thread_id AND r.status IN {active}) OR
          EXISTS(SELECT 1 FROM orchestration_v2_projection_provider_sessions s
          WHERE s.thread_id=bound.thread_id AND s.status IN {active})) FROM bound;
    """
    result = subprocess.run(["sqlite3", "file:" + quote(os.path.abspath(db), safe="/") + "?mode=ro",
                             ".timeout 3000", query], check=True, capture_output=True, text=True, timeout=10)
    return [json.loads(row) for row in result.stdout.splitlines()]


def add_report(journal, repo, path, branch, reason, detail):
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
    if reason != "KEEP-undetermined" and (not birth or time.time() - birth < 72 * 3600):
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
    for line in Path(journal).read_text().splitlines():
        row = json.loads(line)
        owners.setdefault(row.pop("owner"), []).append(row)
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    report = dict(generated_at=now, exit_status=int(run_status), owners=owners)
    md = [f"# Worktree GC owner report\n\n{now}; exit={run_status}\n"]
    for owner, rows in sorted(owners.items()):
        md.append(f"## {owner}\n")
        for row in rows:
            md.append(f"- `{row['path']}` · `{row['branch']}` · {row['size_bytes']} bytes · {row['reason']}: {row['detail']}\n")
    if not owners:
        md.append("No undetermined stalls or stale KEEP rows older than 72 hours.\n")
    # Serialize publishers, not deletion decisions; readers see complete files.
    with (directory / ".report.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        artifacts = (("latest.json", json.dumps(report, indent=2) + "\n"), ("latest.md", "\n".join(md)))
        for name, content in artifacts if publish == "1" and int(run_status) in (0, 3) else ():
            stage = directory / f".{name}.{os.getpid()}"
            stage.write_text(content)
            os.replace(stage, directory / name)
        with (directory / "receipts.jsonl").open("a") as out:
            out.write(json.dumps(dict(at=now, exit_status=int(run_status),
                                     retained=sum(map(len, owners.values())), journal=journal)) + "\n")


if __name__ == "__main__":
    try:
        command, *args = sys.argv[1:]
        if command == "t3":
            live = [t for t in t3_threads(args[0]) if not t["settled"] or t["active"]]
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
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"worktree-gc state: {error}", file=sys.stderr)
        sys.exit(1)
