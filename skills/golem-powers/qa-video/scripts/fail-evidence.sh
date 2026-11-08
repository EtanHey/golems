#!/usr/bin/env bash
set -euo pipefail
[[ $# -eq 1 ]] || { echo 'usage: fail-evidence.sh <run-dir>' >&2; exit 2; }
exec python3 - "$1" <<'PY'
from pathlib import Path
import math
import posixpath
import re
import sys

root = Path(sys.argv[1]).resolve()
try:
    report = (root / 'qa-report.md').read_text()
    # Mirror qa-verdict-gate.mjs videoFramesObserved: both case-sensitive ID forms.
    ident = r'(?=[A-Za-z0-9-]*[0-9])[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*'
    failures = set(re.findall(rf'\b({ident})\s+\**FAIL\b', report, re.ASCII))
    failures.update(re.findall(rf'^\s*#{{1,6}}\s+({ident}):[^\n]*\bFAIL\b', report, re.M | re.ASCII))
    selected, seen = [], set()
    # Exact basename only: never inspect inspected-quarantine-*.tsv.
    for ledger in sorted(root.rglob('inspected.tsv')) if failures else []:
        if not ledger.resolve().is_relative_to(root):
            continue
        for raw in ledger.read_bytes().splitlines(keepends=True):
            cols = raw.decode('utf-8').rstrip('\r\n').split('\t')
            if len(cols) != 4:
                continue
            pts, frame, why, finding = cols
            if (finding in failures and re.fullmatch(r'(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)', pts)
                    and math.isfinite(float(pts)) and frame.startswith(str(root) + '/')
                    and frame == posixpath.normpath(frame) and re.search(r'\.(png|jpe?g)$', frame, re.I)
                    and re.match(r'^[^:\s][^:]*:\s*\S', why, re.ASCII)):
                selected.append(raw)
                seen.add(finding)
    missing = failures - seen
    if missing:
        sys.exit('fail-evidence: no valid inspected row for ' + ', '.join(sorted(missing)))
    sys.stdout.buffer.write(b''.join(selected))
except (OSError, UnicodeError) as error:
    sys.exit('fail-evidence: ' + str(error))
PY
