#!/usr/bin/env python3
"""Red/green tests for prepare-mine-context.py jsonl_line cites."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "prepare-mine-context.py"
FIXTURES = Path(__file__).resolve().parents[2] / "evals" / "fixtures" / "mine-context"


class PrepareMineContextLineNumbers(unittest.TestCase):
    def test_emits_jsonl_line_matching_raw_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            jsonl = Path(tmp) / "fixture.jsonl"
            # line 1: noise, line 2: keyword hit we expect cited
            jsonl.write_text(
                '{"type":"assistant","message":{"content":"hello"}}\n'
                '{"type":"user","message":{"content":"Etan said this is wrong and needs a fix"}}\n'
            )
            ctx_dir = Path(tmp) / "ctx"
            session = {
                "label": "test/fixture",
                "src": str(jsonl),
                "source": "claude",
            }
            r = subprocess.run(
                [sys.executable, str(SCRIPT), "--ctx-dir", str(ctx_dir)],
                input=json.dumps(session),
                capture_output=True,
                text=True,
                check=True,
            )
            out_md = Path(r.stdout.strip())
            text = out_md.read_text()
            self.assertIn("jsonl_line=2", text)
            self.assertNotRegex(text, r"\[2\] USER:")  # old ambiguous format
            # grep line 2 in raw JSONL — content must match excerpt target
            line2 = jsonl.read_text().splitlines()[1]
            self.assertIn("wrong", line2)


class PrepareMineContextUserMessages(unittest.TestCase):
    def test_header_counts_only_operator_user_turns(self) -> None:
        fixture = FIXTURES / "user-message-count.jsonl"
        naive_count = sum(
            1 for line in fixture.read_text().splitlines() if json.loads(line).get("type") == "user"
        )
        self.assertEqual(naive_count, 13)

        with tempfile.TemporaryDirectory() as tmp:
            ctx_dir = Path(tmp) / "ctx"
            session = {
                "label": "test/user-message-count",
                "src": str(fixture),
                "source": "claude",
            }
            r = subprocess.run(
                [sys.executable, str(SCRIPT), "--ctx-dir", str(ctx_dir)],
                input=json.dumps(session),
                capture_output=True,
                text=True,
                check=True,
            )
            text = Path(r.stdout.strip()).read_text()
            self.assertRegex(text, r"(?m)^\*\*user_messages:\*\* 2$")


if __name__ == "__main__":
    unittest.main()
