#!/usr/bin/env python3
"""Transcript-first debrief: <=12 stills, incremental evidence, 600s total budget."""
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
def seconds(value):
    h, m, s = value.replace(',', '.').split(':')
    return int(h)*3600 + int(m)*60 + float(s)

def plan(transcript, concurrency):
    concurrency = min(4, max(1, concurrency))
    candidates, duration = [], 0
    for block in re.split(r'\n\s*\n', transcript.strip()):
        match = re.search(r'(\d{2}:\d{2}:\d{2}[,.]\d+) --> (\d{2}:\d{2}:\d{2}[,.]\d+)\s*\n(.+)', block, re.S)
        if not match:
            continue
        text = ' '.join(match[3].split())
        duration = max(duration, seconds(match[2]))
        visual = bool(re.search(r'\b(slide|chart|screen|code|diagram|share)\b', text, re.I))
        score = 4*visual + 3*bool(re.search(r'\d', text)) + 4*('?' in text)
        score += 2*bool(re.search(r'\b(is|are|should|must|because|means|claim|learned)\b', text, re.I))
        if score:
            candidates.append({'start': seconds(match[1]), 'end': seconds(match[2]),
                               'text': text, 'visual_reference': visual, 'sampling': 'one still', 'score': score})
    ranked = sorted(candidates, key=lambda m: (-m['score'], m['start']))
    bins = {}
    if candidates:
        first = min(m['start'] for m in candidates)
        span = max(360, max(m['start'] for m in candidates)-first+1)
        for item in ranked:
            bins.setdefault(int(12*(item['start']-first)/span), item)
    chosen = list(bins.values())
    waves = math.ceil(len(chosen)/concurrency)
    return {'moments': sorted(chosen, key=lambda m: m['start']), 'concurrency': concurrency,
            'call_waves': waves, 'estimated_wall_seconds': 120 + waves*90,
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

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('video', type=Path)
    parser.add_argument('--workdir', required=True, type=Path)
    parser.add_argument('--mode', choices=['debrief', 'review', 'gems'], default='debrief')
    parser.add_argument('--concurrency', type=int, default=3)
    parser.add_argument('--budget-seconds', type=float, default=600)
    parser.add_argument('--helper', type=Path, default=HERE/'visual-gather.py', help='Offline helper override')
    args = parser.parse_args()
    work = args.workdir.resolve()
    reserved = {'transcript.srt', 'transcript.txt', 'audio.wav', 'progress.txt', 'progress.json',
                'plan.json', 'frames.tsv', 'debrief.md', 'timing.json', 'failure.txt'}
    inputs = {'logs', args.video.name, args.video.with_suffix('.info.json').name} - reserved
    if work.exists() and any(p.name not in inputs for p in work.iterdir()):
        parser.error('use a fresh empty workdir; prior evidence must survive')
    if not 0 < args.budget_seconds < float('inf') or args.concurrency < 1:
        parser.error('positive finite budget and positive concurrency required')
    work.mkdir(parents=True, exist_ok=True)
    (work/'logs').mkdir(exist_ok=True)
    spec = importlib.util.spec_from_file_location('batch', HERE/'visual-batch.py')
    batch = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(batch)
    started = time.monotonic()
    deadline = started + args.budget_seconds
    phases, status = {}, 'PARTIAL'

    def progress(text):
        batch.atomic(work/'progress.txt', text+'\n')
        phases[text] = round(time.monotonic()-started, 3)

    try:
        progress('transcribing · ETA unknown · budget %gs' % args.budget_seconds)
        command(['bash', str(HERE/'extract.sh'), str(args.video.resolve()), str(work)], work/'logs/extract.log', deadline)
        transcript = (work/'transcript.srt').read_text()
        selected = plan(transcript, args.concurrency)
        batch.atomic(work/'plan.json', json.dumps(selected, indent=2)+'\n')
        duration = selected['duration_seconds']
        if duration <= 0:
            raise ValueError('empty/invalid timestamped transcript; no debrief earned')
        prefix = f'transcribed {int(duration)//60}:{int(duration)%60:02d} · picked {len(selected["moments"])} moments · '
        progress(prefix+'extracting targeted stills · ETA unknown')
        sheets, citations = [], []
        for i, moment in enumerate(selected['moments']):
            image, log = work/f'moment-{i:02d}.jpg', work/f'logs/frame-{i:02d}.log'
            command(['ffmpeg', '-hide_banner', '-nostdin', '-y', '-ss', str(moment['start']), '-copyts',
                     '-i', str(args.video.resolve()), '-vf', 'showinfo', '-frames:v', '1', '-q:v', '2', str(image)], log, deadline)
            pts = re.search(r'pts_time:([\d.]+)', log.read_text())
            if not pts or not image.is_file():
                raise ValueError('targeted frame lacks real PTS or image')
            sheets.append(str(image))
            citations.append(f'{image.name}\t0\t{pts[1]}')
            progress(prefix+f'extracted {i+1}/{len(selected["moments"])} stills · ETA unknown')
        (work/'frames.tsv').write_text('\n'.join(citations)+'\n')
        # Reserve 205s: N1 drain exceeds launch budget by <=200s at timeout=90.
        remaining = deadline-time.monotonic()-205
        if sheets and remaining <= 0:
            raise subprocess.TimeoutExpired('visual reserve', args.budget_seconds)
        if sheets:
            progress(prefix+'visual 0/%s · ETA unknown' % len(sheets))
            result = batch.run(argparse.Namespace(workdir=work, budget_seconds=remaining,
                               concurrency=selected['concurrency'], timeout=90, helper=args.helper,
                               question='Describe visible slide/code/chart text and numbers. Do not infer claims from speech. Mark unknown details NOT DETERMINED.',
                               progress_prefix=prefix), sheets)
            status = 'COMPLETE' if result == 0 else json.loads((work/'visual/summary.json').read_text())['status']
        else:
            status = 'TRANSCRIPT_ONLY'
        progress(prefix+'compiling evidence note · ETA <5s')
        observations = (work/'visual/findings.jsonl').read_text() if sheets else ''
        quotes = '\n\n'.join(f'## {m["start"]:g}s — transcript-only claim\n{m["text"]}\nFrame (tile 0, real PTS): {c}'
                             for m, c in zip(selected['moments'], citations))
        (work/'debrief.md').write_text(f'# {args.mode.title()} evidence note\nStatus: {status}\nClaims require verification.\n\n'+quotes+'\n\n## Visual observations\n'+observations)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        status = 'BUDGET_EXCEEDED' if isinstance(error, subprocess.TimeoutExpired) else 'PARTIAL'
        (work/'failure.txt').write_text(str(error)+'\nNOT DETERMINED: unfinished evidence\n')
    elapsed = time.monotonic()-started
    if elapsed >= args.budget_seconds:
        status = 'BUDGET_EXCEEDED'
    progress(f'{status} · elapsed {elapsed:.3f}s · budget {args.budget_seconds:g}s')
    batch.atomic(work/'timing.json', json.dumps({'mode': args.mode, 'status': status,
                 'wall_seconds': elapsed, 'budget_seconds': args.budget_seconds, 'phases': phases}, indent=2)+'\n')
    return 0 if status in ('COMPLETE', 'TRANSCRIPT_ONLY') else 2

if __name__ == '__main__':
    sys.exit(main())
