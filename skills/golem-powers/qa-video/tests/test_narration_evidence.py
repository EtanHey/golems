"""Addendum contracts on synthetic narration and registered synthetic image bytes."""
import importlib.util
import json
from pathlib import Path
import subprocess

import pytest

S = Path(__file__).resolve().parents[1]/'scripts'

def call(*args):
    return subprocess.run(['python3', str(S/'narration-evidence.py'), *map(str, args)],
                          capture_output=True, text=True)

@pytest.fixture
def work(tmp_path):
    (tmp_path/'transcript.srt').write_text('1\n00:00:02,000 --> 00:00:03,000\nLook at this.\n\n'
        '2\n00:00:06,000 --> 00:00:07,000\n125%, 150 looks good, a new tab.\n')
    spec = importlib.util.spec_from_file_location('p', S/'provenance.py')
    p = importlib.util.module_from_spec(spec); spec.loader.exec_module(p)
    frame, crop = tmp_path/'frame.png', tmp_path/'crop.png'
    frame.write_bytes(b'synthetic full size'); crop.write_bytes(b'synthetic crop')
    p.record(tmp_path, [(frame, 2, 'must-read', '', '', ''),
                        (crop, 2, 'crop', '', '', str(frame))])
    p.inspect(tmp_path, frame, 'judge: coloured target')
    p.inspect(tmp_path, crop, 'judge: reference coloured target')
    (tmp_path/'must-read-frames.tsv').write_text('srt_index\toffset_s\trequested_s\tpts_s\tframe\n'
        f'1\t0.0\t2.000\t2.000\t{frame}\n')
    return tmp_path, p, frame, crop

def test_first_pointer_reference_and_later_sweep(work):
    w, p, frame, crop = work
    assert call('plan', w).returncode == 0
    r = call('reference', w, 'item-1', crop)
    assert r.returncode == 0, r.stderr
    r = call('sweep', w, 'item-1', '6', w/'brief.json')
    assert r.returncode == 0, r.stderr
    brief = json.loads((w/'brief.json').read_text())
    assert brief['reference_image'] == str(crop)
    assert 'is this the same defect as the reference?' in brief['question']
    other = w/'wrong.png'; other.write_bytes(b'other')
    p.record(w, [(other, 6, 'crop', '', '', str(frame))])
    p.inspect(w, other, 'judge: wrong-time crop')
    assert call('reference', w, 'item-1', other).returncode == 3

def test_indicator_lag_requires_one_second(work):
    w, p, frame, _ = work
    early = w/'early.png'; late = w/'late.png'
    early.write_bytes(b'old render'); late.write_bytes(b'new render')
    p.record(w, [(early, 6.9, 'refine', '', '', ''), (late, 7, 'refine', '', '', '')])
    p.inspect(w, early, 'judge: old render'); p.inspect(w, late, 'judge: new render')
    assert call('state', w, 'zoom', '6', early).returncode == 3
    r = call('state', w, 'zoom', '6', late)
    assert r.returncode == 0, r.stderr
    assert json.loads((w/'indicator-evidence.json').read_text())['zoom']['change_s'] == 6

def test_every_named_level_and_negative_claim_needs_judge(work):
    w, p, frame, _ = work
    assert call('plan', w).returncode == 0
    levels = json.loads((w/'narrated-plan.json').read_text())['levels']
    assert [v['value'] for v in levels] == ['125%', '150', 'a new tab']
    report = w/'report.md'
    report.write_text('## Findings\n')
    assert call('check-levels', w, report).returncode == 3
    later = w/'later.png'; later.write_bytes(b'badge visible')
    p.record(w, [(later, 7, 'refine', '', '', '')])
    lines = [f'LEVEL\t{v["id"]}\t{later}\t7.000' for v in levels]
    report.write_text('\n'.join(lines)+f'\nGATHER_CLAIM\tb4\thidden\t{later}\t7.000\tconfirmed-hidden\n')
    assert call('check-levels', w, report).returncode == 3
    p.inspect(w, later, 'judge: badge visible')
    assert call('check-levels', w, report).returncode == 0
    report.write_text('\n'.join(lines[:-1]))
    assert call('check-levels', w, report).returncode == 3
    report.write_text('\n'.join(lines)+'\nGATHER_CLAIM\tb4\thidden\t\t\tconfirmed-hidden\n')
    assert call('check-levels', w, report).returncode == 3
    report.write_text('\n'.join(lines)+'\nGATHER_CLAIM\tb4\thidden\t\t\tNOT DETERMINED\n')
    assert call('check-levels', w, report).returncode == 0

def test_planned_narration_span_has_no_gaps(work):
    w, _, _, _ = work
    (w/'cues.tsv').write_text('2\t3\tfirst\n6\t7\tlast\n')
    assert call('check-gaps', w).returncode == 3
    assert call('plan', w).returncode == 0
    assert call('check-gaps', w).returncode == 0

def test_gatherer_invented_class_never_a_low_confidence_finding(work):
    w, p, frame, _ = work
    report = w/'report.md'
    report.write_text('## Findings\nA low confidence generic seam.\n')
    assert call('check-findings', w, report).returncode == 3
    report.write_text('## Findings\n## Unverified gatherer claims\nGeneric seam (unverified).\n')
    assert call('check-findings', w, report).returncode == 0
    report.write_text(f'## Findings\nFINDING\tF1\titem-1\tseam\t{frame}\t2.000\tJudge sees a visible separation.\n')
    assert call('check-findings', w, report).returncode == 0
    (w/'inspected.tsv').write_text('')
    assert call('check-findings', w, report).returncode == 3


def test_combined_gate_and_sweep_receipt_tamper(work):
    w, p, frame, crop = work
    assert call('plan', w).returncode == 0
    assert call('reference', w, 'item-1', crop).returncode == 0
    assert call('sweep', w, 'item-1', '6', w/'sweep.json').returncode == 0
    later = w/'settled.png'; later.write_bytes(b'new render, visible badge')
    p.record(w, [(later, 7, 'refine', '', '', '')])
    p.inspect(w, later, 'judge: observed settled render')
    assert call('state', w, 'badge', '6', later).returncode == 0
    levels = json.loads((w/'narrated-plan.json').read_text())['levels']
    lines = [f'LEVEL\t{v["id"]}\t{later}\t7.000' for v in levels]
    lines += [f'INDICATOR\tbadge\t6.0\t{later}\t7.000', '## Findings',
              f'FINDING\tF1\titem-1\tblock\t{frame}\t2.000\tJudge sees a block beside the target.']
    report = w/'report.md'; report.write_text('\n'.join(lines)+'\n')
    r = call('check', w, report)
    assert r.returncode == 0, r.stderr
    brief = json.loads((w/'sweep.json').read_text())
    del brief['reference_image']
    (w/'sweep.json').write_text(json.dumps(brief))
    assert call('check', w, report).returncode == 3
