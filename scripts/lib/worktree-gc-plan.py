#!/usr/bin/env python3
"""Append list-only TSV inventory, using the archiver's exact preservation policy."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

spec = importlib.util.spec_from_file_location('archive', Path(__file__).with_name('worktree-archive.py'))
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)
HEADER = 'repo\tpath\tbranch\tverdict\treason\tsize_bytes\tnotes_to_archive_json\tinventory_status\n'


def notes(root):
    result = subprocess.run(['git', '-C', root, 'ls-files', '-z', '-o', '-i',
                             '--exclude-standard', '--directory'], check=True,
                            capture_output=True, timeout=30)
    entries = sorted({os.fsdecode(e).rstrip('/') for e in result.stdout.split(b'\0') if e})
    tops = [e for e in entries if not any(e.startswith(o + '/') for o in entries if o != e)]
    keep = [leaf for e in tops for leaf in archive.expand(root, e)]
    paths = set(keep)
    for rel in keep:
        full = os.path.join(root, rel)
        if os.path.isdir(full) and not os.path.islink(full):
            for here, dirs, files in os.walk(full, followlinks=False, onerror=archive._raise):
                for name in dirs + files:
                    paths.add(os.path.relpath(os.path.join(here, name), root))
    return sorted(paths)


def append(output, repo, root, branch, verdict, reason):
    size, inventory, status = 'UNKNOWN', None, []
    try:
        result = subprocess.run(['du', '-sk', root], check=True, capture_output=True, timeout=30)
        size = str(int(result.stdout.split()[0]) * 1024)
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        status.append('size-unknown')
    try:
        inventory = notes(root)
    except (OSError, ValueError, subprocess.SubprocessError):
        status.append('notes-unknown')
    if status and verdict == 'REMOVE':
        verdict = 'KEEP-undetermined'
        reason += '; incomplete plan inventory'
    cells = (repo, root, branch, verdict, reason, size,
             json.dumps(inventory, ensure_ascii=True), ','.join(status) or 'complete')
    with open(output, 'a') as out:
        out.write('\t'.join(archive.escape_field(c) for c in cells) + '\n')


if __name__ == '__main__':
    if sys.argv[1] == 'init':
        Path(sys.argv[2]).write_text(HEADER)
    else:
        append(*sys.argv[2:])
