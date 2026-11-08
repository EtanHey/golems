"""Real runner/miner/ledger; local executable fixture replaces paid Cursor calls."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "weave-cursor-run.py"
spec = importlib.util.spec_from_file_location("weave_cursor_completion", SCRIPT)
runner = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runner
spec.loader.exec_module(runner)


class CursorCompletion(unittest.TestCase):
    def setUp(self):
        scratch = SCRIPT.parents[4] / "docs.local" / "weave-test-scratch"
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        cursor = self.root / "cursor-agent"
        cursor.write_bytes((Path(__file__).parent / "fixtures/cursor-agent.py").read_bytes())
        cursor.chmod(0o755)
        self.sessions = [{"label": f"codex/session-{i}", "src": "fixture.jsonl"} for i in range(2)]
        self.args = SimpleNamespace(workdir=str(self.root / "run"), fresh=False, concurrency=12,
            sources="codex", cutoff="2026-01-01T00:00:00Z", centerpiece_repo="orchestrator",
            prior_weave="fixture", chunk_size=1, run_date="2026-11-08",
            retro_out=str(self.root / "retro.md"), eval_out=str(self.root / "eval.md"))
        self.env = patch.dict(os.environ, {"CURSOR_AGENT": str(cursor), "SYNTH_MODE": "good", "MINER_FAIL": "none"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def run_fixture(self, read_summary=True):
        argv = [str(SCRIPT), "run"]
        for key, value in vars(self.args).items():
            if value is not False:
                argv.append("--" + key.replace("_", "-"))
                if value is not True:
                    argv.append(str(value))
        with patch.object(runner, "discover_sessions", return_value=self.sessions), \
             patch.object(runner, "prepare_contexts", return_value=len(self.sessions)), \
             patch.object(sys, "argv", argv), \
             contextlib.redirect_stdout(io.StringIO()):
            code = runner.main()
        summary = json.loads((Path(self.args.workdir) / "run-summary.json").read_text()) if read_summary else None
        return code, summary

    def test_completion_matrix(self):
        for synth, miner, expected, result in [("good", "none", 0, "DONE"),
                ("no-marker", "none", 0, "DONE"),
                ("missing", "none", 1, "FAILED"), ("wrong", "none", 0, "DONE"),
                ("empty", "none", 1, "FAILED"), ("exit-failure", "none", 1, "FAILED"),
                ("good", "codex/session-1", 2, "PARTIAL"), ("good", "all", 1, "FAILED")]:
            with self.subTest(synth=synth, miner=miner):
                self.args.fresh = True
                os.environ.update(SYNTH_MODE=synth, MINER_FAIL=miner)
                code, summary = self.run_fixture()
                self.assertEqual((code, summary["result"]), (expected, result))
                self.assertEqual(len(summary["sessions"]), 2)
                self.assertEqual(sum(r["status"] == "done" for r in summary["sessions"]),
                                 0 if miner == "all" else 1 if miner != "none" else 2)
                if code in (0, 2):
                    self.assertTrue(summary["ledger_success"] and summary["report_success"])
                    self.assertTrue(Path(self.args.retro_out).read_text().startswith(
                        f"<!-- weave-run: {summary['run_id']} -->\n"))

    def test_synthesis_rejects_an_earlier_report_when_agent_writes_nothing(self):
        _, first = self.run_fixture()
        old = Path(self.args.retro_out).read_bytes()
        os.environ["SYNTH_MODE"] = "missing"
        code, second = self.run_fixture()
        self.assertEqual((code, second["result"]), (1, "FAILED"))
        self.assertNotEqual(first["run_id"], second["run_id"])
        self.assertEqual(old, Path(self.args.retro_out).read_bytes())
        self.assertFalse(runner.synthesize(self.root, Path(self.args.retro_out), runner.WeaveState()))

    def test_ledger_failure_missing_disposition_and_exception_have_failure_summaries(self):
        failed = self.root / "failed-ledger.py"
        failed.write_text("raise SystemExit(9)\n")
        for fault in [patch.object(runner, "LEDGER", failed),
                      patch.object(runner, "run_miner", return_value={"label": "unadmitted", "status": "done"}),
                      patch.object(runner, "chunk_sessions", side_effect=RuntimeError("chunk failed"))]:
            with fault:
                code, summary = self.run_fixture()
                self.assertEqual((code, summary["result"]), (1, "FAILED"))
                self.assertFalse(summary["report_success"])
                self.assertTrue(summary["message"])

    def test_heading_before_marker_is_accepted(self):
        os.environ["SYNTH_MODE"] = "heading"
        code, summary = self.run_fixture()
        self.assertEqual((code, summary["result"]), (0, "DONE"))
        self.assertTrue(Path(self.args.retro_out).read_text().startswith(
            f"<!-- weave-run: {summary['run_id']} -->\n"))

    def test_rejected_paid_output_is_preserved_and_named_in_summary(self):
        os.environ["SYNTH_MODE"] = "exit-failure"
        code, summary = self.run_fixture()
        self.assertEqual(code, 1)
        rejected = Path(summary["rejected_report"])
        self.assertEqual(rejected.suffix, ".rejected")
        self.assertIn("Fresh synthesis.", rejected.read_text())
        self.assertIn(str(rejected), summary["message"])

    def test_empty_window_does_not_prepare_aggregate_or_synthesize(self):
        self.sessions = []
        with patch.object(runner, "_spawn_cursor_agent", side_effect=AssertionError("paid call")), \
             patch.object(runner, "subprocess") as process:
            code, summary = self.run_fixture()
        self.assertEqual((code, summary["result"]), (0, "EMPTY"))
        self.assertFalse(summary["report_success"] or summary["ledger_success"])
        process.run.assert_not_called()

    def test_summary_write_failure_keeps_original_error_and_exit(self):
        original_write = Path.write_text
        def fail_summary(path, *args, **kwargs):
            if path.name == "run-summary.json":
                raise OSError("summary blocked")
            return original_write(path, *args, **kwargs)
        stderr = io.StringIO()
        with patch.object(Path, "write_text", fail_summary), \
             patch.object(runner, "_cmd_run", side_effect=RuntimeError("original failure")), \
             contextlib.redirect_stderr(stderr):
            code, _ = self.run_fixture(read_summary=False)
        self.assertEqual(code, 1)
        self.assertIn("original failure", stderr.getvalue())
        self.assertIn("summary blocked", stderr.getvalue())
