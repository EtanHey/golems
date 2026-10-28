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

GC_MIN_SAFE_SHA=21051c815433bab7cb77a0633e06b19c10fb2cad
PIN="${GOLEMS_WORKTREE_GC_PIN_ROOT-$HOME/Gits/golems/.worktrees/hooks-live}"
PIN_SHA=unavailable
# Match install-hooks.mjs: porcelain must not trust flags, caches or replacements.
git() {
  GIT_NO_REPLACE_OBJECTS=1 command git -c core.fsmonitor=false -c core.untrackedCache=false -c core.commitGraph=false "$@"
}
log_pin_lag() {
  local lag
  lag="$(git -C "$PIN" rev-list --count HEAD..refs/remotes/origin/master 2>/dev/null)" || lag=unavailable
  if [[ "$lag" =~ ^[0-9]+$ ]]; then
    echo "worktree-gc-nightly: pin is $lag commits behind origin/master" >&2
  else
    echo 'worktree-gc-nightly: pin lag unavailable' >&2
  fi
}
refuse_pin() {
  log_pin_lag
  echo "worktree-gc-nightly: REFUSE $1 (pin=$PIN, pin SHA $PIN_SHA)" >&2
  exit 2
}
if [[ "${GOLEMS_WORKTREE_GC_PIN_ROOT+x}" == x ]]; then
  echo "worktree-gc-nightly: WARNING GOLEMS_WORKTREE_GC_PIN_ROOT override in use: $PIN" >&2
fi
PYTHON=/usr/bin/python3
[[ -x "$PYTHON" ]] || PYTHON=python3
realpath() {
  "$PYTHON" -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$1"
}
WRAPPER="$(realpath "${BASH_SOURCE[0]}" 2>/dev/null)" || refuse_pin 'cannot resolve wrapper'
HERE="$(cd "$(dirname "$WRAPPER")" && pwd -P)" || refuse_pin 'cannot resolve wrapper directory'
source "$HERE/lib/worktree-git-env.sh"

# The root checkout can lag the installed safety fixes. Never execute its GC.
[[ -d "$PIN" ]] || refuse_pin 'pin missing'
PIN="$(cd "$PIN" && pwd -P)" || refuse_pin 'cannot resolve pin'
pin_head="$(git -C "$PIN" rev-parse --verify 'HEAD^{commit}' 2>/dev/null)" || refuse_pin 'pin HEAD unavailable'
PIN_SHA="$pin_head"
top="$(git -C "$PIN" rev-parse --show-toplevel 2>/dev/null)" || refuse_pin 'not a golems worktree'
[[ "$top" == "$PIN" ]] || refuse_pin 'not a golems worktree'
admin="$(git -C "$PIN" rev-parse --absolute-git-dir 2>/dev/null)" || refuse_pin 'not a golems worktree'
common="$(git -C "$PIN" rev-parse --git-common-dir 2>/dev/null)" || refuse_pin 'not a golems worktree'
[[ "$common" == /* ]] || common="$PIN/$common"
common="$(cd "$common" && pwd -P)" || refuse_pin 'not a golems worktree'
main="$(golems_main_repo "$HOME/Gits/golems" 2>/dev/null)" || refuse_pin 'not a golems worktree'
main_admin="$(git -C "$main" rev-parse --absolute-git-dir 2>/dev/null)" || refuse_pin 'not a golems worktree'
[[ "$common" == "$main_admin" && "$admin" != "$common" ]] || refuse_pin 'not a golems worktree'
replaced="$(git -C "$PIN" for-each-ref --format='%(refname)' refs/replace/ 2>/dev/null)" || refuse_pin 'cannot inspect replace refs'
[[ -z "$replaced" ]] || refuse_pin 'replace refs present'
grafts="$(git -C "$PIN" rev-parse --git-path info/grafts)" || refuse_pin 'cannot inspect pin grafts'
(cd "$PIN" && [[ ! -f "$grafts" ]]) || refuse_pin 'pin grafts present'
flags="$(git -C "$PIN" ls-files -v 2>/dev/null)" || refuse_pin 'pin index unavailable'
while IFS= read -r entry; do
  [[ ! "$entry" =~ ^(S|[a-z])[[:space:]] ]] || refuse_pin 'pin dirty (index flags hide content)'
done <<< "$flags"
pin_status="$(git -C "$PIN" status --porcelain --untracked-files=all 2>/dev/null)" || refuse_pin 'pin status unavailable'
[[ -z "$pin_status" ]] || refuse_pin 'pin dirty'
git -C "$PIN" diff --quiet --no-ext-diff --ignore-submodules=none HEAD -- 2>/dev/null || refuse_pin 'pin dirty (HEAD content differs)'
# Use the currently fetched full ref; network availability must never waive ancestry.
git -C "$PIN" rev-parse --verify refs/remotes/origin/master >/dev/null 2>&1 || refuse_pin 'origin/master missing'
git -C "$PIN" merge-base --is-ancestor HEAD refs/remotes/origin/master 2>/dev/null || refuse_pin 'HEAD is not on origin/master'
git -C "$PIN" merge-base --is-ancestor "$GC_MIN_SAFE_SHA" HEAD 2>/dev/null || refuse_pin 'pin predates GC safety floor'
GC_SCRIPT="$(realpath "$PIN/scripts/worktree-gc.sh" 2>/dev/null)" || refuse_pin 'cannot resolve GC script'
[[ "$GC_SCRIPT" == "$PIN/"* ]] || refuse_pin 'GC script outside pin'
[[ -f "$GC_SCRIPT" ]] || refuse_pin 'GC script missing'
log_pin_lag
echo "worktree-gc-nightly: verified pin SHA $PIN_SHA ($PIN)" >&2
if [[ "$WRAPPER" != "$PIN/"* ]]; then
  [[ -z "${GOLEMS_WORKTREE_GC_REEXEC:-}" ]] || refuse_pin 're-exec loop'
  pinned_wrapper="$(realpath "$PIN/scripts/worktree-gc-nightly.sh" 2>/dev/null)" || refuse_pin 'cannot resolve pinned wrapper'
  [[ "$pinned_wrapper" == "$PIN/"* && -x "$pinned_wrapper" ]] || refuse_pin 'pinned wrapper missing or outside pin'
  export GOLEMS_WORKTREE_GC_REEXEC=1
  exec "$PIN/scripts/worktree-gc-nightly.sh" "$@"
fi

# Nightly must prove registry coverage; standalone GC may omit a registry.
export WORKTREE_GC_CMUX_REGISTRY="${WORKTREE_GC_CMUX_REGISTRY-$HOME/.cmuxlayer/session-registry.jsonl}"
LOCK="${GOLEMS_HEAVY_LOCK:-$HOME/.local/state/golems/heavy-suite.lock}"
LIMIT="${WORKTREE_GC_NIGHTLY_TIMEOUT:-3600}"

# Refuse upward Git discovery before even trying to take the lock.
args=("$@")
for ((i=0; i<${#args[@]}; i++)); do
  if [[ "${args[i]}" == --repo ]]; then
    requested="${args[i+1]:-}"
    golems_main_repo "$requested" >/dev/null || {
      echo "worktree-gc-nightly: --repo must be the main repository toplevel" >&2; exit 2;
    }
  fi
done
[[ "$LIMIT" =~ ^[1-9][0-9]*$ ]] || { echo "worktree-gc-nightly: invalid timeout" >&2; exit 2; }

if ! mkdir -p "$(dirname "$LOCK")" 2>/dev/null; then
  echo "worktree-gc-nightly: SKIP cannot create the lock dir for $LOCK; next night retries" >&2
  exit 0
fi

# AIDEV-NOTE: perl opens fds above $^F (2) close-on-exec, so the child below
# never holds the lock; only this parent does, and only until the child exits.
exec perl -MFcntl=:flock -MPOSIX=:sys_wait_h,:signal_h -e '
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
  # Block shutdown signals until the child owns its group and handlers are ready.
  my $mask = POSIX::SigSet->new(SIGTERM, SIGINT, SIGHUP);
  my $old = POSIX::SigSet->new();
  sigprocmask(SIG_BLOCK, $mask, $old) or die "signal block failed: $!";
  pipe(my $ready, my $writer) or die "pipe failed: $!";
  my $pid = fork() // die "worktree-gc-nightly: fork failed: $!\n";
  if (!$pid) {
    close $ready;
    POSIX::setpgid(0, 0) == 0 or die "process group failed: $!";
    print $writer "ready\n"; close $writer;
    sigprocmask(SIG_SETMASK, $old);
    exec @cmd or die "worktree-gc-nightly: exec failed: $!\n";
  }
  close $writer;
  my $stop = sub {
    my ($code, $reason) = @_;
    local $SIG{TERM} = "IGNORE"; local $SIG{INT} = "IGNORE";
    local $SIG{HUP} = "IGNORE"; local $SIG{ALRM} = "IGNORE";
    alarm 0;
    print STDERR "worktree-gc-nightly: $reason; killing the prune\n";
    kill "TERM", -$pid; sleep 5; kill "KILL", -$pid;
    waitpid($pid, 0); flock($fh, LOCK_UN); exit $code;
  };
  $SIG{TERM} = sub { $stop->(143, "TERM") };
  $SIG{INT} = sub { $stop->(130, "INT") };
  $SIG{HUP} = sub { $stop->(129, "HUP") };
  $SIG{ALRM} = sub { $stop->(124, "TIMEOUT after ${limit}s") };
  (<$ready> // "") eq "ready\n" or die "child group not ready";
  close $ready;
  sigprocmask(SIG_SETMASK, $old);
  alarm $limit;
  waitpid($pid, 0);
  alarm 0;
  my $rc = WIFEXITED($?) ? WEXITSTATUS($?) : 128 + WTERMSIG($?);
  flock($fh, LOCK_UN);
  # 3 = completed with KEEP-unpushed. A runtime crash (1) remains a failure.
  print STDERR "worktree-gc-nightly: FAILED gc exit $rc\n" if $rc && $rc != 3;
  exit($rc == 3 ? 0 : $rc);
' "$LOCK" "$LIMIT" /bin/bash "$GC_SCRIPT" --apply "$@"
