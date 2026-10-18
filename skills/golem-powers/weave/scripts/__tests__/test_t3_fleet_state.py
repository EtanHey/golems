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


def run_state(path: str, stdin: str | None = None, *extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), path, "--now", NOW, *extra],
        input=stdin,
        capture_output=True,
        text=True,
    )


def run_doc(doc: dict, *extra: str) -> subprocess.CompletedProcess:
    return run_state("-", json.dumps(doc), *extra)


def converged() -> dict:
    return json.loads((FIXTURES / "converged.json").read_text())


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
        doc["threads"].append(
            {"threadId": "thread:asker", "title": "q", "status": "waiting", "settled": False}
        )
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
        doc["threads"].append(
            {"threadId": "thread:idle", "title": "idle", "status": "idle", "settled": False}
        )
        r = run_doc(doc)
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"FAIL .*thread:idle.*settle it")

    def test_pending_request_fails(self) -> None:
        doc = converged()
        doc["pending_requests"] = [{"threadId": "thread:orc", "question": "which?"}]
        r = run_doc(doc)
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"FAIL .*pending question")

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

    def test_incomplete_listing_fails(self) -> None:
        doc = converged()
        doc["threads_complete"] = False
        self.assert_invalid(run_doc(doc), "threads_complete")

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


if __name__ == "__main__":
    unittest.main()
