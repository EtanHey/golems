#!/usr/bin/env python3
"""Validate bounded PR snapshots and categorize stderr without publishing it."""
import json
from pathlib import Path
import re
import sys


def category(stderr):
    text = stderr.lower()
    for name, pattern in (
        ('rate-limit', r'rate.?limit|http 429|secondary limit'),
        ('authentication', r'auth|http 401|token|login'),
        ('forbidden', r'http 403|forbidden'),
        ('not-found', r'http 404|not found|could not resolve to a repository'),
        ('network', r'timeout|timed out|connection|network|resolve host|tls'),
    ):
        if re.search(pattern, text):
            return name
    return 'gh-failed'


def snapshot(raw, mode):
    rows = json.loads(raw)
    if not isinstance(rows, list) or len(rows) >= 500:
        raise ValueError('incomplete snapshot')
    out = []
    for row in rows:
        branch = row['headRefName']
        if not isinstance(branch, str) or not branch or any(c in branch for c in '\n\r\t'):
            raise ValueError('invalid branch')
        if mode == 'open':
            if not isinstance(row['number'], int):
                raise ValueError('invalid number')
            out.append(branch)
        else:
            if mode == 'finished':
                if row['state'] not in ('MERGED', 'CLOSED'):
                    raise ValueError('PR not merged or closed')
                out.append(branch + '\t' + row['state'])
                continue
            sha = row['headRefOid']
            if not re.fullmatch('[0-9a-f]{40}', sha):
                raise ValueError('invalid SHA')
            out.append(branch + '\t' + sha)
    if mode == 'finished' and not out:
        raise ValueError('no merged or closed PR')
    return '\n'.join(out)


if __name__ == '__main__':
    try:
        print(category(Path(sys.argv[2]).read_text()) if sys.argv[1] == 'category'
              else snapshot(sys.stdin.read(), sys.argv[1]))
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(type(error).__name__, file=sys.stderr)
        sys.exit(1)
