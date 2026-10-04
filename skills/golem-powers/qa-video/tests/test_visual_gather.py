import importlib.util
import json
from pathlib import Path
from subprocess import CompletedProcess

import pytest

SKILL = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('visual', SKILL / 'scripts/visual-gather.py')
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)


def result(items, status='SUCCESS'):
    return CompletedProcess([], 0, json.dumps({'status': status, 'response': json.dumps({'images': items})}), '')


def test_success_is_capped_and_paths_are_explicit():
    calls = []
    def run(paths):
        calls.append(paths)
        return result([{'path': p, 'finding': 'ERROR: OFFLINE; 3 circles'} for p in paths])
    text = v.gather(['/a.png', '/b.png'], run)
    assert calls == [['/a.png', '/b.png']]
    assert 'Coverage: 2/2' in text and 'complete' in text
    assert '/a.png: ERROR: OFFLINE' in text
    assert len(text) <= 2500


def test_twenty_images_use_four_first_round_batches():
    paths = [f'/{i}.png' for i in range(20)]
    calls = []
    def run(batch):
        calls.append(batch)
        return result([{'path': p, 'finding': 'visible'} for p in batch])
    text = v.gather(paths, run)
    assert calls == [paths[0:6], paths[6:12], paths[12:18], paths[18:20]]
    assert 'Coverage: 20/20; complete' in text


def test_only_failed_batch_members_get_one_singleton_retry():
    paths = [f'/{i}.png' for i in range(20)]
    calls = []
    failed = paths[6:12]
    def run(batch):
        calls.append(batch)
        if batch == failed or batch == [failed[0]]:
            return CompletedProcess([], 1, '', 'timeout')
        return result([{'path': p, 'finding': 'visible'} for p in batch])
    text = v.gather(paths, run)
    assert calls == [paths[0:6], failed, paths[12:18], paths[18:20]] + [[p] for p in failed]
    assert 'Coverage: 19/20; partial' in text
    assert f'{failed[0]}: NOT DETERMINED' in text


@pytest.mark.parametrize('failure', [
    CompletedProcess([], 1, '', 'print timeout'),
    CompletedProcess([], 0, '<truncated', ''),
    CompletedProcess([], 0, '', 'stream was interrupted'),
    CompletedProcess([], 0, '{bad json', ''),
    result([], 'TIMEOUT'),
])
def test_failed_batch_gets_one_serial_singleton_retry(failure):
    calls = []
    def run(paths):
        calls.append(paths)
        if len(calls) == 1 or paths == ['/b.png']:
            return failure
        return result([{'path': '/a.png', 'finding': 'ALPHA'}])
    text = v.gather(['/a.png', '/b.png'], run)
    assert calls == [['/a.png', '/b.png'], ['/a.png'], ['/b.png']]
    assert 'Coverage: 1/2; partial' in text
    assert '/a.png: ALPHA' in text and '/b.png: NOT DETERMINED' in text


def test_missing_unknown_duplicate_and_uncertain_coverage():
    output = result([{'path': '/a.png', 'finding': 'ALPHA'},
                     {'path': '/x.png', 'finding': 'invented'},
                     {'path': '/b.png', 'finding': 'NOT DETERMINED'}])
    text = v.gather(['/a.png', '/b.png'], lambda _: output)
    assert 'Coverage: 1/2; partial' in text and 'invented' not in text
    assert not v.parse(result([{'path': '/a.png', 'finding': 'a'},
                               {'path': '/a.png', 'finding': 'b'}]), ['/a.png'])


def test_output_overflow_is_disclosed():
    paths = [f'/{i}.png' for i in range(12)]
    text = v.gather(paths, lambda ps: result([{'path': p, 'finding': 'x' * 1000} for p in ps]))
    assert len(text) <= 2500
    assert 'omitted' in text and 'partial' in text


def test_model_id_is_resolved_from_available_models():
    listing = 'gemini-3.8-flash-high\tGemini 3.8 Flash (High)\n'
    assert v.model_id('flash-high', listing) == 'gemini-3.8-flash-high'
    with pytest.raises(ValueError):
        v.model_id('flash-high', 'claude-sonnet-high\tSonnet\n')


def test_cli_adds_only_supplied_image_directories(monkeypatch, capsys):
    image = str(SKILL / 'evals/fixtures/alpha.png')
    commands = []
    lookups = []
    monkeypatch.setattr(v.sys, 'argv', ['visual', '--question', 'OCR', image])
    def check_output(args, **kwargs):
        lookups.append(args)
        if args[0] == 'git':
            return '/discovered-checkout\n'
        return 'flash-high' if args[0] == 'node' else 'gemini-3.8-flash-high\tGemini 3.8 Flash (High)'
    monkeypatch.setattr(v.subprocess, 'check_output', check_output)
    def run(args, **kwargs):
        commands.append(args)
        return result([{'path': image, 'finding': 'ALPHA'}])
    monkeypatch.setattr(v.subprocess, 'run', run)
    assert v.main() == 0
    assert lookups[0] == ['git', '-C', str((SKILL / 'scripts').resolve()), 'rev-parse', '--show-toplevel']
    assert lookups[1][1] == '/discovered-checkout/scripts/model-roles.mjs'
    assert commands[0][-2:] == ['--add-dir', str(Path(image).parent)]
    assert '--dangerously-skip-permissions' not in commands[0]
    assert 'Coverage: 1/1; complete' in capsys.readouterr().out
