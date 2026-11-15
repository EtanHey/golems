"""Offline replay: a recorded run with synthetic image observation and paths."""
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
    image = tmp_path/'work/out/frame.jpg'
    image.parent.mkdir(parents=True)
    image.write_bytes(b'synthetic')
    events = [json.loads(line) for line in FIXTURE.read_text().splitlines()]
    body = json.loads(events[3]['item']['text'])
    body['images'][0]['path'] = str(image)
    events[3]['item']['text'] = json.dumps(body)
    home = tmp_path/'tmp/reader-test/codex-home'
    home.mkdir(parents=True)
    events[1]['item']['message'] = events[1]['item']['message'].replace('/reader/codex-home', str(home))
    receipt = dict(provider='codex', exit_code=0, images=[str(image)],
                   codex_home=str(home), tool_calls=['error'], provider_events=events)
    mutate(receipt)
    directory = image.parent/'helper-receipts'
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
    assert '`CROP` is a fresh `.png` path in the run directory' in text


def test_batch_cli_replays_helper_receipt(tmp_path):
    """Exercise the real subprocess/CLI/summary path, without a provider call."""
    image = tmp_path/'work/out/frame.jpg'
    image.parent.mkdir(parents=True)
    image.write_bytes(b'synthetic input; never sent to a model')
    index = image.parent/'index.tsv'
    index.write_text('frame.jpg\t0\t1\t1\tsynthetic\n')
    helper = tmp_path/'helper.py'
    helper.write_text('''import json, sys
from pathlib import Path
image = sys.argv[-1]
events = [json.loads(line) for line in Path(''' + repr(str(FIXTURE)) + ''').read_text().splitlines()]
body = json.loads(events[3]['item']['text'])
body['images'][0]['path'] = image
events[3]['item']['text'] = json.dumps(body)
home = Path(image).parents[2]/'tmp/reader-test/codex-home'
home.mkdir(parents=True)
events[1]['item']['message'] = events[1]['item']['message'].replace('/reader/codex-home', str(home))
r = dict(provider='codex', exit_code=0, codex_home=str(home), images=[image], tool_calls=['error'], provider_events=events)
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


def test_debrief_review_route_reaches_small_text_crop_rule():
    skill = (SKILL/'SKILL.md').read_text()
    route = next(line for line in skill.splitlines() if line.startswith('| "debrief", "review this video" |'))
    assert '[workflows/process.md](workflows/process.md)' in route
    process = (SKILL/'workflows/process.md').read_text()
    assert '[Small-text crop rule](gems.md#small-text-crop-rule)' in process
    gems = (SKILL/'workflows/gems.md').read_text()
    assert '### Small-text crop rule' in gems
    rule = gems.split('### Small-text crop rule', 1)[1].split('## Visual-first exhaustive', 1)[0]
    assert 'a cue whose answer is small on screen gets a cropped read of the bracketed frames' in rule
    assert '`CROP` is a fresh `.png` path' in rule


@pytest.mark.parametrize('case', ['missing', 'outside_cell', 'protected_bin', 'symlink_escape'])
def test_self_consistent_foreign_codex_home_fails(tmp_path, case):
    def mutate(receipt):
        original = receipt['codex_home']
        home = tmp_path/'tmp/missing/codex-home'
        if case == 'outside_cell':
            home = tmp_path/'other-cell/tmp/reader-test/codex-home'
            home.mkdir(parents=True)
        if case == 'protected_bin':
            home = tmp_path/'bin/reader-test/codex-home'
            home.mkdir(parents=True)
        if case == 'symlink_escape':
            foreign = tmp_path/'foreign-codex-home'
            foreign.mkdir()
            home = tmp_path/'tmp/reader-test/linked-home'
            home.symlink_to(foreign, target_is_directory=True)
        receipt['codex_home'] = str(home)
        warning = receipt['provider_events'][1]['item']
        warning['message'] = warning['message'].replace(original, str(home))
    assert replay(tmp_path, mutate)['state'] == 'FAILED'


@pytest.mark.parametrize('parent_level', [0, 1])
def test_recorded_colocated_reader_home_keeps_read(tmp_path, parent_level):
    def mutate(receipt):
        original = receipt['codex_home']
        home = Path(receipt['images'][0]).parents[parent_level]/'reader-recorded/codex-home'
        home.mkdir(parents=True)
        receipt['codex_home'] = str(home)
        warning = receipt['provider_events'][1]['item']
        warning['message'] = warning['message'].replace(original, str(home))
    assert replay(tmp_path, mutate)['state'] == 'READ'


def test_visible_git_conflict_text_is_not_reader_conflict(tmp_path):
    def mutate(receipt):
        event = receipt['provider_events'][3]['item']
        body = json.loads(event['text'])
        body['images'][0]['finding'] = 'Tile 0: Terminal reports "CONFLICT (content): Merge conflict in example.txt".'
        event['text'] = json.dumps(body)
    assert replay(tmp_path, mutate)['state'] == 'READ'


def test_explicit_reader_conflict_still_fails(tmp_path):
    def mutate(receipt):
        event = receipt['provider_events'][3]['item']
        body = json.loads(event['text'])
        body['images'][0]['finding'] = 'CONFLICT: incompatible readings of Tile 0.'
        event['text'] = json.dumps(body)
    assert replay(tmp_path, mutate)['state'] == 'INVALID'


@pytest.mark.parametrize('finding, expected', [
    ('Reader A says red. CONFLICT: reader B says blue', 'INVALID'),
    ('CONFLICT - reader A red; reader B blue', 'INVALID'),
    ('Reader A says red.\nCONFLICT: reader B says blue.', 'INVALID'),
    ('Tile 0: Terminal reports "CONFLICT (content): Merge conflict in example.txt".', 'READ'),
    ('Tile 0: A sign reads "CONFLICT: choose a side".', 'READ'),
    ("Tile 0: A sign reads 'CONFLICT - choose a side'.", 'READ'),
    ('Tile 0: A sign reads “CONFLICT: choose a side”.', 'READ'),
    ("Reader's note. CONFLICT: reader B says blue.", 'INVALID'),
])
@pytest.mark.parametrize('route', ['normal', 'recovered_warning'])
def test_reader_markers_outside_quotes(tmp_path, finding, expected, route):
    if route == 'normal':
        item = batch.validate(dict(sheet='/synthetic.jpg', finding=finding,
                                   ok=True, fatal='', cause=''), 1)
    else:
        def mutate(receipt):
            event = receipt['provider_events'][3]['item']
            body = json.loads(event['text'])
            body['images'][0]['finding'] = finding
            event['text'] = json.dumps(body)
        item = replay(tmp_path, mutate)
    assert item['state'] == expected, item
