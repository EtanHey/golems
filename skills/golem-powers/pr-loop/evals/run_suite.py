#!/usr/bin/env python3
"""Static arming-contract evals; no live-model or native Monitor claim."""
import json
from pathlib import Path
import unittest

SKILL = Path(__file__).resolve().parents[1]
REPO = SKILL.parents[2]
COMMAND = "pr-watch <owner/repo> <N> --head <sha> --deadline 2h"
TABLE = "../../../../scripts/pr-watch-lib/README.md#usage-and-exits"
SURFACES = ["references/review-loop.md", "adapters/claude.md", "adapters/codex.md",
            "adapters/cursor.md", "adapters/capabilities.yaml"]


def text(relative):
    return (SKILL / relative).read_text()


class ArmingContract(unittest.TestCase):
    def test_native_monitor_has_one_pinned_command_and_bounded_timeout(self):
        monitor = f'Monitor(command="{COMMAND}", timeout_ms=1800000)'
        for relative in SURFACES[:2]:
            with self.subTest(surface=relative):
                self.assertIn(monitor, text(relative))
                self.assertIn("exactly one", text(relative))

    def test_all_clients_use_same_command_safety_rules_and_resolvable_table(self):
        for relative in SURFACES:
            with self.subTest(surface=relative):
                content = " ".join(text(relative).split())
                self.assertIn(COMMAND, content)
                self.assertIn("pr-watch never merges", content)
                self.assertIn("empty rollup is never READY", content)
                self.assertNotRegex(content, r"gh pr checks.*?--watch")
                self.assertIn(TABLE, content)
                self.assertEqual((SKILL / relative).parent.joinpath(TABLE.split("#")[0]).resolve(),
                                 REPO / "scripts/pr-watch-lib/README.md")

    def test_codex_decodes_every_exit_and_does_not_recreate_file_watch_noise(self):
        content = " ".join(text("adapters/codex.md").split())
        for code, event in [(0, "READY"), (10, "FAILED"), (11, "HEAD_MOVED"),
                            (12, "MERGED"), (20, "DEADLINE"), (30, "GH_ERROR")]:
            self.assertIn(f"{code} {event}", content)
        self.assertIn("read its exit code", content)
        self.assertIn("new head pin", content)
        self.assertIn("re-arming if waiting continues", content)
        self.assertIn("stderr diagnosis", content)
        self.assertIn("Do not route its output through a cmuxlayer file watch", content)

    def test_rearming_preserves_settle_review_and_current_release_paths(self):
        content = " ".join(text("references/review-loop.md").split())
        for phrase in ["Required contexts must be present and green", "default 180s settle window",
                       "on exit 20", "Cancel the old Monitor with TaskStop",
                       "after compaction", "read the exact-head review", "`pr-watch` on PATH", "or `scripts/pr-watch` from a golems checkout"]:
            self.assertIn(phrase, content)
        self.assertRegex(content, r"exit 11.*new head.*re-arm with that SHA")

    def test_native_monitor_expiry_rearms_and_restarts_both_windows(self):
        for relative in SURFACES[:2]:
            with self.subTest(surface=relative):
                content = " ".join(text(relative).split())
                self.assertIn("30-minute Monitor expiry precedes the 2h --deadline", content)
                self.assertIn("re-arm on expiry", content)
                self.assertIn("re-arming restarts the deadline and the settle window", content)

    def test_shared_guidance_gives_an_action_for_every_exit(self):
        content = " ".join(text("references/review-loop.md").split())
        for action in ["0 READY: proceed to the exact-head review and authorized merge path",
                       "10 FAILED: fix the failure", "12 MERGED: stop",
                       "20 DEADLINE: re-arm if waiting continues or escalate",
                       "30 GH_ERROR: back off and report stderr"]:
            with self.subTest(action=action):
                self.assertIn(action, content)

    def test_behavioral_cases_cover_native_codex_and_missing_required_checks(self):
        cases = json.loads(text("evals/evals.json"))["evals"]
        ids = [case["id"] for case in cases]
        self.assertEqual(len(ids), len(set(ids)))
        for name in ["one-monitor-pinned-head", "codex-pr-watch-exits", "empty-or-late-required-check"]:
            with self.subTest(case=name):
                case = next(case for case in cases if case.get("name") == name)
                self.assertTrue(case["prompt"])
                self.assertTrue(case["expected_output"])
                self.assertGreaterEqual(len(case["assertions"]), 2)
                self.assertTrue(all(row["name"] and row["description"] for row in case["assertions"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
