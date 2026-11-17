#!/usr/bin/env python3
"""Transcript-first debrief: <=12 cue windows / 24 initial stills, preserved evidence, length-aware budget.

Default: extract the targeted stills and hand back so gatherers read them (no
helper call here). --presort runs the visual-batch.py gather inline.
"""
import argparse
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location('provenance', HERE/'provenance.py')
provenance = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(provenance)
def seconds(value):
    h, m, s = value.replace(',', '.').split(':')
    return int(h)*3600 + int(m)*60 + float(s)

def plan(transcript, concurrency):
    concurrency = min(4, max(1, concurrency))
    candidates, segments, duration = [], [], 0
    for block in re.split(r'\n\s*\n', transcript.strip()):
        match = re.search(r'(\d{2}:\d{2}:\d{2}[,.]\d+) --> (\d{2}:\d{2}:\d{2}[,.]\d+)\s*\n(.+)', block, re.S)
        if not match:
            continue
        text = ' '.join(match[3].split())
        start, end = seconds(match[1]), seconds(match[2])
        segments.append((start, end))
        duration = max(duration, end)
        visual = bool(re.search(r'\b(slide|chart|screen|code|diagram|share)\b', text, re.I))
        score = 4*visual + 3*bool(re.search(r'\d', text)) + 4*('?' in text)
        score += 2*bool(re.search(r'\b(is|are|should|must|because|means|claim|learned)\b', text, re.I))
        if score:
            window_start = segments[max(0, len(segments)-4)][0]
            candidates.append({'start': start, 'end': end,
                               'window_start_s': window_start, 'window_end_s': end,
                               'frame_times_s': [window_start, (window_start+end)/2],
                               'text': text, 'visual_reference': visual,
                               'sampling': 'cue start and midpoint', 'score': score})
    ranked = sorted(candidates, key=lambda m: (-m['score'], m['start']))
    bins = {}
    if candidates:
        first = min(m['start'] for m in candidates)
        span = max(360, max(m['start'] for m in candidates)-first+1)
        for item in ranked:
            bins.setdefault(int(12*(item['start']-first)/span), item)
    chosen = list(bins.values())
    frame_count = 2*len(chosen)
    waves = math.ceil(frame_count/concurrency)
    return {'moments': sorted(chosen, key=lambda m: m['start']), 'concurrency': concurrency,
            'frame_count': frame_count, 'call_waves': waves, 'estimated_wall_seconds': 120 + waves*90,
            'scene_sweep': False, 'duration_seconds': duration, 'estimate_basis': '120s prep + 90s per wave; not a timing receipt'}

def command(argv, log, deadline):
    with log.open('w') as output:
        process = subprocess.Popen(argv, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            process.wait(timeout=max(.01, deadline-time.monotonic()))
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise
        if process.returncode:
            raise subprocess.CalledProcessError(process.returncode, argv)

def atomic(path, text):
    pending = path.with_suffix(path.suffix + '.new')
    pending.write_text(text)
    pending.replace(path)

def evidence_note(work, mode, status, selected, citations, presorted=True):
    readings = {}
    findings = work/'visual/findings.jsonl'
    if findings.exists():
        for line in findings.read_text().splitlines():
            try:
                item = json.loads(line)
                readings[item['sheet']] = item
            except (ValueError, KeyError):
                continue
    quotes = []
    for i, moment in enumerate(selected['moments']):
        evidence = []
        for position in ('start', 'midpoint'):
            image = work/f'moment-{i:02d}-{position}.jpg'
            item = readings.get(str(image), {})
            citation = citations.get(image.name)
            if not presorted and citation:
                visual = f'visual: NOT YET VIEWED; open {image.name} yourself (no helper pre-sort)'
            else:
                visual = item.get('finding', '') if item.get('ok') else 'visual: NOT DETERMINED (budget/failed)'
            frame = 'Frame (tile 0, real PTS): '+citation if citation else 'Frame: NOT DETERMINED'
            evidence.append(frame+'\n'+visual)
        quotes.append(f'## {moment["start"]:g}s — transcript-only claim\n{moment["text"]}\n'+ '\n'.join(evidence))
    (work/'debrief.md').write_text(f'# {mode.title()} evidence note\nStatus: {status}\n'
                                 'Primary evidence: transcript.srt. Claims require verification.\n\n'+'\n\n'.join(quotes)+'\n')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('video', type=Path)
    parser.add_argument('--workdir', required=True, type=Path)
    parser.add_argument('--mode', choices=['debrief', 'review', 'gems'], default='debrief')
    parser.add_argument('--concurrency', type=int, default=3)
    parser.add_argument('--budget-seconds', type=float, help='Parent deadline override; default max(600, 24 * video minutes)')
    parser.add_argument('--presort', action='store_true',
                        help='Opt in to the visual-batch.py pre-sort; its text is a lead, not evidence')
    parser.add_argument('--must-read', action='store_true', help='Opt in to budgeted narrated-pointer evidence in debrief/review/gems')
    parser.add_argument('--helper', type=Path, help='Offline helper override (requires --presort)')
    args = parser.parse_args()
    if args.helper and not args.presort:
        parser.error('--helper requires --presort; the default route calls no helper')
    args.helper = args.helper or HERE/'visual-gather.py'
    work = args.workdir.resolve()
    reserved = {'transcript.srt', 'transcript.txt', 'audio.wav', 'progress.txt', 'progress.json',
                'plan.json', 'frames.tsv', 'debrief.md', 'timing.json', 'failure.txt'}
    inputs = {'logs', args.video.name, args.video.with_suffix('.info.json').name} - reserved
    if args.must_read:
        inputs |= {'.qa-mode', 'must-read.tsv', 'deixis-cues.tsv', 'deixis-budget.json',
                   'narration-status.json', 'no-narration.json', 'narrated-plan.json', 'cues.tsv'}
    if work.exists() and any(p.name not in inputs for p in work.iterdir()):
        parser.error('use a fresh empty workdir; prior evidence must survive')
    if (args.budget_seconds is not None and not 0 < args.budget_seconds < float('inf')) or args.concurrency < 1:
        parser.error('positive finite budget and positive concurrency required')
    work.mkdir(parents=True, exist_ok=True)
    (work/'logs').mkdir(exist_ok=True)
    started = time.monotonic()
    automatic_budget = args.budget_seconds is None
    if automatic_budget:
        args.budget_seconds = 600
    deadline = started + args.budget_seconds
    phases, status = {}, 'PARTIAL'
    selected, citations = None, {}

    def progress(text):
        atomic(work/'progress.txt', text+'\n')
        phases[text] = round(time.monotonic()-started, 3)

    try:
        if automatic_budget:
            duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
                             'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1',
                             str(args.video.resolve())], text=True, stderr=subprocess.PIPE, timeout=10))
            if not 0 < duration < float('inf'):
                raise ValueError('ffprobe duration must be positive and finite')
            args.budget_seconds = max(600, 24 * duration/60)
            deadline = started + args.budget_seconds
        progress('transcribing · ETA unknown · budget %gs' % args.budget_seconds)
        command(['bash', str(HERE/'extract.sh'), str(args.video.resolve()), str(work)], work/'logs/extract.log', deadline)
        transcript = (work/'transcript.srt').read_text()
        if args.must_read:
            command(['python3', str(HERE/'must-read.py'), 'plan', str(work)], work/'logs/must-plan.log', deadline)
            command(['python3', str(HERE/'narration-evidence.py'), 'plan', str(work)], work/'logs/narration-plan.log', deadline)
            command(['python3', str(HERE/'must-read.py'), 'extract', str(args.video.resolve()), str(work)], work/'logs/must-extract.log', deadline)
        selected = plan(transcript, args.concurrency)
        atomic(work/'plan.json', json.dumps(selected, indent=2)+'\n')
        duration = selected['duration_seconds']
        if duration <= 0:
            raise ValueError('empty/invalid timestamped transcript; no debrief earned')
        prefix = f'transcribed {int(duration)//60}:{int(duration)%60:02d} · picked {len(selected["moments"])} moments · total budget {args.budget_seconds:g}s · '
        progress(prefix+'extracting targeted stills · ETA unknown')
        sheets = []
        (work/'frames.tsv').touch()
        for i, moment in enumerate(selected['moments']):
            for position, requested in zip(('start', 'midpoint'), moment['frame_times_s']):
                image = work/f'moment-{i:02d}-{position}.jpg'
                log = work/f'logs/frame-{i:02d}-{position}.log'
                command(['ffmpeg', '-hide_banner', '-nostdin', '-y', '-ss', str(requested), '-copyts',
                         '-i', str(args.video.resolve()), '-vf', 'showinfo', '-frames:v', '1', '-q:v', '2', str(image)], log, deadline)
                pts = re.search(r'pts_time:([\d.]+)', log.read_text())
                if not pts or not image.is_file():
                    raise ValueError('targeted frame lacks real PTS or image')
                # Retain the decoded receipt even on a failed in-window check.
                provenance.record(work, [(image, pts[1], 'refine', image.name, 0, '')])
                if not moment['window_start_s'] <= float(pts[1]) < moment['window_end_s']:
                    raise ValueError(f'{image.name}: decoded PTS outside cue window; refine or NOT DETERMINED')
                sheets.append(str(image))
                citations[image.name] = f'{image.name}\t0\t{pts[1]}'
                progress(prefix+f'extracted {len(sheets)}/{selected["frame_count"]} stills · ETA unknown')
        if sheets and not args.presort:
            status = 'STILLS_READY'  # gatherers read them next; no reserve, no helper
        elif sheets:
            # Reserve 205s: N1 drain exceeds launch budget by <=200s at timeout=90.
            remaining = deadline-time.monotonic()-205
            if remaining <= 0:
                raise subprocess.TimeoutExpired('visual reserve', args.budget_seconds)
            spec = importlib.util.spec_from_file_location('batch', HERE/'visual-batch.py')
            batch = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(batch)
            progress(prefix+'visual 0/%s · ETA unknown' % len(sheets))
            result = batch.run(argparse.Namespace(workdir=work, budget_seconds=remaining,
                               concurrency=selected['concurrency'], timeout=90, helper=args.helper,
                               question='Describe visible slide/code/chart text and numbers. Do not infer claims from speech. Mark unknown details NOT DETERMINED.',
                               progress_prefix=prefix), sheets)
            status = 'COMPLETE' if result == 0 else json.loads((work/'visual/summary.json').read_text())['status']
        else:
            status = 'TRANSCRIPT_ONLY'
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        status = 'BUDGET_EXCEEDED' if isinstance(error, subprocess.TimeoutExpired) else 'PARTIAL'
        (work/'failure.txt').write_text(str(error)+'\nNOT DETERMINED: unfinished evidence\n')
    elapsed = time.monotonic()-started
    if elapsed >= args.budget_seconds:
        status = 'BUDGET_EXCEEDED'
    if (work/'transcript.srt').exists():
        if selected is None:
            selected = plan((work/'transcript.srt').read_text(), args.concurrency)
            atomic(work/'plan.json', json.dumps(selected, indent=2)+'\n')
        progress('compiling evidence note · ETA <5s')
        evidence_note(work, args.mode, status, selected, citations, args.presort)
    elapsed = time.monotonic()-started
    if elapsed >= args.budget_seconds and status != 'BUDGET_EXCEEDED':
        status = 'BUDGET_EXCEEDED'
        if selected is not None:
            evidence_note(work, args.mode, status, selected, citations, args.presort)
    progress(f'{status} · elapsed {elapsed:.3f}s · budget {args.budget_seconds:g}s')
    atomic(work/'timing.json', json.dumps({'mode': args.mode, 'status': status, 'presort': args.presort,
                 'wall_seconds': elapsed, 'budget_seconds': args.budget_seconds, 'phases': phases}, indent=2)+'\n')
    return 0 if status in ('COMPLETE', 'TRANSCRIPT_ONLY', 'STILLS_READY') else 2

if __name__ == '__main__':
    sys.exit(main())
