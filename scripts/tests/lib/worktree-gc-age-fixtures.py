"""Age every fixture worktree's creation marker (commondir) to 2h ago.

A real GC candidate is over an hour old, and GC keeps younger trees in every
mode. Only the creation marker moves; HEAD/index/logs activity is untouched,
so idle-window cases keep their meaning. Fixture roots only.
"""
import os
import sys
import time

old = time.time() - 2 * 3600
for here, dirs, files in os.walk(sys.argv[1]):
    if "commondir" in files and os.path.basename(os.path.dirname(here)) == "worktrees":
        os.utime(os.path.join(here, "commondir"), (old, old))
