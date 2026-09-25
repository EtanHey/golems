#!/usr/bin/env bash
# boundary-history-base.sh <event> <genesis> [<push-before>]
#
# Prints the commit the publish-boundary ratchet starts from (it checks every
# commit in <base>..HEAD). Run inside the checkout, after a full-depth fetch.
#
#   pull_request  → merge base of origin/master and HEAD: the PR's own commits.
#   push          → <push-before> (github.event.before), so a push checks only
#                   the commits it added. Falls back to <genesis> when before is
#                   empty, all zeros (a new branch), missing from the clone, or
#                   not an ancestor of HEAD (a force push).
#   anything else → <genesis>. The nightly schedule and workflow_dispatch run the
#                   full ratchet, which also covers push ranges a cancelled run
#                   never finished.
#
# The chosen base and why go to stderr, for the job log.
set -euo pipefail

event=${1:?usage: boundary-history-base.sh <event> <genesis> [<push-before>]}
genesis=${2:?usage: boundary-history-base.sh <event> <genesis> [<push-before>]}
before=${3:-}

case $event in
  pull_request)
    base=$(git merge-base origin/master HEAD)
    why="merge base with origin/master"
    ;;
  push)
    if [[ -n $before && ! $before =~ ^0+$ ]] \
      && git cat-file -e "$before^{commit}" 2>/dev/null \
      && git merge-base --is-ancestor "$before" HEAD; then
      base=$before
      why="commits this push added"
    else
      base=$genesis
      why="push has no usable before (${before:-empty}), so full ratchet from genesis"
    fi
    ;;
  *)
    base=$genesis
    why="full ratchet from genesis"
    ;;
esac

printf '%s: ratchet from %s (%s)\n' "$event" "$base" "$why" >&2
printf '%s\n' "$base"
