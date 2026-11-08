"""Synthetic CLI proof: rounds create rounds; no provider or private corpus."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "weave_loop.py"


class WeaveLoop(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.wd = Path(self.temp.name)
        sessions = [dict(label=label, centerpiece=label == "center")
                    for label in ["worker-a", "center", "worker-b"]]
        (self.wd / "batch-manifest.json").write_text(json.dumps(
            {"batches": [{"sessions": sessions}]}))
        self.bank = self.wd / "questions.md"
        self.bank.write_text("# Synthetic bank\n\nA1. What worked?\n")

    def cli(self, *args, rc=0):
        result = subprocess.run([sys.executable, "-B", str(SCRIPT), *args,
                                 "--workdir", str(self.wd)], capture_output=True, text=True)
        self.assertEqual(result.returncode, rc, result.stdout + result.stderr)
        return result

    def state(self):
        return json.loads((self.wd / "loop/state.json").read_text())

    def next(self):
        before = len(self.state()["rounds"])
        self.cli("next")
        rounds = self.state()["rounds"]
        self.assertEqual(len(rounds), before + 1)
        self.assertTrue(all(r["items"] for r in rounds), "every round must dispatch real work")
        return rounds[-1]["items"]

    def receipts(self, items, rows=None):
        rows = rows or {}
        for item in items:
            Path(item["out"]).write_text("".join(json.dumps(row) + "\n"
                for row in rows.get(item["key"], [])))

    def test_expanding_fixture_and_two_dry_rounds(self):
        self.cli("init")
        first = self.next()
        self.assertEqual([i["target"] for i in first], ["center", "worker-a", "worker-b"])
        followups = [dict(kind=k, target=t, why=w) for k, t, w in [
            ("redteam", "center", "Challenge result"), ("verify", "center", "Claim"),
            ("widen", "branch-a", "Explore a"), ("widen", "branch-b", "Explore b")]]
        self.receipts(first, {first[0]["key"]: [dict(id="synthetic#1", title="Claim",
            followups=followups, verified=False, new_questions=["What changed?"])]})
        self.cli("ingest", "--round", "1")
        self.cli("questions", "--bank", str(self.bank))
        original = self.bank.read_text()
        self.cli("questions", "--bank", str(self.bank))
        self.assertEqual(self.bank.read_text(), original)
        self.assertTrue(original.startswith("# Synthetic bank\n\nA1. What worked?\n"))
        self.assertIn("round=1; finding=synthetic#1; session=center", original)
        self.assertEqual(self.state()["bank_growth"], 1)
        second = self.next()
        self.assertEqual(len(second), 7)  # four followups + one regather per mined session
        self.assertEqual({i["target"] for i in second if i["kind"] == "regather"},
                         {"center", "worker-a", "worker-b"})
        verify = next(i for i in second if i["kind"] == "verify")
        self.receipts(second, {verify["key"]: [dict(verified=True,
            followups=[followups[0], dict(kind="redteam", target="branch-c", why="New lead")])]})
        self.cli("ingest", "--round", "2")
        third = self.next()
        self.assertEqual(len(third), 1)
        self.assertEqual(third[0]["target"], "branch-c")
        self.receipts(third)
        self.cli("ingest", "--round", "3")
        self.assertEqual(self.state()["dry_streak"], 1)
        confirmation = self.next()
        self.assertEqual(len(confirmation), 7)  # five redteams + two zero-yield sessions
        redteams = [i for i in confirmation if i["kind"] == "redteam"]
        self.assertEqual(len(redteams), 5)
        self.assertEqual(redteams[0]["target"], first[0]["key"])
        self.assertEqual({i["target"] for i in confirmation if i["kind"] == "widen"},
                         {"worker-a", "worker-b"})
        self.assertTrue(all(i["why"] == "confirmation sweep" for i in confirmation))
        self.receipts(confirmation)
        result = self.cli("ingest", "--round", "4")
        self.assertEqual(self.state()["status"], "DRY_STOP")
        self.assertIn("SYNTHESIZE", result.stdout)
        self.assertEqual([len(r["items"]) for r in self.state()["rounds"]], [3, 7, 1, 7])
        self.assertEqual(len(self.state()["scheduled"]), 18)
        self.assertEqual(self.state()["dry_streak"], 2)

    def test_confirmation_finding_resets_streak_and_continues(self):
        self.cli("init", "--confirmation-top-n", "1", "--confirmation-spot-checks", "1")
        first = self.next()
        self.receipts(first)
        self.cli("ingest", "--round", "1")
        self.assertEqual(self.state()["dry_streak"], 1)
        confirmation = self.next()
        self.assertEqual(len(confirmation), 2)
        self.receipts(confirmation, {confirmation[0]["key"]: [dict(followups=[
            dict(kind="regather", target="branch-new", why="New confirmation evidence")])]})
        self.cli("ingest", "--round", "2")
        self.assertEqual(self.state()["dry_streak"], 0)
        self.assertEqual(self.state()["status"], "RUNNING")
        third = self.next()
        self.assertEqual([i["target"] for i in third], ["branch-new"])
        self.receipts(third)
        self.cli("ingest", "--round", "3")
        fourth = self.next()
        self.assertEqual(len(fourth), 2)
        keys = [i["key"] for r in self.state()["rounds"] for i in r["items"]]
        self.assertEqual(len(keys), len(set(keys)))

    def test_confirmation_exhausted_is_explicit_and_creates_no_empty_round(self):
        self.cli("init")
        first = self.next()
        followups = [dict(kind="redteam", target=i["key"], why="confirmation sweep") for i in first]
        followups += [dict(kind="widen", target=i["target"], why="confirmation sweep") for i in first]
        self.receipts(first, {first[0]["key"]: [dict(followups=followups)]})
        self.cli("ingest", "--round", "1")
        second = self.next()
        self.receipts(second)
        self.cli("ingest", "--round", "2")
        self.assertEqual(self.state()["dry_streak"], 1)
        self.cli("next")
        state = self.state()
        self.assertEqual(state["status"], "DRY_STOP")
        self.assertEqual(state["stop_reason"], "confirmation-exhausted")
        self.assertEqual(len(state["rounds"]), 2)
        result = self.cli("status")
        self.assertIn("confirmation-exhausted", result.stdout)
        self.assertIn("SYNTHESIZE", result.stdout)
        self.assertTrue(all(r["items"] for r in state["rounds"]))

    def test_unmined_and_zero_finding_sessions_are_confirmation_candidates(self):
        (self.wd / "corpus-manifest.json").write_text(json.dumps({"sessions": [
            dict(label="unmined", centerpiece=False), dict(label="center", centerpiece=True),
            dict(label="worker-a", centerpiece=False), dict(label="worker-b", centerpiece=False)]}))
        self.cli("init", "--confirmation-top-n", "1", "--confirmation-spot-checks", "2")
        first = self.next()
        self.receipts(first, {first[0]["key"]: [dict(title="Load-bearing", verified=True)]})
        self.cli("ingest", "--round", "1")
        confirmation = self.next()
        self.assertEqual(len(confirmation), 3)
        self.assertEqual([i["target"] for i in confirmation if i["kind"] == "widen"],
                         ["unmined", "worker-a"])

    def test_legacy_empty_round_cannot_increment_dry_streak(self):
        self.cli("init")
        self.next()
        state = self.state()
        state["rounds"][-1]["items"] = []  # simulate a pre-fix state file
        state["dry_streak"] = 1
        (self.wd / "loop/state.json").write_text(json.dumps(state))
        self.cli("ingest", "--round", "1")
        self.assertEqual(self.state()["status"], "RUNNING")
        self.assertEqual(self.state()["dry_streak"], 0)

    def test_confirmation_work_obeys_loud_round_backstop(self):
        self.cli("init", "--max-rounds", "1")
        first = self.next()
        self.receipts(first)
        self.cli("ingest", "--round", "1")
        result = self.cli("next", rc=3)
        self.assertEqual(self.state()["status"], "BACKSTOP_HIT")
        self.assertTrue(self.state()["pending"])
        self.assertIn("confirmation sweep", result.stderr)
        self.assertEqual(len(self.state()["rounds"]), 1)

    def test_overflow_and_loud_backstop(self):
        self.cli("init", "--max-items-per-round", "1", "--max-rounds", "1")
        items = self.next()
        self.assertEqual(len(items), 1)
        self.assertEqual(len(self.state()["rounds"][0]["carried"]), 2)
        self.receipts(items)
        self.cli("ingest", "--round", "1")
        result = self.cli("next", rc=3)
        self.assertEqual(self.state()["status"], "BACKSTOP_HIT")
        for key in self.state()["pending"]:
            self.assertIn(key, result.stderr)
        self.assertNotIn("SYNTHESIZE", result.stdout)

    def test_unverified_claim_retries_instead_of_going_dry(self):
        self.cli("init")
        items = self.next()
        self.receipts(items, {items[0]["key"]: [dict(title="Unproven", verified=False)]})
        self.cli("ingest", "--round", "1")
        verify = self.next()
        self.assertEqual(len(verify), 1)
        self.receipts(verify)
        self.cli("ingest", "--round", "2")
        self.assertEqual(self.state()["dry_streak"], 0)
        self.assertEqual(self.next()[0]["key"], verify[0]["key"])

    def test_density_order_normalized_dedup_and_existing_question(self):
        self.cli("init")
        items = self.next()
        followup = dict(kind="widen", target="branch-a", why="More evidence")
        self.receipts(items, {
            items[0]["key"]: [dict(id="s#1", new_questions=[" WHAT   WORKED? "],
                followups=[followup, dict(kind="widen", target="branch-b", why="More")])],
            items[1]["key"]: [dict(followups=[dict(kind="redteam", target="branch-c", why="Check")])],
            items[2]["key"]: [dict(followups=[dict(followup, why=" MORE   EVIDENCE ")])]})
        self.cli("ingest", "--round", "1")
        self.cli("next", rc=2)  # Bank processing is required before advancing.
        original = self.bank.read_text()
        self.cli("questions", "--bank", str(self.bank))
        self.assertEqual(self.bank.read_text(), original)
        self.assertEqual(self.state()["bank_growth"], 0)
        self.assertEqual([i["target"] for i in self.next()], ["branch-a", "branch-b", "branch-c"])

    def test_overflow_is_eventually_drained(self):
        self.cli("init", "--max-items-per-round", "1")
        targets = []
        for number in range(1, 20):
            if self.state()["status"] != "RUNNING":
                break
            self.cli("next")
            if self.state()["status"] != "RUNNING":
                break
            items = self.state()["rounds"][-1]["items"]
            self.assertTrue(items)
            targets += [i["target"] for i in items if i["kind"] == "mine"]
            self.receipts(items)
            self.cli("ingest", "--round", str(number))
        self.assertEqual(targets, ["center", "worker-a", "worker-b"])
        self.assertEqual(self.state()["status"], "DRY_STOP")

    def test_malformed_optional_fields_do_not_commit_ingestion(self):
        self.cli("init")
        items = self.next()
        for invalid in [dict(verified="false"), dict(new_questions="text"), dict(followups={})]:
            self.receipts(items, {items[0]["key"]: [invalid]})
            self.cli("ingest", "--round", "1", rc=2)
            self.assertFalse(self.state()["rounds"][0]["ingested"])

    def test_old_format_and_missing_output(self):
        self.cli("init")
        items = self.next()
        self.cli("next", rc=2)
        self.cli("ingest", "--round", "1", rc=2)
        self.assertFalse(self.state()["rounds"][0]["ingested"])
        self.receipts(items, {items[0]["key"]: [dict(id="old#1", title="Legacy", disposition="KEEP")]})
        self.cli("ingest", "--round", "1")
        self.assertEqual(len(self.state()["scheduled"]), 3)
        self.assertEqual(self.state()["dry_streak"], 1)
        self.cli("ingest", "--round", "1", rc=2)

    def test_bank_dedup_across_fresh_runs(self):
        for _ in range(2):
            self.cli("init")
            items = self.next()
            self.receipts(items, {items[0]["key"]: [dict(id="s#1", new_questions=["New question?"])]})
            self.cli("ingest", "--round", "1")
            self.cli("questions", "--bank", str(self.bank))
            growth = self.state()["bank_growth"]
            if self.wd.name == "fresh":
                self.assertEqual(growth, 0)
                break
            self.assertEqual(growth, 1)
            plan = (self.wd / "batch-manifest.json").read_text()
            self.wd = self.wd / "fresh"
            self.wd.mkdir()
            (self.wd / "batch-manifest.json").write_text(plan)


if __name__ == "__main__":
    unittest.main()
