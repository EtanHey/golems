from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
SKILLS = ROOT / 'skills/golem-powers'
QUOTE = 'the cloud reviewers get actual proof of changes when codexes are done so they can approve it on actual proof and not just hope that the code is correct ... spacing ... GIFs for each animation and stuff in PRs for verification.'

def test_proof_and_review_contract():
    skill = (SKILLS / 'pr-loop/SKILL.md').read_text()
    assert QUOTE in skill
    for name in ['Desktop before', 'Desktop after', '390 px before', '390 px after', 'GIF', 'E2E screenshot diffs']:
        assert name in (SKILLS / 'pr-loop/references/pr-creation.md').read_text()
    assert 'cites only code is INVALID' in (SKILLS / 'pr-loop/references/review-loop.md').read_text()
    assert 'Routing: see `/agent-routing` § Routing rules (SSOT)' in skill
    assert 'claude-opus-5-5' not in skill

def test_ratified_routing():
    text = (SKILLS / 'agent-routing/SKILL.md').read_text()
    for required in ['Split: Claude for visual slices', 'frontend-design:frontend-design', 'emil-design-eng', 'red-team Claude', '2026-10-28', 'fastMode:false']:
        assert required in text
    assert 'DRAFT, pending Etan ratification' not in text
