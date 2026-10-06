#!/usr/bin/env bash
# LIVE ratchet rows, lead-run after each hooks-live install (standards/ratchet.md, "Two tiers").
#
#   scripts/ratchet/live-rows.sh --merged-pr <N> --lease-pr <open PR> --lease-repo <checkout>
#
# Runs the `live` rows of scripts/ratchet/rows.json against the REAL install and posts the table on
# the merged PR. Nothing is installed or pushed. The human-confirm row issues ONE real lead token
# through the live golems-lead-confirm (lead key, logged to the collab) and feeds lease payloads
# scoped to --lease-pr, an open PR whose branch --lease-repo has checked out at its head.
set -euo pipefail

die() { echo "live-rows: $*" >&2; exit 2; }
MERGED="" LEASE_PR="" LEASE_REPO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --merged-pr) MERGED="${2:?}"; shift 2 ;;
    --lease-pr) LEASE_PR="${2:?}"; shift 2 ;;
    --lease-repo) LEASE_REPO="${2:?}"; shift 2 ;;
    *) die "unknown argument $1" ;;
  esac
done
[ -n "$MERGED" ] && [ -n "$LEASE_PR" ] && [ -n "$LEASE_REPO" ] || die "--merged-pr, --lease-pr and --lease-repo are required"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN="$(cd "$(git -C "$HERE" rev-parse --git-common-dir)/.." && pwd)"
REPO_SLUG="EtanHey/golems"
read -r LEASE_HEAD LEASE_BRANCH < <(gh pr view "$LEASE_PR" --repo "$REPO_SLUG" --json headRefOid,headRefName -q '"\(.headRefOid) \(.headRefName)"')
[ "$(git -C "$LEASE_REPO" rev-parse HEAD)" = "$LEASE_HEAD" ] || die "--lease-repo is not at PR #$LEASE_PR's head"
LIVE_HEAD="$(git -C "$MAIN/.worktrees/hooks-live" rev-parse HEAD)"
RUN="$MAIN/docs.local/ratchet-runs/live-pr$MERGED-$(date +%Y%m%dT%H%M%S)"
mkdir -p "$RUN"

# The probe must not dirty the live tree it measures (the issuer's bytecode was the 10-06 specimen).
export PYTHONDONTWRITEBYTECODE=1
export RATCHET_HOME="$HOME" RATCHET_PUSH_REPO="$LEASE_REPO" RATCHET_BRANCH="$LEASE_BRANCH" RATCHET_PR_HEAD="$LEASE_HEAD"
export RATCHET_CLONE="$HOME/Gits/golems"
node "$HERE/run-rows.mjs" --rows "$HERE/rows.json" --runner live --head "$LIVE_HEAD" --cwd "$(cd "$HERE/../.." && pwd)" --out "$RUN/results.json"
# Direction is checked against the live commit's first parent (the master it was merged onto).
node "$HERE/table.mjs" --rows "$HERE/rows.json" --results "$RUN/results.json" --head "$LIVE_HEAD" --runner live \
  --base-ref "$(git -C "$MAIN" rev-parse "$LIVE_HEAD^1")" \
  --marker golems-ratchet-live --title "Ratchet table (LIVE rows, post-merge, hooks-live@${LIVE_HEAD:0:8})" \
  --repo "$REPO_SLUG" --pr "$MERGED" --author "$(gh api user -q .login)" --out "$RUN/table.md"
