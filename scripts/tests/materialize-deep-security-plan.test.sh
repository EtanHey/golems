#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
repo_root=$(cd "$script_dir/../.." && pwd -P)
materializer="$repo_root/scripts/materialize-deep-security-plan.sh"
suite_parent="$repo_root/.worktrees"
suite_root="$suite_parent/materialize-security-plan-test.$$"
canonical_root="$suite_root/canonical"
worker_root="$suite_root/worker"
unrelated_root="$suite_root/unrelated"

cleanup() {
  if [[ -d $canonical_root ]]; then
    git -C "$canonical_root" worktree remove --force "$worker_root" >/dev/null 2>&1 || true
  fi
  case "$suite_root" in
    "$suite_parent"/materialize-security-plan-test.*) rm -rf -- "$suite_root" ;;
    *) printf 'REFUSING unsafe cleanup path: %s\n' "$suite_root" >&2 ;;
  esac
}
trap cleanup EXIT

mkdir -p \
  "$canonical_root/docs.local/plan/deep-security-remediation-7609/council" \
  "$canonical_root/docs.local/security" \
  "$canonical_root/docs.local/audits/deep-security-remediation-7609"
git -C "$canonical_root" init -q
git -C "$canonical_root" config user.name "Materializer Fixture"
git -C "$canonical_root" config user.email "materializer@example.com"
printf 'fixture\n' > "$canonical_root/README.md"
printf '# Plan\n' > "$canonical_root/docs.local/plan/deep-security-remediation-7609/README.md"
printf '# Collab\n' > "$canonical_root/docs.local/plan/deep-security-remediation-7609/collab.md"
printf '# Council\n' > "$canonical_root/docs.local/plan/deep-security-remediation-7609/council/FIX-ROUND-PLAN.md"
printf '# Ledger\n' > "$canonical_root/docs.local/security/deep-scan-7609-full-ledger.md"
printf '# Audit\n' > "$canonical_root/docs.local/audits/deep-security-remediation-7609/2026-08-21-conformance-verdict.md"
git -C "$canonical_root" add README.md
git -C "$canonical_root" commit -qm "fixture root"
git -C "$canonical_root" worktree add -q -b materializer-fixture "$worker_root"

GOLEMS_CANONICAL_ROOT="$canonical_root" "$materializer" "$worker_root"

test -r "$worker_root/docs.local/plan/deep-security-remediation-7609/README.md"
test -r "$worker_root/docs.local/plan/deep-security-remediation-7609/council/FIX-ROUND-PLAN.md"
test -r "$worker_root/docs.local/security/deep-scan-7609-full-ledger.md"
test -r "$worker_root/docs.local/audits/deep-security-remediation-7609/2026-08-21-conformance-verdict.md"
test -L "$worker_root/docs.local/plan/deep-security-remediation-7609/collab.md"

printf 'fixture append reached canonical\n' >> "$worker_root/docs.local/plan/deep-security-remediation-7609/collab.md"
grep -Fq 'fixture append reached canonical' "$canonical_root/docs.local/plan/deep-security-remediation-7609/collab.md"

if GOLEMS_CANONICAL_ROOT="$canonical_root" "$materializer" "$suite_root/not-a-worktree" >/dev/null 2>&1; then
  printf 'materializer accepted a non-worktree target\n' >&2
  exit 1
fi

git init -q "$unrelated_root"
if GOLEMS_CANONICAL_ROOT="$canonical_root" "$materializer" "$unrelated_root" >/dev/null 2>&1; then
  printf 'materializer accepted an unrelated Git worktree\n' >&2
  exit 1
fi

if GOLEMS_CANONICAL_ROOT="$canonical_root" "$materializer" "$canonical_root" >/dev/null 2>&1; then
  printf 'materializer accepted the canonical checkout as its target\n' >&2
  exit 1
fi

ln -s "$canonical_root/README.md" "$canonical_root/docs.local/security/deep-scan-7609-linked.md"
if GOLEMS_CANONICAL_ROOT="$canonical_root" "$materializer" "$worker_root" >/dev/null 2>&1; then
  printf 'materializer followed a symlinked canonical security input\n' >&2
  exit 1
fi
rm -f -- "$canonical_root/docs.local/security/deep-scan-7609-linked.md"

escape_root="$suite_root/escaped-destination"
mkdir -p "$escape_root"
mv "$worker_root/docs.local/plan/deep-security-remediation-7609/council" \
  "$worker_root/docs.local/plan/deep-security-remediation-7609/council.original"
ln -s "$escape_root" "$worker_root/docs.local/plan/deep-security-remediation-7609/council"
if GOLEMS_CANONICAL_ROOT="$canonical_root" "$materializer" "$worker_root" >/dev/null 2>&1; then
  printf 'materializer wrote through a nested destination symlink\n' >&2
  exit 1
fi

printf 'PASS materializes plan evidence and syncs collab to canonical\n'
