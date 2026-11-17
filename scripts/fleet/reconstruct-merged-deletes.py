#!/usr/bin/env python3
"""Verify supplied historical tips, then append explicitly reconstructed receipts.

Usage: python3 -I scripts/fleet/reconstruct-merged-deletes.py REPO REMOTE BRANCH SHA [BRANCH SHA ...]
Never deletes branches. The caller must establish that these historical deletes occurred.
"""
import datetime
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'skills/golem-powers/_shared'),
                str(ROOT / 'skills/golem-powers/human-confirm-gate/hooks')]
from branch_cleanup import merged_proof, record
import tokens


def repository_default(target):
    gh = tokens.trusted_binary(tokens.GH_CANDIDATES)
    metadata = json.loads(subprocess.check_output([gh, "api", "--hostname", "github.com", "repos/" + target], text=True, timeout=2))
    if metadata["full_name"] != target: raise ValueError("repository identity mismatch")
    return metadata["default_branch"]


def reconstruct(repo, remote, pairs, home):
    target = tokens.own_lease_remote(repo, remote)
    default = repository_default(target)
    verified = []
    for branch, sha in pairs:
        if not re.fullmatch(r'[0-9a-f]{40}', sha):
            raise ValueError('full SHA required')
        subprocess.run([tokens.GIT, 'check-ref-format', 'refs/heads/' + branch],
                       check=True, capture_output=True, timeout=2)
        proof = merged_proof(repo, target, remote, branch, sha, default)
        if not proof:
            raise ValueError('unproven branch tip: ' + branch)
        verified.append((branch, sha, proof))
    # Verify every pair before writing any row; a later write failure can still
    # leave earlier rows, which remain truthful reconstructed evidence.
    for branch, sha, proof in verified:
        record(home, target, branch, sha, rule='merged-on-main', proof=proof,
               reconstructed=True, reconstructed_on=datetime.date.today().isoformat())


def main():
    args = sys.argv[1:]
    if len(args) < 4 or len(args) % 2:
        raise ValueError(__doc__)
    reconstruct(str(Path(args[0]).resolve()), args[1], list(zip(args[2::2], args[3::2])), Path.home())


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as exc:
        sys.exit('Reconstruction refused: ' + str(exc))
