#!/usr/bin/env python3
"""Refuse worktree creation below the host floor (15 GiB fallback); GOLEMS_WORKTREE_MIN_FREE_GB overrides it."""
import math
import os
from pathlib import Path
import shutil
import sys


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
        raise ValueError(f'worktree creation refused: {free:.1f} GiB free at {parent}; '
                         f'requires {floor:g} GiB (GOLEMS_WORKTREE_MIN_FREE_GB)')


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('usage: worktree-disk-floor.py <target-worktree>')
        check_space(sys.argv[1])
    except (ValueError, OSError) as exc:
        print(exc, file=sys.stderr)
        sys.exit(2)
