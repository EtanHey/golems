#!/usr/bin/env python3
"""Install the PATH entry from the pinned hooks-live tree; no checkout fallback."""
from pathlib import Path
import os
source = Path.home() / 'Gits/golems/.worktrees/hooks-live/scripts/hooks/heavy-run'
if not source.is_file():
    raise SystemExit('Pinned heavy-run missing; update hooks-live first')
target = Path.home() / '.local/bin/heavy-run'
target.parent.mkdir(parents=True, exist_ok=True)
if target.is_symlink() and target.resolve() == source.resolve():
    raise SystemExit(0)
if target.exists() or target.is_symlink():
    raise SystemExit('Refusing to replace existing heavy-run')
os.symlink(source, target)
