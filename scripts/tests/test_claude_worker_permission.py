"""Claude PermissionRequest hook: deny only in an unattended T3 worker, else fail open.

Every case runs the hook exactly as registered: the pinned interpreter with
-I -B, through the fail-open launcher. The three worker cases fail on a tree
without the hook (the launcher then prints nothing); the others pin that every
non-worker or broken state stays silent, which leaves Claude's own prompt.
"""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
HOOK = ROOT / "scripts/hooks/claude-worker-permission.py"
LAUNCHER = ROOT / "scripts/hooks/fail-open.py"
MANIFEST = ROOT / "scripts/hooks/manifest.json"
SCRATCH = ROOT / "docs.local/claude-worker-permission-tests"
PAYLOAD = {"hook_event_name": "PermissionRequest", "tool_name": "Bash",
           "tool_input": {"command": 'LINES=(${(f)"$(printf "a\\nb\\n")"})'}}
EXPECTED = {"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {
    "behavior": "deny",
    "message": ("This step needs a person's approval, and this worker runs unattended. "
                "Do it another way that needs no approval (for a shell step: Edit/Write tools, "
                "or one plain literal command, or a script file you run), or report BLOCKED to "
                "your lead with exactly what you needed.")}}}

SCHEMA = """CREATE TABLE orchestration_v2_projection_threads (
  thread_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
  payload_json TEXT NOT NULL)"""


def payload_json(parent=None, created_by="agent", delegated_from=None, relationship=None):
    return json.dumps({
        "createdBy": created_by,
        "delegatedFrom": delegated_from,
        "lineage": {"parentThreadId": parent, "relationshipToParent": relationship,
                    "rootThreadId": parent or "root"},
    })


class WorkerPermissionHook(unittest.TestCase):
    def setUp(self):
        SCRATCH.mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=SCRATCH)
        self.db = Path(self.tmp.name) / "statev2.sqlite"
        con = sqlite3.connect(self.db)
        con.execute(SCHEMA)
        rows = {
            "launched-worker": payload_json(delegated_from={"threadId": "lead", "title": "lead"}),
            "agent-child": payload_json(parent="lead", created_by="agent", relationship="subagent"),
            "agent-fork": payload_json(parent="lead", created_by="agent", relationship="fork"),
            "user-fork": payload_json(parent="lead", created_by="user", relationship="fork"),
            "lead": payload_json(),
            "user-top": payload_json(created_by="user"),
            "null-delegated": json.dumps({"createdBy": "agent", "delegatedFrom": None,
                                          "lineage": {"parentThreadId": None}}),
            "empty-parent": payload_json(parent=""),
            "string-delegated": payload_json(delegated_from="lead"),
            "malformed": "{not json",
        }
        con.executemany("INSERT INTO orchestration_v2_projection_threads VALUES (?, 'p', 't', ?)",
                        list(rows.items()))
        con.commit()
        con.close()

    def tearDown(self):
        self.tmp.cleanup()

    def run_hook(self, thread_id, db=None, hook=HOOK):
        env = {k: v for k, v in os.environ.items() if k not in ("T3CODE_THREAD_ID", "GOLEMS_T3_STATE_DB")}
        env["GOLEMS_T3_STATE_DB"] = str(db if db is not None else self.db)
        if thread_id is not None:
            env["T3CODE_THREAD_ID"] = thread_id
        proc = subprocess.run([sys.executable, "-I", "-B", str(LAUNCHER), str(hook)],
                              input=json.dumps(PAYLOAD), capture_output=True, text=True,
                              env=env, timeout=10, cwd=self.tmp.name)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return proc

    def assert_denies(self, thread_id, **kw):
        proc = self.run_hook(thread_id, **kw)
        self.assertEqual(json.loads(proc.stdout), EXPECTED)
        self.assertEqual(proc.stderr, "")

    def assert_silent(self, thread_id, **kw):
        proc = self.run_hook(thread_id, **kw)
        self.assertEqual(proc.stdout, "", "a non-worker must leave Claude's own prompt in place")

    # --- worker branches (each fails on a tree without the hook) ---
    def test_delegated_task_prefix_denies_without_any_db(self):
        self.assert_denies("thread:delegated-task:command%3Aexample", db=Path(self.tmp.name) / "absent.sqlite")

    def test_delegated_from_record_denies(self):
        self.assert_denies("launched-worker")

    def test_parent_created_by_agent_denies(self):
        self.assert_denies("agent-child")
        self.assert_denies("agent-fork")

    # --- attended or unknown: silent (fail open) ---
    def test_user_fork_or_side_chat_is_attended(self):
        self.assert_silent("user-fork")

    def test_top_level_lead_is_attended(self):
        self.assert_silent("lead")
        self.assert_silent("user-top")

    def test_no_thread_id_is_silent(self):
        self.assert_silent(None)
        self.assert_silent("")

    def test_unknown_thread_is_silent(self):
        self.assert_silent("not-in-db")

    def test_prefix_must_be_a_prefix(self):
        self.assert_silent("x-thread:delegated-task:abc")

    def test_null_or_empty_or_non_object_lineage_values_are_silent(self):
        self.assert_silent("null-delegated")
        self.assert_silent("empty-parent")
        self.assert_silent("string-delegated")

    def test_missing_db_is_silent(self):
        self.assert_silent("launched-worker", db=Path(self.tmp.name) / "absent.sqlite")

    def test_db_errors_are_silent(self):
        self.assert_silent("malformed")
        garbage = Path(self.tmp.name) / "garbage.sqlite"
        garbage.write_bytes(b"this is not a sqlite database" * 100)
        self.assert_silent("launched-worker", db=garbage)
        empty = Path(self.tmp.name) / "empty.sqlite"
        sqlite3.connect(empty).close()
        self.assert_silent("launched-worker", db=empty)

    def test_db_is_opened_read_only(self):
        before = self.db.read_bytes()
        self.assert_denies("launched-worker")
        self.assertEqual(self.db.read_bytes(), before)
        self.assertFalse(Path(f"{self.db}-wal").exists())
        self.assertFalse(Path(f"{self.db}-journal").exists())

    def test_a_crashing_hook_fails_open_through_the_launcher(self):
        broken = Path(self.tmp.name) / "broken.py"
        broken.write_text("raise RuntimeError('boom')\n")
        proc = self.run_hook("thread:delegated-task:x", hook=broken)
        self.assertEqual(proc.stdout, "")

    def test_registered_on_every_host_fail_open_for_all_tools(self):
        manifest = json.loads(MANIFEST.read_text())
        for host, entries in manifest["hosts"].items():
            found = [e for e in entries if e["event"] == "PermissionRequest"]
            self.assertEqual(len(found), 1, host)
            entry = found[0]
            self.assertEqual(entry["source"], "scripts/hooks/claude-worker-permission.py")
            self.assertNotIn("matcher", entry)
            self.assertNotIn("--fail-closed", entry["command"])
            self.assertFalse(entry.get("ownerOnly", False))
            self.assertEqual(entry["command"],
                             "{python} -I -B {hooks}/golems-fail-open.py {hooks}/claude-worker-permission.py")


if __name__ == "__main__":
    unittest.main()
