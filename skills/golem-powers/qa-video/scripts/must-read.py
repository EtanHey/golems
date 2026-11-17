#!/usr/bin/env python3
"""Mandatory pointer evidence: plan, extract, guard and check (no model calls)."""
import csv
import argparse
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

def all_cues(work):
    transcript = work/'transcript.srt'
    status = work/'narration-status.json'
    if not transcript.exists():
        if status.exists() and json.loads(status.read_text()).get('available'):
            raise ValueError('narration transcript was removed; restore transcript.srt')
        if not (work/'no-narration.json').exists():
            (work/'no-narration.json').write_text(json.dumps({'note': 'no narration: no transcript supplied'})+'\n')
        return [], {'strong': 0, 'weak': 0, 'judge_read': 0, 'overflow': 0, 'weak_cap': 6}
    status.write_text(json.dumps({'available': True})+'\n')
    words = work/'transcript.json'
    return d.analyze(transcript.read_text(encoding='utf-8-sig'), json.loads(words.read_text()) if words.exists() else None)

def required(work):
    return [r for r in all_cues(work)[0] if r[3] != 'weak-overflow']

def plan(work):
    work = Path(work).resolve()
    work.mkdir(parents=True, exist_ok=True)
    rows, stats = all_cues(work)
    (work/'deixis-cues.tsv').write_text(''.join('\t'.join(r)+'\n' for r in rows))
    (work/'must-read.tsv').write_text(''.join('\t'.join(r)+'\n' for r in rows if r[3] != 'weak-overflow'))
    (work/'deixis-budget.json').write_text(json.dumps(stats, indent=2)+'\n')
    target = work/'cues.tsv'
    old = target.read_text().splitlines() if target.exists() else []
    old = [line for line in old if not (len(line.split('\t')) >= 3 and line.split('\t')[2].startswith(('must-read:', 'weak-overflow:')))]
    old += [f'{r[1]}\t{r[2]}\t{"weak-overflow" if r[3] == "weak-overflow" else "must-read"}:{r[4]}' for r in rows]
    target.write_text('\n'.join(old)+'\n')
    (work/'.qa-mode').touch()

def extract(video, work, neighbors=False):
    work = Path(work).resolve()
    rows = required(work)
    out = work/'must-read'; out.mkdir(exist_ok=True)
    recorded = {r['frame']: r for r in p.rows(work)}
    pending = work/'must-read-frames.tsv.new'
    with pending.open('w') as stream:
        writer = csv.writer(stream, delimiter='\t', lineterminator='\n')
        writer.writerow(['srt_index', 'offset_s', 'requested_s', 'pts_s', 'frame'])
        for t, start, end, reason, index in rows:
            for offset in ((-.5, 0, .5) if neighbors else (0,)):
                requested = max(0, float(t)+offset)
                frame = out/f'cue-{index}-{t}-{offset:+.1f}.png'
                log = frame.with_suffix('.log')
                if not frame.exists():
                    p.ffmpeg(['-ss', str(requested), '-copyts', '-i', str(Path(video).resolve()),
                          '-vf', 'showinfo', '-frames:v', '1', '-fps_mode', 'passthrough', str(frame)], log)
                match = re.search(r'pts_time:([-0-9.e+]+)', log.read_text())
                if not match or not frame.exists():
                    raise ValueError('must-read frame missing: '+str(frame))
                pts = float(match[1])
                if not requested-.001 <= pts <= requested+.5:
                    raise ValueError('must-read decoded PTS too far from cue; refine source')
                rec = recorded.get(str(frame))
                if rec:
                    if rec['pts_s'] != f'{pts:.3f}' or rec['sha256'] != hashlib.sha256(frame.read_bytes()).hexdigest():
                        raise ValueError('existing extraction differs; use a fresh run directory')
                else:
                    p.record(work, [(frame, pts, 'must-read', '', '', '')])
                writer.writerow([index, offset, f'{requested:.3f}', f'{pts:.3f}', frame])
    pending.replace(work/'must-read-frames.tsv')

def guard(cues, out, fps, pre, post):
    cues, out = Path(cues).resolve(), Path(out).resolve()
    roots = list(out.parents)+[cues.parent, *cues.parents]
    root = next((r for r in roots if (r/'.qa-mode').exists()), cues.parent)
    qa = (root/'.qa-mode').exists() or os.environ.get('QA_MODE') == 'qa' or 'must-read:' in cues.read_text()
    refine = os.environ.get('QA_FRAME_SOURCE') == 'refine' or out.name.startswith('refine')
    if qa and (not (root/'must-read.tsv').exists() or not refine):
        plan(root)
    # Only the primary pass must merge the complete plan. Refinements never modify cue files.
    if qa and not refine:
        planned = required(root)
        actual = [line.split('\t') for line in cues.read_text().splitlines() if line and not line.startswith('#')]
        if any(not any(float(a[0]) <= float(r[1]) and float(a[1]) >= float(r[2]) for a in actual) for r in planned):
            raise ValueError('QA coverage: cues omit mandatory windows; run must-read.py plan <QA workdir> and use its cues.tsv')
    mandatory = 'must-read:' in cues.read_text() or bool((root/'must-read.tsv').exists() and (root/'must-read.tsv').stat().st_size)
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

def check(work, report, transcript=None):
    work = Path(work).resolve()
    cues = required(work)
    text = Path(report).read_text()
    if (work/'coverage-downgrades.jsonl').exists():
        # Conservative run-wide downgrade; prevents a merged dense window being attributed away.
        if re.search(r'\b(?:PASS|INCONCLUSIVE)\b', text) or 'COVERAGE FAIL' not in text:
            raise ValueError('downgraded run permits only COVERAGE FAIL')
        return
    if not cues:
        return
    with (work/'must-read-frames.tsv').open() as stream:
        frames = list(csv.DictReader(stream, delimiter='\t'))
    expected = {(r[4], float(r[0])) for r in cues}
    actual = [(r['srt_index'], float(r['requested_s'])) for r in frames if float(r['offset_s']) == 0]
    if set(actual) != expected or len(actual) != len(expected):
        raise ValueError('missing/duplicate must-read frames')
    recorded = {r['frame']: r for r in p.rows(work)}
    inspected = set()
    ledger = work/'inspected.tsv'
    for line in ledger.read_text().splitlines() if ledger.exists() else []:
        row = line.split('\t')
        if len(row) == 5 and row[2].startswith('judge:') and row[1] in recorded and row[4] == recorded[row[1]]['sha256']:
            inspected.add(row[1])
    entries = [line.split('\t') for line in text.splitlines() if line.startswith('MUST_READ\t')]
    reads = image_reads(Path(transcript)) if transcript else set()
    for row in frames:
        if float(row['offset_s']) != 0:
            continue  # Neighbours are optional evidence, never mandatory reads.
        frame = row['frame']; rec = recorded.get(frame)
        cue = next(c for c in cues if c[4] == row['srt_index'] and float(c[0]) == float(row['requested_s']))
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
        if transcript and cue[3] == 'strong':
            if frame not in reads and crop['frame'] not in reads:
                raise ValueError('strong cue lacks image-read tool call in judge transcript: '+frame)

def image_reads(path):
    """Read calls in Claude JSONL and view_image calls in Codex JSONL; no prose/shell matches."""
    reads = set()
    def walk(value):
        if isinstance(value, dict):
            kind = value.get('type')
            name = value.get('name', '')
            args = value.get('input', value.get('arguments', {}))
            if kind in ('tool_use', 'function_call') and (name == 'Read' or name.endswith('view_image')):
                if isinstance(args, str):
                    args = json.loads(args)
                raw = args.get('file_path', args.get('path')) if isinstance(args, dict) else None
                if raw:
                    reads.add(str(Path(raw).resolve()))
            for key in ('message', 'content', 'payload', 'item', 'output'):
                if key in value and isinstance(value[key], (dict, list)):
                    walk(value[key])
        elif isinstance(value, list):
            for item in value:
                walk(item)
    for line in path.read_text().splitlines():
        if line.strip():
            walk(json.loads(line))
    return reads

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    for name, fields in {'plan': ['work'], 'extract': ['video', 'work'],
                         'guard': ['cues', 'out', 'fps', 'pre', 'post'], 'check': ['work', 'report']}.items():
        cmd = sub.add_parser(name)
        for field in fields:
            cmd.add_argument(field)
        if name == 'extract':
            cmd.add_argument('--neighbors', action='store_true')
        if name == 'check':
            cmd.add_argument('--transcript')
    args = vars(parser.parse_args())
    action = args.pop('action')
    try:
        {'plan': plan, 'extract': extract, 'guard': guard, 'check': check}[action](**args)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print('must-read: '+str(error), file=sys.stderr)
        sys.exit(3 if action == 'check' else 2)
