#!/usr/bin/env python3
"""t3-fleet-state.py — judge a T3 fleet snapshot for the weave convergence gate.

The gate is a shell script and cannot call MCP, so the lead captures the T3
state it can see into one JSON file and this script judges it. Schema
`weave-t3-fleet/v1` (documented in references/run-lifecycle.md §1.1):

    {
      "schema": "weave-t3-fleet/v1",
      "captured_at": "<ISO-8601 with timezone>",
      "self_thread_id": "<the thread running the gate>",
      "projects": [ {"projectId": ..., "total": <t3_thread_list total>} ],
      "threads": [ <t3_thread_list rows (settled:false, includeSubagents:true)
                    + projectId, plus t3_thread_read(childThreadId).thread
                    for every task child the listing does not carry> ],
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
fails with a "settle it" instruction.

Every line of output starts with PASS, FAIL or NOTE.
Exit 0 = converged. Exit 1 = not converged. Exit 2 = invalid/unreadable snapshot.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone

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


def judge(
    doc: dict, now: datetime, max_age_min: float, expect_projects: list[str]
) -> tuple[list[str], list[str]]:
    fails: list[str] = []
    passes: list[str] = []

    age_sec = (now - parse_ts(doc["captured_at"])).total_seconds()
    if age_sec < -FUTURE_SKEW_SEC:
        fails.append(f"snapshot captured_at is {-age_sec / 60:.0f} min in the future — recapture it")
    elif age_sec > max_age_min * 60:
        fails.append(
            f"snapshot is stale ({age_sec / 60:.0f} min old > {max_age_min:g} min) — recapture it"
        )

    # Coverage: the fleet project set comes from the gate, not the snapshot.
    swept = {p["projectId"]: p["total"] for p in doc["projects"]}
    if not expect_projects:
        fails.append(
            "no fleet project set given (--t3-projects / WEAVE_T3_PROJECTS) — "
            "cannot prove every fleet project was swept"
        )
    for pid in expect_projects:
        if pid not in swept:
            fails.append(f"fleet project {pid!r} was not captured — sweep t3_thread_list for it")
    for pid, total in swept.items():
        listed = sum(1 for t in doc["threads"] if t["projectId"] == pid and not t["settled"])
        if listed != total:
            fails.append(
                f"project {pid!r} lists {listed} unsettled thread(s) but t3_thread_list total "
                f"is {total} — read every page"
            )

    self_id = doc["self_thread_id"]
    threads = {t["threadId"]: t for t in doc["threads"]}
    if self_id not in threads:
        fails.append(
            f"self_thread_id {self_id!r} is not in threads — wrong project or filtered listing"
        )

    for tid, t in threads.items():
        label = f"thread {tid} ({t.get('title', '?')})"
        status = t["status"]
        # Coverage applies to every thread, the gate runner included.
        if not t["settled"] and t["projectId"] not in swept:
            fails.append(f"{label} is unsettled in project {t['projectId']!r}, which was not swept")
        if t.get("pendingRequestCount", 0) > 0:
            fails.append(f"{label} has {t['pendingRequestCount']} pending request(s) — answer it first")
        if status not in KNOWN_STATUSES:
            fails.append(f"{label} has unknown status {status!r} — fail closed")
        elif status in WAITING_STATUSES:
            fails.append(f"{label} is waiting — pending question or input")
        elif tid == self_id:
            continue  # the gate runner is expected to be running and unsettled
        elif status in ACTIVE_STATUSES:
            fails.append(f"{label} is {status} — work in flight")
        elif not t["settled"]:
            fails.append(f"{label} is {status} but not settled — settle it")

    for task in doc["tasks"]:
        tid, state, child, status = (
            task["taskId"], task["workState"], task["childThreadId"], task["status"]
        )
        label = f"task {tid}"
        if status not in TASK_STATUSES:
            fails.append(f"{label} has unknown status {status!r} — fail closed")
        if task["hasPendingQuestion"]:
            fails.append(f"{label} has a pending question — answer it first")
        if state in TASK_IN_FLIGHT:
            fails.append(f"{label} is {state} — delegate still running")
            continue
        if state != TASK_DONE:
            fails.append(f"{label} has unknown workState {state!r} — fail closed")
            continue
        if status in TASK_STATUSES and status not in TASK_TERMINAL_STATUSES:
            fails.append(f"{label} is {TASK_DONE} but its status is {status} — inconsistent, fail closed")
        if task["hasPendingChildRuns"]:
            fails.append(f"{label} is {TASK_DONE} but has pending child runs — wait or task_cancel")
        if child not in threads:
            fails.append(
                f"{label} is {TASK_DONE} but its worker thread {child} is missing from the "
                f"snapshot — add t3_thread_read({child}).thread to threads"
            )
        elif not threads[child]["settled"]:
            fails.append(
                f"{label} is {TASK_DONE} but worker thread {child} is not settled — settle it"
            )

    requests = {r["threadId"]: r["requestIds"] for r in doc["pending_requests"]}
    if self_id not in requests:
        fails.append(
            f"no t3_pending_request_list result for self thread {self_id!r} — record it"
        )
    for where, ids in requests.items():
        if ids:
            fails.append(f"pending question on thread {where} ({', '.join(ids)}) — answer it first")

    if not fails:
        others = sum(1 for tid in threads if tid != self_id)
        passes.append(
            f"{len(swept)} project(s) swept, {len(doc['tasks'])} task(s) result_available and "
            f"settled, {others} other thread(s) settled, 0 pending questions "
            f"(snapshot {age_sec / 60:.0f} min old)"
        )
    return fails, passes


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("snapshot", help="snapshot JSON path, or - for stdin")
    ap.add_argument("--max-age-min", type=float, default=15.0)
    ap.add_argument(
        "--expect-projects", default="",
        help="the fleet's T3 projectIds (space- or comma-separated); each must be swept",
    )
    ap.add_argument("--now", help="ISO-8601 clock override (tests only)")
    args = ap.parse_args()
    try:
        now = parse_ts(args.now) if args.now else datetime.now(timezone.utc)
        doc = load(args.snapshot)
        validate(doc)
    except Invalid as exc:
        print(f"FAIL invalid T3 snapshot: {exc}")
        return 2
    expect = [p for p in args.expect_projects.replace(",", " ").split() if p]
    fails, passes = judge(doc, now, args.max_age_min, expect)
    for line in fails:
        print(f"FAIL {line}")
    for line in passes:
        print(f"PASS {line}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
