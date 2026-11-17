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


EXACT_OUTPUTS = {'.build', 'node_modules', '.venv', 'venv'}
NOINDEX_OUTPUTS = {'swift', 'brainbar-render', 'pytest'}


def candidates(root):
    for here, dirs, _files in walk(root):
        dirs[:] = [d for d in dirs if d not in ('.git', 'docs.local') and
                   not os.path.islink(os.path.join(here, d))]
        # Unknown build-like roots and proof children protect their entire subtree.
        # This prefix is a KEEP boundary, never a disposal rule.
        dirs[:] = [d for d in dirs if not d.startswith('.build') or d in ('.build', '.build.noindex')]
        if Path(here).name == '.build.noindex':
            dirs[:] = [d for d in dirs if d in NOINDEX_OUTPUTS]
        for name in list(dirs):
            if name in EXACT_OUTPUTS or (Path(here).name == '.build.noindex' and name in NOINDEX_OUTPUTS):
                yield Path(here) / name
                dirs.remove(name)


def files_unused(target):
    # A complete, bounded user-wide snapshot includes fds, cwd and txt mappings.
    # Empty/partial/mock-without-fd output is not evidence of absence.
    pids = subprocess.check_output(['ps', '-o', 'pid=', '-u', str(os.getuid())], timeout=10).split()
    result = subprocess.run(['lsof', '-nP', '-a', '-u', str(os.getuid()), '-Fpfan'],
                            capture_output=True, text=True, timeout=15)
    result.check_returncode()
    lines = result.stdout.splitlines()
    if not pids or sum(line.startswith('p') for line in lines) * 10 < len(pids) * 9:
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


def event(action, target, detail, **extra):
    print(json.dumps(dict(action=action, path=str(target), detail=detail, **extra)))


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
    outputs = sorted(candidates(root), key=lambda p: (p.name in ('.venv', 'venv'), str(p)))
    selected = []
    for target in outputs:
        try:
            if any(parent in target.parents for parent in selected) or not disposable(root, target):
                continue
            if not files_unused(target):
                event('KEEP-live', target, 'open file or mapping under build output')
                continue
            size = subprocess.check_output(['du', '-sk', str(target)], text=True).split()[0]
            if apply:
                if not disposable(root, target) or not files_unused(target):
                    event('KEEP-live', target, 'build output changed or became live')
                    continue
                try:
                    shutil.rmtree(target)
                except OSError as error:
                    event('KEEP-trim-error', target, 'deletion failed; target may be partially deleted: ' + str(error))
                    continue
            selected.append(target)
            event('TRIMMED' if apply else 'TRIM', target, 'exact ignored rebuildable output', size_bytes=int(size) * 1024)
        except (OSError, ValueError, IndexError, subprocess.SubprocessError) as error:
            event('KEEP-trim-error', target, 'trim refused: ' + str(error))


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
                    try:
                        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    except BlockingIOError:
                        event('KEEP-busy', root, 'heavy-suite lock held; trim deferred')
                    else:
                        trim(root, True)
            else:
                trim(root, False)
    except (OSError, ValueError, IndexError, subprocess.SubprocessError) as error:
        event('KEEP-trim-error', sys.argv[2], 'build maintenance refused: ' + str(error))
        sys.exit(0 if sys.argv[1] == 'trim' else 1)
