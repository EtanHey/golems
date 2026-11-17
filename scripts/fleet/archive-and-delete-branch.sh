#!/usr/bin/env bash
# Prove the tip merged or save a bundle, then print (never execute) the pinned delete.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
# Match the hook installer's fixed Homebrew interpreter candidates; never PATH.
python=/opt/homebrew/bin/python3
if [[ ! -x "$python" ]]; then python=/usr/local/bin/python3; fi
if [[ ! -x "$python" && "$(uname -s)" != Darwin ]]; then python=/usr/bin/python3; fi
[[ -x "$python" ]] || { echo 'No fixed hook Python available' >&2; exit 1; }
exec "$python" -I -B - "$root" "$@" <<'PY'
import os
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path

if sys.version_info < (3, 11):
    sys.exit('Hook Python 3.11+ required')
sys.path.insert(0, str(Path(sys.argv[1]) / 'skills/golem-powers/human-confirm-gate/hooks'))
sys.path.insert(0, str(Path(sys.argv[1]) / 'skills/golem-powers/_shared'))
import tokens
from archived_delete import archive_path, archive_directories, check_bundle
from branch_cleanup import merged_proof


def git(repo, *args):
    return subprocess.check_output([tokens.GIT, '-C', str(repo), *args], text=True).strip()


def main():
    if len(sys.argv) != 5:
        raise ValueError('usage: archive-and-delete-branch.sh <repo-dir> <remote> <branch>')
    repo = str(Path(sys.argv[2]).resolve())
    remote, branch = sys.argv[3:]
    git(repo, 'check-ref-format', 'refs/heads/' + branch)
    target = tokens.own_lease_remote(repo, remote)
    # Fetch precisely this branch, then retain the fetched object before archiving.
    git(repo, 'fetch', '--no-tags', '--no-recurse-submodules', '--', remote, 'refs/heads/' + branch)
    sha = git(repo, 'rev-parse', '--verify', 'FETCH_HEAD^{commit}')
    command = shlex.join(['git', '-C', repo, 'push', '--force-with-lease=refs/heads/' + branch + ':' + sha,
                         remote, ':refs/heads/' + branch])
    try:
        default, _ = tokens.own_lease_metadata(target, branch)
        proof = merged_proof(repo, target, remote, branch, sha, default)
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError):
        proof = ''
    if proof:
        print(command)
        return
    path = archive_path(Path.home(), target, branch, sha)
    root = Path.home() / '.golems/branch-archive'
    archive_directories(root, path.parent, create=True)
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError('symlinked archive')
    if not path.exists():
        # A separate bare repo supplies the exact refs/heads name without moving
        # or replacing the caller's local branch. Private staging stays in archive.
        with tempfile.TemporaryDirectory(prefix='.bundle-source-', dir=path.parent) as staging:
            git(repo, 'init', '--bare', '-q', staging)
            git(staging, 'fetch', '--no-tags', '--', repo, sha + ':refs/heads/' + branch)
            candidate = Path(staging) / 'saved.bundle'
            git(staging, 'bundle', 'create', str(candidate), 'refs/heads/' + branch)
            candidate.chmod(0o600)
            check_bundle(candidate, repo, branch, sha, archive_root=root)
            # Exclusive hard link publishes without overwriting an existing copy.
            os.link(candidate, path)
    check_bundle(path, repo, branch, sha)
    print(command)


try:
    main()
except (ValueError, OSError, subprocess.SubprocessError) as exc:
    sys.exit('Archive refused: ' + str(exc))
PY
