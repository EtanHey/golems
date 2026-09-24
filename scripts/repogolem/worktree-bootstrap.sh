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
# stderr, and the exit status is the installer's.
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
  out="$($step 2>&1)"
  rc=$?
  if [[ $rc -ne 0 ]]; then
    done_line "FAILED: ${step} (exit ${rc})${notes}"
    printf '%s\n' "$out" >&2
    exit "$rc"
  fi
  ran="${ran:+${ran} + }${step}"
done
done_line "${ran}${notes}"
