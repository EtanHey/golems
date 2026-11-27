#!/usr/bin/env python3
"""Bounded concurrent visual reads; progress and findings survive partial runs."""
import argparse
import importlib.util
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import json
import math
import os
import random
import re
from pathlib import Path
import subprocess
import sys
import time
import tempfile

DEFAULT_DRAIN_SECONDS = 2.0

spec = importlib.util.spec_from_file_location('visual', Path(__file__).resolve().with_name('visual-gather.py'))
visual = importlib.util.module_from_spec(spec)
spec.loader.exec_module(visual)

def atomic(path, text):
    pending = path.with_suffix(path.suffix + '.new')
    pending.write_text(text)
    pending.replace(path)


def recover_startup_warning(result, sheet, started, existing):
    """Recover only the recorded Codex helper's exact warning-only rejection.

    The helper owns dispatch and keeps the unmodified provider stream. Never
    infer success from its footer or from an arbitrary error message.
    """
    if started is None or result.returncode != 2 or result.stdout.strip() != (
            'Coverage: 0/1; partial; NOT DETERMINED: helper failed.'):
        return None
    lines = result.stderr.splitlines()
    if len(lines) != 2 or not lines[0].startswith('HELPER_RECEIPT ') or lines[1] != (
            'ADAPTER_UNSUPPORTED: ValueError: ADAPTER_UNSUPPORTED or dispatch failed; inspect private helper receipt'):
        return None
    try:
        path = Path(lines[0].removeprefix('HELPER_RECEIPT '))
        directory = Path(sheet).resolve().parent / 'helper-receipts'
        if (path.is_symlink() or path.resolve().parent != directory.resolve()
                or path.resolve() in existing or path.stat().st_size > 2_000_000
                or path.stat().st_mtime_ns < started):
            return None
        receipt = json.loads(path.read_text())
        if (receipt['provider'] != 'codex' or receipt['exit_code'] != 0
                or receipt['images'] != [sheet] or receipt['tool_calls'] != ['error']):
            return None
        # Recorded cell helpers use cell/tmp or cell/work (when the caller
        # sets TMPDIR to its output directory, above its sheets directory).
        image = Path(sheet).resolve()
        cells = [root for root in image.parents
                 if image.is_relative_to(root / 'work') and (root / 'tmp').is_dir()]
        home = Path(receipt['codex_home'])
        if (len(cells) != 1 or not home.is_absolute() or not home.is_dir()
                or home.is_symlink() or home.name != 'codex-home'
                or not home.parent.name.startswith('reader-')):
            return None
        resolved_home = home.resolve()
        if not (resolved_home.is_relative_to(cells[0] / 'tmp')
                or resolved_home.is_relative_to(cells[0] / 'work')):
            return None
        warning = ('Under-development features enabled: skip_host_skill_discovery. '
                   'Under-development features are incomplete and may behave unpredictably. '
                   'To suppress this warning, set `suppress_unstable_features_warning = true` in '
                   + receipt['codex_home'] + '/config.toml.')
        events = receipt['provider_events']
        # Exact lifecycle: warning before the turn, one final response, no tools,
        # unknown events, additional errors, interrupted or failed turns.
        if [e['type'] for e in events] != ['thread.started', 'item.completed',
                'turn.started', 'item.completed', 'turn.completed']:
            return None
        if events[1]['item']['type'] != 'error' or events[1]['item']['message'] != warning:
            return None
        message = events[3]['item']
        if message['type'] != 'agent_message' or len(message['text']) > 2000:
            return None
        body = message['text'].strip()
        if body.startswith('```'):
            body = '\n'.join(body.splitlines()[1:-1])
        images = json.loads(body)['images']
        if len(images) != 1 or images[0]['path'] != sheet:
            return None
        finding = images[0]['finding']
        if (not isinstance(finding, str) or not visual.finding_is_read(finding)
                or any(t in finding.lower() for t in ('<truncated', 'stream was interrupted'))):
            return None
        return {'finding': sheet + ': ' + finding,
                'warnings': [warning], 'helper_receipt': str(path),
                'recovered_from': 'Codex startup warning; helper exit 2, provider exit 0'}
    except (OSError, ValueError, KeyError, TypeError, IndexError, AttributeError):
        return None


def read_sheet(helper, question, timeout, sheet, model=None, workdir=None, transcript_window=None, admission=None):
    started, existing = None, set()
    try:
        directory = Path(sheet).resolve().parent / 'helper-receipts'
        directory.mkdir(exist_ok=True)
        existing = {path.resolve() for path in directory.iterdir()}
        # Same-filesystem clock avoids skew; the snapshot excludes old receipts even on equal ticks.
        with tempfile.TemporaryFile(dir=directory) as marker:
            started = os.fstat(marker.fileno()).st_mtime_ns
    except OSError:
        started = None  # Disable recovery, but allow ordinary reads from read-only directories.
    try:
        result = visual.bounded_run([sys.executable, str(helper), '--question', question,
                                    '--timeout', str(timeout),
                                    *(['--model', model] if model else []),
                                    *(['--admission', str(admission)] if admission else []),
                                    *(['--transcript-window', visual.transcript.encode({sheet: transcript_window})]
                                      if transcript_window is not None else []), sheet], timeout)
    except (subprocess.TimeoutExpired, OverflowError) as error:
        cause = 'helper timeout' if isinstance(error, subprocess.TimeoutExpired) else str(error)
        context = visual.decoded(getattr(error, 'stderr', ''))
        fatal = visual.dispatch_stop(context)
        return dict(failed(sheet, fatal or cause), fatal=fatal)
    out, err = result.stdout, result.stderr
    recovered = recover_startup_warning(result, sheet, started, existing)
    if recovered:
        return dict(recovered, sheet=sheet, fatal='', ok=True, cause='', attempt=1)
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


def unquoted_screen_text(finding):
    # A quote cannot close on a later line. Word-internal inch marks and
    # apostrophes are not openers; a label's opening quote is not a closer.
    quoted = r'''(?<!\w)"(?:\\.|[^"\\])*"(?!\w)|(?<!\w)'(?:\\.|[^'\\])*'(?!\w)|“[^”]*”|‘[^’]*’|`[^`]*`'''
    return ''.join(re.sub(quoted, ' ', line) for line in finding.splitlines(keepends=True))


def reader_conflict(finding):
    unquoted = unquoted_screen_text(finding)
    return bool(re.search(r'\bCONFLICT\s*[:-]|(?m:^\s*CONFLICT\s*$)', unquoted))


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
    label = re.compile(r'\b(?:tiles?|frames?)\b(?:\(s\))?', re.I)
    number = r'\#?\s*(-?\d+)'
    word_number = (r'(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|'
                   r'eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|'
                   r'nineteen|twenty|thirty|forty|fifty|hundred|first|last|next|previous|'
                   r'second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|final)\b')
    span = re.compile(number + r'(?:\s*(?:\.\.|-|–|to)\s*' + number + r')?', re.I)
    finding = '\n'.join(line for line in item['finding'].splitlines()
                        if not line.startswith('Coverage:'))
    # The helper echoes its input path, which can itself contain "frames".
    # Remove that exact prefix (including spaces), then other path tokens.
    sheet = item.get('sheet', '')
    if sheet:
        finding = '\n'.join(line.removeprefix(sheet + ':') for line in finding.splitlines())
    finding = unquoted_screen_text(finding)
    finding = re.sub(r'''[^\s<>"'`]*[/\\][^\s<>"'`]*''',
                     lambda m: ' ' if re.search(r'[a-zA-Z_]', m[0]) else m[0], finding)
    finding = re.sub(r'\b[\w.-]+\.(?:jpe?g|png|gif|webp|bmp|heic|avif|tiff?)\b',
                     ' ', finding, flags=re.I)
    # Readers abbreviate tile indexes as T0 / T2-T19. Only citation-shaped
    # tokens qualify; an application name such as "T3 Code" remains prose.
    # These are indexes, never seconds, so no decoded-PTS lookup is involved.
    finding = re.sub(
        r'(?<![\w])T(-?\d+(?:\.\d+)?)(?:\s*(?:-|–|\.\.|to)\s*T?(-?\d+))?'
        r'(?=\s*(?:[:;,)./–-]|and\b|to\b|$))',
        lambda m: 'tile ' + m[1] + ('-' + m[2] if m[2] is not None else ''), finding)
    finding = re.sub(r'\b(tiles?|frames?)\s+(?=tile\s+-?\d)', '', finding, flags=re.I)
    for citation in label.finditer(finding):
        prefix = finding[:citation.start()]
        if re.search(r'\b(?:\d+(?:st|nd|rd|th)|first|last|next|previous|second|third|fourth|'
                     r'fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|'
                     r'fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|'
                     r'twentieth|final)\s*$', prefix, re.I):
            malformed = True
            continue
        tail = finding[citation.end():].lstrip()
        # A complete x/y pixel rectangle following the noun is geometry, not
        # an indexed citation. Require its end before punctuation/end-of-text;
        # whitespace cannot hide a following index, conjunction or range.
        # Only ordered lowercase x/y integer coordinates and -/– ranges are
        # accepted; uppercase, reversed axes, decimals and negative values fail
        # closed. Later frame/tile labels are still checked.
        if citation[0].lower().startswith('frame') and re.match(
                r':\s*x=\d+(?:[-–]\d+)?,\s*y=\d+(?:[-–]\d+)?(?=\s*(?:;|\.(?!\d)|$))', tail):
            continue
        # "20 tiles" describes a count, not index 20. A parenthesized range
        # still supplies indexes and must be checked, including 0..19 notation.
        if re.search(r'\b\d+\s*$', prefix):
            if re.match(r'\(\s*[-#\d]', tail):
                tail = tail[1:].lstrip()
            elif not re.match(r'[-#\d\[:]', tail):
                continue
        # Bare nouns at the end of a sentence are not indexed citations.
        if not tail or (tail.startswith((';', '.')) and not re.match(r'[;.]\s*\d', tail)):
            continue
        match = span.match(tail)
        if not match:
            # Ordinary nouns (frame rate, frames per second, tile layout) are
            # not citations. Punctuation after a bare tile noun is prose unless
            # it introduces an index. Still scan nested labels independently.
            attempt = r'[-#\d\[(:]|' + word_number
            if citation[0].lower().startswith('tile'):
                attempt = (r'[#\d\[]|' + word_number +
                           r'|[-(:]\s*(?:[-#\d\[]|x\s*=|' + word_number + r')')
            if re.match(attempt, tail, re.I):
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
                if re.match(r'\w|\s*(?:[-–/&+]|to\b|\.\.|[.]\d|\d|\#)', tail, re.I):
                    malformed = True
                break
            rest = tail[separator.end():]
            match = span.match(rest)
            if not match:
                # A comma/conjunction may introduce prose rather than an index.
                if re.match(r'[-#\d\[(:]|and\b|to\b|' + word_number, rest, re.I) or not rest.strip():
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
    conflict = reader_conflict(item['finding'].removeprefix(sheet + ':'))
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
    # Dispatch stops at deadline; allow only a separate cleanup grace after it.
    drain_deadline = deadline + getattr(args, 'drain_seconds', DEFAULT_DRAIN_SECONDS)
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

    admission_path = getattr(args, 'admission', None)
    run_id = None
    builtin = args.helper.resolve() == Path(__file__).resolve().with_name('claude-image-helper.py')
    try:
        if admission_path:
            admitted = visual.policy.validate(admission_path, sheets)
        else:
            visual.policy.begin(work)  # Every standalone invocation is a fresh run.
            admission_path = visual.policy.admit(work, sheets, getattr(args, 'price_per_sheet_usd', .10))
            admitted = visual.policy.validate(admission_path, sheets)
        run_id = admitted['run_id']
    except (ValueError, OSError, KeyError, TypeError) as error:
        status, cause = 'COST_HOLD', str(error)
    windows = {}
    try:
        windows = visual.transcript.from_args(args, sheets)
        if windows:
            atomic(work / 'visual/transcript-windows.json', visual.transcript.encode(windows) + '\n')
    except (OSError, ValueError) as error:
        status, cause = 'SETUP_FAILED', 'TRANSCRIPT_WINDOW_SETUP_FAILED: ' + visual.safe_cause(str(error), work)
    progress()
    if status == 'RUNNING' and args.helper.resolve() == Path(__file__).resolve().with_name('claude-image-helper.py') and not model:
        try:
            model = json.loads(visual.roles_file().read_text())['roles']['claude.subagent.cheap']['model']
            if not isinstance(model, str) or not model.strip():
                raise ValueError('claude.subagent.cheap model must be a concrete model ID')
        except (OSError, ValueError, KeyError, TypeError) as error:
            status, cause = 'SETUP_FAILED', 'CLAUDE_MODEL_SETUP_FAILED: ' + visual.safe_cause(str(error), work)
    if status == 'RUNNING' and args.helper.resolve() == Path(__file__).resolve().with_name('visual-gather.py') and not model:
        try:
            model = visual.resolve_model(deadline=deadline)[1]
        except (ValueError, OSError, subprocess.SubprocessError, visual.DispatchError) as error:
            status = ('DISPATCH_STOPPED' if isinstance(error, visual.DispatchError) else
                      'BUDGET_EXCEEDED' if time.monotonic() >= deadline else 'SETUP_FAILED')
            cause = visual.safe_cause(getattr(error, 'stderr', '') or str(error), work)
    pool = ThreadPoolExecutor(max_workers=args.concurrency)
    try:
        with (work / 'visual/findings.jsonl').open('a', buffering=1) as log:
            while launched < total or active:
                if status == 'RUNNING' and time.monotonic() >= deadline:
                    status = 'BUDGET_EXCEEDED'
                while status == 'RUNNING' and len(active) < args.concurrency and launched < total:
                    if time.monotonic() >= deadline:
                        status = 'BUDGET_EXCEEDED'
                        break
                    sheet = sheets[launched]
                    timeout = min(args.timeout, deadline - time.monotonic())
                    active[pool.submit(read_sheet, args.helper, args.question + (f' Valid zero-based tiles: 0..{counts[sheet]-1}.' if sheet in counts else ''), timeout, sheet, model, work, **({'transcript_window': windows[sheet]} if windows else {}), **({'admission': admission_path} if builtin else {}))] = sheet
                    launched += 1
                if not active:
                    break
                # Wake at the budget boundary; never start another wave after it.
                delay = max(0, (deadline if status == 'RUNNING' else drain_deadline) - time.monotonic())
                if time.monotonic() >= drain_deadline:
                    cause = cause or 'drain timeout'
                    break
                done, _ = wait(active, timeout=delay, return_when=FIRST_COMPLETED)
                for future in done:
                    sheet = active[future]
                    try:
                        item = future.result()
                    except OSError as error:
                        item = {'sheet': sheet, 'finding': 'NOT DETERMINED (helper launch failed)', 'fatal': '', 'ok': False,
                                'cause': visual.safe_cause(str(error), work), 'setup_failure': True}
                    active.pop(future)
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
                    return read_sheet(args.helper, question, timeout, item['sheet'], model, work, **({'transcript_window': windows[item['sheet']]} if windows else {}), **({'admission': admission_path} if builtin else {}))
                item = retry_read(read, args.question, counts.get(item['sheet']), deadline,
                                  args.timeout, previous=item)
                findings[i] = item
                log.write(json.dumps(item)+'\n')
                if item['fatal']:
                    status, cause = 'DISPATCH_STOPPED', item['fatal']
                progress()
    except BaseException as error:
        status, cause = 'FAILED', visual.safe_cause(str(error), work)
        raise
    finally:
        # Do not let executor context-manager shutdown undo the drain bound.
        for future, sheet in active.items():
            future.cancel()
            findings.append(failed(sheet, cause or 'batch interrupted'))
        pool.shutdown(wait=False, cancel_futures=True)
        retrying = False
        if status == 'RUNNING' and time.monotonic() >= deadline:
            status = 'BUDGET_EXCEEDED'
        if status == 'RUNNING':
            status = 'PARTIAL' if any(not f['ok'] for f in findings) else 'COMPLETE'
        unread = [{'sheet': s, 'finding': 'NOT DETERMINED (not read: ' + status + ')', 'cause': cause, 'state': 'NOT_READ', 'attempts': 0, 'ok': False} for s in sheets[launched:]]
        states = {state: sum(f['state'] == state for f in findings + unread) for state in ('READ', 'INVALID', 'FAILED', 'NOT_READ')}
        visual_error = ''
        if not states['READ'] and status != 'COST_HOLD':
            if status == 'PARTIAL':
                status = 'NO_FRAMES_READ'
            visual_error = 'TOOLING FAILURE: no frames were read (no frames read); STOP, no QA verdict'
        summary = {'run_id': run_id, 'visual_error': visual_error, 'verdict_allowed': states['READ'] > 0, 'counts': states, 'covered': f"{states['READ']}/{total}", 'sheets': findings + unread, 'status': status, 'cause': cause, 'completed': completed,
                   'total': total, 'concurrency': args.concurrency, 'unread': unread,
                   'unresolved': [f for f in findings if not f['ok']]}
        atomic(work / 'visual/summary.json', json.dumps(summary, indent=2) + '\n')
        progress()
        print(json.dumps(summary))
        if visual_error:
            print(visual_error, file=sys.stderr)
        if cause:
            print(cause, file=sys.stderr)
    return 0 if status == 'COMPLETE' else 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--price-per-sheet-usd', type=float, default=0.10,
                        help='Planning allowance per sheet including retry; stop above $5')
    parser.add_argument('--admission', type=Path, default=os.environ.get('QA_VIDEO_ADMISSION'),
                        help='Whole-run cost admission created by default.sh plan/admit')
    parser.add_argument('--index', type=Path)
    parser.add_argument('--question', required=True)
    parser.add_argument('--workdir', required=True, type=Path)
    parser.add_argument('--concurrency', type=int, default=3)
    parser.add_argument('--budget-seconds', type=float, default=480)
    parser.add_argument('--drain-seconds', type=float, default=DEFAULT_DRAIN_SECONDS,
                        help='Cleanup grace after dispatch budget; no new reads start here')
    parser.add_argument('--timeout', type=float, default=90)
    parser.add_argument('--progress-prefix', default='', help='Parent phase context for progress.txt')
    parser.add_argument('--model', help='Already resolved concrete model ID')
    parser.add_argument('--helper', type=Path, default=Path(__file__).with_name('claude-image-helper.py'),
                        help='Default: tool-free Claude reader; visual-gather.py is explicit Gemini only')
    visual.transcript.add_arguments(parser)
    parser.add_argument('sheets', nargs='*', type=Path)
    args = parser.parse_args()
    if not (0 < args.drain_seconds < float('inf') and args.concurrency > 0 and 0 < args.budget_seconds < float('inf') and 0 < args.timeout <= visual.MAX_TIMEOUT):
        parser.error(f'positive concurrency/budget/drain and timeout <={visual.MAX_TIMEOUT:g} required')
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
