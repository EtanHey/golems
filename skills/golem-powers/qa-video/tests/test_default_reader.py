"""Offline routing evaluation: real batch/helper entry points, synthetic provider CLI."""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

SKILL = Path(__file__).resolve().parents[1]
ROOT = SKILL.parents[2]


@pytest.mark.parametrize('explicit_model', [None, 'claude-explicit-fixture'])
def test_default_batch_attaches_images_to_tool_free_claude(tmp_path, explicit_model):
    image = tmp_path / 'frame.png'
    image.write_bytes(b'synthetic image bytes')
    (tmp_path / 'index.tsv').write_text('frame.png\t0.000\t10\t1\tfixture\n')
    bindir = tmp_path / 'bin'
    bindir.mkdir()
    cli = bindir / 'claude'
    cli.write_text('#!' + sys.executable + '''
import json, sys
from pathlib import Path
args = sys.argv
assert args[args.index('--tools') + 1] == ''
data = json.loads(sys.stdin.readline())
assert data['message']['content'][0]['type'] == 'image'
model = args[args.index('--model') + 1]
image = str(Path(__file__).parents[1] / 'frame.png')
print(json.dumps({'type': 'system', 'subtype': 'init', 'model': model,
                  'tools': [], 'mcp_servers': [], 'skills': [], 'slash_commands': []}))
print(json.dumps({'type': 'result', 'is_error': False, 'result': json.dumps({
    'images': [{'path': image, 'finding': 'tile 0: blue square'}]})}))
''')
    cli.chmod(0o700)
    # A default must never probe or dispatch Gemini.
    agy = bindir / 'agy'
    agy.write_text('#!/bin/sh\nexit 99\n')
    agy.chmod(0o700)
    env = {k: v for k, v in os.environ.items() if k not in
           {'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'GOLEMS_ROOT'}}
    env['PATH'] = str(bindir) + os.pathsep + env.get('PATH', '')
    result = subprocess.run([sys.executable, str(SKILL / 'scripts/visual-batch.py'),
        '--question', 'visible facts', '--workdir', str(tmp_path / 'work'),
        *(['--model', explicit_model] if explicit_model else []), str(image)],
        env=env, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
    summary = json.loads((tmp_path / 'work/visual/summary.json').read_text())
    assert summary['counts'] == {'READ': 1, 'INVALID': 0, 'FAILED': 0, 'NOT_READ': 0}
    receipt = json.loads(next((tmp_path / 'helper-receipts').glob('*.json')).read_text())
    expected = explicit_model or json.loads((ROOT / 'standards/model-roles.json').read_text())[
        'roles']['claude.subagent.cheap']['model']
    assert receipt['init']['model'] == expected
    assert receipt['init']['tools'] == [] and receipt['init']['mcp_servers'] == []


def test_plan_names_claude_default_and_explicit_gemini_only(tmp_path):
    result = subprocess.run(['bash', str(SKILL / 'scripts/default.sh'), 'plan',
        '/unused.mov', str(tmp_path), 'debrief'], capture_output=True, text=True, check=True)
    assert 'tool-free Claude reader' in result.stdout
    assert 'claude-image-helper.py' in result.stdout
    assert 'providerInstanceId: "antigravity"' not in result.stdout
    assert 'Gemini only when explicitly named:' in result.stdout
    assert 'Explicit gatherer model/exclusion' in result.stdout


@pytest.mark.parametrize('mode', ['qa', 'debrief', 'review'])
def test_plan_explains_authorization_attestation_and_reset(tmp_path, mode):
    result = subprocess.run(['bash', str(SKILL / 'scripts/default.sh'), 'plan',
        '/unused.mov', str(tmp_path), mode], capture_output=True, text=True, check=True)
    assert 'unless a lead-authorized ceiling is recorded' in result.stdout
    assert 'attestation the script cannot verify' in result.stdout
    assert "brief quotes the lead's explicit dollar amount" in result.stdout
    assert '--authorized-by naming that lead' in result.stdout
    assert 'Re-plan clears authorization' in result.stdout
    assert 'AFTER default.sh plan' in result.stdout
