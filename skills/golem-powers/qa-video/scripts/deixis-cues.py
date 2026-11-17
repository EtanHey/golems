#!/usr/bin/env python3
"""SRT -> headerless t_s/start_s/end_s/reason/srt_index TSV (stdlib only).

The documented phrase list and conservative 'this' grammar are in
references/must-read.md. No transcript text is copied into the TSV.
"""
import re
import sys
from pathlib import Path

PHRASES = ("that one", "here", "right here", "over here", "where my mouse is",
           "where my cursor is", "I'm hovering", "hovering over", "as you can see",
           "look at", "see this", "pointing at")
PATTERN = re.compile(r'\b(?:' + '|'.join(re.escape(p) for p in PHRASES) + r')\b', re.I)
THIS = re.compile(r"\bthis\b(?=\s*(?:$|[,;:.!?]|(?:right\s+)?here\b|(?:that\s+)?I(?:'m| am)\s+(?:currently\s+)?(?:hovering|pointing)\b))", re.I)

def seconds(t):
    h, m, s = t.replace(',', '.').split(':')
    return int(h)*3600 + int(m)*60 + float(s)

def cues(text):
    result = []
    for block in re.split(r'\n\s*\n', text.replace('\r\n', '\n').strip()):
        match = re.fullmatch(r'\s*(\d+)\s*\n(\d\d:\d\d:\d\d[,.]\d+)\s*-->\s*(\d\d:\d\d:\d\d[,.]\d+)[^\n]*\n(.*)', block, re.S)
        if not match:
            if '-->' in block:
                raise ValueError('malformed SRT block')
            continue
        text = ' '.join(match[4].replace('’', "'").split())
        if not (PATTERN.search(text) or THIS.search(text)):
            continue
        start, end = seconds(match[2]), seconds(match[3])
        if end < start:
            raise ValueError('reversed SRT interval')
        result.append((f'{start:.3f}', f'{max(0, start-1):.3f}', f'{end+1:.3f}',
                       'deixis', match[1]))
    if len({r[4] for r in result}) != len(result):
        raise ValueError('duplicate SRT index')
    return result

if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('usage: deixis-cues.py <transcript.srt>')
        for row in cues(Path(sys.argv[1]).read_text(encoding='utf-8-sig')):
            print('\t'.join(row))
    except (OSError, ValueError) as e:
        sys.exit(str(e))
