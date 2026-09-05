#!/usr/bin/env python3
"""RED/GREEN tests for correction-sweep.py (Fix-10, weave 2026-06-07 Phase 2).

RED: a doc tree carrying one un-annotated copy of a struck literal must
produce exit!=0 and a table row `file [line] | struck-string | RAW`.
GREEN: the same tree with every copy struck-in-place must produce exit 0.

Fixtures are DURABLE, committed under evals/fixtures/correction-sweep/
(no /tmp — the sweep belongs to the same fix family as the /tmp ban, S04).
"""
from __future__ import annotations

import re
import subprocess
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "correction-sweep.py"
FIXTURES = Path(__file__).resolve().parents[2] / "evals" / "fixtures" / "correction-sweep"
CORRECTIONS = FIXTURES / "CORRECTIONS.md"
TREE_RED = FIXTURES / "tree-red"
TREE_GREEN = FIXTURES / "tree-green"


def run_sweep(*roots: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(CORRECTIONS), *map(str, roots)],
        capture_output=True,
        text=True,
    )


class CorrectionSweepRed(unittest.TestCase):
    """RED: one unpatched literal copy survives in tree-red."""

    def test_red_exits_nonzero_on_unannotated_copy(self) -> None:
        r = run_sweep(TREE_RED)
        self.assertEqual(r.returncode, 1, msg=r.stdout + r.stderr)

    def test_red_table_names_file_line_literal_raw(self) -> None:
        r = run_sweep(TREE_RED)
        # the unpatched copy lives at tree-red/handoff.md line 4
        row = re.search(
            r"handoff\.md \[4\] \| 47 sessions staged \(§1\.1\) \| RAW \|", r.stdout
        )
        self.assertIsNotNone(row, msg="missing RAW table row; stdout:\n" + r.stdout)

    def test_red_annotated_copy_is_labeled_annotated_not_raw(self) -> None:
        r = run_sweep(TREE_RED)
        # tree-red line 7 carries row-2's literal STRUCK in place -> ANNOTATED
        row = re.search(
            r"handoff\.md \[7\]\s*\|\s*PR #999 OPEN at session end.*\|\s*ANNOTATED",
            r.stdout,
        )
        self.assertIsNotNone(row, msg="annotated copy mislabeled; stdout:\n" + r.stdout)

    def test_struck_copy_does_not_clear_raw_duplicate_on_same_line(self) -> None:
        # tree-red line 9 carries ~~47 sessions staged~~ AND a raw duplicate
        # on the same line — one struck copy must not clear the line (Codex
        # finding: the ALL-copies gate)
        r = run_sweep(TREE_RED)
        row = re.search(
            r"handoff\.md \[9\] \| 47 sessions staged \(§1\.1\) \| RAW \|", r.stdout
        )
        self.assertIsNotNone(row, msg="mixed raw+struck line cleared; stdout:\n" + r.stdout)

    def test_pointer_token_does_not_rescue_raw_duplicate_beside_struck_copy(self) -> None:
        # tree-red line 10: struck copy + pointer token + raw duplicate on the
        # SAME line — the token must not clear the unwrapped duplicate
        r = run_sweep(TREE_RED)
        row = re.search(
            r"handoff\.md \[10\] \| 47 sessions staged \(§1\.1\) \| RAW \|", r.stdout
        )
        self.assertIsNotNone(row, msg="token rescued a raw duplicate; stdout:\n" + r.stdout)

    def test_multi_literal_strike_instruction_captures_every_quote(self) -> None:
        # §1.4 fixture row: Strike "10-min tick" and "67 ticks" in place —
        # BOTH quoted literals must be swept (Codex finding: the second quote
        # was dropped); tree-red line 11 carries both raw
        r = run_sweep(TREE_RED)
        self.assertRegex(
            r.stdout, r"handoff\.md \[11\] \| 10-min tick \(§1\.4\) \| RAW \|"
        )
        self.assertRegex(
            r.stdout, r"handoff\.md \[11\] \| 67 ticks \(§1\.4\) \| RAW \|"
        )

    def test_literal_containing_token_word_does_not_self_clear(self) -> None:
        # §1.5 literal "superseded tick policy applies" contains the token
        # word "superseded" — the token check must exclude the literal's own
        # text or every raw copy self-clears (Codex finding)
        r = run_sweep(TREE_RED)
        self.assertRegex(
            r.stdout,
            r"handoff\.md \[12\] \| superseded tick policy applies \(§1\.5\) \| RAW \|",
        )

    def test_stray_heading_does_not_truncate_section1_and_wrapped_strike_captures(self) -> None:
        # fixture §1 contains a stray `## quoted...` heading between rows 5
        # and 6 (Bugbot: must not end the parse) AND row 6's Strike
        # instruction wraps across a newline (Codex: the post-wrap quote must
        # still be captured); tree-red [13] carries both literals raw
        r = run_sweep(TREE_RED)
        self.assertRegex(
            r.stdout, r"handoff\.md \[13\] \| relay window A \(§1\.6\) \| RAW \|"
        )
        self.assertRegex(
            r.stdout, r"handoff\.md \[13\] \| relay window B \(§1\.6\) \| RAW \|"
        )

    def test_sentence_shaped_strike_literal_keeps_internal_period(self) -> None:
        # §1.7's Strike instruction quotes a sentence with an internal
        # period — the instruction capture must not stop inside the quote
        # (Codex finding); tree-red [14] carries the sentence raw
        r = run_sweep(TREE_RED)
        self.assertRegex(
            r.stdout,
            r"handoff\.md \[14\] \| Phase one was done\. All sessions staged \(§1\.7\) \| RAW \|",
        )

    def test_token_match_is_whole_word_unrefuted_does_not_clear(self) -> None:
        # tree-red [15]: "unrefuted" contains "refuted" as a substring but
        # NOT as a word — it must not clear the raw copy (Bugbot finding)
        r = run_sweep(TREE_RED)
        self.assertRegex(
            r.stdout, r"handoff\.md \[15\] \| 47 sessions staged \(§1\.1\) \| RAW \|"
        )

    def test_no_literal_row_is_surfaced_for_manual_sweep(self) -> None:
        r = run_sweep(TREE_RED)
        self.assertIn("NO-LITERAL", r.stdout)
        self.assertIn("vl PR state errors", r.stdout)

    def test_report_only_never_edits(self) -> None:
        before = (TREE_RED / "handoff.md").read_text()
        run_sweep(TREE_RED)
        self.assertEqual(before, (TREE_RED / "handoff.md").read_text())


class CorrectionSweepGreen(unittest.TestCase):
    """GREEN: every copy annotated in tree-green -> exit 0."""

    def test_green_exits_zero_when_all_copies_annotated(self) -> None:
        r = run_sweep(TREE_GREEN)
        self.assertEqual(r.returncode, 0, msg=r.stdout + r.stderr)

    def test_green_still_reports_annotated_copies(self) -> None:
        r = run_sweep(TREE_GREEN)
        self.assertIn("ANNOTATED", r.stdout)
        self.assertNotRegex(r.stdout, r"\| RAW \|")


class CorrectionSweepContract(unittest.TestCase):
    def test_corrections_file_itself_is_excluded_from_targets(self) -> None:
        # sweeping the fixtures dir (which contains CORRECTIONS.md) must not
        # flag the corrections file's own rows as raw copies of themselves
        r = run_sweep(FIXTURES / "tree-green")
        self.assertNotIn("CORRECTIONS.md [", r.stdout)

    def test_missing_section_1_exits_2(self) -> None:
        r = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                str(TREE_GREEN / "handoff.md"),  # a doc with no §1 strikes
                str(TREE_GREEN),
            ],
            capture_output=True,
            text=True,
        )
        self.assertEqual(r.returncode, 2, msg=r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
