#!/usr/bin/env python3
"""Keep reviewed split comments in their file, code context, and relative order."""
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def receipts(text):
    result, following = [], []
    lines = text.splitlines()
    code_position = sum(bool(line.strip()) and not re.match(r'^\s*(?:#|//|/\*|\*(?:\s|/|$))', line)
                        for line in lines)
    for line in reversed(lines):
        if re.match(r'^\s*(?:#|//|/\*|\*(?:\s|/|$))', line):
            payload = json.dumps([line.strip(), code_position, following], separators=(',', ':'))
            result.append(hashlib.sha256(payload.encode()).hexdigest())
        elif line.strip():
            code_position -= 1
            following = [line.strip(), *following[:2]]
    return result[::-1]


def main(root):
    ledger = json.loads((REPO / 'scripts/tests/fixtures/split-comments.json').read_text())
    files = ledger['files']
    if not files:
        raise ValueError('split comment ledger must not be empty')
    failed = False
    for path, expected in files.items():
        actual = receipts((root / path).read_text())
        missing = sum((Counter(expected) - Counter(actual)).values())
        remaining = iter(actual)
        ordered = all(receipt in remaining for receipt in expected)
        print(f'{path}: missing_or_misplaced={missing}; order_preserved={ordered}')
        failed |= bool(missing) or not ordered
    count = sum(map(len, files.values()))
    print(f'split-comments: {"FAIL" if failed else "PASS"} ({len(files)} files; {count} comments)')
    return int(failed)


if __name__ == '__main__':
    raise SystemExit(main(Path(sys.argv[1]) if len(sys.argv) > 1 else REPO))
