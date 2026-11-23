"""Read-only proof parser regressions; no host cleanup."""
import importlib.util
import json
from pathlib import Path
import unittest

LIB = Path(__file__).resolve().parents[1] / 'lib'
spec = importlib.util.spec_from_file_location('prs', LIB / 'worktree-gc-prs.py')
prs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prs)


class PrProofs(unittest.TestCase):
    def test_categories(self):
        for text, category in [('HTTP 429 secondary rate limit', 'rate-limit'),
                               ('HTTP 403 API rate limit exceeded', 'rate-limit'),
                               ('HTTP 401 bad credentials', 'authentication'),
                               ('HTTP 404 not found', 'not-found'),
                               ('TLS connection timeout', 'network'),
                               ('unrecognized failure', 'gh-failed')]:
            self.assertEqual(prs.category(text), category)

    def test_bad_and_truncated_snapshots_fail(self):
        for rows in [{}, [dict(headRefName='x')],
                     [dict(headRefName='x', number=1)] * 500,
                     [dict(headRefName='x\ny', number=1)]]:
            with self.assertRaises((ValueError, KeyError)):
                prs.snapshot(json.dumps(rows), 'open')
        with self.assertRaises(ValueError):
            prs.snapshot('[{"headRefName":"x","headRefOid":"short"}]', 'merged')

    def test_head_proof_keeps_branch_and_sha_together(self):
        self.assertEqual(prs.snapshot(json.dumps([dict(headRefName='topic', headRefOid='a'*40)]),
                                      'merged'), 'topic\t' + 'a'*40)


class PlanInventory(unittest.TestCase):
    def test_unknown_inventory_cannot_offer_remove(self):
        import csv
        import tempfile
        from unittest.mock import patch
        spec = importlib.util.spec_from_file_location('plan', LIB / 'worktree-gc-plan.py')
        plan = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(plan)
        scratch = LIB.parents[1] / 'docs.local'
        scratch.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=scratch) as directory:
            output = Path(directory) / 'plan.tsv'
            output.write_text(plan.HEADER)
            with patch.object(plan.subprocess, 'run', side_effect=OSError('unavailable')):
                plan.append(output, 'repo', '/missing', 'topic', 'REMOVE', 'eligible')
            with output.open() as source:
                row, = list(csv.DictReader(source, delimiter='\t'))
            self.assertEqual(row['verdict'], 'KEEP-undetermined')
            self.assertEqual(row['size_bytes'], 'UNKNOWN')
            self.assertEqual(json.loads(row['notes_to_archive_json']), None)
            self.assertEqual(row['inventory_status'], 'size-unknown,notes-unknown')


if __name__ == '__main__':
    unittest.main()
