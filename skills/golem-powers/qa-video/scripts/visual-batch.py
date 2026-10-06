#!/usr/bin/env python3
"""Bounded concurrent visual reads; progress and findings survive partial runs."""
import argparse
import importlib.util
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import json
import math
import os
from pathlib import Path
import signal
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
    process = subprocess.Popen([sys.executable, str(helper), '--question', question,
                                '--timeout', str(timeout), *(['--model', model] if model else []), sheet],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, start_new_session=True)
    try:
        out, err = process.communicate(timeout=2 * (timeout + 15) + 50)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        out, err = process.communicate()
        return {'sheet': sheet, 'finding': 'NOT DETERMINED (helper timeout)', 'fatal': '', 'ok': False,
                'cause': 'helper timeout', 'setup_failure': False}
    fatal = next((s for s in err.splitlines() if s.startswith('DISPATCH_STOPPED:')), '')
    complete = process.returncode == 0 and 'Coverage: 1/1; complete;' in out
    return {'sheet': sheet, 'finding': out.strip() if complete else
            'NOT DETERMINED (helper failed or partial)\n' + out.strip(), 'fatal': fatal, 'ok': complete and not fatal,
            'cause': visual.safe_cause(err, workdir or '.') if not complete or fatal else '',
            'setup_failure': not complete and not fatal and 'NOT DETERMINED: setup failed' in out, 'attempt': 1}


def run(args, sheets):
    work = args.workdir.resolve()
    (work / 'visual').mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    deadline = started + args.budget_seconds
    total, completed, launched = len(sheets), 0, 0
    status, cause, eta = 'RUNNING', '', None
    findings, active = [], {}
    model, retrying = getattr(args, 'model', None), False

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
               f'budget {args.budget_seconds/60:g}m · {status}' + (' · serial setup retry' if retrying else '') + '\n')

    progress()
    if args.helper.resolve() == Path(__file__).resolve().with_name('visual-gather.py') and not model:
        try:
            model = visual.resolve_model()[1]
        except (ValueError, OSError, subprocess.SubprocessError, visual.DispatchError) as error:
            status = 'DISPATCH_STOPPED' if isinstance(error, visual.DispatchError) else 'SETUP_FAILED'
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
                    timeout = max(10, min(args.timeout, deadline - time.monotonic() + 30))
                    active[pool.submit(read_sheet, args.helper, args.question, timeout, sheet, model, work)] = sheet
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
                    findings.append(item)
                    log.write(json.dumps(item) + '\n')
                    completed += 1
                    if item['fatal']:
                        status, cause = 'DISPATCH_STOPPED', item['fatal']
                    progress()
        # Drain concurrent calls first; retry only setup failures, once, serially.
        for i, item in enumerate(findings):
            if status != 'RUNNING' or time.monotonic() >= deadline:
                break
            if not item.get('setup_failure'):
                continue
            retrying = True
            progress()
            timeout = max(10, min(args.timeout, deadline-time.monotonic()+30))
            try:
                item = read_sheet(args.helper, args.question, timeout, item['sheet'], model, work)
            except OSError as error:
                item = dict(item, cause=visual.safe_cause(str(error), work))
            item['attempt'] = 2
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
    unread = [{'sheet': s, 'finding': 'NOT DETERMINED (not read: ' + status + ')', 'cause': cause} for s in sheets[launched:]]
    summary = {'status': status, 'cause': cause, 'completed': completed,
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
