"""Append-only frame provenance; legacy first three columns remain headerless."""
import csv
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys

FIELDS = 'sheet_file tile t_s frame pts_s source sheet sha256 repeat_of crop_of'.split()

def rows(work):
    path = Path(work)/'frames.tsv'
    if not path.exists():
        return []
    with path.open() as stream:
        return list(csv.DictReader(stream, fieldnames=FIELDS, delimiter='\t'))

def run_root(work):
    work = Path(work).resolve()
    if os.environ.get('QA_RUN_DIR'):
        return Path(os.environ['QA_RUN_DIR']).resolve()
    return work.parent if (work.parent/'frames.tsv').exists() else work

def append(path, values):
    if any('\t' in str(v) or '\n' in str(v) or '\r' in str(v) for v in values):
        raise ValueError('TSV values must be single-line and tab-free')
    with path.open('a') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        stream.write('\t'.join(map(str, values))+'\n')
        stream.flush()

def record(work, entries):
    work = Path(work).resolve()
    root = run_root(work)
    root.mkdir(parents=True, exist_ok=True)
    with (root/'.provenance.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        old = rows(root)
        hashes = {}
        for row in old:
            hashes.setdefault(row['sha256'], row['frame'])
        known = {r['frame'] for r in old}
        for frame, pts, source, sheet, tile, crop_of in entries:
            frame = str(Path(frame).resolve())
            if frame in known:
                raise ValueError('frame already recorded: '+frame)
            digest = hashlib.sha256(Path(frame).read_bytes()).hexdigest()
            stamp = f'{float(pts):.3f}'
            if not math.isfinite(float(pts)):
                raise ValueError('non-finite PTS')
            values = [sheet, tile, stamp, frame, stamp, source, sheet, digest,
                      hashes.get(digest, ''), crop_of]
            append(root/'frames.tsv', values)
            if work != root:
                append(work/'frames.tsv', values)
            known.add(frame)
            hashes.setdefault(digest, frame)

def ffmpeg(args, log):
    with log.open('w') as stream:
        subprocess.run(['ffmpeg', '-hide_banner', '-nostdin', '-n', *args],
                       stderr=stream, stdout=subprocess.DEVNULL, check=True)

def coverage(video, work):
    work = Path(work).resolve()
    frames = work/'frames'
    frames.mkdir(parents=True, exist_ok=False)
    duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
                     'format=duration', '-of', 'csv=p=0', video], text=True))
    for t in range(0, math.ceil(duration), 30):
        frame, log = frames/f'interval-{t}s.png', frames/f'interval-{t}s.log'
        ffmpeg(['-ss', str(t), '-copyts', '-i', video, '-vf', 'showinfo',
                '-frames:v', '1', '-fps_mode', 'passthrough', str(frame)], log)
        pts = re.search(r'pts_time:([-0-9.e+]+)', log.read_text())
        if not pts or not frame.exists():
            raise ValueError('coverage frame lacks decoded PTS or image')
        record(work, [(frame, pts[1], 'coverage', '', '', '')])

def locate(frame):
    frame = Path(frame).resolve()
    for parent in frame.parents:
        for row in rows(parent):
            if row['frame'] == str(frame):
                return parent, row
    raise ValueError('frame is not recorded: '+str(frame))

def crop(frame, x, y, w, h, out):
    work, row = locate(frame)
    x, y, w, h = map(int, (x, y, w, h))
    size = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
                      'stream=width,height', '-of', 'json', frame], text=True))['streams'][0]
    if min(x, y) < 0 or min(w, h) < 1 or x+w > size['width'] or y+h > size['height']:
        raise ValueError('crop outside full-resolution frame')
    out = Path(out).resolve()
    if out.suffix.lower() != '.png':
        raise ValueError('use .png for a lossless full-resolution crop')
    ffmpeg(['-i', frame, '-vf', f'crop={w}:{h}:{x}:{y}:exact=1',
            '-frames:v', '1', str(out)], out.with_suffix('.log'))
    record(work, [(out, row['pts_s'], 'crop', '', '', str(Path(frame).resolve()))])

def inspect(work, frame, why, finding=''):
    work = Path(work).resolve()
    frame = str(Path(frame).resolve())
    row = next((r for r in rows(work) if r['frame'] == frame), None)
    if row is None or not Path(frame).is_file():
        raise ValueError('inspect requires an existing recorded frame')
    if hashlib.sha256(Path(frame).read_bytes()).hexdigest() != row['sha256']:
        raise ValueError('frame digest differs from recorded digest')
    append(work/'inspected.tsv', [row['pts_s'], frame, why, finding, row['sha256']])

def counts(work):
    work = Path(work).resolve()
    data = rows(work)
    inspected = set()
    if (work/'inspected.tsv').exists():
        recorded = {r['frame']: r['sha256'] for r in data}
        with (work/'inspected.tsv').open() as stream:
            for r in csv.reader(stream, delimiter='\t'):
                if len(r) != 5 or not r[4] or recorded.get(r[1]) != r[4]:
                    continue
                try:
                    digest = hashlib.sha256(Path(r[1]).read_bytes()).hexdigest()
                except OSError:
                    continue
                if digest == r[4]:
                    inspected.add(r[1])
    presorted = set()
    for log in work.rglob('visual/findings.jsonl'):
        for line in log.read_text().splitlines():
            item = json.loads(line)
            if item.get('ok'):
                presorted.add(str(Path(item['sheet']).resolve()))
    known = {r['frame'] for r in data}
    read = inspected & known
    only = set()
    for ledger in work.rglob('frames.tsv'):
        only.update(r['frame'] for r in rows(ledger.parent) if r['sheet'] and
                    str((ledger.parent/r['sheet']).resolve()) in presorted)
    repeated = sum(bool(r['repeat_of']) for r in data)
    print(f'extracted={len(data)} unique={len(data)-repeated} repeated={repeated} '
          f'inspected={len(read)} pre-sorted-only={len((only & known)-read)}')

def window_frames(prefix):
    prefix = Path(prefix)
    return sorted(frame for ext in ('jpg', 'png')
                  for frame in prefix.parent.glob(prefix.name+'-f_*.'+ext))

def cleanup(work, prefix, keep_list):
    work = Path(work).resolve()
    # A failed sheet may already have registered some frames in either ledger.
    # Those paths remain valid for inspect/crop/counts and #1182 evidence.
    keep = {Path(r[key]) for root in {work, run_root(work)} for r in rows(root)
            for key in ('frame', 'crop_of', 'repeat_of') if r[key]}
    if keep_list:
        for line in Path(keep_list).read_text().splitlines():
            if not line:
                continue
            fields = line.split('\t')
            if len(fields) == 1:
                path = Path(fields[0])
                keep.add((work/path if path.parent == Path('.') else path).resolve())
            elif len(fields) == 2 and fields[1].isdigit():
                sheet, tile = fields
                keep.update(Path(r['frame']) for r in rows(work)
                            if (work/r['sheet']).resolve() == (work/sheet).resolve()
                            and r['tile'] == str(int(tile)))
            else:
                raise ValueError('DENSE_KEEP_LIST expects frame path or sheet<TAB>tile')
    for frame in window_frames(prefix):
        if frame.resolve() not in keep:
            frame.unlink()

def main():
    action, *args = sys.argv[1:]
    if action == 'cleanup':
        cleanup(*args)
    elif action == 'sheet':
        work, prefix, source, sheet, first, n = args
        prefix = Path(prefix)
        frames = window_frames(prefix)
        pts = prefix.with_name(prefix.name+'-pts.txt').read_text().splitlines()
        a, n = int(first), int(n)
        record(work, [(frames[i], pts[i], source, sheet, i-a, '') for i in range(a, a+n)])
    else:
        {'coverage': coverage, 'crop': crop, 'inspected': inspect, 'coverage-count': counts}[action](*args)

if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        sys.exit('provenance: '+str(error))
