#!/usr/bin/env python3
"""Mandatory pointer evidence: plan, extract, guard and check (no model calls)."""
import csv
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
def module(name):
    spec = importlib.util.spec_from_file_location(name, HERE/(name+'.py'))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod
p = module('provenance')
d = module('deixis-cues')

def required(work):
    # Recompute from source at every gate: an omitted/edited manifest cannot clear a cue.
    return d.cues((work/'transcript.srt').read_text(encoding='utf-8-sig'))

def plan(work):
    work = Path(work).resolve()
    rows = required(work)
    (work/'must-read.tsv').write_text(''.join('\t'.join(r)+'\n' for r in rows))
    target = work/'cues.tsv'
    old = target.read_text().splitlines() if target.exists() else []
    old = [line for line in old if not (len(line.split('\t')) >= 3 and line.split('\t')[2].startswith('must-read:'))]
    old += [f'{r[1]}\t{r[2]}\tmust-read:{r[4]}' for r in rows]
    target.write_text('\n'.join(old)+'\n')
    (work/'.qa-mode').touch()

def extract(video, work):
    work = Path(work).resolve()
    rows = required(work)
    out = work/'must-read'; out.mkdir(exist_ok=False)
    with (work/'must-read-frames.tsv').open('w') as stream:
        writer = csv.writer(stream, delimiter='\t', lineterminator='\n')
        writer.writerow(['srt_index', 'offset_s', 'requested_s', 'pts_s', 'frame'])
        for t, start, end, reason, index in rows:
            for offset in (-.5, 0, .5):
                requested = max(0, float(t)+offset)
                frame = out/f'cue-{index}-{offset:+.1f}.png'
                log = frame.with_suffix('.log')
                p.ffmpeg(['-ss', str(requested), '-copyts', '-i', str(Path(video).resolve()),
                          '-vf', 'showinfo', '-frames:v', '1', '-fps_mode', 'passthrough', str(frame)], log)
                match = re.search(r'pts_time:([-0-9.e+]+)', log.read_text())
                if not match or not frame.exists():
                    raise ValueError('must-read frame missing: '+str(frame))
                pts = float(match[1])
                if not requested-.001 <= pts <= requested+.5:
                    raise ValueError('must-read decoded PTS too far from cue; refine source')
                p.record(work, [(frame, pts, 'must-read', '', '', '')])
                writer.writerow([index, offset, f'{requested:.3f}', f'{pts:.3f}', frame])

def guard(cues, out, fps, pre, post):
    cues, out = Path(cues).resolve(), Path(out).resolve()
    # Raw media utilities without a QA plan/cue marker retain their existing sampling contract.
    roots = [out.parent, cues.parent]
    root = next((r for r in roots if (r/'.qa-mode').exists() or (r/'must-read.tsv').exists()), cues.parent)
    if (root/'.qa-mode').exists() or (root/'must-read.tsv').exists():
        plan(root)
        if cues != root/'cues.tsv':
            # Refinements must retain the source pointer windows as well.
            with cues.open('a') as stream:
                for row in required(root):
                    stream.write(f'{row[1]}\t{row[2]}\tmust-read:{row[4]}\n')
    mandatory = 'must-read:' in cues.read_text() or bool((root/'must-read.tsv').exists() and (root/'must-read.tsv').stat().st_size)
    qa = mandatory or (root/'.qa-mode').exists() or os.environ.get('QA_MODE') == 'qa'
    reasons = []
    if qa and (float(pre) < 1 or float(post) < 2):
        reasons.append('pre >= 1 and post >= 2 required')
    if mandatory and float(fps) < 10:
        reasons.append('must-read fps >= 10 required')
    if not reasons:
        return
    if os.environ.get('QA_COVERAGE_DOWNGRADE') != '1':
        raise ValueError('QA coverage: '+'; '.join(reasons)+' (explicit QA_COVERAGE_DOWNGRADE=1 records COVERAGE FAIL)')
    root.mkdir(parents=True, exist_ok=True)
    with (root/'coverage-downgrades.jsonl').open('a') as stream:
        stream.write(json.dumps({'verdict': 'COVERAGE FAIL', 'cues': str(cues), 'out': str(out),
                                 'fps': fps, 'pre': pre, 'post': post, 'reasons': reasons})+'\n')

def check(work, report):
    work = Path(work).resolve()
    cues = required(work)
    text = Path(report).read_text()
    if (work/'coverage-downgrades.jsonl').exists():
        # Conservative run-wide downgrade; prevents a merged dense window being attributed away.
        if re.search(r'\b(?:PASS|INCONCLUSIVE)\b', text) or 'COVERAGE FAIL' not in text:
            raise ValueError('downgraded run permits only COVERAGE FAIL')
    if not cues:
        return
    with (work/'must-read-frames.tsv').open() as stream:
        frames = list(csv.DictReader(stream, delimiter='\t'))
    if {(r['srt_index'], float(r['offset_s'])) for r in frames} != {(r[4], o) for r in cues for o in (-.5, 0, .5)} or len(frames) != len(cues)*3:
        raise ValueError('missing/duplicate must-read frames')
    recorded = {r['frame']: r for r in p.rows(work)}
    inspected = set()
    ledger = work/'inspected.tsv'
    for line in ledger.read_text().splitlines() if ledger.exists() else []:
        row = line.split('\t')
        if len(row) == 5 and row[2].startswith('judge:') and row[1] in recorded and row[4] == recorded[row[1]]['sha256']:
            inspected.add(row[1])
    entries = [line.split('\t') for line in text.splitlines() if line.startswith('MUST_READ\t')]
    for row in frames:
        frame = row['frame']; rec = recorded.get(frame)
        cue = next(c for c in cues if c[4] == row['srt_index'])
        wanted = max(0, float(cue[0])+float(row['offset_s']))
        if not rec or rec['source'] != 'must-read' or frame not in inspected or rec['pts_s'] != row['pts_s'] or not wanted-.001 <= float(rec['pts_s']) <= wanted+.5:
            raise ValueError('judge must open registered cue frame: '+frame)
        if hashlib.sha256(Path(frame).read_bytes()).hexdigest() != rec['sha256']:
            raise ValueError('changed must-read frame: '+frame)
        matches = [e for e in entries if len(e) == 6 and e[1:4] == [row['srt_index'], frame, row['pts_s']] and len(e[4].strip()) >= 15]
        if not matches:
            raise ValueError('missing pointer description/path/PTS report entry: '+frame)
        crop = recorded.get(matches[0][5])
        if not crop or crop['source'] != 'crop' or crop['crop_of'] != frame or hashlib.sha256(Path(crop['frame']).read_bytes()).hexdigest() != crop['sha256']:
            raise ValueError('missing registered pointer crop: '+frame)

if __name__ == '__main__':
    action, *args = sys.argv[1:]
    try:
        {'plan': plan, 'extract': extract, 'guard': guard, 'check': check}[action](*args)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print('must-read: '+str(error), file=sys.stderr)
        sys.exit(3 if action == 'check' else 2)
