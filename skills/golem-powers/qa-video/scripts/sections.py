#!/usr/bin/env python3
"""Reconcile transcript topic intervals with scored visual cuts (stdlib only)."""
import argparse
import csv
import io
import math
from pathlib import Path
import sys

DRAFT = 'id start_s end_s topic why'.split()
FINAL = DRAFT + 'boundary_source cut_pts_s cut_score'.split()


def fail(name, detail):
    raise ValueError(f'{name}: {detail}')


def number(value):
    try:
        n = float(value)
        if math.isfinite(n):
            return n
    except (ValueError, TypeError):
        pass
    fail('INVALID_NUMBER', str(value))


def read(path, fields):
    with Path(path).open() as stream:
        data = list(csv.reader(stream, delimiter='\t'))
    if data and data[0] == fields:
        data = data[1:]
    if any(len(row) != len(fields) for row in data):
        fail('INVALID_COLUMNS', str(path))
    return [dict(zip(fields, row)) for row in data]


def validate(rows, duration):
    if not rows:
        fail('EMPTY_SECTIONS', 'at least one subject required')
    ids = [r['id'] for r in rows]
    if any(not i for i in ids) or len(set(ids)) != len(ids):
        fail('INVALID_ID', 'empty or duplicate section id')
    for r in rows:
        if not 0 <= r['start_s'] < r['end_s'] <= duration:
            fail('INVALID_INTERVAL', r['id'])
    if rows[0]['start_s'] != 0 or rows[-1]['end_s'] != duration:
        fail('COVERAGE', 'sections must cover [0, duration]')
    for left, right in zip(rows, rows[1:]):
        if left['end_s'] != right['start_s']:
            fail('GAP' if left['end_s'] < right['start_s'] else 'OVERLAP', right['id'])


def mark(row, cut=None):
    row.update(boundary_source='cut' if cut else 'transcript',
               cut_pts_s=cut[0] if cut else '', cut_score=cut[1] if cut else '')


def strongest(cuts):
    return max(cuts, key=lambda c: (c[1], -c[0]), default=None)


def reconcile(rows, cuts, duration, window, maximum, minimum):
    validate(rows, duration)
    # Preserve the runner's topic boundaries for temporal merge decisions.
    for r in rows:
        r['topic_start'], r['topic_end'] = r['start_s'], r['end_s']
        mark(r)
    for left, right in zip(rows, rows[1:]):
        cut = strongest(c for c in cuts if c[1] > 0 and
                        abs(c[0]-right['topic_start']) <= window and 0 < c[0] < duration)
        if cut:
            left['end_s'] = right['start_s'] = cut[0]
            mark(right, cut)
    validate(rows, duration)  # Crossing snaps are errors, never silently reordered.
    while len(rows) > 1:
        i = next((i for i, r in enumerate(rows) if r['end_s']-r['start_s'] < minimum), None)
        if i is None:
            break
        r = rows[i]
        midpoint = (r['start_s']+r['end_s'])/2
        left = i > 0 and (i == len(rows)-1 or
                         abs(midpoint-r['topic_start']) <= abs(midpoint-r['topic_end']))
        a, b = (rows[i-1], r) if left else (r, rows[i+1])
        target = a if left else b
        target['topic'] = a['topic']+' | '+b['topic']
        target['why'] = a['why']+' | '+b['why']
        target['start_s'], target['end_s'] = a['start_s'], b['end_s']
        target['topic_start'], target['topic_end'] = a['topic_start'], b['topic_end']
        if not left:
            target.update({k: a[k] for k in FINAL[5:]})
        rows.pop(i)
    # Iterate rather than recurse: long recordings need no recursion-limit exception.
    i, serial, used = 0, 2, {r['id'] for r in rows}
    while i < len(rows):
        r = rows[i]
        if r['end_s']-r['start_s'] <= maximum:
            i += 1
            continue
        cut = strongest(c for c in cuts if c[1] > 0 and
                        r['start_s']+minimum <= c[0] <= r['end_s']-minimum and
                        r['start_s'] < c[0] < r['end_s'])
        if not cut:
            fail('LONG_SECTION_NO_CUT', r['id'])
        while f"{r['id']}.{serial}" in used:
            serial += 1
        ident = f"{r['id']}.{serial}"
        used.add(ident)
        tail = dict(r, id=ident, start_s=cut[0])
        mark(tail, cut)
        r['end_s'] = cut[0]
        rows.insert(i+1, tail)
    validate(rows, duration)
    return rows


def override(rows, changes, duration):
    by_id = {r['id']: i for i, r in enumerate(rows)}
    boundaries, seen, log = {}, set(), []
    for change in changes:
        ident = change['id']
        if ident not in by_id or ident in seen:
            fail('INVALID_OVERRIDE_ID', ident)
        seen.add(ident)
        i = by_id[ident]
        start, end = (number(change[k]) for k in ('start_s', 'end_s'))
        if start >= end:
            fail('INVALID_INTERVAL', ident)
        for j, value in ((i, start), (i+1, end)):
            if j in boundaries and boundaries[j] != value:
                fail('OVERRIDE_CONFLICT', ident)
            boundaries[j] = value
        log.append(f"{ident}\t{rows[i]['start_s']}\t{rows[i]['end_s']}\t{start}\t{end}\n")
    for j, value in boundaries.items():
        if j:
            rows[j-1]['end_s'] = value
        if j < len(rows):
            if rows[j]['start_s'] != value:
                mark(rows[j])
            rows[j]['start_s'] = value
    validate(rows, duration)
    return log


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('draft', help='runner-written sections TSV (five columns)')
    parser.add_argument('cuts', help='cut-pass cuts.tsv')
    parser.add_argument('duration')
    parser.add_argument('--snap-window', default=2)
    parser.add_argument('--max-section', default=90)
    parser.add_argument('--min-section', default=3)
    parser.add_argument('--overrides')
    parser.add_argument('--out', help='default: sections.tsv beside draft')
    args = parser.parse_args()
    for key in ('duration', 'snap_window', 'max_section', 'min_section'):
        setattr(args, key, number(getattr(args, key)))
    if args.duration <= 0 or args.snap_window < 0 or not 0 <= args.min_section < args.max_section:
        fail('INVALID_THRESHOLDS', 'duration/max > 0; window/min >= 0; min < max')
    rows = read(args.draft, DRAFT)
    for r in rows:
        for k in ('start_s', 'end_s'):
            r[k] = number(r[k])
    cuts = [(number(r['pts_s']), number(r['score'])) for r in read(args.cuts, ['pts_s', 'score'])]
    if any(not 0 <= t < args.duration or not 0 <= s <= 1 for t, s in cuts) or any(
            a[0] >= b[0] for a, b in zip(cuts, cuts[1:])):
        fail('INVALID_CUTS', 'ordered unique PTS within duration; score in [0,1]')
    rows = reconcile(rows, cuts, args.duration, args.snap_window, args.max_section, args.min_section)
    log = override(rows, read(args.overrides, DRAFT[:3]), args.duration) if args.overrides else []
    output = Path(args.out) if args.out else Path(args.draft).with_name('sections.tsv')
    text = io.StringIO()
    writer = csv.DictWriter(text, FINAL, delimiter='\t', lineterminator='\n', extrasaction='ignore')
    writer.writeheader()
    writer.writerows(rows)
    if log:
        with (output.parent/'sections-overrides.log').open('a') as stream:
            stream.writelines(log)
    output.write_text(text.getvalue())
    print(text.getvalue(), end='')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        sys.exit('sections: '+str(error))
