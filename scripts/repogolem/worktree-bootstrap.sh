#!/usr/bin/env bash
# worktree-bootstrap.sh <worktree> — install a worktree's own dependencies.
#
# Detects by lockfile at the worktree root and runs the matching installer:
#   bun.lock / bun.lockb  → bun install --frozen-lockfile
#   pnpm-lock.yaml        → pnpm install --frozen-lockfile
#   package-lock.json     → npm ci --prefer-offline
#   uv.lock               → uv sync        (alongside a JS installer if both exist)
#   Package.resolved      → no-op (SwiftPM resolves on build)
#
# Never symlinks node_modules. An existing node_modules SYMLINK (the old
# spawner shortcut into the main checkout) is removed and replaced by a real
# install; the symlink's target is never touched. Safe to re-run: every
# installer above is idempotent.
#
# Prints exactly one line, "[worktree-bootstrap] <dir>: <what> (<N>s)". On an
# installer failure the line says FAILED, the installer's output follows on
# stderr, and the exit status is the installer's. Each installer is killed
# after WORKTREE_BOOTSTRAP_TIMEOUT seconds (default 900): a hung install
# (no network, a lock wait) must not block an agent launch forever.
#
# Called by repoGolem launchers for -w (golem-dispatch.zsh
# _golem_bootstrap_worktree); install-golem-dispatch.sh ships it next to the
# dispatcher.
set -uo pipefail

wt="${1:-}"
if [[ -z "$wt" || ! -d "$wt" ]]; then
  echo "usage: worktree-bootstrap.sh <worktree-dir>" >&2
  exit 2
fi
cd "$wt" || exit 2
wt="$PWD"
start=$SECONDS
limit="${WORKTREE_BOOTSTRAP_TIMEOUT:-900}"

done_line() {
  echo "[worktree-bootstrap] ${wt}: $1 ($((SECONDS - start))s)"
}

js=""
if [[ -f bun.lock || -f bun.lockb ]]; then
  js="bun install --frozen-lockfile"
elif [[ -f pnpm-lock.yaml ]]; then
  js="pnpm install --frozen-lockfile"
elif [[ -f package-lock.json ]]; then
  js="npm ci --prefer-offline"
fi
py=""
[[ -f uv.lock ]] && py="uv sync"

if [[ -z "$js" && -z "$py" ]]; then
  if [[ -f Package.resolved ]]; then
    done_line "Package.resolved, nothing to install"
  else
    done_line "no lockfile, nothing to install"
  fi
  exit 0
fi

notes=""
if [[ -n "$js" && -L node_modules ]]; then
  rm node_modules || exit 1 # the link only, never its target
  notes=", replaced node_modules symlink"
fi

ran=""
for step in "$js" "$py"; do
  [[ -z "$step" ]] && continue
  # Word-splitting is intended: each step is a fixed command line from above.
  # shellcheck disable=SC2086
  # The installer runs in its own process group under a perl timer (perl is on
  # macOS and Linux alike; no coreutils timeout needed). On timeout the whole
  # group is killed, children included, since an orphaned child would keep
  # the output pipe open, and the status is 142.
  out="$(perl -e '
    my $limit = shift;
    my $pid = fork() // exit 126;
    if (!$pid) { setpgrp(0, 0); exec @ARGV or exit 127 }
    setpgrp($pid, $pid);
    local $SIG{ALRM} = sub { kill "TERM", -$pid; sleep 1; kill "KILL", -$pid; exit 142 };
    alarm $limit;
    waitpid($pid, 0);
    exit(($? & 127) ? 128 + ($? & 127) : $? >> 8);
  ' "$limit" $step 2>&1)"
  rc=$?
  if [[ $rc -eq 142 ]]; then
    done_line "FAILED: ${step} (timed out after ${limit}s)${notes}"
    printf '%s\n' "$out" >&2
    exit "$rc"
  elif [[ $rc -ne 0 ]]; then
    done_line "FAILED: ${step} (exit ${rc})${notes}"
    printf '%s\n' "$out" >&2
    exit "$rc"
  fi
  ran="${ran:+${ran} + }${step}"
done
done_line "${ran}${notes}"
