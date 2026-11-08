"""Mechanical miner-brief contract, not a live agent obedience evaluation."""
import importlib.util
import json
from pathlib import Path
import unittest

WEAVE = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("brief", WEAVE / "scripts/validate-dispatch-brief.py")
brief = importlib.util.module_from_spec(spec)
spec.loader.exec_module(brief)


class LoopMinerBrief(unittest.TestCase):
    def render(self, row):
        return ('## Scope\nMine findings JSONL.\n## Sources\nquestion_bank: bank.md\n'
                '## Mechanics\nanswers: answers.json\n```json\n' + json.dumps(row) + '\n```\n')

    def test_new_fields_are_required_only_for_miner_briefs(self):
        old = dict(id="synthetic#1", evidence="quote", disposition="KEEP")
        self.assertTrue(brief.validate_brief(self.render(old)))
        current = dict(old, followups=[], verified=False, new_questions=[])
        rendered = self.render(current)
        self.assertEqual(brief.validate_brief(rendered), [])
        for key in ("followups", "verified", "new_questions"):
            self.assertTrue(brief.validate_brief(self.render(
                {k: v for k, v in current.items() if k != key})))
        for marker in ("question_bank:", "answers:"):
            self.assertTrue(brief.validate_brief(rendered.replace(marker, "missing:")))
        self.assertEqual(brief.validate_brief('## Scope\n## Sources\n## Mechanics\nS4'), [])

    def test_skill_description_budget_and_pending_boundaries(self):
        skill = (WEAVE / "SKILL.md").read_text()
        self.assertLessEqual(len(skill.split('description: "', 1)[1].split('"', 1)[0]), 1024)
        lifecycle = (WEAVE / "references/run-lifecycle.md").read_text()
        sections = [lifecycle.split(f"### 2{letter}.", 1)[1].split("### ", 1)[0]
                    for letter in "abcd"]
        self.assertNotIn("harness implementation pending", sections[0] + sections[1])
        for section in sections[2:]:
            self.assertIn("harness implementation pending", section)


if __name__ == "__main__":
    unittest.main()
