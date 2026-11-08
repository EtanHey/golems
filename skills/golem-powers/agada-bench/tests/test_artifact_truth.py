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
        temp = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.corpus = self.root / "corpus.jsonl"
        self.rubric = self.root / "rubric.md"
        self.rubric.write_text("rubric")
        self.rows = [{"query_id": 1, "chunk_id": "a"}, {"query_id": 1, "chunk_id": "b"}]
        self.write(self.corpus, self.rows)

    def write(self, path, rows):
        path.write_text("".join(json.dumps(row) + "\n" for row in rows))

    def run_cli(self, script, *args):
        result = subprocess.run([sys.executable, str(SCRIPTS / script), *map(str, args)],
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_resume_requires_exact_unique_identities(self):
        output = self.root / "claude.jsonl"
        for rows in ([self.rows[0]] * 3, self.rows[:1], [{}] * 3,
                     [self.rows[0], {"query_id": 9, "chunk_id": "foreign"}], self.rows):
            with self.subTest(rows=rows):
                self.write(output, rows)
                text = self.run_cli("dispatch-judges.py", "--corpus", self.corpus,
                                    "--rubric", self.rubric, "--judges", "claude",
                                    "--output-dir", self.root, "--resume", "--dry-run")
                self.assertIn(f"skipped={int(rows == self.rows)}", text)
                self.assertIn("prepared", text)
                self.assertIn("launched=0", text)
                self.assertEqual(len(output.read_text().splitlines()), len(rows))
                self.run_cli("dispatch-judges.py", "--corpus", self.corpus,
                             "--rubric", self.rubric, "--judges", "claude",
                             "--output-dir", self.root, "--resume")
                self.assertEqual(output.exists(), rows == self.rows)
                if rows != self.rows:
                    self.assertTrue(any(p.read_text().splitlines() == [json.dumps(r) for r in rows]
                                        for p in self.root.glob("claude.jsonl.dead-*")))

    def test_rerun_refreshes_both_queues_and_final_gold_digest(self):
        gold = self.root / "gold.jsonl"
        consensus = self.root / "consensus.jsonl"
        pending = [{**r, "method": "pending-rt"} for r in self.rows]
        self.write(gold, pending)
        self.write(consensus, [{**self.rows[0], "labels_by_judge": {"a": 0, "b": 3, "c": 3},
                                "failure_modes_union": ["FM6"], "avg_confidence": 90}])
        snapshots = []
        for mode, count in (("opus-4-7", 1), ("discard-fm14", 0), ("opus-4-7", 0)):
            self.run_cli("route-pending-rt.py", "--gold", gold, "--consensus", consensus,
                         "--out", self.root / "report.md", "--cascade", mode)
            queues = [(self.root / name).read_text() for name in ("ETAN_QUEUE.md", "cascade-queue.md")]
            snapshots.append((count, queues, hashlib.sha256(gold.read_bytes()).hexdigest()))
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
        self.run_cli("route-pending-rt.py", "--gold", gold, "--consensus", consensus,
                     "--out", self.root / "report.md", "--dry-run")
        self.assertEqual(before, {p: p.read_bytes() for p in before})
