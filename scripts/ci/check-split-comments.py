#!/usr/bin/env python3
"""Prove immutable splits; retain whole-line comment multisets in the live tree.
Inline trailing comments are out of scope. Review deliberate removals with:
python scripts/ci/check-split-comments.py --refresh --allow-remove "<exact text>"
"""
import argparse
import hashlib
import json
import re
import subprocess
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def comments(text):
    result, following, code = [], digest(''), 0
    for line in reversed(text.splitlines()):
        if re.match(r'^\s*(?:#|//|/\*|\*(?:\s|/|$))', line):
            result.append((digest(line.strip()), code, following))
        elif line.strip():
            code += 1
            following = digest(line.strip())
    return result[::-1]

def blob(sha, path):
    return subprocess.check_output(['git', 'show', f'{sha}:{path}'], cwd=REPO, text=True)

def main(root, refresh=False, allow_remove=()):
    path = REPO / 'scripts/tests/fixtures/split-comments.json'
    ledger = json.loads(path.read_text())
    failed = False
    for split in ledger['transitions']:
        original = comments(blob(split['pre_split_sha'], split['original_path']))
        seen = []
        for part in split['parts']:
            actual = comments(blob(split['split_sha'], part))
            assignments = split['assignments'][part]
            if any(indices != sorted(set(indices)) for indices in
                   ([row[column] for row in assignments] for column in (0, 1))):
                print(f'transition FAIL {part}: assignments must be unique and ordered')
                failed = True
            for i, j, position in assignments:
                seen.append(i)
                node = split['node_aliases'].get(str(i), {}).get('following', original[i][2])
                if j >= len(actual) or actual[j] != (original[i][0], position, node):
                    print(f'transition FAIL {part}: comment_sha256={original[i][0]}')
                    failed = True
        if sorted(seen) != list(range(len(original))):
            print(f'transition FAIL {split["original_path"]}: incomplete assignment')
            failed = True
    allowed = {digest(text.strip()) for text in allow_remove} if refresh else set()
    updated = {}
    if not ledger['files'] or not ledger['transitions']:
        raise ValueError('split comment ledger must not be empty')
    for file, expected in ledger['files'].items():
        actual = Counter(record[0] for record in comments((root / file).read_text()))
        for text, count in (Counter(expected) - actual).items():
            if text not in allowed:
                print(f'{file}: missing_sha256={text}; count={count}; review removal with '
                      'python scripts/ci/check-split-comments.py --refresh --allow-remove "<exact text>"')
                failed = True
        updated[file] = dict(sorted(actual.items()))
    if refresh and not failed:
        ledger['files'] = updated
        path.write_text(json.dumps(ledger, indent=2) + '\n')
    print(f'split-comments: {"FAIL" if failed else "PASS"} ({len(updated)} files)')
    return int(failed)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', nargs='?', type=Path, default=REPO)
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--allow-remove', action='append', default=[])
    args = parser.parse_args()
    raise SystemExit(main(args.root, args.refresh, args.allow_remove))
