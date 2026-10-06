#!/usr/bin/env bash
# Nightly worktree prune (launchd com.golems.worktree-gc, 06:00, clear of BrainLayer's 03:00-05:30
# backup/scrub window). It never competes with a heavy suite: a perl parent takes the shared
# heavy-suite lock WITHOUT waiting and holds it while the prune runs as its child. A held lock, or
# a lock it cannot open, skips the night (logged, exit 0); the next night retries.
# The child never inherits the lock fd (close-on-exec), so no daemon a child spawns (git
# fsmonitor, ...) can keep the lock after the run. The run is time-limited
# (WORKTREE_GC_NIGHTLY_TIMEOUT seconds, default 3600): on expiry the child's process group is
# killed and the exit is 124. A completed run exits 0 even when it KEEPs unpushed worktrees.
# Extra arguments pass through to worktree-gc.sh --apply.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
LOCK="${GOLEMS_HEAVY_LOCK:-$HOME/.local/state/golems/heavy-suite.lock}"
LIMIT="${WORKTREE_GC_NIGHTLY_TIMEOUT:-3600}"

if ! mkdir -p "$(dirname "$LOCK")" 2>/dev/null; then
  echo "worktree-gc-nightly: SKIP cannot create the lock dir for $LOCK; next night retries" >&2
  exit 0
fi

# AIDEV-NOTE: perl opens fds above $^F (2) close-on-exec, so the child below
# never holds the lock; only this parent does, and only until the child exits.
exec perl -MFcntl=:flock -MPOSIX=:sys_wait_h -e '
  my ($lock, $limit, @cmd) = @ARGV;
  my $fh;
  if (!open($fh, ">>", $lock)) {
    print STDERR "worktree-gc-nightly: SKIP cannot open heavy-suite lock $lock ($!); next night retries\n";
    exit 0;
  }
  if (!flock($fh, LOCK_EX | LOCK_NB)) {
    print STDERR "worktree-gc-nightly: SKIP heavy-suite lock held ($lock); next night retries\n";
    exit 0;
  }
  my $pid = fork() // die "worktree-gc-nightly: fork failed: $!\n";
  if (!$pid) { setpgrp(0, 0); exec @cmd or die "worktree-gc-nightly: exec failed: $!\n" }
  local $SIG{ALRM} = sub {
    print STDERR "worktree-gc-nightly: TIMEOUT after ${limit}s; killing the prune\n";
    kill "TERM", -$pid; sleep 5; kill "KILL", -$pid;
    waitpid($pid, 0); flock($fh, LOCK_UN); exit 124;
  };
  alarm $limit;
  waitpid($pid, 0);
  alarm 0;
  my $rc = WIFEXITED($?) ? WEXITSTATUS($?) : 128 + WTERMSIG($?);
  flock($fh, LOCK_UN);
  # 1 = completed with KEEP-unpushed rows: a clean run, not a failure.
  exit($rc == 1 ? 0 : $rc);
' "$LOCK" "$LIMIT" /bin/bash "$HERE/worktree-gc.sh" --apply "$@"
