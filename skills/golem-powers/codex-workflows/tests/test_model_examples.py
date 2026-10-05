from pathlib import Path
import json
import unittest
class ModelExamplesTest(unittest.TestCase):
    def test_examples_do_not_override_the_role_default(self):
        skill = Path(__file__).resolve().parents[1]
        for path in (skill/'workflows').glob('*.md'):
            text = path.read_text()
            self.assertNotRegex(text, r'gpt-(?:5\.6-[\w.-]+|6-sol|6-luna)')
        fixture = json.loads((skill/'evals/fixtures/parallel-toy.json').read_text())
        self.assertNotIn('model', fixture)
        script = (skill/'evals/run-live-fanout.sh').read_text()
        self.assertIn('scripts/model-roles.mjs', script)
        self.assertNotIn('gpt-5.6-luna', script)
