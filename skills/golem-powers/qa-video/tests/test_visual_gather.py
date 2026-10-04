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
    monkeypatch.setattr(v.sys, 'argv', ['visual', '--question', 'OCR', image])
    monkeypatch.setattr(v.subprocess, 'check_output', lambda args, **kw:
                        'flash-high' if args[0] == 'node' else 'gemini-3.8-flash-high\tGemini 3.8 Flash (High)')
    def run(args, **kwargs):
        commands.append(args)
        return result([{'path': image, 'finding': 'ALPHA'}])
    monkeypatch.setattr(v.subprocess, 'run', run)
    assert v.main() == 0
    assert commands[0][-2:] == ['--add-dir', str(Path(image).parent)]
    assert '--dangerously-skip-permissions' not in commands[0]
    assert 'Coverage: 1/1; complete' in capsys.readouterr().out
