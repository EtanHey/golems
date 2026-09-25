#!/usr/bin/env python3
"""Fail-open launcher for golems python hooks.

Usage (as registered by scripts/hooks/install-hooks.mjs):
    python3 ~/.claude/hooks/golems-fail-open.py <hook.py> [args...]

Claude Code treats exit 2 as a block, and `python3 missing.py` exits 2, so a
hook whose file vanished (hooks-live moved, a link dangles) would block every
matching tool call. This launcher turns every failure that is not the hook's
own decision into exit 0 plus ONE stderr line:
  - target missing            -> exit 0
  - import / syntax / runtime -> exit 0
  - the hook's own sys.exit() -> passed through unchanged (a deliberate block
    stays a block)

AIDEV-NOTE: this file is installed as a COPY on purpose (every other hook is a
symlink into hooks-live). It must still run when hooks-live is missing, and it
holds no policy, so it cannot drift in a way that matters. --status compares it
byte-for-byte with this source.
"""

import os
import runpy
import sys


def _warn(message):
    print(f"golems-fail-open: {message} (allowing)".replace("\n", " "), file=sys.stderr)


def main():
    if len(sys.argv) < 2:
        _warn("no hook path given")
        return 0
    target = sys.argv[1]
    if not os.path.isfile(target):
        _warn(f"hook missing: {target}")
        return 0
    sys.argv = sys.argv[1:]
    # Match `python3 target.py`: sibling imports resolve from the real file's dir.
    sys.path[0] = os.path.dirname(os.path.realpath(target))
    try:
        runpy.run_path(target, run_name="__main__")
    except SystemExit:
        raise
    except BaseException as exc:  # noqa: BLE001 - failing open is the contract
        _warn(f"{os.path.basename(target)} failed: {type(exc).__name__}: {exc}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
