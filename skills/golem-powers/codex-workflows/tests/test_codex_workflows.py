#!/usr/bin/env python3

import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import shlex
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock
from contextlib import redirect_stderr, redirect_stdout


SKILL_DIR = Path(__file__).resolve().parents[1]
MODULE_PATH = SKILL_DIR / "scripts" / "codex_workflows.py"


def load_module():
    if not MODULE_PATH.is_file():
        raise AssertionError(f"production module missing: {MODULE_PATH}")
    spec = importlib.util.spec_from_file_location("codex_workflows", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def run(*args, cwd=None):
    return subprocess.run(
        args,
        cwd=cwd,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


class CodexWorkflowPrimitiveTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp(prefix="codex-workflows-test-"))

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def make_remote_repo(self):
        source = self.temp_dir / "source"
        origin = self.temp_dir / "origin.git"
        checkout = self.temp_dir / "checkout"
        run("git", "init", "--initial-branch=master", str(source))
        run("git", "config", "user.email", "eval@example.com", cwd=source)
        run("git", "config", "user.name", "Eval", cwd=source)
        (source / "README.md").write_text("fixture\n", encoding="utf-8")
        run("git", "add", "README.md", cwd=source)
        run("git", "commit", "-m", "fixture", cwd=source)
        run("git", "clone", "--bare", str(source), str(origin))
        run("git", "clone", str(origin), str(checkout))
        return checkout

    def write_log(self, events):
        path = self.temp_dir / "worker.log"
        lines = ["# codex-workflows model=gpt-5.6-luna effort=xhigh"]
        lines.extend(json.dumps(event) for event in events)
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return path

    def test_discovers_master_from_remote_show_instead_of_assuming_main(self):
        module = load_module()
        checkout = self.make_remote_repo()

        self.assertEqual(module.discover_default_branch(checkout), "master")

    def test_create_worker_worktree_uses_discovered_master(self):
        module = load_module()
        checkout = self.make_remote_repo()
        worktree = self.temp_dir / "worker-a"

        default_branch = module.create_worker_worktree(
            repo=checkout,
            branch="codex-workflows/run-1-worker-a",
            worktree=worktree,
        )

        self.assertEqual(default_branch, "master")
        self.assertTrue((worktree / ".git").is_file())
        branch = run("git", "branch", "--show-current", cwd=worktree).stdout.strip()
        self.assertEqual(branch, "codex-workflows/run-1-worker-a")

    def test_build_launch_argv_pins_binary_model_effort_and_writable_dirs(self):
        module = load_module()
        checkout = self.make_remote_repo()
        self.assertEqual(
            module.CODEX_BIN,
            Path(os.environ.get("CODEX_BIN") or shutil.which("codex") or Path.home() / ".local/bin/codex"),
        )
        fake_codex = self.temp_dir / "bin" / "codex"
        fake_codex.parent.mkdir()
        fake_codex.write_text("#!/usr/bin/env sh\nexit 0\n", encoding="utf-8")
        fake_codex.chmod(0o755)
        brief = self.temp_dir / "briefs" / "worker.md"
        brief.parent.mkdir()
        brief.write_text("Do the toy task.\n", encoding="utf-8")
        report_dir = self.temp_dir / "reports"

        with mock.patch.object(module, "CODEX_BIN", fake_codex):
            argv, prompt = module.build_launch_argv(
                repo=checkout,
                worktree=checkout,
                brief=brief,
                model="gpt-5.6-luna",
                effort="xhigh",
                report_dirs=[report_dir],
            )

        self.assertEqual(argv[0], "/usr/bin/nohup")
        self.assertEqual(argv[1], str(fake_codex))
        self.assertEqual(argv[2:5], ["exec", "--approve-for-me", "--json"])
        self.assertIn("gpt-5.6-luna", argv)
        self.assertIn('model_reasoning_effort="xhigh"', argv)
        common_git = run("git", "rev-parse", "--git-common-dir", cwd=checkout).stdout.strip()
        common_git_path = str((checkout / common_git).resolve())
        self.assertIn(common_git_path, argv)
        self.assertIn(str(brief.parent.resolve()), argv)
        self.assertIn(str(report_dir.resolve()), argv)
        self.assertEqual(
            prompt,
            f"Read and follow {brief.resolve()}. End with TASK_DONE on its own line.",
        )
        self.assertEqual(argv[-1], prompt)

    def test_log_header_states_effective_pin_and_canonical_degraded_mode(self):
        module = load_module()
        log_path = self.temp_dir / "worker.log"

        size = module.write_log_header(
            log_path,
            {
                "worker": "worker-a",
                "lead": "lead-a",
                "model": "gpt-5.6-luna",
                "effort": "xhigh",
            },
        )

        text = log_path.read_text(encoding="utf-8")
        self.assertEqual(size, log_path.stat().st_size)
        self.assertIn("model=gpt-5.6-luna", text)
        self.assertIn("effort=xhigh", text)
        self.assertIn("lead=lead-a", text)
        for disclosure in module.DEGRADED_MODE:
            self.assertIn(disclosure, text)

    def test_rejects_malicious_worker_names_before_path_derivation(self):
        module = load_module()
        for name in ("../../outside", "/absolute", "has space", "", ".leading"):
            with self.subTest(name=name):
                with self.assertRaises(module.CodexWorkflowError):
                    module.validate_worker_name(name)
        self.assertEqual(module.validate_worker_name("worker-a.1"), "worker-a.1")

    def test_artifact_resolution_rejects_traversal_absolute_and_symlink_escape(self):
        module = load_module()
        worktree = self.temp_dir / "worktree"
        worktree.mkdir()
        (worktree / "result.md").write_text("ok\n", encoding="utf-8")
        outside = self.temp_dir / "outside.md"
        outside.write_text("secret\n", encoding="utf-8")
        (worktree / "escape.md").symlink_to(outside)

        self.assertEqual(
            module.resolve_artifacts(worktree, ["result.md"]),
            [(worktree / "result.md").resolve()],
        )
        for pattern in ("../outside.md", str(outside)):
            with self.subTest(pattern=pattern):
                with self.assertRaises(module.CodexWorkflowError):
                    module.resolve_artifacts(worktree, [pattern])
        with self.assertRaises(module.CodexWorkflowError):
            module.resolve_artifacts(worktree, ["escape.md"])

    def test_manifest_write_is_atomic_and_maps_worker_paths(self):
        module = load_module()
        manifest_path = self.temp_dir / "run" / "manifest.json"
        module.create_manifest(manifest_path, "run-1", "/repo", "lead-a")
        module.update_worker(
            manifest_path,
            "worker-a",
            {
                "branch": "codex-workflows/run-1/worker-a",
                "worktree": "/tmp/worktree-a",
                "log": "/tmp/worker-a.log",
                "brief": "/tmp/brief-a.md",
            },
        )

        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(data["run_id"], "run-1")
        self.assertEqual(data["workers"]["worker-a"]["worktree"], "/tmp/worktree-a")
        self.assertEqual(
            data["degraded_mode"],
            ["lead-reachable-only", "no-pane", "no-listen-name", "no-self-monitor"],
        )
        self.assertFalse(manifest_path.with_suffix(".json.tmp").exists())

    def test_false_green_naive_launch_is_rejected(self):
        module = load_module()
        missing_codex = Path("/Users/example/.bun/bin/codex")
        self.assertFalse(missing_codex.exists(), "recorded trap path unexpectedly exists")
        log_path = self.temp_dir / "naive-launch.log"
        shell = (
            f"/usr/bin/nohup {shlex.quote(str(missing_codex))} exec --full-auto "
            f"{shlex.quote('bounded toy task')} > {shlex.quote(str(log_path))} 2>&1 & "
            'printf "%s\\n" "$!"'
        )

        launched = subprocess.run(
            ["/bin/sh", "-c", shell],
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.assertEqual(launched.returncode, 0)
        pid = int(launched.stdout.strip())
        self.assertGreater(pid, 0)
        time.sleep(0.2)
        self.assertTrue(log_path.stat().st_size > 0)
        self.assertTrue(
            hasattr(module, "verify_launch"),
            "verify_launch is not implemented",
        )

        verdict = module.verify_launch(
            pid=pid,
            log_path=log_path,
            initial_size=0,
            timeout=0.5,
        )

        self.assertFalse(verdict["ok"])
        self.assertEqual(verdict["state"], "failed_launch")

    def test_launch_verifier_ignores_failure_text_inside_tool_output(self):
        module = load_module()
        path = self.write_log(
            [
                {"type": "thread.started", "thread_id": "thread-1"},
                {
                    "type": "item.completed",
                    "item": {
                        "id": "item-1",
                        "type": "command_execution",
                        "aggregated_output": "No such file or directory in docs",
                    },
                },
            ]
        )

        verdict = module.verify_launch(
            pid=999999,
            log_path=path,
            initial_size=0,
            timeout=0,
        )

        self.assertTrue(verdict["ok"])
        self.assertEqual(verdict["evidence"], "codex_event")

    def test_launch_verifier_rejects_genuine_fetch_diagnostic(self):
        module = load_module()
        path = self.temp_dir / "fetch-failure.log"
        path.write_text("fatal: couldn't find remote ref main\n", encoding="utf-8")

        verdict = module.verify_launch(
            pid=999999,
            log_path=path,
            initial_size=0,
            timeout=0,
        )

        self.assertFalse(verdict["ok"])
        self.assertEqual(verdict["state"], "failed_launch")

    def test_launch_verifier_ignores_unrelated_json(self):
        module = load_module()
        path = self.temp_dir / "unrelated.log"
        path.write_text('{"status":"TASK_DONE"}\n', encoding="utf-8")

        verdict = module.verify_launch(
            pid=999999,
            log_path=path,
            initial_size=0,
            timeout=0,
        )

        self.assertFalse(verdict["ok"])
        self.assertEqual(verdict["reason"], "process exited before Codex activity")

    def test_concurrent_manifest_updates_preserve_both_worker_changes(self):
        module = load_module()
        manifest_path = self.temp_dir / "manifest.json"
        module.create_manifest(manifest_path, "run-2", "/repo", "lead-a")
        code = """
import importlib.util
import pathlib
import sys
spec = importlib.util.spec_from_file_location('codex_workflows', pathlib.Path(sys.argv[1]))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
for i in range(40):
    module.update_worker(pathlib.Path(sys.argv[2]), sys.argv[3], {'counter': i})
"""
        processes = [
            subprocess.Popen(
                [sys.executable, "-c", code, str(MODULE_PATH), str(manifest_path), name],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            for name in ("worker-a", "worker-b")
        ]
        for process in processes:
            stdout, stderr = process.communicate(timeout=20)
            self.assertEqual(process.returncode, 0, stdout + stderr)

        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(data["workers"]["worker-a"]["counter"], 39)
        self.assertEqual(data["workers"]["worker-b"]["counter"], 39)

    def test_parse_finished_jsonl_uses_agent_messages_not_tool_doc_text(self):
        module = load_module()
        misleading = "TASK_DONE\nhttps://github.com/EtanHey/golems/pull/999"
        final = "package-name=golems\nhttps://github.com/EtanHey/golems/pull/42\nTASK_DONE"
        path = self.write_log(
            [
                {"type": "thread.started", "thread_id": "thread-1"},
                {
                    "type": "item.completed",
                    "item": {
                        "id": "item-1",
                        "type": "command_execution",
                        "aggregated_output": misleading,
                    },
                },
                {
                    "type": "item.completed",
                    "item": {"id": "item-2", "type": "agent_message", "text": final},
                },
                {
                    "type": "turn.completed",
                    "usage": {"input_tokens": 100, "cached_input_tokens": 20, "output_tokens": 11},
                },
            ]
        )

        result = module.parse_finished_log(path)

        self.assertTrue(result["task_done"])
        self.assertEqual(result["pr_urls"], ["https://github.com/EtanHey/golems/pull/42"])
        self.assertNotIn("999", json.dumps(result))
        self.assertEqual(result["assistant_messages"], [final])

    def test_parse_finished_jsonl_extracts_output_tokens_and_exact_task_done(self):
        module = load_module()
        path = self.write_log(
            [
                {"type": "thread.started", "thread_id": "thread-1"},
                {
                    "type": "item.completed",
                    "item": {"id": "item-1", "type": "agent_message", "text": "TASK_DONE-ish"},
                },
                {
                    "type": "turn.completed",
                    "usage": {"input_tokens": 50, "cached_input_tokens": 0, "output_tokens": 7},
                },
                {
                    "type": "item.completed",
                    "item": {"id": "item-2", "type": "agent_message", "text": "ok\nTASK_DONE"},
                },
                {
                    "type": "turn.completed",
                    "usage": {"input_tokens": 90, "cached_input_tokens": 10, "output_tokens": 13},
                },
            ]
        )

        result = module.parse_finished_log(path)

        self.assertTrue(result["task_done"])
        self.assertEqual(result["output_tokens"], 13)
        self.assertIsNone(result["parser_error"])

    def test_process_identity_rejects_reused_pid_with_different_start_or_command(self):
        module = load_module()
        process = subprocess.Popen(["/bin/sleep", "10"])
        try:
            identity = module.capture_process_identity(process.pid)
            self.assertTrue(module.process_identity_alive(identity))

            wrong_start = dict(identity, start_time="not-the-recorded-start")
            wrong_command = dict(identity, command="/bin/not-the-worker")
            self.assertFalse(module.process_identity_alive(wrong_start))
            self.assertFalse(module.process_identity_alive(wrong_command))
        finally:
            process.terminate()
            process.wait(timeout=5)

    def test_process_alive_rejects_zombie_state(self):
        module = load_module()
        process = subprocess.Popen(["/bin/sh", "-c", "sleep 0.05"])
        identity = module.capture_process_identity(process.pid)
        time.sleep(0.15)
        try:
            self.assertFalse(module.process_identity_alive(identity))
        finally:
            process.wait(timeout=5)

    def test_cleanup_refuses_live_worker_and_unharvested_evidence(self):
        module = load_module()
        manifest_path = self.temp_dir / "manifest.json"
        module.create_manifest(manifest_path, "run-3", "/repo", "lead-a")
        process = subprocess.Popen(["/bin/sleep", "10"])
        try:
            identity = module.capture_process_identity(process.pid)
            module.update_worker(
                manifest_path,
                "worker-a",
                {
                    "status": "running",
                    "process": identity,
                    "worktree": str(self.temp_dir / "worker-a"),
                    "branch": "codex-workflows/run-3-worker-a",
                },
            )
            with self.assertRaisesRegex(module.CodexWorkflowError, "still running"):
                module.cleanup_worker(manifest_path, "worker-a")
        finally:
            process.terminate()
            process.wait(timeout=5)

        module.update_worker(
            manifest_path,
            "worker-a",
            {"status": "incomplete", "process": None},
        )
        with self.assertRaisesRegex(module.CodexWorkflowError, "harvest"):
            module.cleanup_worker(manifest_path, "worker-a")

    def test_cleanup_removes_worktree_with_byte_identical_harvested_artifact(self):
        module = load_module()
        repo = self.make_remote_repo()
        worktree = self.temp_dir / "worker-artifact"
        branch = "codex-workflows/run-artifact-worker-a"
        module.create_worker_worktree(repo=repo, branch=branch, worktree=worktree)
        artifact = worktree / "reports" / "out.md"
        artifact.parent.mkdir()
        artifact.write_text("durable output\n", encoding="utf-8")
        log_path = self.temp_dir / "worker-a.log"
        log_path.write_text("finished\n", encoding="utf-8")
        manifest_path = self.temp_dir / "manifest.json"
        module.create_manifest(manifest_path, "run-artifact", str(repo), "lead-a")
        module.update_worker(
            manifest_path,
            "worker-a",
            {
                "status": "completed",
                "process": None,
                "worktree": str(worktree),
                "branch": branch,
                "log": str(log_path),
                "artifacts": ["reports/out.md"],
            },
        )
        module.harvest_manifest(manifest_path, self.temp_dir / "harvest")

        module.cleanup_worker(manifest_path, "worker-a", delete_branch=True)

        self.assertFalse(worktree.exists())
        self.assertNotIn(branch, run("git", "branch", "--list", branch, cwd=repo).stdout)

    def test_cleanup_refuses_dirty_path_that_was_not_harvested(self):
        module = load_module()
        repo = self.make_remote_repo()
        worktree = self.temp_dir / "worker-unharvested"
        branch = "codex-workflows/run-unharvested-worker-a"
        module.create_worker_worktree(repo=repo, branch=branch, worktree=worktree)
        artifact = worktree / "reports" / "out.md"
        artifact.parent.mkdir()
        artifact.write_text("durable output\n", encoding="utf-8")
        log_path = self.temp_dir / "worker-a.log"
        log_path.write_text("finished\n", encoding="utf-8")
        manifest_path = self.temp_dir / "manifest.json"
        module.create_manifest(manifest_path, "run-unharvested", str(repo), "lead-a")
        module.update_worker(
            manifest_path,
            "worker-a",
            {
                "status": "completed",
                "process": None,
                "worktree": str(worktree),
                "branch": branch,
                "log": str(log_path),
                "artifacts": ["reports/out.md"],
            },
        )
        module.harvest_manifest(manifest_path, self.temp_dir / "harvest-unharvested")
        (worktree / "scratch.txt").write_text("not harvested\n", encoding="utf-8")

        with self.assertRaisesRegex(module.CodexWorkflowError, "unharvested dirty path"):
            module.cleanup_worker(manifest_path, "worker-a", delete_branch=True)

        self.assertTrue(worktree.exists())
        self.assertIn(branch, run("git", "branch", "--list", branch, cwd=repo).stdout)

    def test_launch_preflight_rejects_missing_binary_before_worktree_creation(self):
        module = load_module()
        repo = self.make_remote_repo()
        manifest_path = self.temp_dir / "run" / "manifest.json"
        module.create_manifest(manifest_path, "run-1", str(repo.resolve()), "lead-a")
        brief = self.temp_dir / "brief.md"
        brief.write_text("bounded task\n", encoding="utf-8")

        with (
            mock.patch.object(module, "CODEX_BIN", self.temp_dir / "missing-codex"),
            mock.patch.object(module, "create_worker_worktree") as create_worktree,
        ):
            result = module.launch_worker(
                manifest_path=manifest_path,
                repo=repo,
                run_root=self.temp_dir / "run",
                worker_name="worker-a",
                brief=brief,
                lead="lead-a",
                model="gpt-5.6-luna",
                effort="xhigh",
                report_dirs=[],
                artifacts=[],
            )

        self.assertFalse(result["ok"])
        self.assertEqual(result["state"], "failed_launch")
        create_worktree.assert_not_called()

    def composition_spec(self):
        brief_a = self.temp_dir / "brief-a.md"
        brief_b = self.temp_dir / "brief-b.md"
        brief_a.write_text("A\n", encoding="utf-8")
        brief_b.write_text("B\n", encoding="utf-8")
        return {
            "repo": str(self.temp_dir / "repo"),
            "lead": "lead-a",
            "model": "gpt-5.6-luna",
            "effort": "xhigh",
            "workers": [
                {"name": "worker-a", "brief": str(brief_a)},
                {"name": "worker-b", "brief": str(brief_b)},
            ],
        }

    def test_parallel_launches_every_worker_before_watching(self):
        module = load_module()
        spec = self.composition_spec()
        Path(spec["repo"]).mkdir()
        events = []

        def fake_launch(**kwargs):
            events.append(f"launch:{kwargs['worker_name']}")
            module.update_worker(
                kwargs["manifest_path"],
                kwargs["worker_name"],
                {"status": "running"},
            )
            return {"ok": True, "state": "running", "worker": kwargs["worker_name"]}

        def fake_watch(manifest_path, **_kwargs):
            self.assertEqual(events, ["launch:worker-a", "launch:worker-b"])
            events.append("watch")
            for name in ("worker-a", "worker-b"):
                module.update_worker(manifest_path, name, {"status": "completed"})
            return 0

        code, manifest_path = module.run_parallel_spec(
            spec,
            run_root=self.temp_dir / "run",
            run_id="parallel-run",
            watch=True,
            launch_fn=fake_launch,
            watch_fn=fake_watch,
        )

        self.assertEqual(code, 0)
        self.assertEqual(events, ["launch:worker-a", "launch:worker-b", "watch"])
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(set(data["workers"]), {"worker-a", "worker-b"})
        self.assertEqual(data["mode"], "parallel")

    def test_parallel_retains_failed_launch_and_returns_nonzero(self):
        module = load_module()
        spec = self.composition_spec()
        Path(spec["repo"]).mkdir()

        def fake_launch(**kwargs):
            ok = kwargs["worker_name"] != "worker-a"
            state = "running" if ok else "failed_launch"
            module.update_worker(
                kwargs["manifest_path"],
                kwargs["worker_name"],
                {"status": state},
            )
            return {"ok": ok, "state": state, "worker": kwargs["worker_name"]}

        code, manifest_path = module.run_parallel_spec(
            spec,
            run_root=self.temp_dir / "run",
            run_id="parallel-fail",
            watch=False,
            launch_fn=fake_launch,
        )

        self.assertEqual(code, 1)
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(data["workers"]["worker-a"]["status"], "failed_launch")
        self.assertEqual(data["workers"]["worker-b"]["status"], "running")

    def test_parallel_launch_only_uses_distinct_incomplete_exit(self):
        module = load_module()
        spec = self.composition_spec()
        Path(spec["repo"]).mkdir()

        def fake_launch(**kwargs):
            module.update_worker(
                kwargs["manifest_path"],
                kwargs["worker_name"],
                {"status": "running"},
            )
            return {"ok": True, "state": "running", "worker": kwargs["worker_name"]}

        code, manifest_path = module.run_parallel_spec(
            spec,
            run_root=self.temp_dir / "run",
            run_id="parallel-launch-only",
            watch=False,
            launch_fn=fake_launch,
        )

        self.assertEqual(code, 75)
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(data["completion_state"], "launch_only")
        self.assertEqual(data["completion_proven"], False)

    def test_parallel_cli_prints_unmissable_launch_only_diagnostic(self):
        module = load_module()
        spec_path = self.temp_dir / "parallel.json"
        spec_path.write_text(json.dumps(self.composition_spec()), encoding="utf-8")
        manifest_path = self.temp_dir / "run" / "manifest.json"
        module.create_manifest(manifest_path, "run-1", "/repo", "lead-a")
        module.update_worker(manifest_path, "worker-a", {"status": "running"})
        stdout = io.StringIO()
        stderr = io.StringIO()

        with (
            mock.patch.object(
                module,
                "run_parallel_spec",
                return_value=(module.LAUNCH_ONLY_EXIT, manifest_path),
            ),
            redirect_stdout(stdout),
            redirect_stderr(stderr),
        ):
            code = module.main(
                [
                    "parallel",
                    "--spec",
                    str(spec_path),
                    "--run-id",
                    "run-1",
                ]
            )

        self.assertEqual(code, 75)
        self.assertIn("LAUNCH_ONLY: 1 workers running; completion unproven", stderr.getvalue())

    def test_parallel_refuses_false_green_when_watcher_leaves_workers_running(self):
        module = load_module()
        spec = self.composition_spec()
        Path(spec["repo"]).mkdir()

        def fake_launch(**kwargs):
            module.update_worker(
                kwargs["manifest_path"],
                kwargs["worker_name"],
                {"status": "running"},
            )
            return {"ok": True, "state": "running", "worker": kwargs["worker_name"]}

        code, manifest_path = module.run_parallel_spec(
            spec,
            run_root=self.temp_dir / "run",
            run_id="parallel-false-green",
            watch=True,
            launch_fn=fake_launch,
            watch_fn=lambda *_args, **_kwargs: 0,
        )

        self.assertEqual(code, 1)
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(
            {worker["status"] for worker in data["workers"].values()},
            {"running"},
        )

    def test_run_commands_accept_run_id_and_default_harvest_destination(self):
        module = load_module()
        parser = module.build_parser()

        watch = parser.parse_args(["watch", "--run-id", "run-1"])
        harvest = parser.parse_args(["harvest", "--run-id", "run-1"])

        self.assertEqual(watch.run_id, "run-1")
        self.assertIsNone(watch.manifest)
        self.assertEqual(harvest.run_id, "run-1")
        self.assertIsNone(harvest.output_dir)

    def test_watch_does_not_finalize_preparing_worker_without_log(self):
        module = load_module()
        manifest_path = self.temp_dir / "run" / "manifest.json"
        module.create_manifest(manifest_path, "run-1", "/repo", "lead-a")
        module.update_worker(
            manifest_path,
            "worker-a",
            {
                "status": "preparing",
                "log": str(self.temp_dir / "missing.log"),
            },
        )

        code = module.watch_manifest(manifest_path, timeout=0)

        self.assertEqual(code, 124)
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(data["workers"]["worker-a"]["status"], "watch_timeout")

    def test_pipeline_stops_before_next_stage_after_failure(self):
        module = load_module()
        parallel = self.composition_spec()
        Path(parallel["repo"]).mkdir()
        brief_c = self.temp_dir / "brief-c.md"
        brief_c.write_text("C\n", encoding="utf-8")
        spec = {
            "repo": parallel["repo"],
            "lead": parallel["lead"],
            "stages": [
                {"name": "stage-1", "workers": parallel["workers"]},
                {"name": "stage-2", "workers": [{"name": "worker-c", "brief": str(brief_c)}]},
            ],
        }
        events = []

        def fake_launch(**kwargs):
            events.append(f"launch:{kwargs['worker_name']}")
            module.update_worker(
                kwargs["manifest_path"],
                kwargs["worker_name"],
                {"status": "running"},
            )
            return {"ok": True, "state": "running", "worker": kwargs["worker_name"]}

        def failing_watch(_manifest_path, **_kwargs):
            events.append("watch:failed")
            return 1

        code, manifest_path = module.run_pipeline_spec(
            spec,
            run_root=self.temp_dir / "pipeline",
            run_id="pipeline-run",
            launch_fn=fake_launch,
            watch_fn=failing_watch,
        )

        self.assertEqual(code, 1)
        self.assertEqual(events, ["launch:worker-a", "launch:worker-b", "watch:failed"])
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertFalse(data["continue_on_failure"])
        self.assertNotIn("worker-c", data["workers"])

    def test_spec_validation_rejects_unsafe_or_ambiguous_inputs(self):
        module = load_module()
        valid = self.composition_spec()
        Path(valid["repo"]).mkdir()
        module.validate_composition_spec(valid, pipeline=False)

        bad_name = json.loads(json.dumps(valid))
        bad_name["workers"][0]["name"] = "../../outside"
        missing_brief = json.loads(json.dumps(valid))
        del missing_brief["workers"][0]["brief"]
        relative_brief = json.loads(json.dumps(valid))
        relative_brief["workers"][0]["brief"] = "brief.md"
        bad_timeout = json.loads(json.dumps(valid))
        bad_timeout["workers"][1]["launch_timeout"] = "oops"
        bad_worker_effort = json.loads(json.dumps(valid))
        bad_worker_effort["workers"][1]["effort"] = "medium"
        bad_worker_name_type = json.loads(json.dumps(valid))
        bad_worker_name_type["workers"][1]["name"] = 123
        unknown_worker_field = json.loads(json.dumps(valid))
        unknown_worker_field["workers"][1]["unexpected"] = True
        for candidate in (
            bad_name,
            missing_brief,
            relative_brief,
            bad_timeout,
            bad_worker_effort,
            bad_worker_name_type,
            unknown_worker_field,
        ):
            with self.subTest(candidate=candidate):
                with self.assertRaises(module.CodexWorkflowError):
                    module.validate_composition_spec(candidate, pipeline=False)

    def test_pipeline_rejects_nonboolean_failure_policy(self):
        module = load_module()
        parallel = self.composition_spec()
        Path(parallel["repo"]).mkdir()
        spec = {
            "repo": parallel["repo"],
            "lead": parallel["lead"],
            "continue_on_failure": "false",
            "stages": [{"name": "stage-1", "workers": parallel["workers"]}],
        }

        with self.assertRaisesRegex(module.CodexWorkflowError, "continue_on_failure"):
            module.validate_composition_spec(spec, pipeline=True)

    def test_skill_frontmatter_and_routing_contract(self):
        skill_path = SKILL_DIR / "SKILL.md"
        self.assertTrue(skill_path.is_file(), f"missing {skill_path}")
        text = skill_path.read_text(encoding="utf-8")
        self.assertTrue(text.startswith("---\nname: codex-workflows\n"))
        description_line = next(
            line for line in text.splitlines() if line.startswith("description:")
        )
        self.assertLess(len(description_line.removeprefix("description:").strip()), 300)
        for required in (
            "NOT for",
            "cmux",
            "$HOME/.local/bin/codex",
            "git remote show origin",
            "Never live-grep",
            "gpt-5.6-luna",
            "output tokens",
            "wall-clock",
            "lead-reachable-only",
            "no-pane",
            "no-listen-name",
            "no-self-monitor",
            "--add-dir",
        ):
            with self.subTest(required=required):
                self.assertIn(required, text)

    def test_skill_packages_agent_parallel_pipeline_workflows(self):
        expected = {
            "agent.md": ["codex-workflows.sh agent", "--manifest", "--run-id"],
            "parallel.md": ["codex-workflows.sh parallel", "workers", "--watch"],
            "pipeline.md": ["codex-workflows.sh pipeline", "stages", "continue_on_failure"],
        }
        for filename, required in expected.items():
            path = SKILL_DIR / "workflows" / filename
            with self.subTest(filename=filename):
                self.assertTrue(path.is_file(), f"missing {path}")
                text = path.read_text(encoding="utf-8")
                for token in required:
                    self.assertIn(token, text)

        parallel = (SKILL_DIR / "workflows" / "parallel.md").read_text(encoding="utf-8")
        self.assertIn("worktree-relative", parallel)
        self.assertIn("<run-dir>/<run-id>/harvest", parallel)

    def test_composition_schema_and_manifest_reference_are_packaged(self):
        schema_path = SKILL_DIR / "references" / "composition.schema.json"
        manifest_path = SKILL_DIR / "references" / "manifest.md"
        self.assertTrue(schema_path.is_file(), f"missing {schema_path}")
        self.assertTrue(manifest_path.is_file(), f"missing {manifest_path}")
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertIn("repo", schema["required"])
        self.assertIn("lead", schema["required"])
        reference = manifest_path.read_text(encoding="utf-8")
        for state in (
            "failed_launch",
            "watch_timeout",
            "completed",
            "failed",
            "parser_failed",
            "incomplete",
        ):
            self.assertIn(state, reference)

    def test_shell_entrypoints_are_executable(self):
        for path in (
            SKILL_DIR / "scripts" / "codex-workflows.sh",
            SKILL_DIR / "evals" / "run-false-green.sh",
            SKILL_DIR / "evals" / "run-live-fanout.sh",
        ):
            with self.subTest(path=path):
                self.assertTrue(path.is_file(), f"missing {path}")
                self.assertTrue(os.access(path, os.X_OK), f"not executable: {path}")

    def test_live_eval_defaults_to_untracked_repo_worktrees_and_result(self):
        script = (SKILL_DIR / "evals" / "run-live-fanout.sh").read_text(
            encoding="utf-8"
        )
        self.assertIn('$REPO/.worktrees/codex-workflows-evals', script)
        self.assertIn("CODEX_WORKFLOWS_RESULT_PATH", script)
        self.assertNotIn('RESULT="$SCRIPT_DIR/results/live-', script)
        self.assertIn('cleanup --manifest "$MANIFEST" --delete-branches', script)


if __name__ == "__main__":
    unittest.main()
