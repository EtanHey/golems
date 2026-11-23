"""Review regressions; fake local providers only, never API credentials."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

SCRIPTS = Path(__file__).parents[1] / 'scripts'
SPEC = importlib.util.spec_from_file_location('claude_review', SCRIPTS / 'claude-image-helper.py')
helper = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(helper)
MODEL = 'claude-haiku-5-5'
CANARY = 'synthetic-review-canary-0123456789'


def stream(image, result=None):
    return [
        {'type': 'system', 'subtype': 'init', 'model': MODEL, 'tools': [],
         'mcp_servers': [], 'skills': [], 'slash_commands': []},
        {'type': 'result', 'is_error': False,
         'result': result if result is not None else json.dumps({'images': [
             {'path': str(image), 'finding': 'tile 0: blue square'}]})},
    ]


def invoke(tmp_path, monkeypatch, capsys, mutate=lambda e: e, timeout='90'):
    image = tmp_path / 'image.png'
    image.write_bytes(b'png')
    helper.visual.policy.begin(tmp_path)
    monkeypatch.setenv('QA_VIDEO_ADMISSION', str(helper.visual.policy.admit(tmp_path, [image])))
    events = mutate(stream(image))
    seen = []

    def provider(cmd, **kw):
        seen.append(kw)
        return subprocess.CompletedProcess(cmd, 0, '\n'.join(json.dumps(e) for e in events), '')

    monkeypatch.setattr(helper, 'run_provider', provider, raising=False)
    monkeypatch.setattr(helper.subprocess, 'run', provider)
    monkeypatch.setattr(helper.sys, 'argv', [
        'helper', '--question', 'facts', '--timeout', timeout, '--model', MODEL, str(image)])
    code = helper.main()
    output = capsys.readouterr()
    receipt = json.loads(next((tmp_path / 'helper-receipts').glob('*.json')).read_text())
    return code, output, receipt, seen


@pytest.mark.parametrize('mutation,failure', [
    (lambda e: [1, *e], 'MALFORMED_EVENT'),
    (lambda e: [{'type': 'assistant', 'message': 'x'}, *e], 'MALFORMED_EVENT'),
    (lambda e: [e[0], {**e[1], 'result': None}], 'MALFORMED_RESULT'),
    (lambda e: [e[0]], 'RESULT_COUNT'),
    (lambda e: [e[0], {**e[1], 'is_error': True}, e[1]], 'RESULT_COUNT'),
    (lambda e: [{**e[0], 'model': 'wrong-model'}, e[1]], 'MODEL_MISMATCH'),
    (lambda e: [{**e[0], 'skills': ['unexpected']}, e[1]], 'INIT_INVENTORY'),
    (lambda e: [{**e[0], 'slash_commands': ['unexpected']}, e[1]], 'INIT_INVENTORY'),
    (lambda e: [e[0], {**e[1], 'result': 'x' * 2001}], 'RESULT_TOO_LARGE'),
    (lambda e: [e[0], {**e[1], 'result': json.dumps({'images': [1]})}], 'MALFORMED_ROW'),
    (lambda e: [e[0], {**e[1], 'result': json.dumps({'images': []})}], 'MISSING_IMAGE'),
    (lambda e: [e[0], {**e[1], 'result': json.dumps({'images': [
        {'path': '/foreign.png', 'finding': 'blue'}]})}], 'EXTRA_IMAGE'),
])
def test_bad_provider_shapes_leave_named_receipt(tmp_path, monkeypatch, capsys, mutation, failure):
    code, output, receipt, _ = invoke(tmp_path, monkeypatch, capsys, mutation)
    assert code == 2
    assert receipt['failure'] == failure
    assert 'Traceback' not in output.err
    assert 'Coverage: 0/1; partial;' in output.out


def test_duplicate_image_is_named(tmp_path, monkeypatch, capsys):
    def duplicate(events):
        body = json.loads(events[1]['result'])
        body['images'].append(body['images'][0])
        events[1]['result'] = json.dumps(body)
        return events
    _, _, receipt, _ = invoke(tmp_path, monkeypatch, capsys, duplicate)
    assert receipt['failure'] == 'DUPLICATE_IMAGE'


def test_environment_is_exact_allowlist(tmp_path, monkeypatch, capsys):
    for key in ['ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN',
                'HTTP_PROXY', 'MCP_CONFIG', 'SHELL', 'QA_VISUAL_DEADLINE']:
        monkeypatch.setenv(key, 'ambient-do-not-forward')
    monkeypatch.delenv('QA_VISUAL_DEADLINE')
    monkeypatch.setenv('ANTHROPIC_API_KEY', CANARY)
    monkeypatch.setenv('ANTHROPIC_BASE_URL', 'http://127.0.0.1:9')
    code, _, _, seen = invoke(tmp_path, monkeypatch, capsys)
    assert code == 0
    env = seen[0]['env']
    assert set(env) - {'CLAUDE_CONFIG_DIR'} == {'PATH', 'HOME', 'TMPDIR', 'CLAUDE_CODE_TMPDIR',
                        'CLAUDE_CODE_DISABLE_AUTO_MEMORY', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
                        'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'}
    assert env['ANTHROPIC_API_KEY'] == CANARY
    assert env['HOME'] == str(Path.home())
    assert env.get('CLAUDE_CONFIG_DIR') == os.environ.get('CLAUDE_CONFIG_DIR')
    assert env['ANTHROPIC_AUTH_TOKEN'] == 'ambient-do-not-forward'
    assert env['CLAUDE_CODE_OAUTH_TOKEN'] == 'ambient-do-not-forward'
    for key in ['TMPDIR', 'CLAUDE_CODE_TMPDIR']:
        assert Path(env[key]).is_relative_to(tmp_path)


def test_provider_bound_below_batch_and_same_max(tmp_path, monkeypatch, capsys):
    _, _, receipt, seen = invoke(tmp_path, monkeypatch, capsys, timeout='300')
    assert helper.MAX_TIMEOUT == helper.visual.MAX_TIMEOUT
    assert 0 < seen[0]['timeout'] < 300
    assert receipt['provider_timeout_seconds'] < 300


@pytest.mark.parametrize('escaped', [False, True])
@pytest.mark.parametrize('credential', ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'])
def test_key_never_in_output_or_receipt(tmp_path, monkeypatch, capsys, escaped, credential):
    monkeypatch.setenv(credential, CANARY)
    def leak(events):
        text = CANARY if not escaped else ''.join('\\u%04x' % ord(c) for c in CANARY)
        events[1]['result'] = '{"images":[{"path":' + json.dumps(str(tmp_path / 'image.png')) + ',"finding":"' + text + '"}]}'
        return events
    code, output, receipt, _ = invoke(tmp_path, monkeypatch, capsys, leak)
    assert code == 2
    assert receipt['failure'] == 'SECRET_IN_PROVIDER_OUTPUT'
    assert CANARY not in output.out + output.err
    assert all(CANARY.encode() not in p.read_bytes()
               for p in tmp_path.rglob('*') if p.is_file())


def test_image_cap_leaves_receipt_before_provider(tmp_path, monkeypatch, capsys):
    image = tmp_path / 'big.png'
    with image.open('wb') as f:
        f.truncate(6 * 1024 * 1024)
    helper.visual.policy.begin(tmp_path)
    monkeypatch.setenv('QA_VIDEO_ADMISSION', str(helper.visual.policy.admit(tmp_path, [image])))
    monkeypatch.setattr(helper.sys, 'argv', ['helper', '--question', 'facts', '--model', MODEL, str(image)])
    monkeypatch.setattr(helper, 'run_provider', lambda *a, **k: pytest.fail('oversized image dispatched'), raising=False)
    monkeypatch.setattr(helper.subprocess, 'run', lambda *a, **k: pytest.fail('oversized image dispatched'))
    assert helper.main() == 2
    receipt = json.loads(next((tmp_path / 'helper-receipts').glob('*.json')).read_text())
    assert receipt['failure'] == 'IMAGE_TOO_LARGE'


def test_real_local_provider_timeout_keeps_receipt(tmp_path, monkeypatch):
    """Same bounded_run → helper path as the batch; fake CLI has no network."""
    image = tmp_path / 'timeout.png'
    image.write_bytes(b'png')
    bindir = tmp_path / 'bin'
    bindir.mkdir()
    cli = bindir / 'claude'
    cli.write_text('#!' + sys.executable + '\nimport os,time\nfrom pathlib import Path\n'
                   'Path(__file__).with_suffix(".pid").write_text(str(os.getpid()))\ntime.sleep(30)\n')
    cli.chmod(0o700)
    monkeypatch.setenv('PATH', str(bindir) + os.pathsep + os.environ.get('PATH', ''))
    monkeypatch.delenv('ANTHROPIC_API_KEY', raising=False)
    monkeypatch.delenv('ANTHROPIC_BASE_URL', raising=False)
    helper.visual.policy.begin(tmp_path)
    monkeypatch.setenv('QA_VIDEO_ADMISSION', str(helper.visual.policy.admit(tmp_path, [image])))
    result = helper.visual.bounded_run([
        sys.executable, str(SCRIPTS / 'claude-image-helper.py'), '--question', 'facts',
        '--model', MODEL, '--timeout', '4', str(image)], timeout=4)
    assert result.returncode == 2
    receipt = json.loads(next((tmp_path / 'helper-receipts').glob('*.json')).read_text())
    assert receipt['failure'] == 'PROVIDER_TIMEOUT'
    assert 0 < receipt['provider_timeout_seconds'] < 4
    provider_pid = int(cli.with_suffix('.pid').read_text())
    with pytest.raises(ProcessLookupError):
        os.kill(provider_pid, 0)
