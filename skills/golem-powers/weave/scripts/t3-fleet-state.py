#!/usr/bin/env python3
"""t3-fleet-state.py — judge a T3 fleet snapshot for the weave convergence gate.

The gate is a shell script and cannot call MCP, so the lead captures the T3
state it can see into one JSON file and this script judges it. Schema
`weave-t3-fleet/v1` (documented in references/run-lifecycle.md §1.1):

    {
      "schema": "weave-t3-fleet/v1",
      "captured_at": "<ISO-8601 with timezone, stamped at the START of capture>",
      "self_thread_id": "<the thread running the gate>",
      "projects": [ {"projectId": ..., "total": <t3_thread_list total>} ],
      "threads": [ <t3_thread_list rows (settled:false, includeSubagents:true)
                    + projectId, verbatim or the slim projection; plus
                    t3_thread_read(childThreadId).thread for every task child
                    the listing does not carry> ],
      "tasks":   [ <task_status results verbatim, one per delegated task> ],
      "pending_requests": [ {"threadId": ..., "requestIds": [...]} ]
    }

Converged is PROVEN, never assumed: every fleet project (--expect-projects)
was swept and its listing matches the reported total; every task is
result_available, finished, with no pending child runs or question; every
task's child thread is present and settled; no thread other than the gate
runner is unsettled or live; the runner itself is not waiting or unknown; and
the runner's pending-request list is empty. Any absence, duplicate, unknown
value or missing liveness field blocks. Parent/child completion
(result_available) is not a settled worker: a finished but unsettled worker
fails with a "settle it" instruction. A finished createdBy:"user" thread is
Etan's own conversation, not a worker: a NOTE, never a pass for live work.

Every line of output starts with PASS, FAIL or NOTE. In-flight and waiting
blockers print first; finished-but-unsettled workers print as ONE FAIL summary
line (counts per status), with their ids written to --unsettled-out
(default <snapshot>.unsettled.tsv). Each of them still blocks.
Exit 0 = converged. Exit 1 = not converged. Exit 2 = invalid/unreadable snapshot.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = "weave-t3-fleet/v1"
# t3_thread_list status enum. Anything else is unknown and fails closed.
ACTIVE_STATUSES = {"preparing", "queued", "starting", "running"}
WAITING_STATUSES = {"waiting"}
FINISHED_STATUSES = {"idle", "completed", "interrupted", "failed", "cancelled", "rolled_back"}
KNOWN_STATUSES = ACTIVE_STATUSES | WAITING_STATUSES | FINISHED_STATUSES
# task_status status enum (T3 contract OrchestratorMcpDelegatedTaskStatus,
# packages/contracts/src/orchestratorMcp.ts). Separate from the thread enum:
# "idle" and "rolled_back" are thread states, never task states.
TASK_TERMINAL_STATUSES = {"completed", "failed", "cancelled", "interrupted"}
TASK_STATUSES = {"queued", "running", "waiting"} | TASK_TERMINAL_STATUSES
# task_status workState enum.
TASK_IN_FLIGHT = {"working", "waiting_for_children"}
TASK_DONE = "result_available"
# createdBy:"user" is Etan's own conversation, not a worker (lead ruling 2026-10-19).
USER = "user"
# Statuses a pending approval can hide behind once its turn stops: a cancelled
# approval-required child stays `interrupted` with pendingRequestCount 1.
APPROVAL_STATUSES = {"interrupted"}
FUTURE_SKEW_SEC = 120


class Invalid(Exception):
    pass


def parse_ts(value: object) -> datetime:
    if not isinstance(value, str):
        raise Invalid("captured_at must be an ISO-8601 string")
    try:
        ts = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise Invalid(f"captured_at {value!r} is not ISO-8601 ({exc})") from exc
    if ts.tzinfo is None:
        raise Invalid(f"captured_at {value!r} has no timezone")
    return ts


def load(path: str) -> dict:
    try:
        text = sys.stdin.read() if path == "-" else open(path, encoding="utf-8").read()
    except OSError as exc:
        raise Invalid(f"cannot read snapshot {path}: {exc.strerror}") from exc
    try:
        doc = json.loads(text)
    except json.JSONDecodeError as exc:
        raise Invalid(f"snapshot {path} is not valid JSON ({exc.msg} at line {exc.lineno})") from exc
    if not isinstance(doc, dict):
        raise Invalid("snapshot must be a JSON object")
    return doc


def need_str(obj: dict, key: str, where: str) -> str:
    value = obj.get(key)
    if not isinstance(value, str) or not value:
        raise Invalid(f"{where}.{key} must be a non-empty string")
    return value


def need_bool(obj: dict, key: str, where: str) -> bool:
    value = obj.get(key)
    if not isinstance(value, bool):
        raise Invalid(f"{where}.{key} must be a boolean")
    return value


def objects(doc: dict, key: str) -> list[dict]:
    rows = doc.get(key)
    if not isinstance(rows, list):
        raise Invalid(f"{key} must be a list")
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            raise Invalid(f"{key}[{i}] must be an object")
    return rows


def unique(rows: list[dict], key: str, where: str) -> None:
    seen: set[str] = set()
    for i, row in enumerate(rows):
        value = need_str(row, key, f"{where}[{i}]")
        if value in seen:
            raise Invalid(f"duplicate {key} {value!r} in {where} — one row per id")
        seen.add(value)


def validate(doc: dict) -> None:
    if doc.get("schema") != SCHEMA:
        raise Invalid(f"schema must be {SCHEMA!r}, got {doc.get('schema')!r}")
    parse_ts(doc.get("captured_at"))
    need_str(doc, "self_thread_id", "snapshot")
    projects = objects(doc, "projects")
    if not projects:
        raise Invalid("projects must list every t3_thread_list sweep (projectId + total)")
    unique(projects, "projectId", "projects")
    for i, p in enumerate(projects):
        total = p.get("total")
        if not isinstance(total, int) or isinstance(total, bool) or total < 0:
            raise Invalid(f"projects[{i}].total must be a non-negative integer")
    threads = objects(doc, "threads")
    unique(threads, "threadId", "threads")
    for i, t in enumerate(threads):
        need_str(t, "projectId", f"threads[{i}]")
        need_str(t, "status", f"threads[{i}]")
        need_bool(t, "settled", f"threads[{i}]")
        count = t.get("pendingRequestCount", 0)
        if not isinstance(count, int) or isinstance(count, bool):
            raise Invalid(f"threads[{i}].pendingRequestCount must be an integer when present")
    tasks = objects(doc, "tasks")
    unique(tasks, "taskId", "tasks")
    for i, t in enumerate(tasks):
        for key in ("childThreadId", "status", "workState"):
            need_str(t, key, f"tasks[{i}]")
        for key in ("hasPendingChildRuns", "hasPendingQuestion"):
            need_bool(t, key, f"tasks[{i}]")
    requests = objects(doc, "pending_requests")
    unique(requests, "threadId", "pending_requests")
    for i, r in enumerate(requests):
        ids = r.get("requestIds")
        if not isinstance(ids, list) or not all(isinstance(x, str) for x in ids):
            raise Invalid(f"pending_requests[{i}].requestIds must be a list of strings")


def tsv(value: object) -> str:
    return " ".join(str(value if value is not None else "").split())


def write_ids(rows: list[dict], path: Path) -> None:
    lines = [
        "\t".join(tsv(t.get(k)) for k in ("threadId", "status", "createdBy", "updatedAt", "title"))
        for t in rows
    ]
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text("".join(f"{line}\n" for line in lines), encoding="utf-8")
    tmp.replace(path)


def judge(
    doc: dict, now: datetime, max_age_min: float, expect_projects: list[str],
    unsettled_out: Path | None = None,
) -> tuple[list[str], list[str], list[str]]:
    """Return (fails, notes, passes). Fails are ordered for the reader: work in
    flight or waiting first, then every other blocker, then ONE summary line for
    finished-but-unsettled workers (each still blocks; the ids go to a file)."""
    live: list[str] = []
    other: list[str] = []
    notes: list[str] = []
    unsettled: list[dict] = []
    users = 0  # finished createdBy:user conversations noted, not blocking

    # captured_at is stamped at the START of capture, so this is the age of the oldest page.
    age_sec = (now - parse_ts(doc["captured_at"])).total_seconds()
    if age_sec < -FUTURE_SKEW_SEC:
        other.append(f"snapshot captured_at is {-age_sec / 60:.0f} min in the future — recapture it")
    elif age_sec > max_age_min * 60:
        other.append(
            f"snapshot is stale (capture started {age_sec / 60:.0f} min ago > {max_age_min:g} min)"
            " — recapture it"
        )

    self_id = doc["self_thread_id"]
    threads = {t["threadId"]: t for t in doc["threads"]}
    children = {t["childThreadId"] for t in doc["tasks"]}

    def label(t: dict) -> str:
        return f"thread {t['threadId']} ({t.get('title', '?')})"

    # Coverage: the fleet project set comes from the gate, not the snapshot.
    swept = {p["projectId"]: p["total"] for p in doc["projects"]}
    if not expect_projects:
        other.append(
            "no fleet project set given (--t3-projects / WEAVE_T3_PROJECTS) — "
            "cannot prove every fleet project was swept"
        )
    for pid in expect_projects:
        if pid not in swept:
            other.append(f"fleet project {pid!r} was not captured — sweep t3_thread_list for it")
    for pid, total in swept.items():
        listed = sum(1 for t in doc["threads"] if t["projectId"] == pid and not t["settled"])
        if listed == total:
            continue
        # A settled:false sweep never returns a settled row; only task children
        # (t3_thread_read) may be settled. Name a stray instead of "read every page".
        stray = [t for t in doc["threads"]
                 if t["projectId"] == pid and t["settled"] and t["threadId"] not in children]
        if stray and listed + len(stray) == total:
            for t in stray:
                other.append(
                    f"{label(t)} is settled:true but project {pid!r} counts it as unsettled "
                    f"({listed} unsettled row(s), total {total}) — a settled:false sweep cannot "
                    "return a settled row; recapture the rows verbatim"
                )
        else:
            other.append(
                f"project {pid!r} lists {listed} unsettled thread(s) but t3_thread_list total "
                f"is {total} — read every page"
            )

    if self_id not in threads:
        other.append(
            f"self_thread_id {self_id!r} is not in threads — wrong project or filtered listing"
        )

    for tid, t in threads.items():
        status = t["status"]
        # Coverage applies to every thread, the gate runner included.
        if not t["settled"] and t["projectId"] not in swept:
            other.append(f"{label(t)} is unsettled in project {t['projectId']!r}, which was not swept")
        pending = t.get("pendingRequestCount", 0) > 0
        if pending:
            live.append(
                f"{label(t)} has {t['pendingRequestCount']} pending request(s) — decline its "
                "pending approval in the T3 app (MCP cannot), then settle"
            )
        if status not in KNOWN_STATUSES:
            other.append(f"{label(t)} has unknown status {status!r} — fail closed")
        elif status in WAITING_STATUSES:
            live.append(f"{label(t)} is waiting — pending question or input")
        elif tid == self_id:
            continue  # the gate runner is expected to be running and unsettled
        elif status in ACTIVE_STATUSES:
            live.append(f"{label(t)} is {status} — work in flight")
        elif t["settled"] or pending:
            continue
        elif t.get("createdBy") != USER:
            unsettled.append(t)
        elif status in APPROVAL_STATUSES and "pendingRequestCount" not in t:
            # An approval outlives a cancel as `interrupted` + pendingRequestCount, and
            # t3_thread_list rows do not carry the count: a NOTE needs the read.
            live.append(
                f"{label(t)} is createdBy:user and {status} with no pendingRequestCount — "
                f"t3_thread_read({tid}) and record it before this can be a NOTE"
            )
        else:
            users += 1
            notes.append(
                f"{label(t)} is {status} and unsettled, but createdBy:user — Etan's own "
                "conversation, not a worker; not blocking"
            )

    for task in doc["tasks"]:
        tid, state, child, status = (
            task["taskId"], task["workState"], task["childThreadId"], task["status"]
        )
        tlabel = f"task {tid}"
        if status not in TASK_STATUSES:
            other.append(f"{tlabel} has unknown status {status!r} — fail closed")
        if task["hasPendingQuestion"]:
            live.append(f"{tlabel} has a pending question — answer it first")
        if state in TASK_IN_FLIGHT:
            live.append(f"{tlabel} is {state} — delegate still running")
            continue
        if state != TASK_DONE:
            other.append(f"{tlabel} has unknown workState {state!r} — fail closed")
            continue
        if status in TASK_STATUSES and status not in TASK_TERMINAL_STATUSES:
            other.append(f"{tlabel} is {TASK_DONE} but its status is {status} — inconsistent, fail closed")
        if task["hasPendingChildRuns"]:
            live.append(f"{tlabel} is {TASK_DONE} but has pending child runs — wait or task_cancel")
        if child not in threads:
            other.append(
                f"{tlabel} is {TASK_DONE} but its worker thread {child} is missing from the "
                f"snapshot — add t3_thread_read({child}).thread to threads"
            )
        elif not threads[child]["settled"]:
            other.append(
                f"{tlabel} is {TASK_DONE} but worker thread {child} is not settled — settle it"
            )

    requests = {r["threadId"]: r["requestIds"] for r in doc["pending_requests"]}
    if self_id not in requests:
        other.append(
            f"no t3_pending_request_list result for self thread {self_id!r} — record it"
        )
    for where, ids in requests.items():
        if ids:
            live.append(f"pending question on thread {where} ({', '.join(ids)}) — answer it first")

    fails = live + other
    if unsettled:
        counts = Counter(t["status"] for t in unsettled)
        by_status = ", ".join(f"{n} {s}" for s, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))
        where = None
        if unsettled_out is not None:
            try:
                write_ids(unsettled, unsettled_out)
                where = str(unsettled_out)
            except OSError as exc:
                notes.append(f"could not write the unsettled ids to {unsettled_out} ({exc.strerror})")
        if where is None:
            where = "listed in the NOTE lines below"
            notes.extend(
                f"unsettled {t['threadId']} ({t['status']}) {t.get('title', '?')}" for t in unsettled
            )
        fails.append(
            f"{len(unsettled)} finished thread(s) not settled — settle them ({by_status}); ids: {where}"
        )

    passes: list[str] = []
    if not fails:
        listed = sum(swept.values())
        who = "the gate runner only" if not users else f"the gate runner + {users} user conversation(s) noted"
        passes.append(
            f"{len(swept)} project(s) swept: {listed} unsettled thread(s) listed = the totals, {who}; "
            f"{len(doc['tasks'])} task(s) result_available with a settled child thread; "
            f"{len(requests)} pending-request list(s) empty "
            f"(capture started {age_sec / 60:.0f} min ago)"
        )
    return fails, notes, passes


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("snapshot", help="snapshot JSON path, or - for stdin")
    ap.add_argument("--max-age-min", type=float, default=15.0)
    ap.add_argument(
        "--expect-projects", default="",
        help="the fleet's T3 projectIds (space- or comma-separated); each must be swept",
    )
    ap.add_argument(
        "--unsettled-out", type=Path,
        help="file for the finished-but-unsettled thread ids (TSV); "
             "default: <snapshot>.unsettled.tsv beside the snapshot",
    )
    ap.add_argument("--now", help="ISO-8601 clock override (tests only)")
    args = ap.parse_args()
    out = args.unsettled_out
    if out is None and args.snapshot != "-":
        out = Path(args.snapshot).with_suffix(".unsettled.tsv")
    try:
        now = parse_ts(args.now) if args.now else datetime.now(timezone.utc)
        doc = load(args.snapshot)
        validate(doc)
    except Invalid as exc:
        print(f"FAIL invalid T3 snapshot: {exc}")
        return 2
    expect = [p for p in args.expect_projects.replace(",", " ").split() if p]
    fails, notes, passes = judge(doc, now, args.max_age_min, expect, out)
    for line in fails:
        print(f"FAIL {line}")
    for line in notes:
        print(f"NOTE {line}")
    for line in passes:
        print(f"PASS {line}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
