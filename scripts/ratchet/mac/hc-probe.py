#!/usr/bin/env python3
"""human-confirm row: feed real PreToolUse payloads to the INSTALLED hook. Nothing is pushed.

Reads the hook command from $HOME/.claude/settings.json (the installer wrote it) and runs it
with the real interpreter. The lease is scoped to a real open PR (gh is read-only here):
  A  no token, own lease to the PR head  -> allow
  A2 plain force to the PR branch        -> deny
  A3 lease to a foreign repository URL   -> deny
  B  token-only checkout (local fetch, real PR push URL) without token -> deny
     lead token issued by the installed golems-lead-confirm
  C  that checkout with the token        -> allow
     issued token and signature gone, one matching new spent marker -> OK
  D  the same token-only lease again     -> deny
     original own-branch checkout replay -> allow
  E  a lease to master                   -> deny
Prints one JSON line and exits 0 only when all ten steps hold. Run it with HOME set to the home the
hook was installed into: local-run.sh points it at a scratch HOME, live-rows.sh at the real one.
"""
import argparse
from contextlib import contextmanager
import json
import os
import re
import subprocess
import sys
import time
import tempfile
from pathlib import Path


def hook_command(home):
    settings = json.loads((home / '.claude/settings.json').read_text())
    for group in settings.get('hooks', {}).get('PreToolUse', []):
        for hook in group.get('hooks', []):
            if 'human-confirm' in str(hook.get('command', '')):
                return hook['command']
    return None


OUTPUT_LIMIT = 4096


def diagnostics(run, started):
    detail = dict(rc=run.returncode, wall_ms=round((time.monotonic() - started) * 1000, 3))
    for stream in ('stdout', 'stderr'):
        raw = getattr(run, stream).encode('utf-8')
        detail[stream] = raw[:OUTPUT_LIMIT].decode('utf-8', errors='ignore')
        detail[stream + '_truncated'] = len(raw) > OUTPUT_LIMIT
    return detail


def feed(hook, command, cwd, session):
    payload = json.dumps(dict(tool_name='Bash', tool_input=dict(command=command), cwd=cwd,
                              session_id=session, hook_event_name='PreToolUse'))
    started = time.monotonic()
    run = subprocess.run(['sh', '-c', hook], input=payload, capture_output=True, text=True, timeout=60)
    out = run.stdout + run.stderr
    # Any other exit (a hook crash) is ALLOW: Claude Code treats a non-blocking hook error as allow.
    denied = run.returncode == 2 or '"deny"' in out or '"block"' in out
    return 'DENY' if denied else 'ALLOW', f'rc={run.returncode} ' + out.replace('\n', ' ')[:160], diagnostics(run, started)


def token_files(home):
    try:
        return {path.name for path in (home / '.config/golems/human-confirm').iterdir()}
    except FileNotFoundError:
        return set()
    except OSError:
        return None


def consumed_token(home, before_issue, before_command):
    started = time.monotonic()
    after = token_files(home)
    readable = all(names is not None for names in (before_issue, before_command, after))
    issued, spent = set(), set()
    if readable:
        issued = {name[:-5] for name in before_command - before_issue if re.fullmatch(r'[0-9a-f]{32}\.json', name)}
        spent = {name for name in after - before_command if re.fullmatch(r'[0-9a-f]{32}\.spent', name)}
    nonce = next(iter(issued)) if len(issued) == 1 else None
    paired = bool(nonce and nonce + '.json.sig' in before_command)
    absent = bool(nonce and after is not None and nonce + '.json' not in after and nonce + '.json.sig' not in after)
    matching = bool(nonce and spent == {nonce + '.spent'})
    if matching:
        marker = home / '.config/golems/human-confirm' / (nonce + '.spent')
        try:
            matching = marker.is_file() and not marker.is_symlink()
        except OSError:
            matching = False
    ok = readable and paired and absent and matching
    summary = json.dumps(dict(readable=readable, issued=len(issued), new_spent=len(spent),
                              signature_before=paired, token_and_signature_gone=absent, matching_spent=matching))
    run = subprocess.CompletedProcess([], 0 if ok else 1, summary, '')
    return 'OK' if ok else 'NOT_SPENT', summary, diagnostics(run, started)


@contextmanager
def token_checkout(repo, branch):
    """A disposable real checkout outside the unsigned own-lease route.

    Lead scope uses the push URL; the unsigned exception also requires an
    identical fetch URL. Keep the real PR destination, but make fetch local.
    Never change the caller's remotes (this probe also runs on the live tier).
    """
    def git(*args):
        return subprocess.run(['/usr/bin/git', *args], capture_output=True, text=True,
                              check=True, timeout=30).stdout.strip()

    push_url = git('-C', repo, 'remote', 'get-url', '--push', '--all', 'origin')
    scratch = Path(repo) / 'docs.local'
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='hc-token-', dir=scratch) as directory:
        checkout = str(Path(directory, 'repo').resolve())
        git('clone', '--shared', '--no-checkout', repo, checkout)
        git('-C', checkout, 'symbolic-ref', 'HEAD', 'refs/heads/' + branch)
        git('-C', checkout, 'remote', 'set-url', 'origin', str(Path(repo).resolve()))
        git('-C', checkout, 'remote', 'set-url', '--push', 'origin', push_url)
        yield checkout


def run_issuer(argv):
    return subprocess.run(argv, capture_output=True, text=True, timeout=60)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--repo', required=True, help='a checkout on the PR branch whose origin push URL is github.com')
    parser.add_argument('--branch', required=True)
    parser.add_argument('--sha', required=True, help='the PR head SHA the lease pins')
    parser.add_argument('--issuer', required=True, help='the installed golems-lead-confirm')
    args = parser.parse_args()
    home = Path(os.environ['HOME'])
    session = f'ratchet-hc-{int(time.time())}'
    lease = f'git push --force-with-lease=refs/heads/{args.branch}:{args.sha} origin HEAD:refs/heads/{args.branch}'
    master = f'git push --force-with-lease=refs/heads/master:{args.sha} origin HEAD:refs/heads/master'
    steps = {}
    details = {}

    def record(key, result):
        verdict, summary, detail = result
        steps[key] = (verdict, summary)
        details[key] = detail

    hook = hook_command(home)
    if hook is None:
        # An unregistered gate (e.g. a refused, unpinned tree) guards nothing: every deny fails.
        steps['hook'] = 'human-confirm not registered in settings.json'
        print('human-confirm first failing step hook: ' + steps['hook'], file=sys.stderr)
        print(json.dumps(dict(ok=False, steps=steps, details=details, first_failure='hook')))
        return 1
    record('A_own_lease', feed(hook, lease, args.repo, session))
    record('A2_plain_force', feed(hook, f'git push --force origin HEAD:refs/heads/{args.branch}', args.repo, session))
    foreign = lease.replace(' origin ', ' https://github.com/pingdotgg/t3code.git ', 1)
    record('A3_foreign', feed(hook, foreign, args.repo, session))
    with token_checkout(args.repo, args.branch) as token_repo:
        # Fail closed if the supposedly token-only route gains an unsigned exception.
        record('B_no_token', feed(hook, lease, token_repo, session))
        before_issue = token_files(home)
        # Exec the installed issuer with its own shebang; no synthetic capability.
        started = time.monotonic()
        issued = run_issuer([args.issuer, token_repo, '--ref', f'refs/heads/{args.branch}',
                             '--sha', args.sha, '--session', session])
        steps['B_issue'] = ('OK' if issued.returncode == 0 else 'REFUSED',
                            f'rc={issued.returncode} ' + (issued.stdout + issued.stderr).replace('\n', ' ')[:160])
        details['B_issue'] = diagnostics(issued, started)
        before_command = token_files(home)
        record('C_token', feed(hook, lease, token_repo, session))
        record('C_spent', consumed_token(home, before_issue, before_command))
        record('D_replay', feed(hook, lease, token_repo, session))
    record('D_own_replay', feed(hook, lease, args.repo, session))
    record('E_master', feed(hook, master, args.repo, session))
    expected = dict(A_own_lease='ALLOW', A2_plain_force='DENY', A3_foreign='DENY',
                    B_no_token='DENY', B_issue='OK', C_token='ALLOW', C_spent='OK', D_replay='DENY', D_own_replay='ALLOW', E_master='DENY')
    ok = all(steps[key][0] == want for key, want in expected.items())
    first_failure = next((key for key, want in expected.items() if steps[key][0] != want), None)
    if first_failure:
        detail = details[first_failure]
        # JSON escaping keeps even multiline hook reasons on one receipt-log line.
        print(f'human-confirm first failing step {first_failure}: '
              + json.dumps(detail), file=sys.stderr)
    print(json.dumps(dict(ok=ok, steps=steps, details=details, first_failure=first_failure)))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
