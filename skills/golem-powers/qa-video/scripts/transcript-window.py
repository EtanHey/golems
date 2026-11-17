#!/usr/bin/env python3
"""Bounded narration data selected by decoded PTS, never instructions or visual proof."""
import argparse
import csv
import json
import math
from pathlib import Path
import re

MAX_WINDOW_BYTES = 8192  # serialized UTF-8 per sheet, including timestamps/metadata
MAX_SEGMENTS = 40
MAX_SRT_BYTES = 8 * 1024 * 1024
FIELDS = 'sheet_file tile t_s frame pts_s source sheet sha256 repeat_of crop_of'.split()
TIMING = re.compile(r'(\d{2,}:\d{2}:\d{2}[,.]\d+)\s+-->\s+(\d{2,}:\d{2}:\d{2}[,.]\d+)(?:\s+.*)?')


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def seconds(stamp):
    h, m, s = stamp.replace(',', '.').split(':')
    if int(m) >= 60 or float(s) >= 60:
        raise ValueError('TRANSCRIPT_TIMING_INVALID')
    return int(h) * 3600 + int(m) * 60 + float(s)


def segments(path):
    with Path(path).open('rb') as stream:
        raw = stream.read(MAX_SRT_BYTES + 1)
    if len(raw) > MAX_SRT_BYTES:
        raise ValueError('TRANSCRIPT_INPUT_TOO_LARGE')
    data = raw.decode('utf-8-sig').replace('\r\n', '\n').replace('\r', '\n')
    result = []
    for block in re.split(r'\n\s*\n', data.strip()):
        if not block.strip():
            continue
        lines = block.splitlines()
        index = 1 if lines[0].strip().isdigit() else 0
        match = TIMING.fullmatch(lines[index]) if index < len(lines) else None
        if not match:
            raise ValueError('TRANSCRIPT_SRT_INVALID')
        # Match debrief.plan(): an empty timed cue contributes no speech.
        # Skip it between populated cues and at EOF; malformed timing still fails.
        if not any(line.strip() for line in lines[index + 1:]):
            continue
        start, end = map(seconds, match.groups())
        if end < start:
            raise ValueError('TRANSCRIPT_TIMING_INVALID')
        # Preserve original timestamps and narration, including hostile text.
        result.append((start, end, '\n'.join(lines[:index + 1]), '\n'.join(lines[index + 1:])))
    return result


def bounds(path, images):
    wanted = set(map(str, images))
    found = {p: [] for p in wanted}
    with Path(path).open() as stream:
        for row in csv.DictReader(stream, fieldnames=FIELDS, delimiter='\t'):
            if row['sheet_file'] == 'sheet_file':
                continue
            candidates = set()
            if row.get('frame'):
                frame = Path(row['frame'])
                frame = (Path(path).parent / frame).resolve()
                candidates.add(str(frame))
                if row.get('sheet_file'):
                    candidates.add(str((frame.parent / row['sheet_file']).resolve()))
            if row.get('sheet_file'):
                candidates.add(str((Path(path).parent / row['sheet_file']).resolve()))
            for image in wanted & candidates:
                try:
                    pts = float(row['pts_s'])  # never t_s, index or filename guesses
                except (ValueError, TypeError):
                    raise ValueError('TRANSCRIPT_DECODED_PTS_INVALID') from None
                if not math.isfinite(pts) or pts < 0:
                    raise ValueError('TRANSCRIPT_DECODED_PTS_INVALID')
                found[image].append(pts)
    return found


def select(rows, first, last):
    result = dict(start_s=max(0, first - 15), end_s=last + 3, srt=[], truncated=False)
    overlapping = [row for row in rows if row[0] <= result['end_s'] and row[1] >= result['start_s']]
    for i, (_, _, header, text) in enumerate(overlapping):
        if i >= MAX_SEGMENTS:
            result['truncated'] = True
            break
        result['srt'].append(header + '\n' + text)
        if len(encode(result).encode()) <= MAX_WINDOW_BYTES:
            continue
        # Keep the timestamp even when a single huge subtitle exceeds the cap.
        # Reserve space using false (one byte longer than true).
        lo, hi = 0, len(text)
        while lo < hi:
            mid = (lo + hi + 1) // 2
            result['srt'][-1] = header + '\n' + text[:mid] + '[TRUNCATED]'
            if len(encode(result).encode()) <= MAX_WINDOW_BYTES:
                lo = mid
            else:
                hi = mid - 1
        result['srt'][-1] = header + '\n' + text[:lo] + '[TRUNCATED]'
        if len(encode(result).encode()) > MAX_WINDOW_BYTES:
            result['srt'].pop()
        result['truncated'] = True
        break
    return result


def windows_for(images, transcript=None, frames_tsv=None):
    if transcript is None:
        return {}
    images = list(map(lambda p: str(Path(p).resolve()), images))
    rows = segments(transcript)
    ledgers = {Path(frames_tsv)} if frames_tsv else {Path(p).parent / 'frames.tsv' for p in images}
    found = {p: [] for p in images}
    for ledger in ledgers:
        for image, pts in bounds(ledger, images).items():
            found[image].extend(pts)
    if any(not pts for pts in found.values()):
        raise ValueError('TRANSCRIPT_DECODED_PTS_MISSING')
    return {image: select(rows, min(pts), max(pts)) for image, pts in found.items()}


def add_arguments(parser):
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--transcript', type=Path, help='SRT narration; select per-image decoded-PTS windows')
    group.add_argument('--transcript-window', help='Preselected JSON window map keyed by exact image path (data)')
    parser.add_argument('--frames-tsv', type=Path, help='Decoded frame ledger; default each image parent/frames.tsv')


def from_args(args, images):
    raw = getattr(args, 'transcript_window', None)
    if raw is None:
        return windows_for(images, getattr(args, 'transcript', None), getattr(args, 'frames_tsv', None))
    # Bound deserialization and validate the same cap on forwarded data.
    if len(raw.encode()) > (MAX_WINDOW_BYTES + 4096) * len(images):
        raise ValueError('TRANSCRIPT_WINDOW_TOO_LARGE')
    windows = json.loads(raw)
    if not isinstance(windows, dict) or set(windows) != set(map(str, images)):
        raise ValueError('TRANSCRIPT_WINDOW_IMAGES_INVALID')
    for window in windows.values():
        if (not isinstance(window, dict) or set(window) != {'start_s', 'end_s', 'srt', 'truncated'}
                or not isinstance(window['srt'], list) or len(window['srt']) > MAX_SEGMENTS
                or any(not isinstance(s, str) for s in window['srt'])
                or type(window['truncated']) is not bool):
            raise ValueError('TRANSCRIPT_WINDOW_INVALID')
        try:
            valid = all(type(window[k]) in (int, float) and math.isfinite(window[k]) for k in ['start_s', 'end_s'])
        except OverflowError:
            valid = False
        if not valid:
            raise ValueError('TRANSCRIPT_WINDOW_INVALID')
        if not 0 <= window['start_s'] <= window['end_s'] or len(encode(window).encode()) > MAX_WINDOW_BYTES:
            raise ValueError('TRANSCRIPT_WINDOW_INVALID')
    return windows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--transcript', required=True, type=Path)
    parser.add_argument('--frames-tsv', type=Path)
    parser.add_argument('images', nargs='+')
    args = parser.parse_args()
    try:
        print(encode({'transcript_window': windows_for(args.images, args.transcript, args.frames_tsv)}))
    except (OSError, ValueError) as error:
        parser.exit(2, str(error) + '\n')


if __name__ == '__main__':
    main()
