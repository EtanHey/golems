"""Reversible, unsigned single-ref deletes. Never executes a push."""
import hashlib
import json
import os
import re
import shlex
import stat
import subprocess
import time
from pathlib import Path

import tokens

GUIDANCE = ('To delete a fleet branch: run scripts/fleet/archive-and-delete-branch.sh, '
            'then the command it prints.')


def archive_path(home, target, branch, sha):
    return home / '.golems/branch-archive' / target / branch.replace('/', '__') / (sha + '.bundle')


def check_bundle(path, repo, branch, sha):
    # Reject symlinked directories too; a symlinked archive is not a saved copy.
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError('symlinked archive')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) not in (0o600, 0o644)):
            raise ValueError('unsafe bundle')
        # Git and the hash read the same opened file, not a swapped pathname.
        opened = '/dev/fd/' + str(fd)
        for args in (['bundle', 'list-heads', opened], ['bundle', 'verify', opened]):
            stream.seek(0)
            result = subprocess.run([tokens.GIT, '-C', repo, *args], capture_output=True,
                                    text=True, timeout=2, pass_fds=(fd,))
            if result.returncode or (args[1] == 'list-heads' and
                                    result.stdout.strip() != f'{sha} refs/heads/{branch}'):
                raise ValueError('bundle does not preserve exactly the leased ref')
        stream.seek(0)
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def record(home, target, branch, sha, path, digest):
    receipt = home / '.golems/branch-archive/deletes.jsonl'
    fd = os.open(receipt, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    with os.fdopen(fd, 'a') as stream:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) not in (0o600, 0o644)):
            raise ValueError('unsafe receipt')
        row = dict(time=time.time(), repo=target, branch=branch, sha=sha,
                   bundle=str(path), bundle_sha256=digest)
        stream.write(json.dumps(row, separators=(',', ':')) + '\n')
        stream.flush()
        os.fsync(fd)


def scope(payload, ops, home):
    from commands import shell
    if len(ops) != 1 or ops[0]['class'] != 'delete' or ops[0].get('local'):
        return False, ''
    try:
        op = ops[0]
        words = shlex.split(payload['tool_input']['command'])
        prefix = words[:3] + ['push'] if words[:2] == ['git', '-C'] else ['git', 'push']
        tail = words[len(prefix):]
        if words[:len(prefix)] != prefix or len(tail) != 3:
            return False, ''
        lease = re.fullmatch(r'--force-with-lease=refs/heads/(.+):([0-9a-f]{40})', tail[0])
        if not lease:
            return False, ''
        branch, sha = lease.groups()
        repo, remote = op['repo'], op['remote']
        if (tail[1] != remote or tail[2] != ':refs/heads/' + branch
                or op['refs'] != [tail[2]]):
            return False, ''
        subprocess.run([tokens.GIT, 'check-ref-format', 'refs/heads/' + branch],
                       check=True, capture_output=True, timeout=1)
        target = tokens.own_lease_remote(repo, remote)
        if branch.casefold() in ('main', 'master', 'develop', 'trunk', 'gh-pages') or branch.casefold().startswith('release'):
            return False, f'Blocked: shared branch of {target}; deleting it needs Etan.'
        try:
            default, data, prs = tokens.own_lease_metadata(target, branch, include_prs=True)
            if (not isinstance(default, str) or not default or data['name'] != branch
                    or type(data['protected']) is not bool or not isinstance(prs, list) or len(prs) >= 100):
                raise ValueError('ambiguous metadata')
            linked = False
            for pr in prs:
                head, base = pr['head']['ref'], pr['base']['ref']
                if not isinstance(head, str) or not head or not isinstance(base, str) or not base:
                    raise ValueError('ambiguous PR metadata')
                linked |= branch in (head, base)
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError, shell.PolicyEvaluationDeadlineExceeded):
            return False, f"Blocked: couldn't confirm branch safety and open PRs in {target}. Retry the push."
        if branch.casefold() == default.casefold() or data['protected'] or linked:
            return False, f'Blocked: default/protected branch or open PR uses {branch} in {target}; deleting it needs Etan.'
        path = archive_path(home, target, branch, sha)
        try:
            digest = check_bundle(path, repo, branch, sha)
        except (OSError, ValueError, subprocess.SubprocessError):
            create = shlex.join(['git', '-C', repo, 'bundle', 'create', str(path), 'refs/heads/' + branch])
            return False, (f'Blocked: missing or invalid bundle {path}. {GUIDANCE} '
                           f'Bundle creation command (local ref must equal {sha}): {create}')
        try:
            record(home, target, branch, sha, path, digest)
        except (OSError, ValueError):
            return False, 'Blocked: could not save the branch deletion receipt. Retry after fixing the archive permissions.'
        return True, ''
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        return False, ''
