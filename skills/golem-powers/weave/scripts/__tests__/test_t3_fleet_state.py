#!/usr/bin/env python3
"""RED/GREEN tests for t3-fleet-state.py (weave convergence gate, T3 fleet).

The gate cannot call MCP, so a lead captures t3_thread_list / task_status rows
into a JSON snapshot. These tests pin the verdicts: a converged snapshot
passes; a working child, a completed-but-unsettled worker, a malformed or
stale snapshot, and any unknown state all fail closed.

Fixtures are DURABLE, committed under evals/fixtures/t3-fleet-state/. Variants
are fed on stdin ("-") so no scratch files are written.
"""
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "t3-fleet-state.py"
FIXTURES = Path(__file__).resolve().parents[2] / "evals" / "fixtures" / "t3-fleet-state"
NOW = "2026-10-18T21:05:00Z"  # 5 min after every fixture's captured_at
PROJECT = "project:fleet"  # the fleet project set every fixture covers


def run_state(path: str, stdin: str | None = None, *extra: str,
              projects: str | None = PROJECT) -> subprocess.CompletedProcess:
    expect = [] if projects is None else ["--expect-projects", projects]
    return subprocess.run(
        [sys.executable, str(SCRIPT), path, "--now", NOW, *expect, *extra],
        input=stdin,
        capture_output=True,
        text=True,
    )


def run_doc(doc: dict, *extra: str, projects: str | None = PROJECT) -> subprocess.CompletedProcess:
    return run_state("-", json.dumps(doc), *extra, projects=projects)


def converged() -> dict:
    return json.loads((FIXTURES / "converged.json").read_text())


def add_listed(doc: dict, row: dict) -> None:
    """Append an unsettled t3_thread_list row and bump its project's total."""
    doc["threads"].append({"projectId": PROJECT, **row})
    next(p for p in doc["projects"] if p["projectId"] == PROJECT)["total"] += 1


def task(doc: dict, task_id: str) -> dict:
    return next(t for t in doc["tasks"] if t["taskId"] == task_id)


def thread(doc: dict, thread_id: str) -> dict:
    return next(t for t in doc["threads"] if t["threadId"] == thread_id)


class Converged(unittest.TestCase):
    def test_converged_snapshot_passes(self) -> None:
        r = run_state(str(FIXTURES / "converged.json"))
        self.assertEqual(r.returncode, 0, msg=r.stdout + r.stderr)
        self.assertNotIn("FAIL", r.stdout)
        self.assertIn("PASS", r.stdout)

    def test_self_thread_running_is_not_counted_as_work(self) -> None:
        r = run_state(str(FIXTURES / "converged.json"))
        self.assertEqual(r.returncode, 0, msg=r.stdout + r.stderr)
        self.assertNotIn("thread:orc", "\n".join(
            line for line in r.stdout.splitlines() if line.startswith("FAIL")
        ))


class NotConverged(unittest.TestCase):
    def test_working_child_fails(self) -> None:
        r = run_state(str(FIXTURES / "working-child.json"))
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"FAIL .*task:pr8-impl.*working")
        self.assertRegex(r.stdout, r"FAIL .*thread:pr8-worker.*running")

    def test_result_available_but_unsettled_worker_fails_with_settle_instruction(self) -> None:
        r = run_state(str(FIXTURES / "unsettled-result.json"))
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"FAIL .*task:pr2-impl.*result_available.*not settled")
        self.assertIn("settle it", r.stdout)

    def test_waiting_for_children_fails(self) -> None:
        doc = converged()
        doc["tasks"][0]["workState"] = "waiting_for_children"
        r = run_doc(doc)
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"FAIL .*task:pr1-impl.*waiting_for_children")

    def test_result_available_with_pending_child_runs_fails(self) -> None:
        doc = converged()
        doc["tasks"][0]["hasPendingChildRuns"] = True
        r = run_doc(doc)
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"FAIL .*task:pr1-impl.*pending child runs")

    def test_unknown_task_state_fails_closed(self) -> None:
        doc = converged()
        doc["tasks"][0]["workState"] = "mystery"
        r = run_doc(doc)
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"FAIL .*task:pr1-impl.*unknown workState 'mystery'")

    def test_waiting_thread_is_a_pending_question(self) -> None:
        doc = converged()
        add_listed(doc, {"threadId": "thread:asker", "title": "q", "status": "waiting", "settled": False})
        r = run_doc(doc)
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"FAIL .*thread:asker.*waiting")

    def test_unknown_thread_status_fails_closed(self) -> None:
        doc = converged()
        doc["threads"][1]["status"] = "teleporting"
        r = run_doc(doc)
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"FAIL .*thread:old-worker.*unknown status 'teleporting'")

    def test_settled_thread_still_running_fails(self) -> None:
        doc = converged()
        doc["threads"][1]["status"] = "running"
        r = run_doc(doc)
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"FAIL .*thread:old-worker.*running")

    def test_idle_unsettled_thread_fails_with_settle_instruction(self) -> None:
        doc = converged()
        add_listed(doc, {"threadId": "thread:idle", "title": "idle", "status": "idle", "settled": False})
        r = run_doc(doc)
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"FAIL .*thread:idle.*settle it")

    def test_pending_request_fails(self) -> None:
        doc = converged()
        doc["pending_requests"] = [{"threadId": "thread:orc", "requestIds": ["request:1"]}]
        r = run_doc(doc)
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"FAIL .*pending question.*thread:orc")

    def test_stale_snapshot_fails(self) -> None:
        r = run_state(str(FIXTURES / "converged.json"), None, "--max-age-min", "2")
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"FAIL .*stale")

    def test_future_snapshot_fails(self) -> None:
        doc = converged()
        doc["captured_at"] = "2026-10-18T22:00:00Z"
        r = run_doc(doc)
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"FAIL .*future")

    def test_self_thread_missing_from_listing_fails(self) -> None:
        doc = converged()
        doc["threads"] = doc["threads"][1:]
        r = run_doc(doc)
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"FAIL .*self_thread_id 'thread:orc' is not in threads")


class Invalid(unittest.TestCase):
    def assert_invalid(self, r: subprocess.CompletedProcess, pattern: str) -> None:
        self.assertEqual(r.returncode, 2, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"FAIL .*" + pattern)

    def test_malformed_json_fails(self) -> None:
        self.assert_invalid(run_state(str(FIXTURES / "malformed.json")), "not valid JSON")

    def test_missing_file_fails(self) -> None:
        self.assert_invalid(run_state(str(FIXTURES / "does-not-exist.json")), "cannot read")

    def test_wrong_schema_fails(self) -> None:
        doc = converged()
        doc["schema"] = "something/v0"
        self.assert_invalid(run_doc(doc), "schema")

    def test_projects_must_be_present(self) -> None:
        doc = converged()
        del doc["projects"]
        self.assert_invalid(run_doc(doc), "projects")

    def test_thread_row_needs_project_id(self) -> None:
        doc = converged()
        del thread(doc, "thread:orc")["projectId"]
        self.assert_invalid(run_doc(doc), r"threads\[0\]\.projectId")

    def test_naive_timestamp_fails(self) -> None:
        doc = converged()
        doc["captured_at"] = "2026-10-18T21:00:00"
        self.assert_invalid(run_doc(doc), "captured_at")

    def test_settled_must_be_boolean(self) -> None:
        doc = converged()
        doc["threads"][1]["settled"] = "yes"
        self.assert_invalid(run_doc(doc), "settled")

    def test_task_without_child_thread_cannot_prove_settlement(self) -> None:
        doc = converged()
        del doc["tasks"][0]["childThreadId"]
        self.assert_invalid(run_doc(doc), "childThreadId")

    def test_tasks_must_be_a_list(self) -> None:
        doc = converged()
        doc["tasks"] = {}
        self.assert_invalid(run_doc(doc), "tasks")


class FailOpenProbes(unittest.TestCase):
    """Review round 1 (Cursor + Sol on f55ef551): each of these printed PASS / exit 0.

    The gate passes only when convergence is proven; every absence, duplicate,
    unknown value or missing liveness field blocks.
    """

    def assert_blocks(self, r: subprocess.CompletedProcess, pattern: str, rc: int = 1) -> None:
        self.assertEqual(r.returncode, rc, msg=r.stdout + r.stderr)
        self.assertNotIn("PASS", r.stdout)
        self.assertRegex(r.stdout, r"FAIL .*" + pattern)

    def test_result_available_child_absent_from_snapshot_blocks(self) -> None:
        doc = converged()
        doc["threads"] = [t for t in doc["threads"] if t["threadId"] != "thread:pr2-worker"]
        self.assert_blocks(run_doc(doc), r"task:pr2-impl.*thread:pr2-worker.*missing")

    def test_missing_has_pending_child_runs_is_invalid(self) -> None:
        doc = converged()
        del task(doc, "task:pr1-impl")["hasPendingChildRuns"]
        self.assert_blocks(run_doc(doc), "hasPendingChildRuns", rc=2)

    def test_missing_has_pending_question_is_invalid(self) -> None:
        doc = converged()
        del task(doc, "task:pr1-impl")["hasPendingQuestion"]
        self.assert_blocks(run_doc(doc), "hasPendingQuestion", rc=2)

    def test_task_with_pending_question_blocks(self) -> None:
        doc = converged()
        task(doc, "task:pr1-impl")["hasPendingQuestion"] = True
        self.assert_blocks(run_doc(doc), r"task:pr1-impl.*pending question")

    def test_missing_task_status_is_invalid(self) -> None:
        doc = converged()
        del task(doc, "task:pr1-impl")["status"]
        self.assert_blocks(run_doc(doc), r"tasks\[0\]\.status", rc=2)

    def test_unknown_task_status_blocks(self) -> None:
        doc = converged()
        task(doc, "task:pr1-impl")["status"] = "teleporting"
        self.assert_blocks(run_doc(doc), r"task:pr1-impl.*unknown status 'teleporting'")

    def test_result_available_with_running_status_is_inconsistent(self) -> None:
        doc = converged()
        task(doc, "task:pr1-impl")["status"] = "running"
        self.assert_blocks(run_doc(doc), r"task:pr1-impl.*result_available.*running")

    def test_duplicate_thread_running_then_settled_is_invalid(self) -> None:
        doc = converged()
        live = dict(thread(doc, "thread:old-worker"), status="running", settled=False)
        doc["threads"].insert(1, live)
        self.assert_blocks(run_doc(doc), r"duplicate threadId 'thread:old-worker'", rc=2)

    def test_duplicate_thread_settled_then_running_is_invalid(self) -> None:
        doc = converged()
        live = dict(thread(doc, "thread:old-worker"), status="running", settled=False)
        doc["threads"].append(live)
        self.assert_blocks(run_doc(doc), r"duplicate threadId 'thread:old-worker'", rc=2)

    def test_duplicate_task_id_is_invalid(self) -> None:
        doc = converged()
        doc["tasks"].append(dict(task(doc, "task:pr1-impl")))
        self.assert_blocks(run_doc(doc), r"duplicate taskId 'task:pr1-impl'", rc=2)

    def test_self_thread_unknown_status_blocks(self) -> None:
        doc = converged()
        thread(doc, "thread:orc")["status"] = "teleporting"
        self.assert_blocks(run_doc(doc), r"thread:orc.*unknown status 'teleporting'")

    def test_self_thread_waiting_blocks(self) -> None:
        doc = converged()
        thread(doc, "thread:orc")["status"] = "waiting"
        self.assert_blocks(run_doc(doc), r"thread:orc.*waiting")

    def test_no_fleet_project_set_blocks(self) -> None:
        self.assert_blocks(run_doc(converged(), projects=None), "fleet project set")

    def test_fleet_project_not_captured_blocks(self) -> None:
        r = run_doc(converged(), projects=f"{PROJECT} project:other")
        self.assert_blocks(r, r"fleet project 'project:other' was not captured")

    def test_listing_short_of_total_blocks(self) -> None:
        doc = converged()
        doc["projects"][0]["total"] = 2
        self.assert_blocks(run_doc(doc), r"project:fleet.*1 unsettled.*total is 2")

    def test_unsettled_thread_from_unswept_project_blocks(self) -> None:
        doc = converged()
        doc["threads"].append({"threadId": "thread:elsewhere", "projectId": "project:other",
                               "status": "completed", "settled": False})
        self.assert_blocks(run_doc(doc), r"thread:elsewhere.*project:other.*not swept")

    def test_pending_request_list_response_shape_blocks(self) -> None:
        # t3_pending_request_list returns {"requestIds": [...]}; the lead records
        # one row per call as {"threadId": <thread asked>, **response}.
        r = run_state(str(FIXTURES / "pending-question.json"))
        self.assert_blocks(r, r"pending question.*thread:orc.*request:which-base-branch")

    def test_pending_requests_must_cover_self_thread(self) -> None:
        doc = converged()
        doc["pending_requests"] = []
        self.assert_blocks(run_doc(doc), r"no t3_pending_request_list result for self thread")

    def test_pending_requests_row_without_request_ids_is_invalid(self) -> None:
        doc = converged()
        doc["pending_requests"] = [{"threadId": "thread:orc"}]
        self.assert_blocks(run_doc(doc), "requestIds", rc=2)

    def test_pending_requests_missing_is_invalid(self) -> None:
        doc = converged()
        del doc["pending_requests"]
        self.assert_blocks(run_doc(doc), "pending_requests", rc=2)

    def test_thread_pending_request_count_blocks(self) -> None:
        doc = converged()
        thread(doc, "thread:old-worker")["pendingRequestCount"] = 1
        self.assert_blocks(run_doc(doc), r"thread:old-worker.*pending request")


if __name__ == "__main__":
    unittest.main()
