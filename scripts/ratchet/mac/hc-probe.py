#!/usr/bin/env python3
"""human-confirm row: feed real PreToolUse payloads to the INSTALLED hook. Nothing is pushed.

Reads the hook command from $HOME/.claude/settings.json (the installer wrote it) and runs it
with the real interpreter. The lease is scoped to a real open PR (gh is read-only here):
  A  no token, lease to the PR head      -> deny
  B  lead token issued by the installed golems-lead-confirm
  C  the same lease with that token      -> allow
  D  the same lease again (replay)       -> deny
  E  a lease to master                   -> deny
Prints one JSON line and exits 0 only when A-E all hold. Run it with HOME set to the home the
hook was installed into: local-run.sh points it at a scratch HOME, live-rows.sh at the real one.
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path


def hook_command(home):
    settings = json.loads((home / '.claude/settings.json').read_text())
    for group in settings.get('hooks', {}).get('PreToolUse', []):
        for hook in group.get('hooks', []):
            if 'human-confirm' in str(hook.get('command', '')):
                return hook['command']
    return None


def feed(hook, command, cwd, session):
    payload = json.dumps(dict(tool_name='Bash', tool_input=dict(command=command), cwd=cwd,
                              session_id=session, hook_event_name='PreToolUse'))
    run = subprocess.run(['sh', '-c', hook], input=payload, capture_output=True, text=True, timeout=60)
    out = run.stdout + run.stderr
    denied = run.returncode == 2 or '"deny"' in out or '"block"' in out
    return 'DENY' if denied else 'ALLOW', f'rc={run.returncode} ' + out.replace('\n', ' ')[:160]


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
    hook = hook_command(home)
    if hook is None:
        # An unregistered gate (e.g. a refused, unpinned tree) guards nothing: every deny fails.
        steps['hook'] = 'human-confirm not registered in settings.json'
        print(json.dumps(dict(ok=False, steps=steps)))
        return 1
    steps['A_no_token'] = feed(hook, lease, args.repo, session)
    # Exec the issuer the way a lead does (its own shebang), so its side effects are real.
    issued = subprocess.run([args.issuer, args.repo, '--ref', f'refs/heads/{args.branch}', '--sha', args.sha,
                             '--session', session], capture_output=True, text=True, timeout=60)
    steps['B_issue'] = ('OK' if issued.returncode == 0 else 'REFUSED',
                        f'rc={issued.returncode} ' + (issued.stdout + issued.stderr).replace('\n', ' ')[:160])
    steps['C_token'] = feed(hook, lease, args.repo, session)
    steps['D_replay'] = feed(hook, lease, args.repo, session)
    steps['E_master'] = feed(hook, master, args.repo, session)
    expected = dict(A_no_token='DENY', B_issue='OK', C_token='ALLOW', D_replay='DENY', E_master='DENY')
    ok = all(steps[key][0] == want for key, want in expected.items())
    print(json.dumps(dict(ok=ok, steps=steps)))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
