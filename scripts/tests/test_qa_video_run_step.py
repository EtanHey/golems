"""Real run-step processes, including caller process-group teardown."""
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
RUN_STEP = ROOT / "skills/golem-powers/qa-video/scripts/run-step.sh"


class RunStepTests(unittest.TestCase):
    def setUp(self):
        parent = ROOT / ".worktrees"
        parent.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="run-step-test-", dir=parent)
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.receipt = self.work / "logs/test.exit"

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
        # The FIFO fixes the interleaving: teardown happens after the worker
        # starts and before it can finish. No sleep-and-hope survival test.
        caller = subprocess.Popen([
            "bash", "-c", 'bash "$@"; exec sleep 30', "caller", str(RUN_STEP),
            str(self.work), "test", "--", "bash", "-c",
            'printf "%s\\n" "$$" > "$1"; read -r _ < "$2"; sleep 0.05; printf "%s\\n" "$3"',
            "step", str(ready), str(gate), "completed with spaces; $literal",
        ], start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        def cleanup():
            if caller.poll() is None:
                os.killpg(caller.pid, signal.SIGKILL)
            caller.wait(timeout=5)
            pid_file = self.work / "logs/test.pid"
            if pid_file.exists():
                try:
                    os.kill(int(pid_file.read_text()), signal.SIGKILL)
                except ProcessLookupError:
                    pass
        self.addCleanup(cleanup)
        step_pid = int(self.wait_file(ready))
        worker_pid = int(self.wait_file(self.work / "logs/test.pid"))
        worker_group, step_group = os.getpgid(worker_pid), os.getpgid(step_pid)
        duplicate = subprocess.run(["bash", str(RUN_STEP), str(self.work), "test", "--", "true"],
                                   capture_output=True, timeout=5)
        self.assertEqual(duplicate.returncode, 1)
        self.assertEqual(os.getpgid(caller.pid), caller.pid)
        os.killpg(caller.pid, signal.SIGTERM)
        caller.wait(timeout=5)
        with os.fdopen(os.open(gate, os.O_RDWR | os.O_NONBLOCK), "w") as pipe:
            pipe.write("continue\n")
        self.assertEqual(self.wait_file(self.receipt), "0")
        self.assertEqual((self.work / "logs/test.log").read_text(), "completed with spaces; $literal\n")
        self.assertEqual((worker_group, step_group), (worker_pid, worker_pid))
        self.assertFalse((self.work / "logs/test.lock").exists())
        self.assertFalse((self.work / "logs/test.exit.tmp").exists())

    def test_foreground_receipts_argv_and_stdin(self):
        result = subprocess.run([
            "bash", str(RUN_STEP), str(self.work), "test", "--", "bash", "-c",
            'read -r _ && exit 99; sleep 0.1; printf "%s\\n" "$@"; printf "%s\\n" "$PPID"',
            "step", "", "spaces; $literal",
        ], env={**os.environ, "RUN_STEP_FOREGROUND": "1"}, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(self.receipt.read_text(), "0\n")
        worker_pid = (self.work / "logs/test.pid").read_text().strip()
        self.assertEqual((self.work / "logs/test.log").read_text(), f"\nspaces; $literal\n{worker_pid}\n")
        self.assertFalse((self.work / "logs/test.lock").exists())

    def test_foreground_failure_status(self):
        result = subprocess.run(["bash", str(RUN_STEP), str(self.work), "test", "--", "bash", "-c",
                                 'echo failed >&2; exit 23'], env={**os.environ, "RUN_STEP_FOREGROUND": "1"},
                                capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 23)
        self.assertEqual(self.receipt.read_text(), "23\n")
        self.assertEqual((self.work / "logs/test.log").read_text(), "failed\n")
        self.assertFalse((self.work / "logs/test.lock").exists())


if __name__ == "__main__":
    unittest.main()
