"""Enclave wire contract. Software signing implementations belong only in tests."""
import hashlib
import json
import os
import re
import shlex
import subprocess
from pathlib import Path

PUBLIC_KEY = Path('.config/golems/enclave-public.der')
HELPER = '/Applications/GolemsApprove.app/Contents/MacOS/golems-approve'


def scope(command, cwd, ops):
    """One explicit Git/GitHub operation; wrappers refuse rather than guess display scope."""
    import git_config
    words = shlex.split(command)
    if not words or words[0] not in ('git', 'gh') or len(ops) != 1 or ops[0]['class'] not in ('delete', 'force', 'lease', 'rewrite', 'settings'):
        raise ValueError('enclave requires one direct Git/GitHub operation')
    op = ops[0]
    if op['repo'] != cwd or ('push' in words[:2] and not re.fullmatch('[0-9a-f]{64}', op.get('push_config_sha256', ''))):
        raise ValueError('unbound enclave push destination')
    binary = git_config.resolve_git(cwd)
    urls = subprocess.run([binary, '-C', cwd, 'remote', 'get-url', '--push', '--all', '--', op.get('remote', 'origin')],
                          check=True, capture_output=True, text=True, timeout=2).stdout.splitlines()
    if len(urls) != 1 or not urls[0]:
        raise ValueError('enclave needs exactly one resolved remote URL')
    refs = op.get('refs', op.get('target', [op.get('ref', '')]))
    return dict(remote_url=urls[0], ref=json.dumps(refs, separators=(',', ':')), operation=op['class'], git_provider=binary)


def validate(token, payload, ops):
    if token['cwd'] != payload['cwd'] or token['command'] != payload['tool_input']['command']:
        return False
    expected = scope(token['command'], token['cwd'], ops)
    return all(token.get(k) == v for k, v in expected.items())


def verify(raw, home, signature):
    from tokens import private_read, pinned_fingerprints, PINS
    public = private_read(home / PUBLIC_KEY)
    # SPKI DER for id-ecPublicKey / prime256v1 + uncompressed point. Reject other curves.
    prefix = bytes.fromhex('3059301306072a8648ce3d020106082a8648ce3d03010703420004')
    if len(public) != 91 or not public.startswith(prefix):
        return False
    if hashlib.sha256(public).hexdigest() not in pinned_fingerprints(PINS):
        return False
    read_fd, write_fd = os.pipe()
    try:
        os.write(write_fd, public); os.close(write_fd); write_fd = None
        result = subprocess.run(['/usr/bin/openssl', 'dgst', '-sha256', '-verify', '/dev/fd/' + str(read_fd),
                                 '-keyform', 'DER', '-signature', str(signature)], input=raw,
                                capture_output=True, timeout=2, pass_fds=(read_fd,), env={"PATH": "/usr/bin:/bin"})
        return result.returncode == 0
    finally:
        os.close(read_fd)
        if write_fd is not None:
            os.close(write_fd)
