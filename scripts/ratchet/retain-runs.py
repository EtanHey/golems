#!/usr/bin/env python3
"""List PR-aware ratchet retention; --apply explicitly removes eligible runs."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import subprocess


def gh(args):
    return json.loads(subprocess.check_output(['gh', *args], text=True))


def snapshot(path):
    st = path.lstat()
    if path.is_symlink():
        raise ValueError(f'symlink refused: {path}')
    rows = [(str(path), st.st_ino, st.st_dev, st.st_size, st.st_mtime_ns)]
    if path.is_dir():
        for child in sorted(path.iterdir()):
            rows.extend(snapshot(child))
    return rows


def plan(root, repo, now):
    if root.is_symlink() or root.resolve() != root.absolute():
        raise ValueError('symlink root refused')
    rows, states = [], {}
    try:
        pages = gh(['api', '--paginate', '--slurp', f'repos/{repo}/issues/comments?per_page=100'])
        citations = [c['body'] for page in pages for c in page]
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError):
        citations = None
    for path in sorted(root.iterdir()):
        proof = snapshot(path)
        match = re.fullmatch(r'(?:live-)?pr(\d+)-(?:[a-f0-9]{7,40}-)?(\d{8}T\d{6})(?:\d*Z?)', path.name)
        row = dict(path=str(path), pr=None, state='UNKNOWN', age=None,
                   bytes=sum(p[3] for p in proof), reason='unrecognized run', keep=True, proof=proof)
        rows.append(row)
        if not match or not path.is_dir():
            continue
        pr = int(match[1])
        row['pr'] = pr
        try:
            timestamp = dt.datetime.strptime(match[2], '%Y%m%dT%H%M%S').replace(tzinfo=dt.timezone.utc)
            row['age'] = (now - timestamp).total_seconds() / 86400
            row['timestamp'] = timestamp
            if pr not in states:
                data = gh(['pr', 'view', str(pr), '--repo', repo, '--json', 'state,closedAt'])
                pages = gh(['api', '--paginate', '--slurp', f'repos/{repo}/issues/{pr}/comments?per_page=100'])
                comments = [c['body'] for page in pages for c in page]
                if data['state'] not in ('OPEN', 'CLOSED', 'MERGED'):
                    raise ValueError('unknown state')
                states[pr] = (data, comments)
            data, comments = states[pr]
            row['state'] = data['state']
            # All repository issue/PR comments cover cross-PR sticky citations too.
            if citations is None:
                row['reason'] = 'repository citations unavailable'
            elif any(path.name in body for body in citations + comments):
                row['reason'] = 'PR comment citation'
            elif row['age'] < 0:
                row['reason'] = 'future timestamp'
            else:
                row['reason'] = 'retention candidate'
        except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError):
            states.pop(pr, None)
            row['state'] = 'UNKNOWN'
            row['reason'] = 'lookup failed or unknown state'
    for pr, (data, _) in states.items():
        runs = sorted([r for r in rows if r['pr'] == pr and r['state'] != 'UNKNOWN'],
                      key=lambda r: (r['timestamp'], r['path']), reverse=True)
        limit = 3
        if data['state'] != 'OPEN':
            try:
                closed = dt.datetime.fromisoformat(data['closedAt'].replace('Z', '+00:00'))
                limit = 1 if (now - closed).total_seconds() <= 14 * 86400 else 0
            except (ValueError, KeyError, TypeError, AttributeError):
                continue
        for index, row in enumerate(runs):
            if row['reason'] != 'retention candidate':
                continue
            row['keep'] = index < limit
            row['reason'] = 'newest run retention' if row['keep'] else 'outside PR retention'
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path)
    parser.add_argument('--repo', default='EtanHey/golems')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    root = args.root
    if root is None:
        common = subprocess.check_output(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], text=True).strip()
        root = Path(common).parent / 'docs.local/ratchet-runs'
    if not root.exists():
        print(f'No run root: {root}')
        return
    rows = plan(root.absolute(), args.repo, dt.datetime.now(dt.timezone.utc))
    for row in rows:
        print('\t'.join(str(row[k]) for k in ('path', 'pr', 'state', 'age', 'bytes', 'reason')) + '\t' + ('KEEP' if row['keep'] else 'REMOVE'))
    if args.apply:
        # Validate the entire plan before the first mutation; stop on any error.
        for row in rows:
            if snapshot(Path(row['path'])) != row['proof']:
                raise ValueError('run changed since scan')
        for row in rows:
            if not row['keep']:
                shutil.rmtree(row['path'])


if __name__ == '__main__':
    main()
