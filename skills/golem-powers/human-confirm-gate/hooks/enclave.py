"""Enclave wire contract. Software signing implementations belong only in tests."""
import hashlib
import json
import os
import re
import shlex
import subprocess
import unicodedata
from pathlib import Path

PUBLIC_KEY = Path('.config/golems/enclave-public.der')
HELPER = '/Library/PrivilegedHelperTools/com.golems.approve/GolemsApprove.app/Contents/MacOS/golems-approve'
ENROLL_TEAM_ID = 'PPN23G925Y'


def validate_reason(reason):
    if reason is not None and (not isinstance(reason, str) or len(reason) > 200 or
            any(ord(c) in (0x115f, 0x1160, 0x3164, 0xffa0) or (c != ' ' and unicodedata.category(c)[0] not in 'LNPS') for c in reason)):
        raise ValueError('reason must be one printable line of at most 200 characters; no controls or invisible marks')
    return reason


def operation_sentence(url, op):
    """Fixed gate copy from parsed scope; never consume caller explanatory text."""
    if not isinstance(url, str) or not url or len(url) > 400 or any(not 32 <= ord(c) <= 126 for c in url):
        raise ValueError('unsafe repository display')
    github = re.fullmatch(r'(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?', url)
    repo = 'GitHub repo ' + github[1] if github else 'repository ' + url
    kind = op.get('class')
    if kind == 'settings':
        target = op.get('target')
        if not isinstance(target, str) or not re.fullmatch(r'repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/(?:rulesets/[0-9]+|branches/[A-Za-z0-9_./-]+/protection)', target):
            raise ValueError('unknown settings shape')
        return 'Change repository protections at ' + target + '. This may permit destructive changes.'
    if kind == 'lease':
        ref = op.get('ref', '')
    elif kind in ('delete', 'force', 'rewrite'):
        refs = op.get('refs')
        if not isinstance(refs, list) or not all(isinstance(r, str) for r in refs):
            raise ValueError('unknown branch shape')
        if kind == 'rewrite': refs = [r for r in refs if r not in ('--force', '-f', '--')]
        if len(refs) != 1: raise ValueError('need exactly one explicit branch')
        ref = refs[0].lstrip('+').rsplit(':', 1)[-1]
    else:
        raise ValueError('unknown operation class')
    if not isinstance(ref, str) or not re.fullmatch(r'refs/heads/[A-Za-z0-9][A-Za-z0-9_./-]*', ref) or '..' in ref or '//' in ref:
        raise ValueError('unknown explicit branch shape')
    branch = ref[len('refs/heads/'):]
    return {
        'delete': f'Delete branch {branch} from {repo}. This cannot be undone.',
        'force': f'Force-push over branch {branch} in {repo}. Remote history may be overwritten.',
        'lease': f'Force-push over branch {branch} in {repo} only if its expected remote revision still matches.',
        'rewrite': f'Rewrite shared history on branch {branch} in {repo}.'
    }[kind]


def scope(command, cwd, ops):
    """One explicit Git operation; wrappers refuse rather than guess display scope."""
    import git_config
    words = shlex.split(command)
    if words and words[0] == 'gh':
        raise ValueError('enclave refuses gh until its exact GitHub target can be rendered')
    lexer = shlex.shlex(command, posix=True, punctuation_chars=';&|()<>')
    lexer.whitespace_split = True
    if any(word and all(c in ';&|()<>' for c in word) for word in lexer):
        raise ValueError('enclave cannot establish a GitHub target through compound commands')
    if len(words) < 2 or words[0] != 'git' or words[1] not in ('push', 'filter-branch', 'filter-repo', 'replace', 'rebase', 'config') or len(ops) != 1 or ops[0]['class'] not in ('delete', 'force', 'lease', 'rewrite', 'settings'):
        raise ValueError('enclave requires one direct Git operation; GitHub target aliases are unsupported')
    op = ops[0]
    if op['repo'] != cwd or ('push' in words[:2] and not re.fullmatch('[0-9a-f]{64}', op.get('push_config_sha256', ''))):
        raise ValueError('unbound enclave push destination')
    binary = git_config.resolve_git(cwd)
    urls = subprocess.run([binary, '-C', cwd, 'remote', 'get-url', '--push', '--all', '--', op.get('remote', 'origin')],
                          check=True, capture_output=True, text=True, timeout=2).stdout.splitlines()
    if len(urls) != 1 or not urls[0]:
        raise ValueError('enclave needs exactly one resolved remote URL')
    operation_sentence(urls[0], op)
    if ((words[1] == 'push' and op['class'] not in ('delete', 'force', 'lease')) or
            (words[1] != 'push' and (words[1] not in ('filter-branch', 'filter-repo', 'replace') or op['class'] != 'rewrite'))):
        raise ValueError('unknown direct operation shape')
    refs = op.get('refs', op.get('target', [op.get('ref', '')]))
    return dict(remote_url=urls[0], ref=json.dumps(refs, separators=(',', ':')), operation=op['class'], git_provider=binary)


def validate(token, payload, ops):
    validate_reason(token.get('reason'))
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
