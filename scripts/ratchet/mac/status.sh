#!/usr/bin/env bash
# hooks-status row: after the candidate install AND a lead-token issuance (real use), the
# installer's --status on that scratch HOME exits 0. Specimen: untracked __pycache__ written into
# hooks-live by the issuer made the live --status exit 1 (2026-10-06). The scratch origin/master
# is set to the installed commit, i.e. "this PR merged and was installed".
set -euo pipefail
: "${RATCHET_RUN:?run from scripts/ratchet/local-run.sh}"
git -C "$RATCHET_CLONE" update-ref refs/remotes/origin/master "$RATCHET_INSTALLED"
cd "$RATCHET_CLONE"
HOME="$RATCHET_HOME" CODEX_HOME="$RATCHET_HOME/.codex" node scripts/hooks/install-hooks.mjs \
  --host mbp --repo "$RATCHET_CLONE" --status
