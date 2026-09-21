import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).parents[2]
SCRIPT = REPO / "scripts" / "jev-gate-replay.py"
SPEC = importlib.util.spec_from_file_location("jev_gate_replay", SCRIPT)
replay = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(replay)


class JevGateReplayTest(unittest.TestCase):
    def setUp(self):
        root = REPO / "docs.local"
        root.mkdir(parents=True, exist_ok=True)
        self.tempdir = tempfile.TemporaryDirectory(dir=root)
        self.old_env = os.environ.copy()
        os.environ["TYPESAFE_API_KEY"] = "test-key"
        for name in (
            "CI",
            "JEV_ENABLED",
            "JEV_DAILY_USD_CAP",
            "JEV_SITE_JEV_E2_GATES",
        ):
            os.environ.pop(name, None)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.old_env)
        self.tempdir.cleanup()

    @staticmethod
    def fixture():
        state = {"events": [{"role": "assistant", "text": "Should I start?"}]}
        return {
            "gate": "idle-dwell",
            "state_hash": replay.state_hash(state),
            "fixtures": ["synthetic.json"],
            "expected": "FLAG",
            "state": state,
            "serialized_bytes": replay.serialized_item_bytes("idle-dwell", state),
        }

    @staticmethod
    def response(values=(0.9, 0.1, 0.8)):
        return {
            "model": "jev-test",
            "answers": {
                question["id"]: {"type": "noul", "noul": value}
                for question, value in zip(replay.QUESTIONS["idle-dwell"], values)
            },
            "usage": {"input_tokens": 12, "output_tokens": 3},
        }

    def test_preflight_loads_exact_unique_set_without_label_leakage(self):
        preflight = replay.preflight_fixtures(REPO)
        self.assertEqual(preflight["source_count"], 59)
        self.assertEqual(len(preflight["decisions"]), 59)
        self.assertEqual(preflight["exclusions"], [])
        self.assertEqual(
            sum(row["gate"] == "idle-dwell" for row in preflight["decisions"]),
            23,
        )
        self.assertEqual(
            sum(row["gate"] == "false-green" for row in preflight["decisions"]),
            36,
        )
        self.assertLess(
            max(row["serialized_bytes"] for row in preflight["decisions"]),
            replay.SIZE_LIMIT_BYTES,
        )
        serialized = json.dumps([row["state"] for row in preflight["decisions"]])
        self.assertNotIn('"expect"', serialized)
        self.assertNotIn('"violation"', serialized)
        self.assertNotIn('"specimen"', serialized)

    def test_preflight_refuses_an_empty_scorable_population(self):
        with self.assertRaisesRegex(RuntimeError, "no scorable decisions"):
            replay.planned_call_count({"decisions": []})

    def test_scores_public_shadow_answer_and_usage_receipt(self):
        jev_client = replay.load_jev(REPO)
        sent = {}

        def transport(payload, _key):
            sent.update(payload)
            return self.response()

        fixture = self.fixture()
        row = replay.score_fixture(
            jev_client,
            fixture,
            Path(self.tempdir.name),
            None,
            1,
            transport,
        )
        self.assertEqual(sent["state"], fixture["state"])
        self.assertEqual(len(sent["questions"]), 3)
        self.assertEqual(replay.predict(row, 0.75), "FLAG")
        self.assertEqual(row["input_tokens"], 12)
        self.assertEqual(row["model"], "jev-test")
        self.assertAlmostEqual(row["cost_usd"], 12 * replay.PRICE_PER_INPUT_TOKEN)
        decisions = replay.read_jsonl(Path(self.tempdir.name) / "decisions.jsonl")
        self.assertTrue(all(not decision["acted"] for decision in decisions))

    def test_refuses_non_shadow_before_transport(self):
        jev_client = replay.load_jev(REPO)
        calls = []
        os.environ["JEV_SITE_JEV_E2_GATES"] = "on"
        with self.assertRaisesRegex(ValueError, "requires shadow mode"):
            replay.score_fixture(
                jev_client,
                self.fixture(),
                Path(self.tempdir.name),
                None,
                1,
                lambda *_: calls.append(True),
            )
        self.assertEqual(calls, [])

    def test_fallback_answer_aborts_scoring_with_bounded_reason(self):
        jev_client = replay.load_jev(REPO)

        def transport(*_):
            raise TimeoutError("do not log this raw message")

        with self.assertRaisesRegex(RuntimeError, "transport_timeout"):
            replay.score_fixture(
                jev_client,
                self.fixture(),
                Path(self.tempdir.name),
                None,
                1,
                transport,
            )

    def test_floor_is_selected_from_run_one_only(self):
        run_one = [
            {
                "run": 1,
                "gate": "idle-dwell",
                "expected": "FLAG",
                "answers": {
                    "handed_back_authorized_work": 0.9,
                    "genuine_external_blocker": 0.2,
                    "could_continue_without_input": 0.8,
                },
            },
            {
                "run": 1,
                "gate": "idle-dwell",
                "expected": "PASS",
                "answers": {
                    "handed_back_authorized_work": 0.7,
                    "genuine_external_blocker": 0.9,
                    "could_continue_without_input": 0.1,
                },
            },
        ]
        floor, met = replay.choose_floor(run_one)
        self.assertTrue(met)
        self.assertEqual(floor, 0.8)
        hostile_later_runs = [
            {**row, "run": run, "expected": "FLAG"} for run in (2, 3) for row in run_one
        ]
        self.assertNotEqual(
            replay.choose_floor(run_one + hostile_later_runs), (floor, met)
        )
        self.assertEqual(replay.choose_floor(run_one), (floor, met))

    def test_single_question_metrics_use_protective_polarity(self):
        row = {
            "gate": "idle-dwell",
            "expected": "FLAG",
            "answers": {
                "handed_back_authorized_work": 0.9,
                "genuine_external_blocker": 0.1,
                "could_continue_without_input": 0.8,
            },
        }
        self.assertEqual(
            replay.metrics([row], 0.75, "genuine_external_blocker")["tp"], 1
        )
        self.assertEqual(replay.metrics([row], 0.75)["tp"], 1)

    def test_executed_report_retains_verifiable_approval_receipt(self):
        report = Path(self.tempdir.name) / "report.md"
        report.write_text(
            "# E2\n\nStatus: **EXECUTED — E2 PASS BAR FAILED.** "
            "Orc approved this specification at 2026-09-22 01:00 IDT.\n"
            "\n## Run receipt\n\nold\n",
            encoding="utf-8",
        )
        prefix = replay.load_spec_prefix(report)
        self.assertIn("Status: **EXECUTED", prefix)
        self.assertNotIn("old", prefix)

    def test_render_preserves_spec_and_reports_frozen_floor_and_questions(self):
        rows = []
        for run in range(1, 4):
            rows.append(
                {
                    **self.fixture(),
                    "run": run,
                    "answers": {
                        "handed_back_authorized_work": 0.9,
                        "genuine_external_blocker": 0.1,
                        "could_continue_without_input": 0.8,
                    },
                    "model": "jev-test",
                    "input_tokens": 12,
                    "cost_usd": 12 * replay.PRICE_PER_INPUT_TOKEN,
                    "wall_seconds": 0.01,
                }
            )
        preflight = {
            "source_count": 1,
            "decisions": [self.fixture()],
            "exclusions": [],
        }
        ledger = [
            {"kind": "reservation", "cost_usd": replay.MAX_REQUEST_USD},
            {
                "kind": "reconciliation",
                "cost_usd": 12 * replay.PRICE_PER_INPUT_TOKEN - replay.MAX_REQUEST_USD,
            },
        ] * 3
        report = replay.render_report(
            "# E2\n\nStatus: APPROVED WITH AMENDMENTS INCORPORATED\n",
            rows,
            preflight,
            ledger,
        )
        self.assertTrue(report.startswith("# E2\n\nStatus: APPROVED"))
        self.assertIn("selected from run 1 only", report)
        self.assertIn("E2 pass bar: PASS", report)
        self.assertIn("handed_back_authorized_work", report)
        self.assertIn("not truth or accuracy on natural transcripts", report)


if __name__ == "__main__":
    unittest.main()
