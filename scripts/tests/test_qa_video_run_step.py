"""Real run-step processes, including caller process-group teardown."""
import ctypes
import os
import select
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
RUN_STEP = ROOT / "skills/golem-powers/qa-video/scripts/run-step.sh"


class RunStepTests(unittest.TestCase):
    def setUp(self):
        (ROOT / ".worktrees").mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="run-step-test-", dir=ROOT / ".worktrees")
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.receipt = self.work / "logs/test.exit"
        # Linux CI may not reap orphans at PID 1; own and reap this test's group.
        if sys.platform == "linux":
            libc, previous = ctypes.CDLL(None, use_errno=True), ctypes.c_int()
            self.assertEqual(libc.prctl(37, ctypes.byref(previous), 0, 0, 0), 0)
            self.assertEqual(libc.prctl(36, 1, 0, 0, 0), 0)
            self.addCleanup(lambda: libc.prctl(36, previous.value, 0, 0, 0))

    def wait_group_dead(self, group):
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            try:
                os.waitpid(-group, os.WNOHANG)
            except ChildProcessError:
                pass
            try:
                os.killpg(group, 0)
            except ProcessLookupError:
                return
            time.sleep(0.01)
        self.fail(f"group not reaped: {group}")

    def wait_file(self, path):
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            if path.exists() and path.stat().st_size:
                return path.read_text().strip()
            time.sleep(0.02)
        self.fail(f"missing/nonempty receipt: {path}")

    def test_caller_process_group_kill(self):
        gate, ready = self.work / "gate", self.work / "ready"
        os.mkfifo(gate)
        startup, before = self.work / "startup", self.work / "before"
        os.mkfifo(startup)
        shim = self.work / "python3"
        shim.write_text('#!/usr/bin/env bash\nprintf ready > "$BEFORE"\nread -r _ < "$STARTUP"\nexec "$REAL_PYTHON" "$@"\n')
        shim.chmod(0o755)
        # The FIFO fixes the interleaving: teardown happens after the worker
        # starts and before it can finish. No sleep-and-hope survival test.
        caller = subprocess.Popen([
            "bash", "-c", 'bash "$@" >/dev/null; printf "returned\\n"; exec sleep 30', "caller", str(RUN_STEP),
            str(self.work), "test", "--", "bash", "-c",
            'printf "%s\\n" "$$" > "$1"; read -r _ < "$2"; sleep 0.05; printf "%s\\n" "$3"',
            "step", str(ready), str(gate), "completed with spaces; $literal",
        ], start_new_session=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            env={**os.environ, "PATH": f"{shim.parent}:{os.environ['PATH']}",
                 "STARTUP": str(startup), "BEFORE": str(before), "REAL_PYTHON": sys.executable})
        def cleanup():
            pid_file = self.work / "logs/test.pid"
            groups = {caller.pid, int(pid_file.read_text())} if pid_file.exists() else {caller.pid}
            for group in groups:
                try:
                    os.killpg(group, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            caller.wait(timeout=5)
            caller.stdout.close()
            for group in groups:
                self.wait_group_dead(group)
        self.addCleanup(cleanup)
        self.wait_file(before)
        self.assertFalse(select.select([caller.stdout], [], [], 0.2)[0], "returned before setsid")
        with startup.open("w") as pipe:
            pipe.write("continue\n")
        step_pid = int(self.wait_file(ready))
        worker_pid = int(self.wait_file(self.work / "logs/test.pid"))
        worker_ids = os.getsid(worker_pid), os.getpgid(worker_pid), os.getpgid(step_pid)
        duplicate = subprocess.run(["bash", str(RUN_STEP), str(self.work), "test", "--", "true"],
                                   capture_output=True, timeout=5)
        self.assertEqual(duplicate.returncode, 1)
        os.killpg(caller.pid, signal.SIGTERM)
        caller.wait(timeout=5)
        with os.fdopen(os.open(gate, os.O_RDWR | os.O_NONBLOCK), "w") as pipe:
            pipe.write("continue\n")
        self.assertEqual(self.wait_file(self.receipt), "0")
        self.assertEqual((self.work / "logs/test.log").read_text(), "completed with spaces; $literal\n")
        self.assertEqual(worker_ids, (worker_pid,) * 3)
        self.assertEqual((self.work / "logs/test.lock/pgid").read_text().strip(), str(worker_pid))
        self.assertFalse((self.work / "logs/test.exit.tmp").exists())
        self.wait_group_dead(worker_pid)
        retry = subprocess.run(["bash", str(RUN_STEP), str(self.work), "test", "--", "true"],
                               env={**os.environ, "RUN_STEP_FOREGROUND": "1"}, capture_output=True, timeout=5)
        self.assertEqual(retry.returncode, 0)
        self.assertNotEqual((self.work / "logs/test.lock/pgid").read_text().strip(), str(worker_pid))

    def test_foreground_receipts_argv_stdin_and_failure(self):
        for code in (0, 23):
            with self.subTest(code=code):
                result = subprocess.run([
                    "bash", str(RUN_STEP), str(self.work), "test", "--", "bash", "-c",
                    'code=$1; shift; read -r _ && exit 99; sleep 0.1; printf "%s\\n" "$@"; printf "%s\\n" "$PPID"; exit "$code"',
                    "step", str(code), "", "spaces; $literal",
                ], env={**os.environ, "RUN_STEP_FOREGROUND": "1"}, capture_output=True, timeout=5)
                self.assertEqual(result.returncode, code)
                self.assertEqual(self.receipt.read_text(), f"{code}\n")
                worker_pid = (self.work / "logs/test.pid").read_text().strip()
                self.assertEqual((self.work / "logs/test.log").read_text(), f"\nspaces; $literal\n{worker_pid}\n")
                self.assertEqual((self.work / "logs/test.lock/pgid").read_text().strip(), worker_pid)
