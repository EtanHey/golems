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

def test_visual_flow_preserves_cross_vendor_review():
    text = (SKILLS / 'agent-routing/SKILL.md').read_text()
    flow = next(line for line in text.splitlines() if line.startswith('- UI flow (Etan FRONTEND RULE, 2026-10-28)'))
    assert 'explicitly overrides the other-vendor reviewer requirement' not in text
    assert "A Claude-implemented visual slice gets the red-team Claude (taste, BOTH skills) plus the table's Codex reviewer (cross-vendor, canon #1); Codex plumbing gets the red-team Claude, which is already the other vendor. Both reviews cite the Visual proof." in flow
    for required in ['never the implementer', 'frontend-design:frontend-design', 'emil-design-eng']:
        assert required in text
    assert 'Ratified sequence:' not in text
    assert 'Sequence (lead guidance):' in text

def test_no_live_cursor_routes_across_fleet_tree():
    """Scan live instruction/runtime surfaces; CURSOR_GUARD_REF replays a Git tree."""
    import os
    import re
    import subprocess
    root = SKILLS.parents[1]
    ref = os.environ.get('CURSOR_GUARD_REF')
    files = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', ref] if ref else
                                    ['git', 'ls-files'], cwd=root, text=True).splitlines()
    historical = {
        'skills/golem-powers/agent-routing/references/fan-out-head-to-head.md',
        'skills/golem-powers/whats-new/references/changelog-sources.md',
    }
    patterns = [r'["\']?providerInstanceId["\']?:\s*["\']?cursor\b', r'bugbot run', r'@cursor @bugbot',
                r'\bcursor(?:-|\s+)agent(?:[`"\'])?\s+--?', r'cursor_bin.*\bagent\b',
                r'gather\s*=\s*Cursor', r'Cursor gathers', r'cursor:.*delegate_task', r'T3 Cursor child', r'read-only Cursor audit', r'\brun\s+Cursor\s+(?:with|to)\b',
                r'audits → Cursor', r'Cursor miners use', r'--(?:primary-)?judges[ \t]+[a-z,]*cursor']
    errors = []
    for name in files:
        if name in historical or any(part in name.split('/') for part in
                ('evals', 'fixtures', '__tests__', 'tests', 'vendor')):
            continue
        if not (name == 'README.md' or name.startswith(('skills/', 'standards/', 'scripts/repogolem/'))):
            continue
        if not name.endswith(('.md', '.yaml', '.yml', '.sh', '.zsh')):
            continue
        text = subprocess.check_output(['git', 'show', f'{ref}:{name}'], cwd=root, text=True) if ref else (root / name).read_text()
        for line, content in enumerate(text.splitlines(), 1):
            for pattern in patterns:
                if re.search(pattern, content, re.I):
                    errors.append(f'{name}:{line}: {pattern}')
    assert not errors, '\n'.join(errors)
