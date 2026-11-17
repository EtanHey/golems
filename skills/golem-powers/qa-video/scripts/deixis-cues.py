#!/usr/bin/env python3
"""Budgeted deixis cues: t_s/start_s/end_s/strength/srt_index TSV, stdlib only."""
import argparse
import json
import math
import re
import sys
from pathlib import Path

STRONG = re.compile(r'\b(?:hovering|hover over|my mouse|my cursor|under my cursor|pointing (?:at|to)|right here|right there|this one|that one)\b', re.I)
WEAK = re.compile(r'\b(?:look at this|see this|see how|as you can see|look at|this|here)\b', re.I)
NEGATIVE = re.compile(r"\b(?:here's the thing|here we go|here you go|as you can see in the docs|look at the docs later|I(?:'ll| will) fix this|what is this|so this(?=[.!?]|$)|it's here in the code)\b", re.I)
DEFECT = re.compile(r"\b(?:issue|bug|broken|wrong|doesn't|should)\b", re.I)

def seconds(t):
    h, m, s = t.replace(',', '.').split(':')
    return int(h)*3600 + int(m)*60 + float(s)

def segments(text):
    result = []
    for block in re.split(r'\n\s*\n', text.replace('\r\n', '\n').strip()):
        match = re.fullmatch(r'\s*(\d+)\s*\n(\d\d:\d\d:\d\d[,.]\d+)\s*-->\s*(\d\d:\d\d:\d\d[,.]\d+)[^\n]*\n(.*)', block, re.S)
        if not match:
            if '-->' in block:
                raise ValueError('malformed SRT block')
            continue
        start, end = seconds(match[2]), seconds(match[3])
        if end < start:
            raise ValueError('reversed SRT interval')
        result.append((match[1], start, end, ' '.join(match[4].replace('’', "'").split())))
    if len({r[0] for r in result}) != len(result):
        raise ValueError('duplicate SRT index')
    return result

def word_times(data):
    """OpenAI words/segments and whisper.cpp full-JSON tokens/offsets."""
    found = []
    def walk(value):
        if isinstance(value, dict):
            word = value.get('word', value.get('text'))
            stamp = value.get('start')
            if stamp is None and 'offsets' in value:
                stamp = value['offsets'].get('from')
                stamp = stamp/1000 if isinstance(stamp, (int, float)) else None
            if stamp is None and 'timestamps' in value:
                raw = value['timestamps'].get('from')
                stamp = seconds(raw) if isinstance(raw, str) else None
            if word and stamp is not None and not any(k in value for k in ('words', 'tokens')):
                stamp = float(stamp)
                if not math.isfinite(stamp) or stamp < 0:
                    raise ValueError('invalid word timestamp')
                found.append((str(word).strip().lower(), stamp))
            for key in ('words', 'tokens', 'segments', 'transcription'):
                if key in value:
                    walk(value[key])
        elif isinstance(value, list):
            for v in value:
                walk(v)
    walk(data)
    return sorted(set(found), key=lambda r: r[1])

def analyze(text, words=None):
    subs = segments(text)
    words = word_times(words) if words else []
    candidates, defects = [], []
    for index, start, end, line in subs:
        estimate = lambda pos: start + (end-start)*pos/max(1, len(line))
        defects.extend(estimate(m.start()) for m in DEFECT.finditer(line))
        strong = list(STRONG.finditer(line))
        negative = list(NEGATIVE.finditer(line))
        matches = [(m, 'strong') for m in strong]
        for m in WEAK.finditer(line):
            if strong:
                continue  # Explicit pointer language determines this subtitle's targets.
            if any(m.start() < n.end() and m.end() > n.start() for n in strong+negative):
                continue
            tail = line[m.end():]
            if m[0].lower() == 'this' and re.match(r'\s+\w', tail):
                continue
            if m[0].lower() == 'here' and tail.strip() and not re.match(r'\s*[,.;:!?]', tail) and not re.search(r'\bover\s*$', line[:m.start()], re.I):
                continue
            matches.append((m, 'weak'))
        for m, strength in matches:
            t = estimate(m.start())
            token = re.findall(r"[\w']+", m[0].lower())[0]
            nearby = [stamp for word, stamp in words if start <= stamp <= end
                      and token in re.findall(r"[\w']+", word)]
            if nearby:
                t = min(nearby, key=lambda stamp: abs(stamp-t))
            candidates.append({'t': t, 'start': max(0, start-1), 'end': end+1,
                               'strength': strength, 'index': index})
    # Each cluster spans <=3s from its first cue; avoid transitive unbounded merges.
    groups = []
    for cue in sorted(candidates, key=lambda c: c['t']):
        if groups and cue['t']-groups[-1][0]['t'] <= 3:
            groups[-1].append(cue)
        else:
            groups.append([cue])
    merged = []
    for group in groups:
        representative = next((c for c in group if c['strength'] == 'strong'), group[0])
        merged.append({**representative, 'start': min(c['start'] for c in group),
                       'end': max(c['end'] for c in group)})
    duration = max((r[2] for r in subs), default=0)-min((r[1] for r in subs), default=0)
    cap = max(6, math.ceil(duration/120))
    weak = sorted((c for c in merged if c['strength'] == 'weak'),
                  key=lambda c: (min((abs(c['t']-t) for t in defects), default=float('inf')), c['t']))
    selected = {id(c) for c in weak[:cap]}
    rows = [(f'{c["t"]:.3f}', f'{c["start"]:.3f}', f'{c["end"]:.3f}',
             c['strength'] if c['strength'] == 'strong' or id(c) in selected else 'weak-overflow', c['index'])
            for c in sorted(merged, key=lambda c: c['t'])]
    return rows, {'strong': sum(r[3] == 'strong' for r in rows), 'weak': len(weak),
                  'judge_read': sum(r[3] != 'weak-overflow' for r in rows),
                  'overflow': sum(r[3] == 'weak-overflow' for r in rows), 'weak_cap': cap}

def cues(text, words=None):
    return analyze(text, words)[0]

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('srt', type=Path)
    parser.add_argument('--words', type=Path)
    parser.add_argument('--stats', action='store_true')
    args = parser.parse_args()
    try:
        rows, stats = analyze(args.srt.read_text(encoding='utf-8-sig'),
                              json.loads(args.words.read_text()) if args.words else None)
        if args.stats:
            print(json.dumps(stats))
        else:
            for row in rows:
                print('\t'.join(row))
    except (OSError, ValueError) as e:
        parser.exit(2, str(e)+'\n')
