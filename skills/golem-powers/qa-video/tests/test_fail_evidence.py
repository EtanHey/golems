"""Synthetic CLI receipts; these do not measure live QA-seat compliance."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SKILL = Path(__file__).resolve().parents[1]
GATE = SKILL.parent / 'qa-verdict-gate/scripts/qa-verdict-gate-cli.mjs'


class FailEvidence(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.run = Path(self.temp.name).resolve() / 'qa-video/synthetic-run'
        (self.run / 'logs').mkdir(parents=True)
        self.report = '- [x] First inspected\n- [x] Second inspected\nF1 FAIL\n### S1-F6r: Second — **FAIL**\n'
        (self.run / 'qa-report.md').write_text(self.report)
        self.rows = [f'{pts}\t{self.run}/frames/{name}.png\t{reader}: observed\t{finding}\n'
                     for pts, name, reader, finding in
                     [('12.600', 'before', 'h2', 'F1'), ('12.800', 'after', 'v-S1-F6r', 'S1-F6r')]]
        self.ledger = self.run / 'logs/inspected.tsv'
        self.ledger.write_text(''.join(self.rows))
        (self.run / 'logs/inspected-quarantine-old.tsv').write_text(self.rows[1])

    def helper(self):
        return subprocess.run(['bash', str(SKILL / 'scripts/fail-evidence.sh'), str(self.run)],
                              capture_output=True, text=True)

    def gate(self, output):
        events = [{'role': 'user', 'text': 'QA the recording.'},
                  {'role': 'assistant', 'tools': [{'name': 'Write', 'input': {
                      'file_path': str(self.run / 'qa-report.md'), 'content': self.report}}]},
                  {'role': 'tool', 'text': output},
                  {'role': 'assistant', 'text': 'Verdict: FAIL — F1 FAIL; S1-F6r FAIL.'}]
        return subprocess.run(['node', str(GATE), '-'], input=json.dumps({'events': events}),
                              capture_output=True, text=True)

    def test_exact_rows_clear_gate_and_summaries_do_not(self):
        result = self.helper()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, ''.join(self.rows))
        self.assertEqual(self.gate(result.stdout).returncode, 0)
        self.assertEqual(self.gate('F1 FAIL verify=CONFIRMED\nS1-F6r FAIL verify=CONFIRMED').returncode, 3)

    def test_missing_row_names_id_and_quarantine_cannot_supply_it(self):
        self.ledger.write_text(self.rows[0])
        result = self.helper()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('S1-F6r', result.stderr)
        self.assertEqual(result.stdout, '')

    def test_writer_layout_and_invalid_row(self):
        (self.run / 'media').mkdir()
        self.ledger.rename(self.run / 'media/inspected.tsv')
        self.assertEqual(self.helper().stdout, ''.join(self.rows))
        (self.run / 'media/inspected.tsv').write_text(self.rows[0] + self.rows[1].replace('v-S1-F6r:', ''))
        self.assertNotEqual(self.helper().returncode, 0)

    def test_final_report_rules(self):
        for document in ('SKILL.md', 'workflows/process.md'):
            text = (SKILL / document).read_text()
            for rule in ('fail-evidence.sh', 'SAME turn', 'qa-report.md', 'every FAIL',
                         'unmodified TSV', 'tool output', 'INCONCLUSIVE', 'never fake a row'):
                self.assertIn(rule, text, document)
