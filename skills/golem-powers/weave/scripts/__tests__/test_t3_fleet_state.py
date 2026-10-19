#!/usr/bin/env python3
"""RED/GREEN tests for t3-fleet-state.py (weave convergence gate, T3 fleet).

The gate cannot call MCP, so a lead captures t3_thread_list / task_status rows
into a JSON snapshot. These tests pin the verdicts: a converged snapshot
passes; a working child, a completed-but-unsettled worker, a malformed or
stale snapshot, and any unknown state all fail closed.

Fixtures are DURABLE, committed under evals/fixtures/t3-fleet-state/. Variants
are fed on stdin ("-"); the unsettled-id files the judge writes go to
per-test scratch dirs, never beside a committed fixture.
"""
from __future__ import annotations

import json
import subprocess
import re
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "t3-fleet-state.py"
FIXTURES = Path(__file__).resolve().parents[2] / "evals" / "fixtures" / "t3-fleet-state"
NOW = "2026-10-18T21:05:00Z"  # 5 min after every fixture's captured_at
PROJECT = "project:fleet"  # the fleet project set every fixture covers
SCRATCH = tempfile.TemporaryDirectory(prefix="t3-fleet-state-ids-")  # removed at exit


def run_state(path: str, stdin: str | None = None, *extra: str,
              projects: str | None = PROJECT) -> subprocess.CompletedProcess:
    expect = [] if projects is None else ["--expect-projects", projects]
    if path.startswith(str(FIXTURES)) and "--unsettled-out" not in extra:
        # never write <fixture>.unsettled.tsv into the committed fixture dir
        extra = (*extra, "--unsettled-out", str(Path(SCRATCH.name) / "ids.tsv"))
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
        self.assertRegex(r.stdout, r"FAIL 1 finished thread\(s\) not settled — settle them \(1 idle\)")
        self.assertRegex(r.stdout, r"NOTE unsettled thread:idle \(idle\)")

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
        r = run_doc(doc)
        self.assert_blocks(r, r"thread:old-worker.*pending request")
        self.assertIn("decline its pending approval in the T3 app (MCP cannot), then settle", r.stdout)

    # Review round 2 (Sol on 65bc3123): both mutations printed PASSED.
    def test_self_thread_in_unswept_project_blocks(self) -> None:
        doc = converged()
        thread(doc, "thread:orc")["projectId"] = "project:unswept"
        doc["projects"][0]["total"] = 0
        self.assert_blocks(run_doc(doc), r"thread:orc.*project:unswept.*not swept")

    def test_thread_status_idle_is_not_a_task_status(self) -> None:
        doc = converged()
        task(doc, "task:pr1-impl")["status"] = "idle"
        self.assert_blocks(run_doc(doc), r"task:pr1-impl.*unknown status 'idle'")

    def test_thread_status_rolled_back_is_not_a_task_status(self) -> None:
        doc = converged()
        task(doc, "task:pr1-impl")["status"] = "rolled_back"
        self.assert_blocks(run_doc(doc), r"task:pr1-impl.*unknown status 'rolled_back'")

    def test_every_terminal_task_status_passes(self) -> None:
        for status in ("completed", "failed", "cancelled", "interrupted"):
            with self.subTest(status=status):
                doc = converged()
                task(doc, "task:pr1-impl")["status"] = status
                r = run_doc(doc)
                self.assertEqual(r.returncode, 0, msg=r.stdout + r.stderr)

    def test_result_available_with_live_task_status_is_inconsistent(self) -> None:
        for status in ("queued", "running", "waiting"):
            with self.subTest(status=status):
                doc = converged()
                task(doc, "task:pr1-impl")["status"] = status
                self.assert_blocks(run_doc(doc), rf"task:pr1-impl.*result_available.*{status}")



LIVE = FIXTURES / "live-2026-10-19-slim.json"
LIVE_NOW = "2026-10-19T01:36:54Z"  # 1 min after the live capture
LIVE_PROJECTS = " ".join(p["projectId"] for p in json.loads(LIVE.read_text())["projects"])
# Titles in the public fixture are neutral placeholders (thread-<n>); match by id.
LIVE_RUNNING = (
    "thread:delegated-task:command%3Amcp%3Ad9decfdc-341a-4e44-a99a-45986c4e049b"
    "%3Adelegate-task%3Askill-lead-pr805-fix-r2",
    "mcp:6bb2062f-209b-4dd2-91e7-04ff8e6793a0",
    "mcp:6e21f367-9d2b-4d23-baef-a916aa140d03",
    "thread:delegated-task:command%3Amcp%3Aab5dc856-fa6b-4b79-9867-305653494527"
    "%3Adelegate-task%3Asmart-eval-decode-20261019",
    "mcp:8ac2385e-04e7-4ea5-97a9-d9ea173bec52",
)
SCRUB_THREAD = "mcp:6e21f367-9d2b-4d23-baef-a916aa140d03"
SYSTEM_THREAD = "import:claudeAgent:697CED41-A173-4DF4-B9C7-C8EFFFD9D581"
ETAN_THREAD = "e38c37b7-ddf9-4c0a-b005-45434544ba82"


def run_live(doc: dict | None, out: Path, *extra: str) -> subprocess.CompletedProcess:
    """Judge the live 2026-10-19 snapshot (slim projection) or a mutation of it."""
    stdin = None if doc is None else json.dumps(doc)
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(LIVE) if doc is None else "-", "--now", LIVE_NOW,
         "--expect-projects", LIVE_PROJECTS, "--unsettled-out", str(out), *extra],
        input=stdin, capture_output=True, text=True,
    )


def fails(r: subprocess.CompletedProcess) -> list[str]:
    return [line for line in r.stdout.splitlines() if line.startswith("FAIL ")]


class Scratch(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(prefix="t3-fleet-state-test-")
        self.out = Path(self._tmp.name) / "unsettled.tsv"

    def tearDown(self) -> None:
        self._tmp.cleanup()


class LiveDryRun(Scratch):
    """D1/D2 on the real 2026-10-19 fleet: 238 settle-hygiene FAILs hid 5 running threads."""

    def test_in_flight_first_then_one_summary_line(self) -> None:
        r = run_live(None, self.out)
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        lines = fails(r)
        self.assertEqual(len(lines), 6, msg=r.stdout)
        for line in lines[:5]:
            self.assertRegex(line, r"is running — work in flight$")
        self.assertEqual(sorted(t for t in LIVE_RUNNING if any(f"thread {t} " in l for l in lines[:5])),
                         sorted(LIVE_RUNNING))
        self.assertRegex(
            lines[5],
            r"^FAIL 237 finished thread\(s\) not settled — settle them "
            r"\(209 completed, 14 interrupted, 10 idle, 4 failed\); ids: " + re.escape(str(self.out)),
        )
        self.assertNotIn("PASS", r.stdout)

    def test_id_file_lists_every_unsettled_worker(self) -> None:
        run_live(None, self.out)
        rows = [line.split("\t") for line in self.out.read_text().splitlines()]
        self.assertEqual(len(rows), 237)
        self.assertEqual(len({row[0] for row in rows}), 237)
        self.assertNotIn(ETAN_THREAD, {row[0] for row in rows})
        self.assertIn((SYSTEM_THREAD, "completed", "system"),
                      {tuple(row[:3]) for row in rows})  # createdBy:system is a worker

    def test_etan_conversation_is_a_note(self) -> None:
        r = run_live(None, self.out)
        self.assertRegex(r.stdout, rf"NOTE thread {ETAN_THREAD} .*createdBy:user.*not a worker")
        self.assertNotIn(ETAN_THREAD, "\n".join(fails(r)))

    def test_public_fixture_carries_no_real_titles(self) -> None:
        # Review r1 BLOCKING (#807): the public fixture shipped every live thread title.
        threads = json.loads(LIVE.read_text())["threads"]
        self.assertEqual([t["title"] for t in threads],
                         [f"thread-{n}" for n in range(1, len(threads) + 1)])

    def test_slim_projection_needs_no_dropped_field(self) -> None:
        doc = json.loads(LIVE.read_text())
        for row in doc["threads"]:
            for key in ("title", "createdBy", "parentThreadId", "updatedAt"):
                row.pop(key)
        r = run_live(doc, self.out)
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertNotIn("invalid", r.stdout)
        # createdBy dropped: the user conversation is a worker again (fail closed)
        self.assertRegex(fails(r)[-1], r"^FAIL 238 finished thread\(s\) not settled")

    def test_settled_row_inside_unsettled_sweep_is_named(self) -> None:
        # perturbation p1: a running thread flipped to completed + settled, row kept, total unchanged
        doc = json.loads(LIVE.read_text())
        scrub = next(t for t in doc["threads"] if t["threadId"] == SCRUB_THREAD)
        scrub.update(status="completed", settled=True)
        r = run_live(doc, self.out)
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertNotIn("read every page", r.stdout)
        self.assertRegex(r.stdout, rf"FAIL .*{re.escape(scrub['threadId'])} .*settled:true.*"
                                   r"settled:false sweep")

    def test_all_settled_but_runner_passes_with_proven_counts(self) -> None:
        # perturbation p4 (positive control): only the gate runner is unsettled
        doc = json.loads(LIVE.read_text())
        doc["threads"] = [t for t in doc["threads"] if t["threadId"] == doc["self_thread_id"]]
        for p in doc["projects"]:
            p["total"] = sum(1 for t in doc["threads"] if t["projectId"] == p["projectId"])
        r = run_live(doc, self.out)
        self.assertEqual(r.returncode, 0, msg=r.stdout + r.stderr)
        self.assertNotIn("other thread(s) settled", r.stdout)
        self.assertRegex(r.stdout, r"PASS 5 project\(s\) swept: 1 unsettled thread\(s\) "
                                   r"listed = the totals, the gate runner only")


class SummaryAndOrder(Scratch):
    def test_in_flight_prints_before_hygiene_whatever_the_row_order(self) -> None:
        doc = converged()
        add_listed(doc, {"threadId": "thread:done", "title": "d", "status": "completed", "settled": False})
        add_listed(doc, {"threadId": "thread:busy", "title": "b", "status": "running", "settled": False})
        r = run_doc(doc, "--unsettled-out", str(self.out))
        lines = fails(r)
        self.assertRegex(lines[0], r"thread:busy.*running")
        self.assertRegex(lines[-1], r"^FAIL 1 finished thread\(s\) not settled")

    def test_summary_writes_ids_and_still_blocks(self) -> None:
        doc = converged()
        for i, status in enumerate(("completed", "completed", "failed")):
            add_listed(doc, {"threadId": f"thread:w{i}", "title": f"w{i}", "status": status,
                             "settled": False})
        r = run_doc(doc, "--unsettled-out", str(self.out))
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertEqual(len(fails(r)), 1, msg=r.stdout)
        self.assertIn("(2 completed, 1 failed)", r.stdout)
        self.assertEqual([line.split("\t")[0] for line in self.out.read_text().splitlines()],
                         ["thread:w0", "thread:w1", "thread:w2"])

    def test_snapshot_path_defaults_the_id_file_beside_it(self) -> None:
        doc = converged()
        add_listed(doc, {"threadId": "thread:w", "title": "w", "status": "idle", "settled": False})
        snap = Path(self._tmp.name) / "snap.json"
        snap.write_text(json.dumps(doc))
        r = run_state(str(snap))
        beside = Path(self._tmp.name) / "snap.unsettled.tsv"
        self.assertIn(f"ids: {beside}", r.stdout)
        self.assertTrue(beside.read_text().startswith("thread:w\tidle"))


class UserConversation(Scratch):
    """D2 lead ruling 2026-10-19: createdBy:"user" is Etan's own conversation, not a worker."""

    def judge(self, **row) -> subprocess.CompletedProcess:
        doc = converged()
        add_listed(doc, {"threadId": "thread:etan", "title": "etan", "settled": False,
                         "createdBy": "user", **row})
        return run_doc(doc, "--unsettled-out", str(self.out))

    def test_finished_unsettled_user_thread_is_a_note(self) -> None:
        for status in ("completed", "idle", "failed"):
            with self.subTest(status=status):
                r = self.judge(status=status)
                self.assertEqual(r.returncode, 0, msg=r.stdout + r.stderr)
                self.assertRegex(r.stdout, r"NOTE thread thread:etan .*createdBy:user")
                self.assertRegex(r.stdout, r"PASS .*1 user conversation\(s\) noted")

    def test_active_user_thread_blocks(self) -> None:
        r = self.judge(status="running")
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"FAIL thread thread:etan .*running — work in flight")

    def test_waiting_user_thread_blocks(self) -> None:
        r = self.judge(status="waiting")
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"FAIL thread thread:etan .*waiting")

    def test_interrupted_user_thread_needs_its_pending_count(self) -> None:
        r = self.judge(status="interrupted")
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"FAIL thread thread:etan .*no pendingRequestCount — t3_thread_read")
        r = self.judge(status="interrupted", pendingRequestCount=0)
        self.assertEqual(r.returncode, 0, msg=r.stdout + r.stderr)

    def test_user_thread_with_pending_approval_blocks(self) -> None:
        r = self.judge(status="interrupted", pendingRequestCount=1)
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertIn("decline its pending approval in the T3 app (MCP cannot), then settle", r.stdout)

    def test_system_thread_is_still_a_worker(self) -> None:
        r = self.judge(status="completed", createdBy="system")
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"FAIL 1 finished thread\(s\) not settled")


class PendingApprovals(Scratch):
    """D3: t3_thread_list rows carry no pendingRequestCount; a missing count never PASSes."""

    def test_interrupted_worker_without_count_blocks_without_crash(self) -> None:
        doc = converged()
        add_listed(doc, {"threadId": "thread:cancelled", "title": "c", "status": "interrupted",
                         "settled": False})
        r = run_doc(doc, "--unsettled-out", str(self.out))
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertNotIn("PASS", r.stdout)
        self.assertEqual(r.stderr, "")

    def test_worker_pending_approval_names_the_app_step(self) -> None:
        doc = converged()
        add_listed(doc, {"threadId": "thread:cancelled", "title": "c", "status": "interrupted",
                         "settled": False, "pendingRequestCount": 1})
        r = run_doc(doc, "--unsettled-out", str(self.out))
        self.assertRegex(r.stdout, r"FAIL thread thread:cancelled .*1 pending request\(s\) — "
                                   r"decline its pending approval in the T3 app \(MCP cannot\), then settle")
        self.assertRegex(fails(r)[0], "thread:cancelled")  # a live blocker, printed first


class CaptureClock(unittest.TestCase):
    def test_stale_message_measures_from_capture_start(self) -> None:
        r = run_state(str(FIXTURES / "converged.json"), None, "--max-age-min", "2")
        self.assertRegex(r.stdout, r"FAIL snapshot is stale \(capture started 5 min ago > 2 min\)")



# Review r1 (#807, Sol + Cursor) literal repro: an interrupted user thread with
# pendingRequestCount -1 printed a NOTE and PASSed (judge rc 0, gate PASSED).
NEGATIVE_COUNT_REPRO = {
    "schema": "weave-t3-fleet/v1", "captured_at": "2026-10-18T21:00:00Z", "self_thread_id": "self",
    "projects": [{"projectId": "project:fleet", "total": 2}],
    "threads": [
        {"threadId": "self", "projectId": "project:fleet", "status": "running", "settled": False},
        {"threadId": "u", "projectId": "project:fleet", "status": "interrupted", "settled": False,
         "createdBy": "user", "pendingRequestCount": -1},
    ],
    "tasks": [], "pending_requests": [{"threadId": "self", "requestIds": []}],
}


class PendingCountValidation(Scratch):
    def test_negative_count_repro_is_invalid(self) -> None:
        r = run_doc(json.loads(json.dumps(NEGATIVE_COUNT_REPRO)), "--unsettled-out", str(self.out))
        self.assertEqual(r.returncode, 2, msg=r.stdout + r.stderr)
        self.assertNotIn("PASS", r.stdout)
        self.assertRegex(r.stdout, r"FAIL invalid T3 snapshot: threads\[1\]\.pendingRequestCount "
                                   r"must be a non-negative integer")

    def test_negative_count_on_a_worker_is_invalid(self) -> None:
        doc = converged()
        thread(doc, "thread:old-worker")["pendingRequestCount"] = -3
        self.assertEqual(run_doc(doc).returncode, 2)

    def test_non_integer_counts_are_invalid(self) -> None:
        for bad in ("0", True, 0.0, None):
            with self.subTest(count=bad):
                doc = json.loads(json.dumps(NEGATIVE_COUNT_REPRO))
                doc["threads"][1]["pendingRequestCount"] = bad
                r = run_doc(doc, "--unsettled-out", str(self.out))
                self.assertEqual(r.returncode, 2, msg=r.stdout + r.stderr)

    def test_interrupted_user_note_needs_exactly_zero(self) -> None:
        doc = json.loads(json.dumps(NEGATIVE_COUNT_REPRO))
        doc["threads"][1]["pendingRequestCount"] = 0
        r = run_doc(doc, "--unsettled-out", str(self.out))
        self.assertEqual(r.returncode, 0, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"NOTE thread u .*createdBy:user")


def system_worker_snapshot(capture: Path) -> Path:
    """Review r1 symlink repro: one finished createdBy:system worker, default id path."""
    doc = json.loads(json.dumps(NEGATIVE_COUNT_REPRO))
    doc["threads"][1] = {"threadId": "u", "projectId": "project:fleet", "status": "completed",
                         "settled": False, "createdBy": "system"}
    capture.mkdir(parents=True)
    snap = capture / "snap.json"
    snap.write_text(json.dumps(doc))
    return snap


class IdFileSymlinks(Scratch):
    """Review r1 MAJOR (#807): the predictable <ids>.tmp path followed a planted symlink."""

    def setUp(self) -> None:
        super().setUp()
        root = Path(self._tmp.name)
        self.snap = system_worker_snapshot(root / "capture")
        self.keep = root / "outside" / "keep.txt"
        self.keep.parent.mkdir()
        self.keep.write_text("KEEP\n")
        self.ids = root / "capture" / "snap.unsettled.tsv"

    def test_planted_tmp_symlink_is_not_followed(self) -> None:
        (self.snap.parent / "snap.unsettled.tsv.tmp").symlink_to(self.keep)
        r = run_state(str(self.snap))
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertEqual(self.keep.read_text(), "KEEP\n")
        self.assertFalse(self.ids.is_symlink())
        self.assertEqual(self.ids.read_text(), "u\tcompleted\tsystem\t\t\n")
        self.assertEqual(sorted(p.name for p in self.snap.parent.iterdir()),
                         ["snap.json", "snap.unsettled.tsv", "snap.unsettled.tsv.tmp"])

    def test_symlinked_target_is_refused(self) -> None:
        self.ids.symlink_to(self.keep)
        r = run_state(str(self.snap))
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertEqual(self.keep.read_text(), "KEEP\n")
        self.assertTrue(self.ids.is_symlink())
        self.assertRegex(r.stdout, r"FAIL refusing to write the unsettled ids: .*snap\.unsettled\.tsv "
                                   r"is a symlink")
        self.assertRegex(r.stdout, r"NOTE unsettled u \(completed\)")
        self.assertEqual(sorted(p.name for p in self.snap.parent.iterdir()),
                         ["snap.json", "snap.unsettled.tsv"])  # no temp file left behind


if __name__ == "__main__":
    unittest.main()
