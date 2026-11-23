#!/usr/bin/env python3
"""Read-only full-tree age and open-file proof for T3 retirement."""
import os
from pathlib import Path
import subprocess
import sys
import time

def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args])


def walk(root):
    def fail(error):
        raise error
    return os.walk(root, followlinks=False, onerror=fail)


def old(root):
    newest = os.lstat(root).st_mtime
    admin = Path(os.fsdecode(git(root, 'rev-parse', '--absolute-git-dir')).strip())
    for name in ('HEAD', 'index', 'COMMIT_EDITMSG'):
        p = admin / name
        if p.exists():
            newest = max(newest, p.stat().st_mtime)
    for here, dirs, files in walk(root):
        dirs[:] = [d for d in dirs if d != '.git']
        for name in dirs + files:
            newest = max(newest, os.lstat(os.path.join(here, name)).st_mtime)
    return time.time() - newest > 86400


def files_unused(target):
    # A complete, bounded user-wide snapshot includes fds, cwd and txt mappings.
    # Empty/partial/mock-without-fd output is not evidence of absence.
    pids = subprocess.check_output(['ps', '-o', 'pid=', '-u', str(os.getuid())], timeout=10).split()
    result = subprocess.run(['lsof', '-nP', '-a', '-u', str(os.getuid()), '-Fpfan'],
                            capture_output=True, text=True, timeout=15)
    result.check_returncode()
    lines = result.stdout.splitlines()
    after = subprocess.check_output(['ps', '-o', 'pid=', '-u', str(os.getuid())], timeout=10).split()
    stable = set(pids) & set(after)
    observed = {line[1:].encode() for line in lines if line.startswith('p')}
    if not stable or not stable <= observed:
        raise ValueError('partial open-file process coverage')
    fd = False
    for line in lines:
        if line.startswith('p'):
            fd = False
        elif line.startswith('f'):
            fd = True
        elif line.startswith('n'):
            if not fd:
                raise ValueError('open-file snapshot lacks descriptor records')
            name = line[1:].removesuffix(' (deleted)')
            if name == str(target) or name.startswith(str(target) + os.sep):
                return False
    if not any(line.startswith('f') for line in lines):
        raise ValueError('open-file snapshot empty')
    return True


if __name__ == '__main__':
    try:
        root = Path(os.path.realpath(sys.argv[1]))
        if not old(root):
            raise ValueError('files or Git admin activity within 24h')
        if not files_unused(root):
            raise ValueError('process has a file open inside tree')
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
