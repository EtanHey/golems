"""Review regressions: explicit pointer budget, real sampling, no attestation-only reads."""
import csv
import importlib.util
import json
import os
from pathlib import Path

import pytest
from test_deixis import S, call, prepare, report, run
from test_prepare import media

def parser():
    spec = importlib.util.spec_from_file_location('deixis', S/'deixis-cues.py')
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod

@pytest.mark.parametrize('phrase', ['hovering', 'hover over', 'my mouse', 'my cursor',
    'under my cursor', 'pointing at', 'pointing to', 'right here', 'right there',
    'this one', 'that one', 'hovering overhead'])
def test_strong_list_always_mandatory(phrase):
    rows = parser().cues('1\n00:00:02,000 --> 00:00:03,000\n'+phrase+'\n')
    assert len(rows) == 1 and rows[0][3] == 'strong'

def test_weak_budget_ranking_and_merge():
    p = parser()
    subs = []
    # 22 minutes; 22 weak candidates, with the last 11 nearest defect words.
    for i in range(22):
        t = i*60
        f = lambda v: f'{v//3600:02}:{v//60%60:02}:{v%60:02},000'
        subs.append(f'{i+1}\n{f(t)} --> {f(t+59)}\nSee this'+(' issue' if i >= 11 else '')+'.\n')
    rows, stats = p.analyze('\n'.join(subs))
    assert stats == {'strong': 0, 'weak': 22, 'judge_read': 11, 'overflow': 11, 'weak_cap': 11}
    assert {r[4] for r in rows if r[3] == 'weak'} == {str(i) for i in range(12, 23)}
    merged = p.cues('1\n00:00:02,000 --> 00:00:03,000\nright here\n\n'
                   '2\n00:00:04,000 --> 00:00:05,000\nmy cursor\n')
    assert len(merged) == 1

def test_phrase_offset_and_whisper_words():
    p = parser()
    text = '1\n00:00:00,000 --> 00:00:10,000\nAfter this long introduction I am hovering over it.\n'
    estimated = float(p.cues(text)[0][0])
    assert 5 < estimated < 10
    words = {'transcription': [{'tokens': [{'text': ' hovering', 'offsets': {'from': 8200}}]}]}
    assert p.cues(text, words)[0][0] == '8.200'

def test_refine_only_named_windows_and_duplicate_rows(run):
    work, video = run
    prepare(work, video)
    cues = work/'refine-cues.tsv'
    content = '8.0\t8.5\tchosen\n8.0\t8.5\tchosen\n'
    cues.write_text(content)
    counts = []
    for i in range(2):
        out = work/f'refine-{i}'
        r = call('dense-windows.sh', video, cues, out, 20, 1, 2,
                 env={**os.environ, 'QA_FRAME_SOURCE': 'refine', 'DENSE_SLOTS': '0'})
        assert r.returncode == 0, r.stderr
        rows = list(csv.reader((out/'frames.tsv').open(), delimiter='\t'))
        assert all(7 <= float(row[2]) <= 10.5 for row in rows)
        counts.append(len(rows))
        assert cues.read_text() == content
    assert counts[0] == counts[1] and 60 <= counts[0] <= 70
    print('refine frame counts:', counts)

def test_floor_walks_ancestors_and_plan_marks_before_transcription(run):
    work, video = run
    (work/'transcript.srt').unlink()
    assert call('default.sh', 'plan', video, work).returncode == 0
    assert (work/'.qa-mode').exists()
    (work/'transcript.srt').write_text('1\n00:00:04,000 --> 00:00:05,000\nmy cursor\n')
    (work/'must-read.tsv').unlink()
    nested = work/'hand'/'more'; nested.mkdir(parents=True)
    cues = nested/'cues.tsv'; cues.write_text('4\t5\tnamed\n')
    r = call('dense-windows.sh', video, cues, nested/'dense', 2, 0, 0)
    assert r.returncode == 2 and 'QA coverage' in r.stderr
    assert (work/'must-read.tsv').stat().st_size > 0
    env = {**os.environ, 'QA_MODE': 'qa'}
    other = work.parent/'external'; other.mkdir()
    (other/'cues.tsv').write_text('4\t5\tnamed\n')
    assert call('dense-windows.sh', video, other/'cues.tsv', other/'dense', 2, 0, 0, env=env).returncode == 2

def test_read_transcript_and_auto_finalize_reject_forged_ledger(run):
    work, video = run
    prepare(work, video)
    text, rows = report(work)
    out = work/'report.md'; out.write_text(text+'\n')
    for row in rows:
        assert call('inspected.sh', work, row['frame'], 'judge: pointer grid').returncode == 0
        assert call('crop.sh', row['frame'], 0, 0, 20, 20, row['frame']+'.crop.png').returncode == 0
    session = work/'judge.jsonl'; session.write_text(json.dumps({'type': 'assistant', 'message': {'content': 'I read the images'}})+'\n')
    assert call('must-read-check.sh', work, out, '--transcript', session).returncode == 3
    assert call('default.sh', 'finalize', work, out, '--transcript', session).returncode == 3
    session.write_text('\n'.join(json.dumps({'type': 'assistant', 'message': {'content': [
        {'type': 'tool_use', 'name': 'Read', 'input': {'file_path': row['frame']}}]}}) for row in rows))
    r = call('must-read-check.sh', work, out, '--transcript', session)
    assert r.returncode == 0, r.stderr
    assert call('narration-evidence.py', 'plan', work).returncode == 0
    assert call('inspected.sh', work, rows[0]['frame']+'.crop.png', 'judge: reference crop').returncode == 0
    r = call('narration-evidence.py', 'reference', work, 'item-1', rows[0]['frame']+'.crop.png')
    assert r.returncode == 0, r.stderr
    out.write_text(text+'\n## Findings\n')
    r = call('default.sh', 'finalize', work, out, '--transcript', session)
    assert r.returncode == 0, r.stderr

def test_silent_idempotent_and_downgrade(run):
    work, video = run
    prepare(work, video)
    before = (work/'frames.tsv').read_text()
    assert call('must-read.py', 'extract', video, work).returncode == 0
    assert (work/'frames.tsv').read_text() == before
    manifest = (work/'must-read-frames.tsv').read_text()
    row = next(csv.DictReader(manifest.splitlines(), delimiter='\t'))
    Path(row['frame']).write_bytes(b'changed registered bytes')
    assert call('must-read.py', 'extract', video, work).returncode == 2
    assert (work/'must-read-frames.tsv').read_text() == manifest
    assert 'usage:' in call('must-read.py').stderr and 'Traceback' not in call('must-read.py').stderr
    (work/'coverage-downgrades.jsonl').write_text('{"verdict":"COVERAGE FAIL"}\n')
    report = work/'report.md'; report.write_text('COVERAGE FAIL\n')
    assert call('must-read-check.sh', work, report).returncode == 0
    silent = work/'silent'; silent.mkdir()
    assert call('must-read-check.sh', silent, report).returncode == 0
    assert 'no narration' in (silent/'no-narration.json').read_text()
    r = call('extract.sh', video, silent)
    assert r.returncode == 0 and 'no audio stream' in r.stdout

def test_review_opt_in(run):
    work, video = run
    assert call('default.sh', 'plan', video, work, 'review').returncode == 0
    assert not (work/'must-read.tsv').exists()
    assert call('default.sh', 'plan', video, work, 'review', '--must-read').returncode == 0
    assert (work/'must-read.tsv').stat().st_size > 0

def test_review_opt_in_runs_after_pretranscription_plan(media):
    video, work, env = media
    assert call('default.sh', 'plan', video, work, 'review', '--must-read', env=env).returncode == 0
    r = call('debrief.py', video, '--workdir', work, '--mode', 'review', '--must-read', env=env)
    assert r.returncode == 0, r.stderr
    assert len(list(csv.DictReader((work/'must-read-frames.tsv').open(), delimiter='\t'))) == 1
