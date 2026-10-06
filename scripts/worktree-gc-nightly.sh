#!/usr/bin/env bash
# Nightly worktree prune (launchd com.golems.worktree-gc, 06:00, clear of BrainLayer's 03:00-05:30
# backup/scrub window). It never competes with a heavy suite: it takes the shared heavy-suite lock
# WITHOUT waiting and holds it for the whole prune. A held lock skips the night (logged, exit 0);
# the next night retries. Extra arguments pass through to worktree-gc.sh --apply.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
LOCK="${GOLEMS_HEAVY_LOCK:-$HOME/.local/state/golems/heavy-suite.lock}"
mkdir -p "$(dirname "$LOCK")"

# AIDEV-NOTE: $^F keeps the lock fd open across exec, so the flock lives exactly as long as the
# prune. Opened for append: heavy-suite.py keeps its owner record in the same file.
exec perl -MFcntl=:flock -e '
  my $lock = shift;
  $^F = 255;
  open(my $fh, ">>", $lock) or die "worktree-gc-nightly: cannot open $lock: $!\n";
  if (!flock($fh, LOCK_EX | LOCK_NB)) {
    print STDERR "worktree-gc-nightly: SKIP heavy-suite lock held ($lock); next night retries\n";
    exit 0;
  }
  exec @ARGV or die "worktree-gc-nightly: exec failed: $!\n";
' "$LOCK" /bin/bash "$HERE/worktree-gc.sh" --apply "$@"
