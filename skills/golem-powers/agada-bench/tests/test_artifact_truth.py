"""Exercise artifact reuse and rerouting through the real CLIs."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


class ArtifactTruthTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.corpus = self.root / "corpus.jsonl"
        self.rubric = self.root / "rubric.md"
        self.rubric.write_text("rubric")
        self.rows = [{"query_id": 1, "chunk_id": c, "label": 0} for c in ("a", "b")]
        self.write(self.corpus, self.rows)

    def write(self, path, rows):
        path.write_text("".join(json.dumps(row) + "\n" for row in rows))

    def run_cli(self, script, *args, expected_code=0):
        result = subprocess.run([sys.executable, str(SCRIPTS / script), *map(str, args)],
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, expected_code, result.stderr)
        return result.stdout + result.stderr

    def test_resume_requires_exact_unique_identities(self):
        output = self.root / "claude.jsonl"
        args = ("--corpus", self.corpus, "--rubric", self.rubric, "--judges", "claude",
                "--output-dir", self.root, "--resume")
        cases = [(rows, False) for rows in ([self.rows[0]] * 3, self.rows[:1], [{}] * 3,
                 [self.rows[0], {"query_id": 9, "chunk_id": "foreign", "label": 0}])]
        cases += [(self.rows + [{**self.rows[0], "label": label}], False) for label in (None, "")]
        cases += [([{**row, "label": None} for row in self.rows], False)]
        cases += [([{k: v for k, v in row.items() if k != "label"} for row in self.rows], False),
                  (self.rows, True), (self.rows + [{**self.rows[0], "label": 3}], True),
                  ([{**row, "query_id": "1"} for row in self.rows], False),
                  (self.rows + [{"calibration_note": "revised a"}], True),
                  (self.rows + [{"query_id": 1, "chunk_id": "a", "calibration_note": "revised a"}], False)]
        for rows, complete in cases:
            with self.subTest(rows=rows):
                self.write(output, rows)
                text = self.run_cli("dispatch-judges.py", *args, "--dry-run")
                self.assertIn(f"skipped={int(complete)}", text)
                self.assertIn("prepared; launched=0", text)
                self.assertEqual(len(output.read_text().splitlines()), len(rows))
                self.run_cli("dispatch-judges.py", *args)
                self.assertEqual(output.exists(), complete)
                if not complete:
                    self.assertTrue(any(p.read_text().splitlines() == [json.dumps(r) for r in rows]
                                        for p in self.root.glob("claude.jsonl.dead-*")))

    def test_rerun_refreshes_both_queues_and_final_gold_digest(self):
        gold = self.root / "gold.jsonl"
        consensus = self.root / "consensus.jsonl"
        args = ("--gold", gold, "--consensus", consensus, "--out", self.root / "report.md")
        pending = [{**r, "method": "pending-rt"} for r in self.rows]
        self.write(gold, pending)
        self.write(consensus, [{**self.rows[0], "labels_by_judge": {"a": 0, "b": 3, "c": 3},
                                "failure_modes_union": ["FM6"], "avg_confidence": 90}])
        (self.root / "ETAN_QUEUE.md").write_text("Your verdict: 3\n")
        snapshots = []
        for mode, count in (("opus-4-7", 1), ("discard-fm14", 0), ("opus-4-7", 0)):
            self.run_cli("route-pending-rt.py", *args, "--cascade", mode)
            queues = [(self.root / name).read_text() for name in ("ETAN_QUEUE.md", "cascade-queue.md")]
            snapshots.append((count, queues, hashlib.sha256(gold.read_bytes()).hexdigest()))
        self.assertTrue(any(p.read_text() == "Your verdict: 3\n"
                            for p in self.root.glob("ETAN_QUEUE.md.prev-*")))
        self.assertNotIn("Row 1:", snapshots[-1][1][0])
        self.assertNotIn("single outlier", snapshots[-1][1][1])
        generations = []
        for count, queues, digest in snapshots:
            shared = []
            for text in queues:
                self.assertIn(f"Rows: {count}", text)
                self.assertIn(f"Gold SHA-256: {digest}", text)
                shared.append(next(line for line in text.splitlines() if line.startswith("Generation:")))
                if count == 0:
                    self.assertIn("No rows pending.", text)
                    self.assertNotIn("chunk_id=b", text)
            self.assertEqual(shared[0], shared[1])
            generations.append(shared[0])
        self.assertEqual(len(set(generations)), 3)
        before = {p: p.read_bytes() for p in self.root.iterdir() if p.is_file()}
        self.run_cli("route-pending-rt.py", *args, "--dry-run")
        self.assertEqual(before, {p: p.read_bytes() for p in before})
        self.write(gold, pending)
        (self.root / "ETAN_QUEUE.md").write_text(snapshots[0][1][0].replace("**Your verdict**: __", "**Your verdict**: 3"))
        before = {p: p.read_bytes() for p in self.root.iterdir() if p.is_file()}
        text = self.run_cli("route-pending-rt.py", *args, "--cascade", "discard-fm14", expected_code=1)
        self.assertIn("human verdict", text)
        self.assertEqual(before, {p: p.read_bytes() for p in before})
