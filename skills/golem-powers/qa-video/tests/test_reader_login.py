"""Regression proof through real entry points; synthetic frames and CLI only."""
import json
import os
from pathlib import Path
import subprocess
import sys

S = Path(__file__).parents[1] / 'scripts'


def fixture(tmp_path):
    home = tmp_path / 'login-home'
    home.mkdir()
    image = tmp_path / 'frame.png'
    # Valid synthetic 1x1 PNG, no recording or private content.
    import base64
    image.write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='))
    (tmp_path/'index.tsv').write_text('frame.png\t0.000\t1\t1\tfixture\n')
    bindir = tmp_path / 'bin'
    bindir.mkdir()
    cli = bindir / 'claude'
    cli.write_text('#!' + sys.executable + '''
import json, os, sys
from pathlib import Path
assert os.environ['HOME'] == str(Path(__file__).parents[1] / 'login-home')
assert 'ANTHROPIC_API_KEY' not in os.environ
assert '--bare' not in sys.argv
assert sys.argv[sys.argv.index('--tools') + 1] == ''
Path(os.environ['HOME']).joinpath('called').touch()
if Path(os.environ['HOME']).joinpath('fail').exists():
    sys.exit(1)
data = json.loads(sys.stdin.readline())['message']['content']
assert data[0]['type'] == 'image'
image = json.loads(data[-1]['text'].split('\\n', 1)[1])['paths'][0]
print(json.dumps(dict(type='system', subtype='init', model=sys.argv[sys.argv.index('--model')+1],
    tools=[], mcp_servers=[], skills=[], slash_commands=[])))
print(json.dumps(dict(type='result', is_error=False, result=json.dumps(dict(images=[
    dict(path=image, finding='tile 0: white pixel')])))))
''')
    cli.chmod(0o700)
    env = {k: v for k, v in os.environ.items() if k not in {
        'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
        'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR'}}
    env.update(PATH=str(bindir) + os.pathsep + env.get('PATH', ''), HOME=str(home), EXPECTED_HOME=str(home))
    subprocess.run([sys.executable, str(S/'reader-policy.py'), 'plan', str(tmp_path), str(image)], check=True, capture_output=True)
    env['QA_VIDEO_ADMISSION'] = str(tmp_path/'visual/cost-admission.json')
    return home, image, env


def batch(tmp_path, image, env, *extra):
    return subprocess.run([sys.executable, str(S/'visual-batch.py'), '--workdir', str(tmp_path/'work'),
        '--question', 'visible facts', *extra, str(image)], env=env, capture_output=True, text=True, timeout=20)


def test_no_key_uses_login_home_and_reads_synthetic_frame(tmp_path):
    home, image, env = fixture(tmp_path)
    result = batch(tmp_path, image, env)
    assert result.returncode == 0, result.stdout + result.stderr
    assert (home/'called').exists()
    summary = json.loads((tmp_path/'work/visual/summary.json').read_text())
    assert summary['counts']['READ'] == 1


def test_no_working_reader_stops_without_verdict(tmp_path):
    home, image, env = fixture(tmp_path)
    (home/'fail').touch()
    result = batch(tmp_path, image, env)
    assert result.returncode != 0
    assert 'no frames were read' in result.stderr
    summary = json.loads((tmp_path/'work/visual/summary.json').read_text())
    assert summary['status'] == 'DISPATCH_STOPPED'
    assert summary['sheets'][0]['attempts'] == 1
    assert summary['verdict_allowed'] is False
    result = subprocess.run(['bash', str(S/'default.sh'), 'finalize', str(tmp_path/'work'),
        str(tmp_path/'work/qa-report.md'), '--transcript', str(tmp_path/'unused.jsonl')],
        capture_output=True, text=True)
    assert result.returncode != 0
    assert 'no frames were read' in result.stderr
    assert not (tmp_path/'work/qa-report.md').exists()


def test_cost_stated_and_stops_before_provider_over_five_dollars(tmp_path):
    home, image, env = fixture(tmp_path)
    env.pop('QA_VIDEO_ADMISSION')
    result = batch(tmp_path, image, env, '--price-per-sheet-usd', '6')
    assert result.returncode != 0
    assert '1 sheets x $6.00 = $6.00' in result.stderr
    assert 'COST_HOLD' in result.stderr
    assert not (home/'called').exists()


def test_cost_for_whole_batch_counts_every_sheet(tmp_path):
    home, image, env = fixture(tmp_path)
    index = tmp_path/'many.tsv'
    for i in range(51):
        (tmp_path/f'sheet-{i}.png').write_bytes(image.read_bytes())
    index.write_text(''.join(f'sheet-{i}.png\t0\t1\t1\tfixture\n' for i in range(51)))
    env.pop('QA_VIDEO_ADMISSION')
    result = subprocess.run([sys.executable, str(S/'visual-batch.py'), '--workdir', str(tmp_path/'work'),
        '--question', 'facts', '--index', str(index)], env=env, capture_output=True, text=True, timeout=20)
    assert result.returncode == 2
    assert '51 sheets x $0.10 = $5.10' in result.stderr
    assert 'COST_HOLD' in result.stderr
    assert not (home/'called').exists()


def test_direct_helper_cost_hold_without_call(tmp_path):
    home, image, env = fixture(tmp_path)
    result = subprocess.run([sys.executable, str(S/'claude-image-helper.py'), '--model', 'fixture',
        '--question', 'facts', '--price-per-sheet-usd', '6', str(image)],
        env=env, capture_output=True, text=True, timeout=20)
    assert result.returncode == 2
    assert '1 sheets x $6.00 = $6.00' in result.stderr and 'COST_HOLD' in result.stderr
    assert not (home/'called').exists()


def test_missing_receipts_cannot_finalize(tmp_path):
    session = tmp_path/'session.jsonl'
    session.write_text('')
    result = subprocess.run([sys.executable, str(S/'reader-policy.py'), str(tmp_path), str(session)],
        capture_output=True, text=True)
    assert result.returncode != 0
    assert 'no frames were read' in result.stderr


def test_successful_helper_receipt_admits_current_image(tmp_path):
    home, image, env = fixture(tmp_path)
    assert batch(tmp_path, image, env).returncode == 0
    # Receipts are next to the input; finalization uses the run root.
    args = [sys.executable, str(S/'reader-policy.py'), str(tmp_path), str(tmp_path/'unused.jsonl')]
    assert subprocess.run(args, capture_output=True).returncode == 0
