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


ATTRIBUTION = "(Etan 2026-10-18, via orc collab)"
RULE_NO_POLLING = ("No polling turns. No collab-monitor wakes in Codex, and no \"watch #410\" loops. "
                   "Use T3 completion notifications or a single bounded check. "
                   "Mechanical polling or rebases go to gpt-6-luna.")
RULE_WATCHING = ("anything that must sit and watch (a PR, CI, a file) uses a cheap gpt-6-luna "
                 "sub-agent, never a big-context Sol or lead session.")
RULE_RATE_LIMITS = "Never wait on rate limits."
ADAPTERS = ["adapters/claude.md", "adapters/codex.md", "adapters/cursor.md"]
POLICY_LINK = "references/review-loop.md#waiting-policy-no-polling-turns"


def flat(relative):
    return " ".join(text(relative).split())


class WaitingPolicy(unittest.TestCase):
    """Etan 2026-10-18 rulings: T3 watch first, no polling turns, cheap watchers only."""

    def test_review_loop_orders_t3_watch_bounded_check_cheap_watcher_then_bans(self):
        content = flat("references/review-loop.md")
        self.assertIn("### Waiting policy (no polling turns)", content)
        content = content.split("### Waiting policy (no polling turns)", 1)[1]
        order = ["`link_pull_request`", "`watch_pull_request`", "end the turn",
                 "Single bounded check", "cheap watcher", "`codex.subagent.mechanical`", "Banned"]
        positions = [content.find(token) for token in order]
        self.assertTrue(all(pos >= 0 for pos in positions), dict(zip(order, positions)))
        self.assertEqual(positions, sorted(positions))
        self.assertIn("`unwatch_pull_request`", content)
        self.assertIn("parent-owned", content)
        self.assertIn("never a big-context lead session", content)

    def test_review_loop_quotes_the_rules_verbatim_with_attribution(self):
        # The collab source bolds some phrases; compare words, not emphasis markers.
        content = flat("references/review-loop.md").replace("**", "")
        for rule in [RULE_NO_POLLING, RULE_WATCHING, RULE_RATE_LIMITS]:
            with self.subTest(rule=rule[:40]):
                self.assertIn(rule, content)
        self.assertIn(ATTRIBUTION, content)

    def test_banned_list_names_every_polling_shape(self):
        content = flat("references/review-loop.md").split("### Waiting policy (no polling turns)", 1)[1]
        banned = content.split("Banned", 1)[1][:900]
        for shape in ["ScheduleWakeup", "CronCreate", "`/loop`", "collab-monitor", "duplicate watcher",
                      "rate limit"]:
            with self.subTest(shape=shape):
                self.assertIn(shape, banned)

    def test_scheduled_wakes_are_no_longer_prescribed(self):
        for relative in ["references/review-loop.md", *ADAPTERS]:
            with self.subTest(surface=relative):
                self.assertNotIn("Timed one-shot wakes", flat(relative))

    def test_cmux_fallback_is_labelled_not_deleted(self):
        content = flat("references/review-loop.md")
        self.assertIn("#### cmux adapter", content)
        cmux = content.split("#### cmux adapter", 1)[1].split("###", 1)[0]
        self.assertIn("/collab-monitor", cmux)
        self.assertIn("Codex seats never arm it", cmux)

    def test_every_adapter_points_at_the_policy(self):
        for relative in ADAPTERS:
            with self.subTest(surface=relative):
                content = flat(relative)
                self.assertIn(f"../{POLICY_LINK}", content)
                self.assertIn("`watch_pull_request`", content)

    def test_codex_adapter_has_no_collab_monitor_review_wake(self):
        content = flat("adapters/codex.md")
        self.assertNotIn("arm the `/collab-monitor` packaged fallback", content)
        self.assertIn("No collab-monitor wakes in Codex", content)
        self.assertIn("T3 completion", content)
        caps = flat("adapters/capabilities.yaml")
        self.assertNotIn("/collab-monitor for handoffs", caps)

    def test_skill_md_names_the_policy_in_one_line(self):
        content = text("SKILL.md")
        self.assertIn("references/review-loop.md#waiting-policy-no-polling-turns", content)
        self.assertIn("never a polling turn", content)

    def test_behavioral_cases_cover_the_waiting_policy(self):
        cases = {case["id"]: case for case in json.loads(text("evals/evals.json"))["evals"]}
        for case_id, name in [(40, "t3-seat-links-and-watches-pr"), (41, "rate-limited-bot-not-awaited"),
                              (42, "codex-no-collab-monitor-after-push"), (43, "cmux-seat-one-watcher-process")]:
            with self.subTest(case=name):
                case = cases.get(case_id)
                self.assertIsNotNone(case)
                self.assertEqual(case["name"], name)
                self.assertTrue(case["prompt"] and case["expected_output"])
                self.assertGreaterEqual(len(case["assertions"]), 2)
                self.assertTrue(any(row.get("type") == "negative" for row in case["assertions"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
