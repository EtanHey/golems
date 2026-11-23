#!/usr/bin/env python3
"""Pre-dispatch cost admission and minimum visual evidence gate; no credentials."""
import hashlib
import json
import math
from pathlib import Path
import sys


def admit_cost(sheets, price=0.10):
    # Planning allowance per sheet, INCLUDING the batch's one retry. This is
    # not a provider tariff or a guarantee of the final token bill.
    if not math.isfinite(price) or price <= 0:
        raise ValueError('positive finite price-per-sheet-usd required')
    estimate = sheets * price
    print(f'Visual cost estimate: {sheets} sheets x ${price:.2f} = ${estimate:.2f} '
          '(planning allowance including one retry; actual billing may differ)', file=sys.stderr)
    if estimate > 5:
        raise ValueError('COST_HOLD: estimate exceeds $5; stop and state cost before reading; '
                         'reduce scope or obtain explicit cost authorization')
    return estimate


def check(work, transcript):
    work = Path(work).resolve()
    # Direct helper calls and delegate wrappers retain receipts next to their
    # images. Bind their successful reads to the current bytes in this run.
    for path in work.rglob('helper-receipts/*.json'):
        try:
            row = json.loads(path.read_text())
            if row.get('exit_code') != 0 or not row.get('read_count', 0):
                continue
            for image, digest in row.get('image_sha256', {}).items():
                image = Path(image).resolve()
                if image.is_relative_to(work) and hashlib.sha256(image.read_bytes()).hexdigest() == digest:
                    return
        except (OSError, ValueError, TypeError):
            continue
    # Explicit non-Claude helpers retain batch READ rows instead.
    for path in work.rglob('visual/summary.json'):
        row = json.loads(path.read_text())
        if any(r.get('state') == 'READ' and r.get('ok') and Path(r['sheet']).resolve().is_relative_to(work)
               and Path(r['sheet']).is_file() for r in row.get('sheets', [])):
            return
    # Native judge reads (pointer/spot-check routes) must reference a run image.
    import importlib.util
    spec = importlib.util.spec_from_file_location('must_read', Path(__file__).with_name('must-read.py'))
    native = importlib.util.module_from_spec(spec); spec.loader.exec_module(native)
    if Path(transcript).is_file():
        for image in native.image_reads(Path(transcript)):
            image = Path(image)
            if image.is_relative_to(work) and image.is_file() and image.suffix.lower() in ('.png', '.jpg', '.jpeg'):
                return
    raise ValueError('TOOLING FAILURE: no frames were read (no frames read); STOP, no QA verdict')


if __name__ == '__main__':
    try:
        check(*sys.argv[1:])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(3)
