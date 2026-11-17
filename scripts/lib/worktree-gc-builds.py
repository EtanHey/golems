#!/usr/bin/env python3
"""Conservative filesystem age and ignored build-directory maintenance.

Never follows directory aliases. Unknown traversal/Git/age keeps data.
"""
import fcntl
import json
import os
from pathlib import Path
import shutil
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
    return time.time() - newest > 3 * 86400


def candidates(root):
    for here, dirs, _files in walk(root):
        dirs[:] = [d for d in dirs if d not in ('.git', 'docs.local') and
                   not os.path.islink(os.path.join(here, d))]
        for name in list(dirs):
            if name.startswith('.build') or name in ('.venv', 'node_modules'):
                target = Path(here) / name
                yield target
                # Known build children remain eligible when a sibling receipt
                # protects the container. Never traverse docs.local itself.
                if name == '.build.noindex':
                    for child in ('swift', 'brainbar-render', 'pytest'):
                        if (target / child).is_dir() and not (target / child).is_symlink():
                            yield target / child
                dirs.remove(name)


def disposable(root, target):
    rel = target.relative_to(root).as_posix()
    if target.is_symlink() or not target.is_dir():
        return False
    # Both tracked descendants and ignore-rule exceptions protect the directory.
    if git(root, 'ls-files', '-z', '--', rel):
        return False
    if git(root, 'ls-files', '-z', '--others', '--exclude-standard', '--', rel):
        return False
    check = subprocess.run(['git', '-C', str(root), 'check-ignore', '-q', '--', rel + '/'])
    if check.returncode == 1:
        return False
    check.check_returncode()
    for _here, dirs, files in walk(target):
        if '.git' in dirs + files or 'docs.local' in dirs + files:
            return False
    return True


def trim(root, apply):
    if not old(root):
        print('builds kept: activity within 72h')
        return
    outputs = sorted(candidates(root), key=lambda p: (p.name == '.venv', str(p)))
    for target in outputs:
        if not disposable(root, target):
            continue
        size = subprocess.check_output(['du', '-sk', str(target)], text=True).split()[0]
        if apply:
            # Recheck immediately before deleting; never use Git clean or follow aliases.
            if not disposable(root, target):
                continue
            shutil.rmtree(target)
        print(json.dumps(dict(action='TRIMMED' if apply else 'TRIM', path=str(target),
                              size_bytes=int(size) * 1024)))


if __name__ == '__main__':
    try:
        command, path, *args = sys.argv[1:]
        root = Path(path)
        if root.is_symlink() or root.resolve() != root:
            raise ValueError('noncanonical worktree')
        if command == 'old':
            sys.exit(0 if old(root) else 3)
        elif command == 'trim':
            apply = args == ['apply']
            if apply:
                lock = Path(os.environ.get('GOLEMS_HEAVY_LOCK',
                            os.path.expanduser('~/.local/state/golems/heavy-suite.lock')))
                lock.parent.mkdir(parents=True, exist_ok=True)
                with lock.open('a') as handle:
                    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    trim(root, True)
            else:
                trim(root, False)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print('build maintenance refused: ' + str(error))
        sys.exit(1)
