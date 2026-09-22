import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).parents[2]
SCRIPT = REPO / "scripts" / "jev-choice-replay.py"
SPEC = importlib.util.spec_from_file_location("jev_choice_replay", SCRIPT)
replay = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(replay)


class JevChoiceReplayTest(unittest.TestCase):
    def setUp(self):
        root = REPO / "docs.local"
        root.mkdir(parents=True, exist_ok=True)
        self.tempdir = tempfile.TemporaryDirectory(dir=root)
        self.old_env = os.environ.copy()
        os.environ.pop("CI", None)
        os.environ["TYPESAFE_API_KEY"] = "test-key"
        os.environ["JEV_SITE_JEV_E1_CHOICE_REPLAY"] = "shadow"

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.old_env)
        self.tempdir.cleanup()

    @staticmethod
    def corpus():
        states = [
            {"name": "unknown", "entry_evidence": "No reliable evidence."},
            {"name": "ready", "entry_evidence": "An agent prompt is ready."},
            {"name": "dead", "entry_evidence": "The pane is positively known gone."},
        ]
        parser_screen = "Agent\n>"
        painpoint_screen = ""
        return {
            "states": states,
            "parser": [
                {
                    "screen": parser_screen,
                    "screen_hash": replay.screen_hash(parser_screen),
                    "label": "ready",
                    "regex": "ready",
                    "provenance": ["parser.test.ts:1"],
                }
            ],
            "painpoints": [
                {
                    "screen": painpoint_screen,
                    "screen_hash": replay.screen_hash(painpoint_screen),
                    "label": "dead",
                    "regex": "unknown",
                    "provenance": ["painpoint.test.ts:1"],
                }
            ],
        }

    def write_corpus(self, corpus=None):
        path = Path(self.tempdir.name) / "corpus.json"
        path.write_text(json.dumps(corpus or self.corpus()), encoding="utf-8")
        return path

    def test_preflight_keeps_subsets_separate_and_imports_choices(self):
        result = replay.preflight_corpus(self.write_corpus())
        self.assertEqual(len(result["decisions"]), 2)
        self.assertEqual(
            {row["subset"] for row in result["decisions"]},
            {"parser", "painpoint"},
        )
        self.assertEqual(
            list(result["question"]["criteria"]), ["unknown", "ready", "dead"]
        )
        self.assertLess(
            max(row["serialized_bytes"] for row in result["decisions"]),
            replay.SIZE_LIMIT_BYTES,
        )

    def test_preflight_rejects_hash_drift(self):
        corpus = self.corpus()
        corpus["parser"][0]["screen_hash"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            replay.preflight_corpus(self.write_corpus(corpus))

    def test_scores_only_vendor_shadow_answer_and_reconciled_usage(self):
        preflight = replay.preflight_corpus(self.write_corpus())
        decision = preflight["decisions"][0]
        sent = {}
        transport_calls = 0

        def transport(payload, _key):
            nonlocal transport_calls
            transport_calls += 1
            sent.update(payload)
            return {
                "model": "jev-test",
                "answers": {
                    "control_plane_state": {
                        "type": "choice",
                        "choice": decision["label"],
                        "confidence": 0.91,
                        "probabilities": {
                            "unknown": 0.04,
                            "ready": 0.91,
                            "dead": 0.05,
                        },
                    }
                },
                "usage": {"input_tokens": 12},
            }

        row = replay.score_decision(
            replay.load_jev(REPO),
            decision,
            preflight["question"],
            Path(self.tempdir.name) / "state",
            None,
            1,
            transport,
        )
        self.assertEqual(transport_calls, 1)
        self.assertEqual(sent["state"], {"screen_text": decision["screen"]})
        self.assertEqual(row["answer"], decision["label"])
        self.assertEqual(row["input_tokens"], 12)
        self.assertEqual(row["model"], "jev-test")

    def test_fallback_aborts_scoring_with_bounded_reason(self):
        preflight = replay.preflight_corpus(self.write_corpus())

        def transport(*_):
            raise TimeoutError("raw text must not escape")

        with self.assertRaisesRegex(RuntimeError, "transport_timeout"):
            replay.score_decision(
                replay.load_jev(REPO),
                preflight["decisions"][0],
                preflight["question"],
                Path(self.tempdir.name) / "state",
                None,
                1,
                transport,
            )

    def test_floor_uses_run_one_and_summary_never_blends_subsets(self):
        observations = []
        decisions = []
        for subset, label, baseline in (
            ("parser", "ready", "ready"),
            ("painpoint", "dead", "unknown"),
        ):
            decisions.append({"subset": subset, "label": label, "baseline": baseline})
            for run in range(1, 4):
                observations.append(
                    {
                        "subset": subset,
                        "run": run,
                        "label": label,
                        "baseline": baseline,
                        "answer": label,
                        "confidence": 0.9 if run == 1 else 0.1,
                    }
                )
        run_one = [row for row in observations if row["run"] == 1]
        self.assertEqual(replay.choose_floor(run_one), (0.5, True))
        summary = replay.summarize(observations, decisions)
        self.assertEqual(set(summary["subsets"]), {"parser", "painpoint"})
        self.assertNotIn("combined", summary)
        self.assertEqual(summary["floor"], 0.5)


if __name__ == "__main__":
    unittest.main()
