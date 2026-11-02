#!/usr/bin/env python3
"""Refuse worktree creation below the host floor (15 GiB fallback); GOLEMS_WORKTREE_MIN_FREE_GB overrides it."""
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys


def disk_report(parent):
    """Bounded optional Available probe; callers retain their own raw fallback."""
    binary = shutil.which('brainlayer') or '/opt/homebrew/opt/brainlayer/bin/brainlayer'
    try:
        result = subprocess.run([binary, 'disk', '--path', str(parent), '--json'],
                                capture_output=True, text=True, check=True, timeout=8)
        data = json.loads(result.stdout)
        if not isinstance(data, dict) or data.get('source') in ('statfs_macos_available_unavailable', 'statfs_raw_only'):
            return None
        values = [data[key] for key in ('available_bytes', 'free_now_bytes', 'purgeable_bytes')]
        if any(type(value) is not int or value < 0 for value in values):
            return None
        if values[0] < values[1] or values[2] != values[0] - values[1]:
            return None
        return values
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError):
        return None


def describe(values):
    available, free, purgeable = values
    return (f'Available {available / 1e9:.1f} GB '
            f'({free / 1e9:.1f} GB free now + {purgeable / 1e9:.1f} GB purgeable)')


def measure(parent):
    values = disk_report(parent)
    if values is not None:
        print(*values, sep='\t')
        print(describe(values))
    else:
        # Preserve this reader's existing df measurement as the fallback.
        output = subprocess.check_output(['df', '-Pk', str(parent)], text=True)
        free = int(output.splitlines()[1].split()[3]) * 1024
        if free < 0:
            raise ValueError('negative df measurement')
        print(f'{free}\t{free}\tnull')
        print(f'{free / 1e9:.1f} GB free-now only; purgeable unknown')


def check_space(target):
    try:
        floor = float(os.environ.get('GOLEMS_WORKTREE_MIN_FREE_GB', '15'))
    except ValueError as exc:
        raise ValueError('GOLEMS_WORKTREE_MIN_FREE_GB must be a finite nonnegative number') from exc
    if not math.isfinite(floor) or floor < 0:
        raise ValueError('GOLEMS_WORKTREE_MIN_FREE_GB must be a finite nonnegative number')
    parent = Path(target).resolve()
    while not parent.exists():
        parent = parent.parent
    free = shutil.disk_usage(parent).free / 1024**3
    if free < floor:
        values = disk_report(parent)
        detail = describe(values) if values is not None else 'free-now only; purgeable unknown'
        free_gb = free * 1024**3 / 1e9
        floor_gb = floor * 1024**3 / 1e9
        raise ValueError(f'worktree creation refused: {free_gb:.1f} GB free now at {parent}; '
                         f'immediate allocation requires {floor_gb:.1f} GB free now '
                         f'(GOLEMS_WORKTREE_MIN_FREE_GB={floor:g}); {detail}')


if __name__ == '__main__':
    try:
        if len(sys.argv) == 3 and sys.argv[1] == '--measure':
            measure(sys.argv[2])
            sys.exit(0)
        if len(sys.argv) != 2:
            raise ValueError('usage: worktree-disk-floor.py <target-worktree>')
        check_space(sys.argv[1])
    except (ValueError, OSError, subprocess.SubprocessError, IndexError) as exc:
        print(exc, file=sys.stderr)
        sys.exit(2)
