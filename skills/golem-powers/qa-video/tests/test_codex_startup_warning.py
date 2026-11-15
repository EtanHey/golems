"""Offline replay: w167 event structure, synthetic image observation and paths."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from unittest.mock import patch

import pytest

SKILL = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('batch_warning', SKILL/'scripts/visual-batch.py')
batch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(batch)
FIXTURE = Path(__file__).parent/'fixtures/codex-startup-warning.jsonl'


def replay(tmp_path, mutate=lambda receipt: None, code=2):
    image = tmp_path/'frame.jpg'
    image.write_bytes(b'synthetic')
    events = [json.loads(line) for line in FIXTURE.read_text().splitlines()]
    body = json.loads(events[3]['item']['text'])
    body['images'][0]['path'] = str(image)
    events[3]['item']['text'] = json.dumps(body)
    receipt = dict(provider='codex', exit_code=0, images=[str(image)],
                   codex_home='/reader/codex-home', tool_calls=['error'], provider_events=events)
    mutate(receipt)
    directory = tmp_path/'helper-receipts'
    directory.mkdir()
    path = directory/'recorded.json'

    def helper(*args):
        path.write_text(json.dumps(receipt))
        return subprocess.CompletedProcess([], code,
            'Coverage: 0/1; partial; NOT DETERMINED: helper failed.\n',
            f'HELPER_RECEIPT {path}\nADAPTER_UNSUPPORTED: ValueError: ADAPTER_UNSUPPORTED or dispatch failed; inspect private helper receipt\n')
    with patch.object(batch.visual, 'bounded_run', side_effect=helper):
        return batch.validate(batch.read_sheet(Path('helper'), 'facts', 10, str(image), workdir=tmp_path), 1)


def test_recorded_warning_keeps_valid_read(tmp_path):
    item = replay(tmp_path)
    assert item['state'] == 'READ', item
    assert 'synthetic blue square' in item['finding']
    assert len(item['warnings']) == 1
    assert 'skip_host_skill_discovery' in item['warnings'][0]
    assert Path(item['helper_receipt']).is_file()


@pytest.mark.parametrize('case', ['other_error', 'extra_feature', 'failed_turn', 'tool',
    'summary_mismatch', 'provider_exit', 'body', 'missing_turn', 'wrong_image', 'late_warning'])
def test_adverse_receipt_still_fails(tmp_path, case):
    def mutate(r):
        e = r['provider_events']
        if case == 'other_error': e[1]['item']['message'] = 'some other failure'
        if case == 'extra_feature': e[1]['item']['message'] = e[1]['item']['message'].replace('skip_host_skill_discovery.', 'skip_host_skill_discovery other_feature.')
        if case == 'failed_turn': e.append({'type': 'turn.failed'})
        if case == 'tool': e.insert(3, {'type':'item.completed', 'item':{'type':'command_execution'}})
        if case == 'summary_mismatch': r['tool_calls'] = []
        if case == 'provider_exit': r['exit_code'] = 1
        if case == 'body': e[3]['item']['text'] = '{}'
        if case == 'missing_turn': e.pop()
        if case == 'wrong_image': r['images'] = ['/other.jpg']
        if case == 'late_warning': e[1], e[2] = e[2], e[1]
    assert replay(tmp_path, mutate)['state'] == 'FAILED'


def test_crop_rule_has_exact_parameters():
    text = (SKILL/'workflows/gems.md').read_text()
    assert 'a cue whose answer is small on screen gets a cropped read of the bracketed frames' in text
    assert 'crop.sh "$FRAME" "$X" "$Y" "$W" "$H" "$CROP"' in text
    assert 'never use oracle coordinates' in text


def test_batch_cli_replays_helper_receipt(tmp_path):
    """Exercise the real subprocess/CLI/summary path, without a provider call."""
    image = tmp_path/'frame.jpg'
    image.write_bytes(b'synthetic input; never sent to a model')
    index = tmp_path/'index.tsv'
    index.write_text('frame.jpg\t0\t1\t1\tsynthetic\n')
    helper = tmp_path/'helper.py'
    helper.write_text('''import json, sys
from pathlib import Path
image = sys.argv[-1]
events = [json.loads(line) for line in Path(''' + repr(str(FIXTURE)) + ''').read_text().splitlines()]
body = json.loads(events[3]['item']['text'])
body['images'][0]['path'] = image
events[3]['item']['text'] = json.dumps(body)
r = dict(provider='codex', exit_code=0, codex_home='/reader/codex-home', images=[image], tool_calls=['error'], provider_events=events)
p = Path(image).parent/'helper-receipts/replay.json'
p.parent.mkdir(exist_ok=True)
p.write_text(json.dumps(r))
print('HELPER_RECEIPT '+str(p), file=sys.stderr)
print('ADAPTER_UNSUPPORTED: ValueError: ADAPTER_UNSUPPORTED or dispatch failed; inspect private helper receipt', file=sys.stderr)
print('Coverage: 0/1; partial; NOT DETERMINED: helper failed.')
sys.exit(2)
''')
    result = subprocess.run([sys.executable, str(SKILL/'scripts/visual-batch.py'),
        '--helper', str(helper), '--index', str(index), '--question', 'facts',
        '--workdir', str(tmp_path), '--budget-seconds', '5'], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    summary = json.loads((tmp_path/'visual/summary.json').read_text())
    assert summary['status'] == 'COMPLETE' and summary['covered'] == '1/1'
    assert len(summary['sheets'][0]['warnings']) == 1
    assert json.loads((tmp_path/'visual/findings.jsonl').read_text())['helper_receipt']
