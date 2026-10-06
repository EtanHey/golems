#!/usr/bin/env bash
# hooks-status row (numeric, max 0): problems the installer's --status reports on the scratch HOME
# after the candidate install AND a lead-token issuance (real use). The scratch origin/master is set
# to the installed commit ("this PR merged and was installed"). Codex `trust=missing` is excluded:
# in a scratch CODEX_HOME trust needs an owner /hooks review, so it is structural, not a defect.
# Specimen (2026-10-06): the issuer, run by its shebang, wrote __pycache__ into hooks-live and the
# live --status exited 1 ("hooks import files unexpected").
set -euo pipefail
: "${RATCHET_RUN:?run from scripts/ratchet/local-run.sh}"
git -C "$RATCHET_CLONE" update-ref refs/remotes/origin/master "$RATCHET_INSTALLED"
cd "$RATCHET_CLONE"
out="$(HOME="$RATCHET_HOME" CODEX_HOME="$RATCHET_HOME/.codex" node scripts/hooks/install-hooks.mjs \
  --host mbp --repo "$RATCHET_CLONE" --status 2>&1 || true)"
printf '%s\n' "$out"
problems="$(grep -cE 'DIRTY|unexpected|not on origin/master|recorded pin|no recorded pin| drifted$| unregistered$|dangling|STILL ACTIVE|interpreter BAD|retired-registered|PRESENT in settings|hook-python=NONE|drift=[1-9]|settings-drift=[1-9]|^codex wiring=(drifted|absent)' <<<"$out" || true)"
echo "$problems"
