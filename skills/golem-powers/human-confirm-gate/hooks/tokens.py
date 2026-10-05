"""One-use signed capabilities. Same-UID hook/trust-anchor tampering is out of scope."""
import hashlib
import json
import os
import re
import stat
import subprocess
import time
from pathlib import Path

GIT = '/usr/bin/git'
SSH = '/usr/bin/ssh-keygen'
GH = '/opt/homebrew/bin/gh'


def private_read(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_uid != os.getuid() or info.st_size > 65536:
            raise ValueError('unsafe confirmation file')
        return stream.read(65537)


def read_command(argv):
    return subprocess.run(argv, capture_output=True, text=True, check=True, timeout=2).stdout.strip()


def lead_metadata(op):
    repo = op['repo']; branch = op['ref'].removeprefix('refs/heads/')
    if op['source'] not in ('HEAD', branch, op['ref']):
        raise ValueError('lead lease must use the current branch')
    if read_command([GIT, '-C', repo, 'symbolic-ref', '--short', 'HEAD']) != branch:
        raise ValueError('not the worker current branch')
    url = read_command([GIT, '-C', repo, 'remote', 'get-url', '--push', '--all', op['remote']])
    match = re.fullmatch(r'(?:git@github\.com:|https://github\.com/)([^/\s]+/[^/\s]+?)(?:\.git)?', url)
    if not match:
        raise ValueError('lead scope needs one GitHub remote')
    target = match[1]
    metadata = json.loads(read_command([GH, 'repo', 'view', target, '--json', 'defaultBranchRef']))
    pr = json.loads(read_command([GH, 'pr', 'view', branch, '--repo', target, '--json',
                                 'state,mergedAt,headRefName,isCrossRepository,headRefOid']))
    return metadata['defaultBranchRef']['name'], pr


def authorize(payload, ops, home, metadata_fn=lead_metadata):
    root = home / '.config/golems/human-confirm'
    policy = root.parent / 'human-confirm.allowed_signers'
    digest = hashlib.sha256((payload['cwd'] + '\0' + payload['tool_input']['command']).encode()).hexdigest()
    for path in sorted(root.glob('*.json')):
        try:
            raw = private_read(path); token = json.loads(raw)
            now = time.time(); kind = token['kind']; nonce = token['nonce']
            if kind not in ('human', 'lead') or token['version'] != 1 or not re.fullmatch('[0-9a-f]{32}', nonce) or path.name != nonce + '.json':
                continue
            if not (token['issued_at'] <= now < token['expires_at'] <= token['issued_at'] + 300):
                continue
            if token['command_sha256'] != digest or token['operations'] != ops or token['session_id'] != payload['session_id']:
                continue
            # Signature authenticates the creator; creator fields/agent chat do not.
            private_read(policy)
            verified = subprocess.run([SSH, '-Y', 'verify', '-f', str(policy), '-I', kind,
                                       '-n', 'golems-confirm', '-s', str(path) + '.sig'],
                                      input=raw, capture_output=True, timeout=2)
            if verified.returncode:
                continue
            if kind == 'lead':
                if len(ops) != 1 or ops[0]['class'] != 'lease':
                    continue
                # Nested shells/cd/aliases can obscure cwd; lead authority is narrower.
                import shlex
                words = shlex.split(payload['tool_input']['command'])
                prefix = ['git', 'push']
                if words[:1] == ['git'] and words[1:2] == ['-C']:
                    prefix = words[:3] + ['push']
                expected = [f"--force-with-lease={ops[0]['ref']}:{ops[0]['sha']}", ops[0]['remote'],
                            ops[0]['source'] + ':' + ops[0]['ref']]
                if words != prefix + expected:
                    continue
                default, pr = metadata_fn(ops[0])
                branch = ops[0]['ref'].removeprefix('refs/heads/')
                if branch == default or pr['state'] != 'OPEN' or pr['mergedAt'] is not None or pr['isCrossRepository'] or pr['headRefName'] != branch or pr['headRefOid'] != ops[0]['sha']:
                    continue
                collab = Path(token['collab'])
                line = 'GOLEMS_CONFIRM ' + json.dumps(token, sort_keys=True, separators=(',', ':'))
                if line not in collab.read_text().splitlines():
                    continue
            # O_EXCL makes concurrent attempts mutually exclusive. A restored token
            # remains spent; retain nonce tombstones permanently, delete capability.
            spent = root / (nonce + '.spent')
            fd = os.open(spent, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
            os.close(fd)
            path.unlink(); Path(str(path) + '.sig').unlink()
            return True
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
            continue
    return False
