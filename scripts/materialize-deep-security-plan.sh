#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'materialize-security-plan: %s\n' "$1" >&2
  exit 2
}

target_input=${1:-.}
[[ -d $target_input ]] || fail "target does not exist: $target_input"
target_root=$(cd "$target_input" && pwd -P)
git -C "$target_root" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || fail "target is not a Git worktree: $target_root"

if [[ -n ${GOLEMS_CANONICAL_ROOT:-} ]]; then
  [[ -d $GOLEMS_CANONICAL_ROOT ]] || fail "canonical root does not exist: $GOLEMS_CANONICAL_ROOT"
  canonical_root=$(cd "$GOLEMS_CANONICAL_ROOT" && pwd -P)
else
  canonical_root=$(git -C "$target_root" worktree list --porcelain \
    | awk '/^worktree / { sub(/^worktree /, ""); print; exit }')
  [[ -n $canonical_root && -d $canonical_root ]] \
    || fail "could not resolve the canonical worktree"
  canonical_root=$(cd "$canonical_root" && pwd -P)
fi

[[ $target_root != "$canonical_root" ]] \
  || fail "target must be an isolated linked worktree, not the canonical checkout"

canonical_common=$(git -C "$canonical_root" rev-parse --git-common-dir)
target_common=$(git -C "$target_root" rev-parse --git-common-dir)
[[ $canonical_common == /* ]] || canonical_common="$canonical_root/$canonical_common"
[[ $target_common == /* ]] || target_common="$target_root/$target_common"
canonical_common=$(cd "$canonical_common" && pwd -P)
target_common=$(cd "$target_common" && pwd -P)
[[ $canonical_common == "$target_common" ]] \
  || fail "target and canonical checkout do not share Git metadata"

registered=no
while IFS= read -r registered_path; do
  [[ -d $registered_path ]] || continue
  registered_path=$(cd "$registered_path" && pwd -P)
  if [[ $registered_path == "$target_root" ]]; then
    registered=yes
    break
  fi
done < <(git -C "$canonical_root" worktree list --porcelain \
  | awk '/^worktree / { sub(/^worktree /, ""); print }')
[[ $registered == yes ]] || fail "target is not a registered worktree: $target_root"

source_plan="$canonical_root/docs.local/plan/deep-security-remediation-7609"
source_security="$canonical_root/docs.local/security"
source_audits="$canonical_root/docs.local/audits/deep-security-remediation-7609"
[[ -f $source_plan/README.md ]] || fail "canonical plan README is missing"
[[ -f $source_plan/collab.md ]] || fail "canonical collab file is missing"
[[ -f $source_security/deep-scan-7609-full-ledger.md ]] || fail "canonical finding ledger is missing"
[[ -f $source_audits/2026-08-21-conformance-verdict.md ]] || fail "canonical architecture verdict is missing"

for relative_dir in \
  docs.local \
  docs.local/plan \
  docs.local/plan/deep-security-remediation-7609 \
  docs.local/security \
  docs.local/audits \
  docs.local/audits/deep-security-remediation-7609; do
  [[ ! -L $target_root/$relative_dir ]] \
    || fail "refusing symlinked destination directory: $target_root/$relative_dir"
done

if find "$source_plan" "$source_security" "$source_audits" -type l -print -quit | grep -q .; then
  fail "canonical plan, security, or audit tree contains a symlink"
fi

target_plan="$target_root/docs.local/plan/deep-security-remediation-7609"
target_security="$target_root/docs.local/security"
target_audits="$target_root/docs.local/audits/deep-security-remediation-7609"
mkdir -p "$target_plan" "$target_security" "$target_audits"
target_collab="$target_plan/collab.md"

if find "$target_plan" "$target_security" "$target_audits" \
  -type l ! -path "$target_collab" -print -quit | grep -q .; then
  fail "destination plan, security, or audit tree contains an unmanaged symlink"
fi

copy_tree_files() {
  local source_root=$1
  local destination_root=$2
  local excluded_file=${3:-}
  local source_file
  local relative_file
  local destination_file

  while IFS= read -r -d '' source_file; do
    [[ -n $excluded_file && $source_file == "$excluded_file" ]] && continue
    relative_file=${source_file#"$source_root"/}
    destination_file="$destination_root/$relative_file"
    [[ ! -L $destination_file ]] \
      || fail "refusing symlinked destination file: $destination_file"
    mkdir -p "$(dirname "$destination_file")"
    cp -p "$source_file" "$destination_file"
  done < <(find "$source_root" -type f -print0)
}

copy_tree_files "$source_plan" "$target_plan" "$source_plan/collab.md"
copy_tree_files "$source_audits" "$target_audits"

security_count=0
for source_file in "$source_security"/deep-scan-7609-*.md; do
  [[ -f $source_file ]] || fail "no canonical deep-scan security documents found"
  destination_file="$target_security/${source_file##*/}"
  [[ ! -L $destination_file ]] \
    || fail "refusing symlinked destination file: $destination_file"
  cp -p "$source_file" "$destination_file"
  security_count=$((security_count + 1))
done

if [[ -e $target_collab && ! -L $target_collab ]]; then
  fail "refusing to replace a non-symlink collab file: $target_collab"
fi
rm -f -- "$target_collab"
ln -s "$source_plan/collab.md" "$target_collab"

plan_count=$(find "$target_plan" -type f | wc -l | tr -d ' ')
audit_count=$(find "$target_audits" -type f | wc -l | tr -d ' ')
printf 'MATERIALIZED_SECURITY_PLAN target=%s plan_files=%s security_files=%s audit_files=%s collab=canonical-symlink\n' \
  "$target_root" "$plan_count" "$security_count" "$audit_count"
