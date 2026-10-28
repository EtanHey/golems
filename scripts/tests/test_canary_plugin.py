import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PLUGIN = ROOT / 'plugins/golems-canary'


def read_json(path):
    return json.loads(path.read_text())


def test_claude_marketplace_and_manifest():
    market = read_json(ROOT / '.claude-plugin/marketplace.json')
    assert market['name'] == 'golems'
    assert market['owner']['name']
    assert market['plugins'] == [{'name': 'golems-canary', 'source': './plugins/golems-canary'}]
    manifest = read_json(PLUGIN / '.claude-plugin/plugin.json')
    assert manifest['name'] == 'golems-canary'
    assert manifest['description'] and manifest['author']['name']


def test_codex_marketplace_and_manifest():
    market = read_json(ROOT / '.agents/plugins/marketplace.json')
    assert market['name'] == 'golems'
    assert market['plugins'] == [{'name': 'golems-canary', 'source': {'source': 'local', 'path': './plugins/golems-canary'}, 'policy': {'installation': 'AVAILABLE', 'authentication': 'ON_INSTALL'}, 'category': 'Productivity'}]
    manifest = read_json(PLUGIN / '.codex-plugin/plugin.json')
    assert manifest['name'] == 'golems-canary'
    assert manifest['description'] and manifest['skills'] == './skills/'


def test_single_skill_and_single_version_marker():
    skills = list((PLUGIN / 'skills').glob('*/SKILL.md'))
    assert skills == [PLUGIN / 'skills/golems-canary/SKILL.md']
    text = skills[0].read_text()
    frontmatter, body = text.removeprefix('---\n').split('\n---\n', 1)
    assert 'name: golems-canary' in frontmatter
    assert 'description:' in frontmatter
    match = re.fullmatch(r'Reply exactly: (GOLEMS-CANARY v[0-9]+)', body.strip())
    assert match
    marker = match.group(1)
    assert sum(p.read_text().count(marker) for p in PLUGIN.rglob('*') if p.is_file()) == 1
