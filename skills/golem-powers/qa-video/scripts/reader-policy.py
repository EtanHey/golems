#!/usr/bin/env python3
"""Run-bound cost admission and successful gather evidence, never credentials."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import time
import uuid

NO_READS = 'TOOLING FAILURE: no frames were read (no frames read); STOP, no QA verdict'


def save(path, row):
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_suffix('.new')
    pending.write_text(json.dumps(row, indent=2)+'\n')
    pending.replace(path)


def begin(work):
    row = {'run_id': str(uuid.uuid4()), 'started_ns': time.time_ns()}
    save(Path(work)/'visual/run.json', row)
    save(Path(work)/'visual/cost-admission.json', {**row, 'status': 'PENDING', 'sheets': []})
    return row


def index_images(index):
    index = Path(index)
    return list(dict.fromkeys(str((index.parent/line.split('\t')[0]).resolve())
        for line in index.read_text().splitlines() if line and not line.startswith('#')
        and line.split('\t')[0] not in ('sheet', 'sheet_file')))


def admit_cost(sheets, price=0.10):
    if not math.isfinite(price) or price <= 0:
        raise ValueError('positive finite price-per-sheet-usd required')
    estimate = round(sheets*price, 6)
    print(f'Visual cost estimate: {sheets} sheets x ${price:.2f} = ${estimate:.2f} '
          '(planning allowance including one retry; actual billing may differ)', file=sys.stderr)
    if estimate > 5:
        raise ValueError('COST_HOLD: estimate exceeds $5; stop and state cost before reading')
    return estimate


def admit(work, images, price=.10):
    work = Path(work).resolve()
    run_path = work/'visual/run.json'
    run = json.loads(run_path.read_text()) if run_path.is_file() else begin(work)
    images = list(dict.fromkeys(str(Path(p).resolve()) for p in images))
    old_path = work/'visual/cost-admission.json'
    if old_path.is_file():
        old = json.loads(old_path.read_text())
        if old.get('run_id') == run['run_id']:
            images = list(dict.fromkeys(old.get('sheets', []) + images))
            price = max(price, old.get('price_per_sheet_usd', price))
    row = {**run, 'sheets': images, 'price_per_sheet_usd': price, 'status': 'PENDING'}
    try:
        row['estimated_usd'] = round(len(images)*price, 6)
        admit_cost(len(images), price)
        if not images:
            raise ValueError('COST_PENDING: no sheets yet; extract then admit the whole index')
        row['image_sha256'] = {p: hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in images}
        row['status'] = 'ADMITTED'
    except (ValueError, OSError) as error:
        row['status'] = 'COST_HOLD'
        save(work/'visual/cost-admission.json', row)
        raise ValueError(str(error)) from None
    save(work/'visual/cost-admission.json', row)
    return work/'visual/cost-admission.json'


def validate(admission, images):
    if not admission:
        raise ValueError('COST_ADMISSION_REQUIRED: admit the whole run before reading')
    path = Path(admission).resolve()
    row = json.loads(path.read_text())
    run = json.loads((path.parent/'run.json').read_text())
    if row.get('status') != 'ADMITTED' or row.get('run_id') != run.get('run_id'):
        raise ValueError('COST_ADMISSION_REQUIRED: missing, held or stale run admission')
    if not 0 <= row['estimated_usd'] <= 5:
        raise ValueError('COST_HOLD: run estimate exceeds $5')
    for image in images:
        image = str(Path(image).resolve())
        if image not in row['sheets'] or row['image_sha256'].get(image) != hashlib.sha256(Path(image).read_bytes()).hexdigest():
            raise ValueError('COST_ADMISSION_REQUIRED: image outside admitted run or bytes changed')
    return row


def successful_reads(session):
    requests, succeeded = {}, set()
    def walk(value):
        if isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, dict):
            if value.get('type') == 'tool_use' and value.get('name') == 'Read':
                raw = value.get('input', {}).get('file_path')
                if raw and value.get('id'):
                    requests[value['id']] = str(Path(raw).resolve())
            if value.get('type') == 'tool_result' and not value.get('is_error', False):
                content = value.get('content')
                if isinstance(content, list) and any(isinstance(c, dict) and c.get('type') == 'image' for c in content):
                    succeeded.add(value.get('tool_use_id'))
            for key in ('message', 'content', 'payload', 'item', 'output'):
                if key in value:
                    walk(value[key])
    for line in Path(session).read_text().splitlines():
        if line.strip():
            walk(json.loads(line))
    return {requests[key] for key in succeeded if key in requests}


def check(work, transcript):
    work = Path(work).resolve()
    try:
        run = json.loads((work/'visual/run.json').read_text())
        admission = validate(work/'visual/cost-admission.json', [])
    except (OSError, ValueError, KeyError, TypeError):
        raise ValueError(NO_READS) from None
    allowed = set(admission['sheets'])
    # Only gathered run images qualify. Mandatory pointer frames / judge-only
    # inspections cannot substitute for dense-window gathering.
    def gathered(image):
        image = Path(image).resolve()
        if not image.is_relative_to(work):
            return False
        return str(image) in allowed and 'must-read' not in image.relative_to(work).parts
    for path in work.rglob('helper-receipts/*.json'):
        try:
            row = json.loads(path.read_text())
            if row.get('run_id') != run['run_id'] or row.get('failure') or row.get('exit_code') != 0 or not row.get('read_count', 0):
                continue
            for image, digest in row.get('image_sha256', {}).items():
                if gathered(image) and hashlib.sha256(Path(image).read_bytes()).hexdigest() == digest:
                    return
        except (OSError, ValueError, TypeError, AttributeError):
            continue
    for path in work.rglob('visual/summary.json'):
        try:
            row = json.loads(path.read_text())
            if row.get('run_id') != run['run_id']:
                continue
            for item in row.get('sheets', []):
                image = item.get('sheet', '')
                if item.get('state') == 'READ' and item.get('ok') and gathered(image):
                    validate(work/'visual/cost-admission.json', [image])
                    return
        except (OSError, ValueError, TypeError, KeyError, AttributeError):
            continue
    try:
        session = Path(transcript)
        if session.stat().st_mtime_ns >= run['started_ns']:
            for image in successful_reads(session):
                if gathered(image):
                    validate(work/'visual/cost-admission.json', [image])
                    return
    except (OSError, ValueError, TypeError, KeyError):
        pass
    raise ValueError(NO_READS)


def main():
    if len(sys.argv) > 1 and sys.argv[1] in ('plan', 'admit'):
        p = argparse.ArgumentParser()
        p.add_argument('action'); p.add_argument('work', type=Path)
        p.add_argument('--index', type=Path)
        p.add_argument('--price-per-sheet-usd', type=float, default=.10)
        p.add_argument('images', nargs='*')
        a = p.parse_args()
        if a.action == 'plan':
            begin(a.work)
        index = a.index or a.work/'dense/index.tsv'
        if not a.images and not index.is_file() and a.action == 'plan':
            print('COST_PENDING: whole-run index not ready; admit after extraction, before ANY reader', file=sys.stderr)
            return
        admit(a.work, a.images or index_images(index), a.price_per_sheet_usd)
    else:
        check(*sys.argv[1:])


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(3)
