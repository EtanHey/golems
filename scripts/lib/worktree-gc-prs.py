#!/usr/bin/env python3
"""Run-local GitHub metadata cache, shared by repository slug across checkouts."""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


_spec = importlib.util.spec_from_file_location('gc_network_budget', Path(__file__).with_name('worktree-gc-budget.py'))
_budget = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_budget)


class LookupError(Exception):
    pass


def lookup(directory, repo, kind, branch=''):
    key = hashlib.sha256(json.dumps([repo.lower(), kind, branch]).encode()).hexdigest()
    path = Path(directory) / (key + '.json')
    if path.exists():
        result = json.loads(path.read_text())
    else:
        args = ['gh', 'pr', 'list', '--repo', repo]
        if kind == 'open-branch':
            args += ['--head', branch, '--state', 'open', '--limit', '1', '--json', 'headRefName']
        elif kind == 'merged':
            # One bounded probe; never enumerate the former 10,000-head history.
            args += ['--state', 'merged', '--limit', '2001', '--json', 'headRefName,headRefOid,baseRefName']
        else:
            args += ['--head', branch, '--state', 'merged', '--json', 'headRefOid,baseRefName', '--limit', '5']
        try:
            command = _budget.captured(args, directory)
            if command.returncode == 124:
                raise TimeoutError('hard gh per-call timeout')
            command.check_returncode()
            rows = json.loads(command.stdout)
            if not isinstance(rows, list):
                raise ValueError('invalid PR list')
            for row in rows:
                if kind != 'open-branch' and (not re.fullmatch('[0-9a-f]{40}', row.get('headRefOid', '')) or
                                       not isinstance(row.get('baseRefName', 'unknown'), str)):
                    raise ValueError('invalid PR head/base')
                if kind in ('open-branch', 'merged') and not isinstance(row.get('headRefName'), str):
                    raise ValueError('invalid PR branch')
            result = dict(rows=rows)
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            result = dict(error=type(error).__name__)
        path.parent.mkdir(parents=True, exist_ok=True)
        stage = path.with_suffix('.' + str(os.getpid()))
        stage.write_text(json.dumps(result))
        os.replace(stage, path)
    if 'error' in result:
        raise LookupError('PR lookup failed for ' + repo + ' (' + ('open PRs' if kind == 'open-branch' else kind) + ': ' + result['error'] + ')')
    return result['rows']


if __name__ == '__main__':
    try:
        cache, repo, mode, branch = sys.argv[1:]
        if mode == 'open':
            rows = lookup(cache, repo, 'open-branch', branch)
            print('\n'.join(row['headRefName'] for row in rows))
        else:
            if mode == 't3':
                rows = lookup(cache, repo, 'branch', branch)
                source_branch = branch
                if len(rows) >= 5:
                    # A match still proves integration; absence in a capped list does not.
                    print('CAPPED')
            else:
                rows = lookup(cache, repo, 'merged')
                source_branch = None
                if len(rows) >= 2001:
                    rows = lookup(cache, repo, 'branch', branch)
                    source_branch = branch
                    if len(rows) >= 5:
                        print('CAPPED')
            for row in rows:
                print((source_branch or row['headRefName']) + '\t' + row['headRefOid'] + '\t' + row.get('baseRefName', 'unknown'))
    except (OSError, ValueError, LookupError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
