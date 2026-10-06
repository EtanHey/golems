#!/usr/bin/env python3
"""Fail-open launcher for golems python hooks.

Usage (as registered by scripts/hooks/install-hooks.mjs):
    <pinned python3> -I -B ~/.claude/hooks/golems-fail-open.py <hook.py> [args...]

Imports: hooks live in a same-UID tree, so nothing planted beside a hook may
stand in for the stdlib. The launcher preloads runpy's lazy imports, then adds
the hook's dir LAST on sys.path (never first). -I drops PYTHONPATH and user
site; -B keeps hooks from writing bytecode into the tree. The Codex adapter
(codex-policy-hook.py) runs each policy child through this launcher the same
way; there, the launcher's exit 0 + stderr line is a denial, never an allow.

Claude Code treats exit 2 as a block, and `python3 missing.py` exits 2, so a
hook whose file vanished (hooks-live moved, a link dangles) would block every
matching tool call. This launcher turns every infrastructure or harness failure
that is not the hook's own decision into exit 0 plus ONE stderr line:
  - target missing            -> exit 0
  - import / syntax / runtime -> exit 0
  - the hook's own sys.exit() -> passed through unchanged (a deliberate block
    stays a block)

Security hooks must catch errors raised by their policy evaluator and convert
them to a value-free deliberate block before they reach this launcher. The
launcher cannot safely distinguish a policy error from an unrelated hook crash.

AIDEV-NOTE: this file is installed as a COPY on purpose (every other hook is a
symlink into hooks-live). It must still run when hooks-live is missing, and it
holds no policy, so it cannot drift in a way that matters. --status compares it
byte-for-byte with this source.
"""

import os
import pkgutil  # noqa: F401  runpy imports these lazily; load them before a hook dir joins sys.path
import runpy
import sys
import warnings  # noqa: F401


def _warn(message):
    print(f"golems-fail-open: {message} (allowing)".replace("\n", " "), file=sys.stderr)


def _scrub_path(hook_dir):
    """Put the hook's dir LAST on sys.path and drop the launcher's own dir.

    AIDEV-NOTE: no hook dir is ever FIRST on sys.path. Sibling imports still
    resolve from the real file's dir, but the stdlib always wins over anything
    planted beside a hook. Without -I, sys.path[0] is this launcher's own dir
    (the hooks dir of links). The scrub is by value, not by flag: hooks may be
    pinned to any Python >= 3.9, and sys.flags.safe_path (-P) only exists on
    3.11+. Under 3.9 -I there is no script dir to drop, so popping sys.path[0]
    there would remove the stdlib zip instead.
    """
    here = os.path.abspath(__file__)
    drop = {hook_dir, os.path.dirname(here), os.path.dirname(os.path.realpath(here))}
    sys.path[:] = [p for p in sys.path
                   if os.path.abspath(p) not in drop and os.path.realpath(p) not in drop]
    sys.path.append(hook_dir)


def main():
    if len(sys.argv) < 2:
        _warn("no hook path given")
        return 0
    target = sys.argv[1]
    if not os.path.isfile(target):
        _warn(f"hook missing: {target}")
        return 0
    sys.argv = sys.argv[1:]
    hook_dir = os.path.dirname(os.path.realpath(target))
    _scrub_path(hook_dir)
    try:
        runpy.run_path(target, run_name="__main__")
    except SystemExit:
        raise
    except BaseException as exc:  # noqa: BLE001 - failing open is the contract
        _warn(f"{os.path.basename(target)} failed: {type(exc).__name__}: {exc}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
