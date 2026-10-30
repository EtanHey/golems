#!/usr/bin/env python3
"""Static arming-contract evals; no live-model or native Monitor claim."""
import json
from pathlib import Path
import unittest

SKILL = Path(__file__).resolve().parents[1]
REPO = SKILL.parents[2]
COMMAND = "pr-watch <owner/repo> <N> --head <sha> --deadline 2h"
# Codex blocks its turn on pr-watch with no shorter Monitor expiry, so its deadline is its cache limit.
CODEX_COMMAND = "pr-watch <owner/repo> <N> --head <sha> --deadline 25m"
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
                if relative == "adapters/codex.md":
                    self.assertIn(CODEX_COMMAND, content)
                    self.assertNotIn("--deadline 2h", content)
                else:
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

    def test_codex_deadline_stays_inside_its_cache_window(self):
        codex = " ".join(text("adapters/codex.md").split())
        self.assertIn("~30-min cache window", codex)
        self.assertIn("25-minute", codex)
        shared = " ".join(text("references/review-loop.md").split())
        self.assertIn("`--deadline 25m`", shared)
        self.assertIn("The 30-minute Monitor expiry precedes the 2h --deadline", shared)

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
        # The source-backed receipt preamble now precedes the ordered procedure.
        content = content.split("Wait in this order. Take the first option that fits:", 1)[1]
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

    def test_dispatch_handoffs_links_the_policy_instead_of_a_review_timer(self):
        # Review round 1 (#796): Autonomous Agent Mode kept a 120s / 5 min timer beside the policy.
        content = flat("references/dispatch-and-handoffs.md")
        autonomous = content.split("## Autonomous Agent Mode", 1)[1].split("## ", 1)[0]
        self.assertIn("(review-loop.md#waiting-policy-no-polling-turns)", autonomous)
        for stale in ["120s", "5 min", "wait minimum", "If no reviews after"]:
            with self.subTest(stale=stale):
                self.assertNotIn(stale, autonomous)

    def test_no_surface_keeps_a_timed_review_recheck(self):
        for path in sorted(SKILL.rglob("*.md")):
            relative = path.relative_to(SKILL).as_posix()
            if relative.startswith("evals/results"):
                continue
            with self.subTest(surface=relative):
                self.assertNotRegex(flat(relative), r"(?i)wait minimum \d+|if no reviews after \d+")

    def test_watcher_child_uses_the_supported_resolution_path(self):
        # Bare `codex.subagent.mechanical` resolution refuses (candidate role); watchers use --use watcher.
        self.assertIn("node scripts/model-roles.mjs codex.subagent.mechanical --use watcher",
                      flat("references/review-loop.md"))
        for path in sorted(SKILL.rglob("*.md")):
            relative = path.relative_to(SKILL).as_posix()
            for line in text(relative).splitlines():
                if "model-roles.mjs codex.subagent.mechanical" in line:
                    with self.subTest(surface=relative, line=line.strip()[:60]):
                        self.assertIn("--use watcher", line)

    def test_behavioral_cases_cover_receipt_persistence_stop_and_fallback(self):
        cases = {case.get("name"): case for case in json.loads(text("evals/evals.json"))["evals"]}
        for name in ["t3-watch-receipt-no-list", "t3-ordinary-wake-and-push-persist",
                     "t3-documented-stop-new-request", "t3-child-no-extra-waiter",
                     "non-t3-reuse-pinned-watcher", "bot-draft-config-no-duplicate"]:
            with self.subTest(case=name):
                case = cases[name]
                self.assertTrue(case["prompt"] and case["expected_output"])
                self.assertTrue(any(row.get("type") == "negative" for row in case["assertions"]))

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



RULE_MERGING = ("Merging: small PRs merge right away on fast CI + 1 review. Heavy or e2e tests run per "
                "FEATURE BATCH (a full plan or feature change tested together), not per PR and not as a "
                "pre-merge gate.")
RULE_XS_S = "XS/S: 1 reviewer, 1 round."
RULE_BOTS = ("Review bots (CodeRabbit/Bugbot) run only AFTER the inner loop, and they're advisory. "
             "Only wait on a bot when it flags something important. Never wait on rate limits.")
RULE_PARALLEL = "Give each test/build its own ports and temp folders so they run in parallel."
SSOT = "`/agent-routing` § Routing rules (SSOT)"
BATCH_LINK = "references/merge-and-verification.md#feature-batch-gate"


class RiskSizedGates(unittest.TestCase):
    """Etan 2026-10-18 22:00 + 23:25 rulings: risk-sized merges, feature-batch heavy gates."""

    def test_skill_md_quotes_the_rules_verbatim_with_attribution(self):
        content = flat("SKILL.md").replace("**", "")
        for rule in [RULE_MERGING, RULE_XS_S, RULE_BOTS, RULE_PARALLEL]:
            with self.subTest(rule=rule[:40]):
                self.assertIn(rule, content)
        self.assertIn(ATTRIBUTION, content)

    def test_cadence_points_at_the_routing_ssot_for_reviewer_counts(self):
        cadence = flat("SKILL.md").split("## Merge Cadence", 1)[1].split("## Hard Gates", 1)[0]
        self.assertIn(SSOT, cadence)
        for size in ["XS/S", "| M |", "L, data or security"]:
            with self.subTest(size=size):
                self.assertIn(size, cadence)
        self.assertIn("`headRefOid`", cadence)

    def test_per_pr_runtime_gates_moved_to_the_feature_batch_gate(self):
        skill = flat("SKILL.md")
        for stale in ["Complete the real-client gate before merge", "Complete visual self-QA before merge",
                      "Before closing either endpoint, run `scripts/ci/release-gate.mjs"]:
            with self.subTest(stale=stale):
                self.assertNotIn(stale, skill)
        self.assertIn(BATCH_LINK, skill)
        merge = flat("references/merge-and-verification.md")
        for stale in ["COMPLETE REAL CLIENT RUNTIME VERIFICATION BEFORE MERGE",
                      "Run `./scripts/voicelayer-verify.sh` BEFORE `gh pr merge`",
                      "builders click IN before merge", "screenshots it BEFORE merge", "6. Only then merge."]:
            with self.subTest(stale=stale):
                self.assertNotIn(stale, merge)
        self.assertNotIn("you MUST test with a real client session before proceeding", flat("references/pr-creation.md"))

    def test_batch_gate_keeps_the_how_and_the_single_pr_exception(self):
        merge = flat("references/merge-and-verification.md")
        self.assertIn("## Feature-Batch Gate", merge)
        for how in ["./scripts/voicelayer-verify.sh", "Verified-Runtime: <sha>", "Press F5 in the real VoiceBar client",
                    "Verify MCP tools are available AND return real results", "Screenshot",
                    "VISUAL VERIFICATION NOT PERFORMED", "single-PR batch", "canon #4"]:
            with self.subTest(how=how):
                self.assertIn(how, merge)

    def test_release_gate_runs_at_the_batch_endpoint_not_every_pr(self):
        skill = flat("SKILL.md")
        self.assertIn("`MERGED_UNRELEASED` mid-batch is expected, not a stop", skill)
        self.assertIn("scripts/ci/release-gate.mjs <repo>", flat("references/merge-and-verification.md"))

    def test_live_daemon_hook_is_named_not_bypassed(self):
        merge = flat("references/merge-and-verification.md")
        self.assertIn("daemon-gate-precheck", merge)
        self.assertIn("never bypass", merge.lower())

    def test_bots_are_advisory_and_post_merge_findings_open_a_new_pr(self):
        skill = flat("SKILL.md")
        self.assertIn("in a NEW PR (canon #9)", skill)
        self.assertNotIn("require PR-level bot status/comments before merge", flat("references/pr-creation.md"))
        self.assertNotIn("comments < 2", flat("references/review-loop.md"))

    def test_tests_and_builds_are_parallel_safe(self):
        skill = flat("SKILL.md")
        self.assertIn("own ports and temp dirs per run", skill)
        self.assertIn("no global one-at-a-time locks", skill)

    def test_behavioral_cases_cover_risk_sized_gates(self):
        cases = {case["id"]: case for case in json.loads(text("evals/evals.json"))["evals"]}
        for case_id, name in [(50, "xs-pr-one-clean-review-merges-now"),
                              (51, "daemon-pr-mid-batch-queues-real-client-run"),
                              (52, "rate-limited-bugbot-after-inner-loop-not-awaited"),
                              (53, "batch-done-runs-heavy-gates-before-done-claim")]:
            with self.subTest(case=name):
                case = cases.get(case_id)
                self.assertIsNotNone(case)
                self.assertEqual(case["name"], name)
                self.assertTrue(case["prompt"] and case["expected_output"])
                self.assertGreaterEqual(len(case["assertions"]), 2)
                self.assertTrue(any(row.get("type") == "negative" for row in case["assertions"]))

    # Review round 1 (#800): stale per-PR gates survived outside the files the first pass touched.
    STALE_GATES = [
        r"(?i)full test suite\s*\W+\s*all must pass",
        r"(?i)review bots and required checks green",
        r"(?i)bot reviewers post on the pr\. wait for them",
        r"(?i)wait for re-review",
        r"(?i)coderabbit (plus|\+) one",
        r"(?i)comment count is less than \d",
        # Verification-before-PR wording only; "invoke /pr-loop before gh pr create" (eval 26) is the kickoff contract, not a gate.
        r"(?i)(test|suite|verif|e2e|runtime|qa|check)[^.]{0,60}(before|until)[^.]{0,40}(creating the pr|pr creation|gh pr create)",
        r"(?i)functional self-qa happens before handoff",
    ]

    # Verbatim historical rulings stay quoted as provenance; the scan skips only these exact quotes.
    PROVENANCE_QUOTES = [
        "*\"bot tiering — full 4-bot panel only on daemon/engine/transport diffs, else CodeRabbit + one, "
        "one pass per bot, duplicate findings answered once + dup-links.\"*",
    ]

    def test_no_surface_keeps_a_per_pr_heavy_gate_or_bot_wait(self):
        for path in sorted(SKILL.rglob("*")):
            relative = path.relative_to(SKILL).as_posix()
            if not path.is_file() or relative.startswith("evals/results") or relative == "evals/run_suite.py":
                continue
            content = flat(relative)
            for quote in self.PROVENANCE_QUOTES:
                content = content.replace(quote, "")
            for pattern in self.STALE_GATES:
                with self.subTest(surface=relative, pattern=pattern):
                    self.assertNotRegex(content, pattern)

    def test_bot_tiering_points_at_the_routing_ssot_for_reviewer_counts(self):
        panel = flat("references/review-loop.md").split("#### 8a.1", 1)[1].split("#### 8a.2", 1)[0]
        self.assertIn(SSOT, panel)
        case = next(case for case in json.loads(text("evals/evals.json"))["evals"] if case["id"] == 20)
        self.assertIn("agent-routing", case["expected_output"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
