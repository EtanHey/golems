"""Static reader/brief contract; this does not prove live agent compliance."""
from pathlib import Path
import unittest

SKILL = Path(__file__).resolve().parents[1]


class SerialImageReadContract(unittest.TestCase):
    def test_skill_and_dispatched_briefs_preserve_read_failures(self):
        for relative in ('SKILL.md', 'workflows/process.md'):
            with self.subTest(document=relative):
                text = (SKILL / relative).read_text()
                for rule in (
                    'Helpers and verifiers', 'one image per tool call, sequentially',
                    'never parallel or batched image reads in one turn',
                    '[media removed', 'request-limit', 'NOT inspected',
                    'Do not log it to the inspected ledger', 'retry it serially',
                    'If the retry still fails', 'INCONCLUSIVE with a tooling note',
                    'never record a verdict from the failed read',
                ):
                    self.assertTrue(rule in text, f'{relative}: missing {rule!r}')
        self.assertTrue('Include this rule in every helper and verifier brief' in
                        (SKILL / 'workflows/process.md').read_text(),
                        'processing workflow must pass the rule to readers')
