#!/usr/bin/env python3
"""t3-fleet-state.py — judge a T3 fleet snapshot for the weave convergence gate.

The gate is a shell script and cannot call MCP, so the lead captures the T3
state it can see into one JSON file and this script judges it. Schema
`weave-t3-fleet/v1` (documented in references/run-lifecycle.md §1.1):

    {
      "schema": "weave-t3-fleet/v1",
      "captured_at": "<ISO-8601 with timezone>",
      "self_thread_id": "<the thread running the gate>",
      "threads_complete": true,          # every t3_thread_list page was read
      "threads": [ <t3_thread_list rows, settled:false, includeSubagents:true> ],
      "tasks":   [ <task_status results, one per delegated task, + childThreadId> ],
      "pending_requests": [ <optional t3_pending_request_list rows> ]
    }

Converged means: every task is result_available with no pending child runs,
every task's backing child thread is settled, and no thread other than the
gate runner is unsettled or still running. Parent/child completion
(result_available) is not the same as a settled worker: a finished but
unsettled worker fails with a "settle it" instruction.

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


def validate(doc: dict) -> None:
    if doc.get("schema") != SCHEMA:
        raise Invalid(f"schema must be {SCHEMA!r}, got {doc.get('schema')!r}")
    parse_ts(doc.get("captured_at"))
    if not isinstance(doc.get("self_thread_id"), str) or not doc["self_thread_id"]:
        raise Invalid("self_thread_id must be a non-empty string")
    if doc.get("threads_complete") is not True:
        raise Invalid("threads_complete must be true (read every t3_thread_list page)")
    for key in ("threads", "tasks"):
        if not isinstance(doc.get(key), list):
            raise Invalid(f"{key} must be a list")
    if not isinstance(doc.get("pending_requests", []), list):
        raise Invalid("pending_requests must be a list when present")
    for i, t in enumerate(doc["threads"]):
        if not isinstance(t, dict):
            raise Invalid(f"threads[{i}] must be an object")
        if not isinstance(t.get("threadId"), str) or not t["threadId"]:
            raise Invalid(f"threads[{i}].threadId must be a non-empty string")
        if not isinstance(t.get("status"), str):
            raise Invalid(f"threads[{i}].status must be a string")
        if not isinstance(t.get("settled"), bool):
            raise Invalid(f"threads[{i}].settled must be a boolean")
    for i, t in enumerate(doc["tasks"]):
        if not isinstance(t, dict):
            raise Invalid(f"tasks[{i}] must be an object")
        for key in ("taskId", "workState", "childThreadId"):
            if not isinstance(t.get(key), str) or not t[key]:
                raise Invalid(f"tasks[{i}].{key} must be a non-empty string")
        if not isinstance(t.get("hasPendingChildRuns", False), bool):
            raise Invalid(f"tasks[{i}].hasPendingChildRuns must be a boolean when present")


def judge(doc: dict, now: datetime, max_age_min: float) -> tuple[list[str], list[str]]:
    fails: list[str] = []
    passes: list[str] = []

    age_sec = (now - parse_ts(doc["captured_at"])).total_seconds()
    if age_sec < -FUTURE_SKEW_SEC:
        fails.append(f"snapshot captured_at is {-age_sec / 60:.0f} min in the future — recapture it")
    elif age_sec > max_age_min * 60:
        fails.append(
            f"snapshot is stale ({age_sec / 60:.0f} min old > {max_age_min:g} min) — recapture it"
        )

    self_id = doc["self_thread_id"]
    threads = {t["threadId"]: t for t in doc["threads"]}
    if self_id not in threads:
        fails.append(
            f"self_thread_id {self_id!r} is not in threads — wrong project or filtered listing"
        )

    for tid, t in threads.items():
        if tid == self_id:
            continue
        label = f"thread {tid} ({t.get('title', '?')})"
        status = t["status"]
        if status in ACTIVE_STATUSES:
            fails.append(f"{label} is {status} — work in flight")
        elif status in WAITING_STATUSES:
            fails.append(f"{label} is waiting — pending question or input")
        elif status not in FINISHED_STATUSES:
            fails.append(f"{label} has unknown status {status!r} — fail closed")
        elif not t["settled"]:
            fails.append(f"{label} is {status} but not settled — settle it")

    for task in doc["tasks"]:
        tid, state, child = task["taskId"], task["workState"], task["childThreadId"]
        label = f"task {tid}"
        if state in TASK_IN_FLIGHT:
            fails.append(f"{label} is {state} — delegate still running")
        elif state != TASK_DONE:
            fails.append(f"{label} has unknown workState {state!r} — fail closed")
        elif task.get("hasPendingChildRuns", False):
            fails.append(f"{label} is {TASK_DONE} but has pending child runs — wait or task_cancel")
        elif child in threads and not threads[child]["settled"]:
            fails.append(
                f"{label} is {TASK_DONE} but worker thread {child} is not settled — settle it"
            )

    for req in doc.get("pending_requests", []):
        where = req.get("threadId", "?") if isinstance(req, dict) else "?"
        fails.append(f"pending question on thread {where} — answer it first")

    if not fails:
        others = sum(1 for tid in threads if tid != self_id)
        passes.append(
            f"{len(doc['tasks'])} task(s) result_available and settled, "
            f"{others} other thread(s) settled, 0 pending questions "
            f"(snapshot {age_sec / 60:.0f} min old)"
        )
    return fails, passes


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("snapshot", help="snapshot JSON path, or - for stdin")
    ap.add_argument("--max-age-min", type=float, default=15.0)
    ap.add_argument("--now", help="ISO-8601 clock override (tests only)")
    args = ap.parse_args()
    try:
        now = parse_ts(args.now) if args.now else datetime.now(timezone.utc)
        doc = load(args.snapshot)
        validate(doc)
    except Invalid as exc:
        print(f"FAIL invalid T3 snapshot: {exc}")
        return 2
    fails, passes = judge(doc, now, args.max_age_min)
    for line in fails:
        print(f"FAIL {line}")
    for line in passes:
        print(f"PASS {line}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
