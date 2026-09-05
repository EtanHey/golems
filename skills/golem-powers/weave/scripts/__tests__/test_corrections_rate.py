#!/usr/bin/env python3
"""Regression coverage for the committed corrections-rate fixtures."""
from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path

WEAVE = Path(__file__).resolve().parents[2]
SCRIPT = WEAVE / "scripts" / "corrections-rate.py"
FIXTURES = WEAVE / "evals" / "fixtures" / "corrections-rate"


def run_rate(corrections: str, denominators: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            str(FIXTURES / corrections),
            "--denominators",
            str(FIXTURES / denominators),
        ],
        capture_output=True,
        text=True,
    )


class CorrectionsRateFixtures(unittest.TestCase):
    def test_sample_matches_expected_output(self) -> None:
        result = run_rate("sample.jsonl", "denominators.json")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, (FIXTURES / "expected.json").read_text())

    def test_unknown_bucket_fails_closed(self) -> None:
        result = run_rate("unknown-bucket.jsonl", "denominators.json")
        self.assertEqual(result.returncode, 2)
        self.assertIn("ERROR: unknown bucket 'hallucination'", result.stderr)

    def test_missing_denominator_fails_closed(self) -> None:
        result = run_rate("missing-denominator.jsonl", "missing-denominators.json")
        self.assertEqual(result.returncode, 2)
        self.assertIn("ERROR: missing denominator for model(s): fable-5", result.stderr)

    def test_zero_denominator_fails_closed(self) -> None:
        result = run_rate("missing-denominator.jsonl", "zero-denominators.json")
        self.assertEqual(result.returncode, 2)
        self.assertIn("must be a positive integer, got 0", result.stderr)


if __name__ == "__main__":
    unittest.main()
