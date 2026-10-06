#!/usr/bin/env bash
# Mac ratchet rows for a golems PR (standards/ratchet.md; the lead ruled the scratch-HOME shape).
#
#   scripts/ratchet/local-run.sh --pr <N> [--install <sha>] [--private-manifest <file>]
#                                [--private-file <name>=<path>]... [--with <sha>]... [--no-post] [--keep]
#
# Installs <sha> (default: the PR head) with the REAL installer, the real hook interpreter, real
# git/ssh-keygen/gh and the real private regression gate, into a SCRATCH HOME under
# ~/.local/state/golems/ratchet-runs/, outside every repository: the guards' own suites decide by
# repository ancestry, so a HOME inside a checkout flips their verdicts. Logs, results and the
# table go to <repo>/docs.local/ratchet-runs/. The live install (~/.claude, ~/.codex, hooks-live) is never
# read for writing or touched. Then it runs the `mac` rows of scripts/ratchet/rows.json and, for a
# PR-head run, upserts the head-SHA-bound table that the CI `ratchet` job requires on guarded paths.
#
# The fixture human+lead keys are generated here; their allowed_signers fingerprint replaces the
# owner's pin in a scratch-only commit on top of <sha> (never pushed). A tree with NO pin stays
# unpinned, so an unpinned bug commit still replays as the bug it was.
#
# --install <bug sha>, --private-manifest and --private-file replay a row's bug state. --with <sha>
# cherry-picks a commit onto the scratch tree first (e.g. a test-only fix a historical SHA lacks);
# it is logged. Replays never post: the table is printed and saved under the run directory.
set -euo pipefail

die() { echo "local-run: $*" >&2; exit 2; }

PR="" INSTALL="" PRIVATE_MANIFEST="" POST=1 KEEP=0
declare -a PRIVATE_FILES=() WITH=()
while [ $# -gt 0 ]; do
  case "$1" in
    --pr) PR="${2:?}"; shift 2 ;;
    --install) INSTALL="${2:?}"; shift 2 ;;
    --private-manifest) PRIVATE_MANIFEST="${2:?}"; shift 2 ;;
    --private-file) PRIVATE_FILES+=("${2:?}"); shift 2 ;;
    --with) WITH+=("${2:?}"); shift 2 ;;
    --no-post) POST=0; shift ;;
    --keep) KEEP=1; shift ;;
    *) die "unknown argument $1" ;;
  esac
done
[ -n "$PR" ] || die "--pr <number> is required (the lease probe is scoped to a real open PR)"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN="$(cd "$(git -C "$HERE" rev-parse --git-common-dir)/.." && pwd)"
REPO_SLUG="EtanHey/golems"
REAL_HOME="$HOME"

read -r HEAD BRANCH STATE BASE < <(gh pr view "$PR" --repo "$REPO_SLUG" --json headRefOid,headRefName,state,baseRefOid -q '"\(.headRefOid) \(.headRefName) \(.state) \(.baseRefOid)"')
[ "$STATE" = "OPEN" ] || die "PR #$PR is $STATE; the lease probe needs an open PR"
INSTALL="${INSTALL:-$HEAD}"
[ "$INSTALL" = "$HEAD" ] && [ -z "${WITH[*]+x}" ] || POST=0

NAME="pr$PR-${INSTALL:0:12}-$(date +%Y%m%dT%H%M%S)"
RUN="$MAIN/docs.local/ratchet-runs/$NAME"
SCRATCH="$REAL_HOME/.local/state/golems/ratchet-runs/$NAME"
SH="$SCRATCH/home"
CLONE="$SH/Gits/golems"
mkdir -p "$RUN" "$SH/.claude" "$SH/.codex" "$SH/Gits/orchestrator/collab" "$SCRATCH/keys"
echo '{}' > "$SH/.claude/settings.json"
: > "$SH/Gits/orchestrator/collab/2026-09-24-oss-consolidation.md"
echo "local-run: run dir $RUN"

cleanup() {
  # The anchor is locked immutable (uchg) like the owner's; unlock it so the scratch can go.
  chflags -R nouchg "$SH/.config/golems/human-confirm-anchor" 2>/dev/null || true
  if [ "$KEEP" = 0 ]; then
    case "$SCRATCH" in "$REAL_HOME"/.local/state/golems/ratchet-runs/pr*) rm -rf -- "$SCRATCH" ;; esac
  fi
}
trap cleanup EXIT

# --shared borrows the real repo's objects read-only; origin is GitHub so the installer's
# `fetch origin master` sees the real master.
git clone -q --shared "$MAIN" "$CLONE"
git -C "$CLONE" remote set-url origin "https://github.com/$REPO_SLUG.git"
git -C "$CLONE" fetch -q origin "+refs/heads/*:refs/remotes/origin/*" "+refs/pull/$PR/head:refs/ratchet/pr"
git -C "$CLONE" checkout -q --detach "$INSTALL"
for extra in "${WITH[@]+"${WITH[@]}"}"; do
  git -C "$CLONE" -c user.name=ratchet-fixture -c user.email=ratchet@localhost cherry-pick "$extra" > /dev/null
  echo "local-run: scratch-only cherry-pick $extra -> $(git -C "$CLONE" rev-parse HEAD)"
done

# Fixture keys and a locked anchor, shaped exactly like the owner's.
ssh-keygen -q -t ed25519 -N '' -C ratchet-fixture-human -f "$SCRATCH/keys/human"
mkdir -p -m 700 "$SH/.config/golems/lead-signer" "$SH/.config/golems/human-confirm-anchor"
ssh-keygen -q -t ed25519 -N '' -C ratchet-fixture-lead -f "$SH/.config/golems/lead-signer/lead_ed25519"
chmod 600 "$SH/.config/golems/lead-signer/lead_ed25519"
ANCHOR="$SH/.config/golems/human-confirm-anchor/allowed_signers"
printf 'human %s\nlead %s\n' "$(cut -d' ' -f1,2 "$SCRATCH/keys/human.pub")" \
  "$(cut -d' ' -f1,2 "$SH/.config/golems/lead-signer/lead_ed25519.pub")" > "$ANCHOR"
chmod 600 "$ANCHOR"
chmod 700 "$(dirname "$ANCHOR")"
FINGERPRINT="$(shasum -a 256 "$ANCHOR" | cut -c1-64)"
chflags uchg "$ANCHOR" "$(dirname "$ANCHOR")"

PINS=skills/golem-powers/human-confirm-gate/anchor.pins
INSTALLED="$(git -C "$CLONE" rev-parse HEAD)"
if [ -f "$CLONE/$PINS" ] && grep -Eq '^[0-9a-f]{64}' "$CLONE/$PINS"; then
  sed -E -i '' "s/^[0-9a-f]{64}( .*)?\$/$FINGERPRINT ratchet-fixture/" "$CLONE/$PINS"
  git -C "$CLONE" -c user.name=ratchet-fixture -c user.email=ratchet@localhost commit -q -m "ratchet: scratch-only fixture pin" -- "$PINS"
  INSTALLED="$(git -C "$CLONE" rev-parse HEAD)"
  echo "local-run: fixture pin committed in scratch only: $INSTALLED (on $INSTALL)"
else
  echo "local-run: $INSTALL carries no owner pin; left unpinned"
fi

# The real private suites, copied into the scratch repo with their manifest paths re-rooted.
# Every file is re-hashed against the manifest; a mismatch aborts.
python3 - "$MAIN/docs.local/private-guard-suites" "$CLONE/docs.local/private-guard-suites" \
  "${PRIVATE_MANIFEST:-$MAIN/docs.local/private-guard-suites/manifest.json}" "${PRIVATE_FILES[@]+"${PRIVATE_FILES[@]}"}" <<'PY'
import hashlib, json, shutil, sys
from pathlib import Path
src, dst, manifest_path = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
overrides = dict(item.split('=', 1) for item in sys.argv[4:])
manifest = json.loads(manifest_path.read_text())
for entry in manifest['fixtures'] + manifest['dependencies']:
    rel = Path(entry['path']).relative_to(src)
    origin = Path(overrides.get(rel.name, entry['path']))
    target = dst / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(origin, target)
    if hashlib.sha256(target.read_bytes()).hexdigest() != entry['sha256']:
        sys.exit(f'private file {rel} does not match its manifest hash')
    entry['path'] = str(target)
(dst / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f"local-run: private suites staged, expectedCases={manifest['expectedCases']}, manifest sha256={hashlib.sha256(manifest_path.read_bytes()).hexdigest()[:12]}")
PY

export GOLEMS_HEAVY_LOCK="$REAL_HOME/.local/state/golems/heavy-suite.lock"
export GH_TOKEN="${GH_TOKEN:-$(gh auth token)}"
set +e
(cd "$CLONE" && HOME="$SH" CODEX_HOME="$SH/.codex" node scripts/hooks/install-hooks.mjs \
  --host mbp --repo "$CLONE" --update "$INSTALLED" --apply) > "$RUN/install.log" 2>&1
echo "$?" > "$RUN/install.rc"
set -e
echo "local-run: install exit $(cat "$RUN/install.rc") (log: $RUN/install.log)"
cp -R "$CLONE/docs.local/hooks-private-gate-runs" "$RUN/" 2>/dev/null || true

# The checkout the lease payloads name: on the PR branch, push URL github.com, HEAD = PR head.
git -C "$CLONE" worktree add -q -B "$BRANCH" "$SCRATCH/pushwt" "$HEAD"

export RATCHET_RUN="$RUN" RATCHET_HOME="$SH" RATCHET_CLONE="$CLONE" RATCHET_INSTALLED="$INSTALLED"
export RATCHET_PR_HEAD="$HEAD" RATCHET_BRANCH="$BRANCH" RATCHET_PUSH_REPO="$SCRATCH/pushwt"
node "$HERE/run-rows.mjs" --rows "$HERE/rows.json" --runner mac --head "$INSTALL" --cwd "$(cd "$HERE/../.." && pwd)" --out "$RUN/results.json"

args=(--rows "$HERE/rows.json" --results "$RUN/results.json" --head "$INSTALL" --runner mac
      --marker golems-ratchet-mac --title "Ratchet table (Mac candidate rows: real binaries, scratch HOME)"
      --out "$RUN/table.md")
# Rule 5 against the PR's base row file, which table.mjs reads itself at --base-ref.
git -C "$MAIN" fetch -q origin "$BASE" 2>/dev/null || true
args+=(--base-ref "$BASE")
[ "$POST" = 1 ] && args+=(--repo "$REPO_SLUG" --pr "$PR" --author "$(gh api user -q .login)")
status=0
node "$HERE/table.mjs" "${args[@]}" || status=$?
if [ "$POST" = 1 ]; then
  # A comment does not re-trigger pull_request; re-run this head's ratchet check so it reads it.
  run_id="$(gh run list --repo "$REPO_SLUG" --workflow ratchet.yml --commit "$HEAD" --json databaseId -q '.[0].databaseId' || true)"
  if [ -n "$run_id" ]; then gh run rerun "$run_id" --repo "$REPO_SLUG" || echo "local-run: re-run the ratchet check for $HEAD by hand"; fi
fi
exit "$status"
