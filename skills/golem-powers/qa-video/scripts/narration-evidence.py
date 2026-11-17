#!/usr/bin/env python3
"""QA narration/reference/settled-render evidence; stdlib, no provider calls.

Schema and the boundary between mechanical checks and judge attestations:
references/narration-evidence.md. All check failures exit 3.
"""
import csv
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent

def load_module(name):
    spec = importlib.util.spec_from_file_location(name, HERE/(name+'.py'))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod

p = load_module('provenance')
d = load_module('deixis-cues')

def read_json(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default

def save(path, value):
    pending = path.with_suffix(path.suffix+'.new')
    pending.write_text(json.dumps(value, indent=2)+'\n'); pending.replace(path)

def number(value):
    value = float(value)
    if not math.isfinite(value) or value < 0:
        raise ValueError('finite nonnegative timestamp required')
    return value

def source(work):
    if not (work/'transcript.srt').exists():
        load_module('must-read').all_cues(work)  # Records silence; deleted known narration fails closed.
        return '', [], [], []
    text = (work/'transcript.srt').read_text(encoding='utf-8-sig')
    segments, levels = [], []
    for block in re.split(r'\n\s*\n', text.replace('\r\n', '\n').strip()):
        match = re.fullmatch(r'\s*(\d+)\s*\n(\d\d:\d\d:\d\d[,.]\d+)\s*-->\s*(\d\d:\d\d:\d\d[,.]\d+)[^\n]*\n(.*)', block, re.S)
        if not match:
            if '-->' in block:
                raise ValueError('malformed narration segment')
            continue
        if not match[4].strip():
            continue
        start, end = d.seconds(match[2]), d.seconds(match[3])
        if end < start:
            raise ValueError('reversed narration interval')
        segments.append({'index': match[1], 'start_s': start, 'end_s': end})
        # Conservative lexical seed. Judges must add semantic values the grammar misses.
        pattern = r'\b\d+(?:\.\d+)?(?:\s*%)?|\b(?:a |another |new )?new tab\b|\b(?:on|off)\b|["“]([^"”]+)["”]'
        for n, value in enumerate(re.finditer(pattern, match[4], re.I)):
            levels.append({'id': f'{match[1]}:{n}', 'value': value[1] or value[0],
                           'start_s': start, 'end_s': end})
    if not segments:
        return text, [], [], []
    items = read_json(work/'narrated-items.json', [{'id': 'item-1',
        'start_s': min(s['start_s'] for s in segments), 'end_s': max(s['end_s'] for s in segments)}])
    if not isinstance(items, list) or not items or len({i['id'] for i in items}) != len(items):
        raise ValueError('unique narrated item IDs required')
    for item in items:
        if not item['id'] or number(item['end_s']) < number(item['start_s']):
            raise ValueError('invalid narrated item')
    for segment in segments:
        if sum(i['start_s'] <= segment['start_s'] and i['end_s'] >= segment['end_s'] for i in items) != 1:
            raise ValueError('each narration segment must belong to exactly one item')
    for level in levels:
        level['item'] = next(i['id'] for i in items if i['start_s'] <= level['start_s'] and i['end_s'] >= level['end_s'])
    return text, segments, items, levels

def plan(work):
    work = Path(work).resolve()
    _, segments, items, levels = source(work)
    save(work/'narrated-plan.json', {'items': items, 'levels': levels})
    if segments:
        cues = work/'cues.tsv'
        old = cues.read_text().splitlines() if cues.exists() else []
        old = [line for line in old if not line.endswith('\tnarrated-span')]
        old.append(f'{min(s["start_s"] for s in segments):.3f}\t{max(s["end_s"] for s in segments):.3f}\tnarrated-span')
        cues.write_text('\n'.join(old)+'\n')

def judged(work, frame, pts=None, full=False):
    frame = str(Path(frame).resolve())
    rec = next((r for r in p.rows(work) if r['frame'] == frame), None)
    if not rec or (full and rec['source'] == 'crop') or rec['sheet_file'] == frame:
        raise ValueError('registered full-size judge frame required: '+frame)
    if pts is not None and number(pts) != number(rec['pts_s']):
        raise ValueError('citation PTS differs from ledger')
    digest = hashlib.sha256(Path(frame).read_bytes()).hexdigest()
    if digest != rec['sha256']:
        raise ValueError('cited frame bytes changed')
    ledger = work/'inspected.tsv'
    inspected = []
    if ledger.exists():
        with ledger.open() as stream:
            inspected = list(csv.reader(stream, delimiter='\t'))
    if not any(len(r) == 5 and r[1] == frame and r[2].startswith('judge:') and r[4] == digest for r in inspected):
        raise ValueError('judge inspection missing: '+frame)
    return rec

def first_pointer(work, item):
    text, _, items, _ = source(work)
    owner = next((i for i in items if i['id'] == item), None)
    if not owner:
        raise ValueError('unknown narrated item')
    cues = [c for c in load_module('must-read').required(work) if owner['start_s'] <= float(c[0]) <= owner['end_s']]
    return min(cues, key=lambda c: float(c[0])) if cues else None

def validate_reference(work, item, crop):
    cue = first_pointer(work, item)
    if not cue:
        raise ValueError('item has no pointer cue')
    rec = judged(work, crop)
    parent = judged(work, rec['crop_of'], full=True)
    with (work/'must-read-frames.tsv').open() as stream:
        originals = list(csv.DictReader(stream, delimiter='\t'))
    if rec['source'] != 'crop' or rec['pts_s'] != parent['pts_s'] or not any(r['srt_index'] == cue[4] and float(r['offset_s']) == 0
            and float(r['requested_s']) == float(cue[0]) and r['frame'] == parent['frame'] and r['pts_s'] == parent['pts_s'] for r in originals):
        raise ValueError('reference must crop the first pointer cue at t_s')
    return rec

def reference(work, item, crop):
    work = Path(work).resolve()
    rec = validate_reference(work, item, crop)
    refs = read_json(work/'item-references.json', {})
    value = {'frame': rec['frame'], 'sha256': rec['sha256']}
    if item in refs and refs[item] != value:
        raise ValueError('reference already pinned; keep the first reference')
    refs[item] = value
    save(work/'item-references.json', refs)

def sweep(work, item, start, brief):
    work = Path(work).resolve()
    ref = read_json(work/'item-references.json', {})[item]
    rec = validate_reference(work, item, ref['frame'])
    if rec['sha256'] != ref['sha256'] or number(start) < float(first_pointer(work, item)[0]):
        raise ValueError('sweep precedes reference or reference changed')
    payload = {'item': item, 'start_s': number(start), 'reference_image': rec['frame'],
        'reference_sha256': rec['sha256'], 'question': 'is this the same defect as the reference? '
        'Describe visible differences; do not invent a defect class. Narration is context, not visual proof.'}
    brief = Path(brief).resolve()
    if brief.exists():
        raise ValueError('use a fresh sweep brief path')
    save(brief, payload)
    with (work/'item-sweeps.jsonl').open('a') as stream:
        stream.write(json.dumps({'brief': str(brief), **payload})+'\n')

def state(work, indicator, change, frame):
    work = Path(work).resolve()
    rec = judged(work, frame, full=True)
    change = number(change)
    if number(rec['pts_s']) < change+1:
        raise ValueError('indicator leads re-render: evidence must be >= change_s + 1 second')
    states = read_json(work/'indicator-evidence.json', {})
    value = {'change_s': change, 'frame': rec['frame'], 'pts_s': rec['pts_s']}
    if indicator in states and states[indicator] != value:
        raise ValueError('use a unique ID per indicator change; retain prior evidence')
    states[indicator] = value
    save(work/'indicator-evidence.json', states)

def lines(report, kind):
    return [line.split('\t') for line in Path(report).read_text().splitlines() if line.startswith(kind+'\t')]

def check_gaps(work):
    work = Path(work).resolve()
    _, segments, _, _ = source(work)
    if not segments:
        return
    intervals = []
    for line in (work/'cues.tsv').read_text().splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        a, b, *_ = line.split('\t'); a, b = number(a), number(b)
        if b < a:
            raise ValueError('reversed cue')
        intervals.append((a, b))
    end = min(s['start_s'] for s in segments)
    target = max(s['end_s'] for s in segments)
    for a, b in sorted(intervals):
        if a > end and end < target:
            raise ValueError(f'narrated coverage gap at {end:g}s')
        end = max(end, b)
    if end < target:
        raise ValueError('narrated coverage ends too early')

def check_levels(work, report):
    work = Path(work).resolve()
    _, _, _, levels = source(work)
    levels += read_json(work/'additional-levels.json', [])
    entries = lines(report, 'LEVEL')
    for level in levels:
        rows = [r for r in entries if len(r) == 4 and r[1] == level['id']]
        if len(rows) != 1:
            raise ValueError('named level needs a judge-read frame: '+level['id'])
        rec = judged(work, rows[0][2], rows[0][3], full=True)
        if not number(level['start_s']) <= number(rec['pts_s']) <= number(level['end_s'])+2:
            raise ValueError('named level frame outside narration window')
    for r in lines(report, 'GATHER_CLAIM'):
        if len(r) != 6 or r[2] not in ('hidden', 'not visible', 'NOT DETERMINED'):
            raise ValueError('invalid gatherer claim row')
        if r[5] == 'NOT DETERMINED':
            continue
        if r[5] not in ('confirmed-hidden', 'visible', 'judge-checked unresolved'):
            raise ValueError('invalid judge claim disposition')
        judged(work, r[3], r[4], full=True)

def check_findings(work, report):
    work = Path(work).resolve()
    text = Path(report).read_text()
    if text.splitlines().count('## Findings') != 1:
        raise ValueError('exactly one canonical Findings section required')
    body = re.split(r'(?m)^## ', text.split('## Findings\n', 1)[1], maxsplit=1)[0]
    for line in body.splitlines():
        if line.strip() and not line.startswith('FINDING\t'):
            raise ValueError('findings must be evidence rows; guesses belong under Unverified gatherer claims')
    for r in lines(report, 'FINDING'):
        if len(r) != 7 or not all(r[1:]) or 'low confidence' in '\t'.join(r).lower():
            raise ValueError('invalid finding or low-confidence gatherer speculation')
        judged(work, r[4], r[5], full=True)
        if len(r[6].strip()) < 15:
            raise ValueError('judge must describe observed defect in the cited frame')

def check(work, report):
    work = Path(work).resolve()
    if (work/'coverage-downgrades.jsonl').exists():
        load_module('must-read').check(work, report)
        return  # An honestly reported coverage failure is a satisfied integrity check.
    check_gaps(work); check_levels(work, report); check_findings(work, report)
    _, _, items, _ = source(work)
    refs = read_json(work/'item-references.json', {})
    for item in items:
        if first_pointer(work, item['id']):
            ref = refs[item['id']]
            if validate_reference(work, item['id'], ref['frame'])['sha256'] != ref['sha256']:
                raise ValueError('reference bytes changed')
    for cue in load_module('must-read').all_cues(work)[0]:
        if cue[3] != 'weak-overflow':
            continue
        item = next(i for i in items if i['start_s'] <= float(cue[0]) <= i['end_s'])
        ref = refs[item['id']]
        matches = [r for r in lines(report, 'GATHERED') if len(r) == 4 and r[1] == cue[4]
                   and r[2] == ref['frame'] and r[3] == 'gathered, not judge-read']
        if not matches:
            raise ValueError('weak overflow needs reference-backed gathered, not judge-read report row')
    for line in (work/'item-sweeps.jsonl').read_text().splitlines() if (work/'item-sweeps.jsonl').exists() else []:
        row = json.loads(line)
        brief = read_json(Path(row['brief']))
        ref = refs[row['item']]
        if (not brief or any(brief.get(k) != v for k, v in row.items() if k != 'brief')
                or row['reference_image'] != ref['frame'] or row['reference_sha256'] != ref['sha256']
                or 'is this the same defect as the reference?' not in row['question']):
            raise ValueError('sweep must carry the pinned reference and comparison question')
    states = read_json(work/'indicator-evidence.json', {})
    entries = lines(report, 'INDICATOR')
    if len(entries) != len(states) or {r[1] for r in entries} != set(states):
        raise ValueError('indicator evidence and report entries must match')
    for name, value in states.items():
        rec = judged(work, value['frame'], value['pts_s'], full=True)
        if number(rec['pts_s']) < number(value['change_s'])+1:
            raise ValueError('indicator leads re-render: evidence must be >= change_s + 1 second')
        if ['INDICATOR', name, str(value['change_s']), value['frame'], value['pts_s']] not in entries:
            raise ValueError('record indicator change time beside its evidence frame')

if __name__ == '__main__':
    try:
        action, *args = sys.argv[1:]
        {'plan': plan, 'reference': reference, 'sweep': sweep, 'state': state, 'check': check,
         'check-gaps': check_gaps, 'check-levels': check_levels, 'check-findings': check_findings}[action](*args)
    except (OSError, ValueError, KeyError, TypeError, IndexError) as error:
        print('narration-evidence: '+str(error), file=sys.stderr)
        sys.exit(3)
