import copy
import json
import re
from pathlib import Path, PurePosixPath

import pytest

ROOT = Path(__file__).resolve().parents[2]
PLUGIN = ROOT / 'plugins/golems-canary'
CLAUDE_MARKET = ROOT / '.claude-plugin/marketplace.json'
CODEX_MARKET = ROOT / '.agents/plugins/marketplace.json'

# Strict subsets of the provider schemas: this canary deliberately permits no
# extra components. References: code.claude.com/docs/en/plugin-marketplaces,
# code.claude.com/docs/en/plugins-reference, developers.openai.com/plugins/build/plugins.
NONEMPTY = lambda value: type(value) is str and bool(value.strip())
RELATIVE = lambda value: (NONEMPTY(value) and value.startswith('./')
                          and '..' not in PurePosixPath(value).parts
                          and len(PurePosixPath(value).parts) > 0)
SCHEMAS = {
    'claude_market': {'name': NONEMPTY, 'owner': {'name': NONEMPTY},
                      'plugins': [{'name': NONEMPTY, 'source': RELATIVE}]},
    'claude_plugin': {'name': NONEMPTY, 'description': NONEMPTY,
                      'author': {'name': NONEMPTY}},
    'codex_market': {'name': NONEMPTY, 'plugins': [{
        'name': NONEMPTY, 'source': {'source': lambda v: v == 'local', 'path': RELATIVE},
        'policy': {'installation': lambda v: v == 'AVAILABLE',
                   'authentication': lambda v: v == 'ON_INSTALL'}, 'category': NONEMPTY}]},
    'codex_plugin': {'name': NONEMPTY, 'description': NONEMPTY, 'skills': RELATIVE},
}


def validate_node(schema, value):
    if isinstance(schema, dict):
        assert type(value) is dict and set(value) == set(schema)
        for key, child in schema.items():
            validate_node(child, value[key])
    elif isinstance(schema, list):
        assert type(value) is list and len(value) == 1
        validate_node(schema[0], value[0])
    else:
        assert schema(value)


def validate(name, value):
    validate_node(SCHEMAS[name], value)


def manifests():
    paths = {'claude_market': CLAUDE_MARKET, 'codex_market': CODEX_MARKET,
             'claude_plugin': PLUGIN / '.claude-plugin/plugin.json',
             'codex_plugin': PLUGIN / '.codex-plugin/plugin.json'}
    return {name: json.loads(path.read_text()) for name, path in paths.items()}


def test_manifests_validate_and_reference_single_plugin():
    data = manifests()
    for name, value in data.items():
        validate(name, value)
    assert data['claude_market']['name'] == data['codex_market']['name'] == 'golems'
    assert data['claude_market']['plugins'][0]['name'] == 'golems-canary'
    assert data['codex_market']['plugins'][0]['name'] == 'golems-canary'
    assert data['claude_plugin']['name'] == data['codex_plugin']['name'] == 'golems-canary'
    assert data['claude_market']['plugins'][0]['source'] == './plugins/golems-canary'
    assert data['codex_market']['plugins'][0]['source']['path'] == './plugins/golems-canary'
    assert data['codex_plugin']['skills'] == './skills/'


def test_single_skill_and_single_version_marker():
    skills = list(PLUGIN.rglob('SKILL.md'))
    assert skills == [PLUGIN / 'skills/golems-canary/SKILL.md']
    text = skills[0].read_text()
    frontmatter, body = text.removeprefix('---\n').split('\n---\n', 1)
    assert 'name: golems-canary' in frontmatter
    assert 'description:' in frontmatter
    assert re.fullmatch(r'Reply exactly: GOLEMS-CANARY v[0-9]+', body.strip())
    # The package includes both marketplace manifests and every plugin file.
    package_files = [CLAUDE_MARKET, CODEX_MARKET, *(p for p in PLUGIN.rglob('*') if p.is_file())]
    markers = re.findall(rb'GOLEMS-CANARY v[0-9]+', b'\n'.join(p.read_bytes() for p in package_files))
    assert len(markers) == 1


@pytest.mark.parametrize('target,mutation', [
    ('claude_plugin', lambda obj: obj['author'].__setitem__('name', 1)),
    ('claude_plugin', lambda obj: obj.__setitem__('hooks', './hooks.json')),
    ('claude_plugin', lambda obj: obj.pop('name')),
    ('claude_market', lambda obj: obj['plugins'][0].__setitem__('source', '../escape')),
    ('claude_market', lambda obj: obj['plugins'][0].__setitem__('sourc', './plugins/golems-canary')),
    ('codex_plugin', lambda obj: obj.__setitem__('skills', 1)),
    ('codex_plugin', lambda obj: obj.__setitem__('commands', './commands')),
    ('codex_market', lambda obj: obj['plugins'][0]['source'].__setitem__('path', '../escape')),
    ('codex_market', lambda obj: obj['plugins'][0]['policy'].pop('installation')),
])
def test_schema_rejects_invalid_manifests(target, mutation):
    data = copy.deepcopy(manifests()[target])
    mutation(data)
    with pytest.raises(AssertionError):
        validate(target, data)
