#!/usr/bin/env python3
"""Bounded concurrent visual reads; progress and findings survive partial runs."""
import argparse
import importlib.util
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import json
import math
import random
import re
from pathlib import Path
import subprocess
import sys
import time

spec = importlib.util.spec_from_file_location('visual', Path(__file__).resolve().with_name('visual-gather.py'))
visual = importlib.util.module_from_spec(spec)
spec.loader.exec_module(visual)

def atomic(path, text):
    pending = path.with_suffix(path.suffix + '.new')
    pending.write_text(text)
    pending.replace(path)


def read_sheet(helper, question, timeout, sheet, model=None, workdir=None):
    try:
        result = visual.bounded_run([sys.executable, str(helper), '--question', question,
                                    '--timeout', str(timeout),
                                    *(['--model', model] if model else []), sheet], timeout)
    except (subprocess.TimeoutExpired, OverflowError) as error:
        cause = 'helper timeout' if isinstance(error, subprocess.TimeoutExpired) else str(error)
        context = visual.decoded(getattr(error, 'stderr', ''))
        fatal = visual.dispatch_stop(context)
        return dict(failed(sheet, fatal or cause), fatal=fatal)
    out, err = result.stdout, result.stderr
    fatal = next((s for s in err.splitlines() if s.startswith('DISPATCH_STOPPED:')), '')
    complete = (result.returncode == 0 and 'Coverage: 1/1; complete;' in out
                and len(out.strip().splitlines()) > 1
                and not any(token in out.lower() for token in ('<truncated', 'stream was interrupted')))
    return {'sheet': sheet, 'finding': out.strip() if complete else
            'NOT DETERMINED (helper failed or partial)\n' + out.strip(), 'fatal': fatal, 'ok': complete and not fatal,
            'cause': ('exit ' + str(result.returncode) + ': ' if result.returncode else 'empty or truncated output: ') + visual.safe_cause(err, workdir or '.') if not complete or fatal else '',
            'setup_failure': not complete and not fatal and 'NOT DETERMINED: setup failed' in out, 'attempt': 1}


def failed(sheet, cause):
    return dict(sheet=sheet, finding='NOT DETERMINED', fatal='', ok=False,
                state='FAILED', cause=cause, offending_indexes=[])


def citation_number(token):
    if len(token.lstrip('-')) > 9:
        raise ValueError('numeric citation exceeds 9 digits')
    return int(token)


def validate(item, tile_count):
    if item.get('fatal'):
        return dict(item, state='FAILED', ok=False, cause=item['fatal'], offending_indexes=[])
    try:
        return validate_citations(item, tile_count)
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        return failed(item.get('sheet', ''), 'malformed output: ' + str(error))


def validate_citations(item, tile_count):
    bad, intervals = set(), []
    malformed = False
    # Read a complete numeric expression after each tile/frame label. Lists may
    # contain ranges, optional hashes and Oxford commas. Indexing stays zero-based.
    label = re.compile(r'\b(?:tiles?|frames?)\b', re.I)
    number = r'\#?\s*(-?\d+)'
    span = re.compile(number + r'(?:\s*(?:-|–|to)\s*' + number + r')?', re.I)
    finding = '\n'.join(line for line in item['finding'].splitlines()
                        if not line.startswith('Coverage:'))
    for citation in label.finditer(finding):
        prefix = finding[:citation.start()]
        if re.search(r'\b(?:\d+(?:st|nd|rd|th)|first|last|next|previous|second|third|final)\s*$', prefix, re.I):
            malformed = True
            continue
        tail = finding[citation.end():].lstrip()
        # Bare nouns at the end of a sentence are not indexed citations.
        if not tail or (tail.startswith((';', '.')) and not re.match(r'[;.]\s*\d', tail)):
            continue
        match = span.match(tail)
        if not match:
            malformed = True
            continue
        while match:
            lo = citation_number(match[1])
            hi = citation_number(match[2]) if match[2] is not None else lo
            if hi < lo:
                malformed = True
                break
            intervals.append((lo, hi))
            tail = tail[match.end():]
            separator = re.match(r'\s*(?:,\s*(?:and\s+)?|and\s+)', tail, re.I)
            if not separator:
                # An unfinished range, decimal or malformed numeric token fails closed.
                if re.match(r'\w|\s*(?:[-–/&+]|to\b|[.]\d|\d|\#)', tail, re.I):
                    malformed = True
                break
            rest = tail[separator.end():]
            match = span.match(rest)
            if not match:
                malformed = True
                break
            tail = rest
    if intervals and tile_count is None:
        return dict(item, state='FAILED', ok=False, offending_indexes=[], cause='tile count unavailable')
    offending_intervals = []
    for lo, hi in intervals:
        for start, end in ((lo, min(hi, -1)), (max(lo, tile_count or 0), hi)):
            if start <= end:
                offending_intervals.append([start, end])
                # Small violations list every index. Huge intervals remain exact
                # intervals without allocating billions of Python integers.
                if end - start < 1000:
                    bad.update(range(start, end + 1))
    conflict = bool(re.search(r'\bCONFLICT\b', item['finding']))
    invalid = bool(offending_intervals or malformed or conflict)
    state = 'INVALID' if invalid else ('READ' if item['ok'] else 'FAILED')
    cause = ('unparseable tile/frame citation' if malformed else
             'out-of-bounds tiles: ' + str(offending_intervals) if offending_intervals else
             'conflicting read' if conflict else item.get('cause', ''))
    return dict(item, state=state, ok=state == 'READ', offending_indexes=sorted(bad),
                offending_intervals=offending_intervals, cause=cause)


def retry_read(read, question, tile_count, deadline, timeout, *, clock=None,
               sleep=time.sleep, jitter=random.random, previous=None):
    clock = clock or time.monotonic
    history = list(previous.get('history', [])) if previous else []
    item = previous
    for attempt in range(len(history) + 1, 3):
        if history:
            delay = .25 * 2 ** (attempt - 2) + jitter() * .1
            if clock() + delay >= deadline:
                break
            sleep(delay)
        remaining = deadline - clock()
        if remaining <= 0:
            break
        bound = f' Tile indexes are zero-based; valid range 0..{tile_count-1}.' if tile_count else ''
        try:
            item = validate(read(question + bound, min(timeout, remaining)), tile_count)
        except OSError as error:
            item = failed(previous['sheet'] if previous else '', visual.safe_cause(str(error), '.'))
        history.append({'attempt': attempt, 'state': item['state'], 'cause': item.get('cause', '')})
        if item['ok'] or item.get('fatal'):
            break
    if not history:
        return dict(state='NOT_READ', ok=False, finding='NOT DETERMINED (budget)', fatal='',
                    cause='budget', attempts=0, history=[])
    return dict(item, attempts=len(history), attempt=len(history), history=history)


def tile_counts(index, sheets):
    counts = {}
    sources = {Path(s).parent / 'index.tsv' for s in sheets}
    if index:
        sources.add(index)
    for source in sources:
        if not source.is_file():
            continue
        for row in source.read_text().splitlines():
            cols = row.split('\t')
            if len(cols) >= 4 and cols[3].isdigit():
                counts[str((source.parent / cols[0]).resolve())] = int(cols[3])
    for directory in {Path(s).parent for s in sheets}:
        frames = directory / 'frames.tsv'
        if not frames.is_file():
            continue
        grouped = {}
        for row in frames.read_text().splitlines():
            cols = row.split('\t')
            if len(cols) >= 2 and cols[1].isdigit():
                grouped.setdefault(str((directory / cols[0]).resolve()), set()).add(int(cols[1]))
        for sheet, tiles in grouped.items():
            if tiles == set(range(len(tiles))):
                counts[sheet] = len(tiles)
    return counts


def run(args, sheets):
    work = args.workdir.resolve()
    (work / 'visual').mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    deadline = started + args.budget_seconds
    total, completed, launched = len(sheets), 0, 0
    status, cause, eta = 'RUNNING', '', None
    findings, active = [], {}
    model, retrying = getattr(args, 'model', None), False
    counts = tile_counts(getattr(args, 'index', None), sheets)

    def progress():
        nonlocal eta
        elapsed = time.monotonic() - started
        eta = elapsed / completed * (total - completed) if completed and not retrying else None
        state = {'status': status, 'completed': completed, 'total': total,
                 'elapsed_seconds': round(elapsed, 3), 'eta_seconds': eta,
                 'budget_seconds': args.budget_seconds, 'concurrency': args.concurrency}
        atomic(work / 'progress.json', json.dumps(state) + '\n')
        remaining = '~%ss' % math.ceil(eta) if eta is not None else 'unknown'
        atomic(work / 'progress.txt', getattr(args, 'progress_prefix', '') + f'visual {completed}/{total} sheets · elapsed '
               f'{int(elapsed)//60}m{int(elapsed)%60:02d}s · ETA {remaining} · '
               f'budget {args.budget_seconds/60:g}m · {status}' + (' · serial retry' if retrying else '') + '\n')

    progress()
    if args.helper.resolve() == Path(__file__).resolve().with_name('visual-gather.py') and not model:
        try:
            model = visual.resolve_model(deadline=deadline)[1]
        except (ValueError, OSError, subprocess.SubprocessError, visual.DispatchError) as error:
            status = ('DISPATCH_STOPPED' if isinstance(error, visual.DispatchError) else
                      'BUDGET_EXCEEDED' if time.monotonic() >= deadline else 'SETUP_FAILED')
            cause = visual.safe_cause(getattr(error, 'stderr', '') or str(error), work)
    with (work / 'visual/findings.jsonl').open('a', buffering=1) as log:
        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            while launched < total or active:
                if status == 'RUNNING' and time.monotonic() >= deadline:
                    status = 'BUDGET_EXCEEDED'
                while status == 'RUNNING' and len(active) < args.concurrency and launched < total:
                    if time.monotonic() >= deadline:
                        status = 'BUDGET_EXCEEDED'
                        break
                    sheet = sheets[launched]
                    timeout = min(args.timeout, deadline - time.monotonic())
                    active[pool.submit(read_sheet, args.helper, args.question + (f' Valid zero-based tiles: 0..{counts[sheet]-1}.' if sheet in counts else ''), timeout, sheet, model, work)] = sheet
                    launched += 1
                if not active:
                    break
                # Wake at the budget boundary; never start another wave after it.
                delay = max(0, deadline - time.monotonic()) if status == 'RUNNING' else None
                done, _ = wait(active, timeout=delay, return_when=FIRST_COMPLETED)
                for future in done:
                    sheet = active.pop(future)
                    try:
                        item = future.result()
                    except OSError as error:
                        item = {'sheet': sheet, 'finding': 'NOT DETERMINED (helper launch failed)', 'fatal': '', 'ok': False,
                                'cause': visual.safe_cause(str(error), work), 'setup_failure': True}
                    item = validate(item, counts.get(sheet))
                    item['attempts'] = 1
                    item['history'] = [{'attempt': 1, 'state': item['state'], 'cause': item.get('cause', '')}]
                    findings.append(item)
                    log.write(json.dumps(item) + '\n')
                    completed += 1
                    if item['fatal']:
                        status, cause = 'DISPATCH_STOPPED', item['fatal']
                    progress()
        # Drain concurrent calls, then retry failures once with bounded backoff.
        for i, item in enumerate(findings):
            if status != 'RUNNING' or time.monotonic() >= deadline:
                break
            if item['ok']:
                continue
            retrying = True
            progress()
            def read(question, timeout):
                return read_sheet(args.helper, question, timeout, item['sheet'], model, work)
            item = retry_read(read, args.question, counts.get(item['sheet']), deadline,
                              args.timeout, previous=item)
            findings[i] = item
            log.write(json.dumps(item)+'\n')
            if item['fatal']:
                status, cause = 'DISPATCH_STOPPED', item['fatal']
            progress()
    retrying = False
    if status == 'RUNNING' and time.monotonic() >= deadline:
        status = 'BUDGET_EXCEEDED'
    if status == 'RUNNING':
        status = 'PARTIAL' if any(not f['ok'] for f in findings) else 'COMPLETE'
    unread = [{'sheet': s, 'finding': 'NOT DETERMINED (not read: ' + status + ')', 'cause': cause, 'state': 'NOT_READ', 'attempts': 0, 'ok': False} for s in sheets[launched:]]
    states = {state: sum(f['state'] == state for f in findings + unread) for state in ('READ', 'INVALID', 'FAILED', 'NOT_READ')}
    summary = {'counts': states, 'covered': f"{states['READ']}/{total}", 'sheets': findings + unread, 'status': status, 'cause': cause, 'completed': completed,
               'total': total, 'concurrency': args.concurrency, 'unread': unread,
               'unresolved': [f for f in findings if not f['ok']]}
    atomic(work / 'visual/summary.json', json.dumps(summary, indent=2) + '\n')
    progress()
    print(json.dumps(summary))
    if cause:
        print(cause, file=sys.stderr)
    return 0 if status == 'COMPLETE' else 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--index', type=Path)
    parser.add_argument('--question', required=True)
    parser.add_argument('--workdir', required=True, type=Path)
    parser.add_argument('--concurrency', type=int, default=3)
    parser.add_argument('--budget-seconds', type=float, default=480)
    parser.add_argument('--timeout', type=float, default=90)
    parser.add_argument('--progress-prefix', default='', help='Parent phase context for progress.txt')
    parser.add_argument('--model', help='Already resolved concrete model ID')
    parser.add_argument('--helper', type=Path, default=Path(__file__).with_name('visual-gather.py'))
    parser.add_argument('sheets', nargs='*', type=Path)
    args = parser.parse_args()
    if not (args.concurrency > 0 and 0 < args.budget_seconds < float('inf') and 0 < args.timeout <= 120):
        parser.error('positive concurrency/budget and timeout <=120 required')
    if bool(args.index) == bool(args.sheets):
        parser.error('supply either --index index.tsv or a list of sheets')
    if args.concurrency > 4:
        print('WARNING: concurrency hard cap is 4', file=sys.stderr)
        args.concurrency = 4
    sheets = args.sheets
    if args.index:
        sheets = [args.index.parent / row.split('\t')[0] for row in args.index.read_text().splitlines()
                  if row and row.split('\t')[0] not in ('sheet_file', 'sheet') and not row.startswith('#')]
    sheets = list(dict.fromkeys(str(p.resolve()) for p in sheets))
    if not sheets or any(not Path(p).is_file() for p in sheets) or not args.helper.is_file():
        parser.error('all sheets and helper must exist; index must be nonempty')
    return run(args, sheets)


if __name__ == '__main__':
    sys.exit(main())
