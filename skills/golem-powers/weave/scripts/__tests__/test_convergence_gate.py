#!/usr/bin/env python3
"""End-to-end tests for convergence-gate.sh fleet selection (cmux / T3 / both).

Runs the real script with stubbed gh, cmux, vm_stat and pgrep on a minimal
PATH, so every gate other than the one under test is deterministic. Stubs and
fresh snapshots live in pytest's per-test scratch dir (ephemeral by design);
the durable snapshot fixtures are under evals/fixtures/t3-fleet-state/.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

GATE = Path(__file__).resolve().parents[1] / "convergence-gate.sh"
FIXTURES = Path(__file__).resolve().parents[2] / "evals" / "fixtures" / "t3-fleet-state"

STUBS = {
    "gh": "#!/bin/sh\necho 0\n",
    # ~32 GB reclaimable at 16 KiB pages
    "vm_stat": (
        "#!/bin/sh\n"
        "echo 'Mach Virtual Memory Statistics: (page size of 16384 bytes)'\n"
        "echo 'Pages free:                             2097152.'\n"
        "echo 'Pages inactive:                               0.'\n"
        "echo 'Pages speculative:                            0.'\n"
    ),
    "pgrep": "#!/bin/sh\nexit 1\n",
}
CMUX_IDLE = "#!/bin/sh\necho 'agent-surface:1=idle icon=circle'\n"
CMUX_BUSY = "#!/bin/sh\necho 'agent-surface:1=working icon=circle'\n"


class GateHarness(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(prefix="weave-gate-test-")
        self.root = Path(self._tmp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        for name, body in STUBS.items():
            self._stub(name, body)
        (self.bin / "python3").symlink_to(sys.executable)
        (self.root / "gits" / "repo").mkdir(parents=True)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _stub(self, name: str, body: str) -> None:
        path = self.bin / name
        path.write_text(body)
        path.chmod(0o755)

    def snapshot(self, fixture: str, age_min: int = 1) -> Path:
        doc = json.loads((FIXTURES / fixture).read_text())
        stamp = datetime.now(timezone.utc) - timedelta(minutes=age_min)
        doc["captured_at"] = stamp.strftime("%Y-%m-%dT%H:%M:%SZ")
        out = self.root / fixture
        out.write_text(json.dumps(doc))
        return out

    def gate(self, *args: str, env: dict | None = None) -> subprocess.CompletedProcess:
        base = {
            "PATH": f"{self.bin}:/usr/bin:/bin",
            "HOME": str(self.root),
            "GITS_ROOT": str(self.root / "gits"),
        }
        base.update(env or {})
        return subprocess.run(
            ["bash", str(GATE), "--repos", "repo", "--ack-demo", *args],
            capture_output=True,
            text=True,
            env=base,
        )


class T3Fleet(GateHarness):
    def test_converged_t3_snapshot_passes_without_cmux(self) -> None:
        r = self.gate("--fleet", "t3", "--t3-state", str(self.snapshot("converged.json")))
        self.assertEqual(r.returncode, 0, msg=r.stdout + r.stderr)
        section = r.stdout.split("[2/3]")[1].split("[RAM]")[0]
        self.assertNotIn("cmux", section, msg=r.stdout)
        self.assertIn("PASSED", r.stdout)

    def test_no_cmux_with_fleet_t3_has_no_cmux_failure(self) -> None:
        r = self.gate("--fleet", "t3", "--t3-state", str(self.snapshot("working-child.json")))
        self.assertNotRegex(r.stdout, r"❌ .*cmux")

    def test_working_child_blocks(self) -> None:
        r = self.gate("--fleet", "t3", "--t3-state", str(self.snapshot("working-child.json")))
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"❌ T3: .*task:pr8-impl.*working")
        self.assertIn("BLOCKED", r.stdout)

    def test_result_available_but_unsettled_blocks_with_settle_instruction(self) -> None:
        r = self.gate("--fleet", "t3", "--t3-state", str(self.snapshot("unsettled-result.json")))
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"❌ T3: .*settle it")

    def test_malformed_snapshot_blocks(self) -> None:
        r = self.gate("--fleet", "t3", "--t3-state", str(FIXTURES / "malformed.json"))
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"❌ T3: .*not valid JSON")

    def test_missing_snapshot_file_blocks(self) -> None:
        r = self.gate("--fleet", "t3", "--t3-state", str(self.root / "nope.json"))
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"❌ T3: .*cannot read")

    def test_fleet_t3_without_snapshot_blocks(self) -> None:
        r = self.gate("--fleet", "t3")
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"❌ T3 fleet selected but no snapshot")

    def test_stale_snapshot_blocks_and_max_age_is_configurable(self) -> None:
        snap = str(self.snapshot("converged.json", age_min=30))
        r = self.gate("--fleet", "t3", "--t3-state", snap)
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"❌ T3: .*stale")
        r = self.gate("--fleet", "t3", "--t3-state", snap, "--t3-max-age-min", "60")
        self.assertEqual(r.returncode, 0, msg=r.stdout + r.stderr)

    def test_judge_crash_without_verdict_blocks(self) -> None:
        snap = str(self.snapshot("converged.json"))
        (self.bin / "python3").unlink()
        self._stub("python3", "#!/bin/sh\nexit 3\n")
        r = self.gate("--fleet", "t3", "--t3-state", snap)
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertIn("snapshot judge exited 3 without a verdict", r.stdout)

    def test_env_vars_select_t3_snapshot(self) -> None:
        r = self.gate(env={"WEAVE_FLEET": "t3",
                           "WEAVE_T3_STATE": str(self.snapshot("converged.json"))})
        self.assertEqual(r.returncode, 0, msg=r.stdout + r.stderr)

    def test_demo_gate_still_blocks_a_converged_t3_fleet(self) -> None:
        snap = str(self.snapshot("converged.json"))
        r = subprocess.run(
            ["bash", str(GATE), "--repos", "repo", "--fleet", "t3", "--t3-state", snap],
            capture_output=True, text=True,
            env={"PATH": f"{self.bin}:/usr/bin:/bin", "HOME": str(self.root),
                 "GITS_ROOT": str(self.root / "gits")},
        )
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertIn("demo approval NOT asserted", r.stdout)

    def test_open_pr_gate_still_blocks_a_converged_t3_fleet(self) -> None:
        self._stub("gh", "#!/bin/sh\necho 2\n")
        r = self.gate("--fleet", "t3", "--t3-state", str(self.snapshot("converged.json")))
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertIn("repo: 2 open PR(s)", r.stdout)


class FleetSelection(GateHarness):
    def test_auto_with_nothing_detectable_blocks(self) -> None:
        r = self.gate()
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"❌ no fleet detected")

    def test_auto_inside_t3_without_snapshot_blocks(self) -> None:
        self._stub("cmux", CMUX_IDLE)
        r = self.gate(env={"T3CODE_CLI_PATH": "/opt/t3"})
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"❌ T3 fleet selected but no snapshot")

    def test_auto_with_cmux_only_keeps_cmux_path(self) -> None:
        self._stub("cmux", CMUX_IDLE)
        r = self.gate()
        self.assertEqual(r.returncode, 0, msg=r.stdout + r.stderr)
        self.assertIn("✅ cmux: 1 agent surface(s), 0 working/busy", r.stdout)

    def test_auto_with_cmux_and_snapshot_checks_both(self) -> None:
        self._stub("cmux", CMUX_BUSY)
        r = self.gate("--t3-state", str(self.snapshot("converged.json")))
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertIn("❌ cmux: 1 of 1 surface(s) working/busy", r.stdout)
        self.assertRegex(r.stdout, r"✅ T3: ")

    def test_both_needs_both_to_pass(self) -> None:
        self._stub("cmux", CMUX_IDLE)
        r = self.gate("--fleet", "both", "--t3-state", str(self.snapshot("working-child.json")))
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertIn("✅ cmux:", r.stdout)
        self.assertRegex(r.stdout, r"❌ T3: ")

    def test_fleet_cmux_without_cmux_blocks(self) -> None:
        r = self.gate("--fleet", "cmux")
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)
        self.assertIn("cmux CLI not on PATH", r.stdout)

    def test_fleet_cmux_ignores_snapshot(self) -> None:
        self._stub("cmux", CMUX_IDLE)
        r = self.gate("--fleet", "cmux", "--t3-state", str(self.snapshot("working-child.json")))
        self.assertEqual(r.returncode, 0, msg=r.stdout + r.stderr)
        self.assertNotIn("T3:", r.stdout)

    def test_unknown_fleet_value_is_usage_error(self) -> None:
        r = self.gate("--fleet", "slack")
        self.assertEqual(r.returncode, 64, msg=r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
