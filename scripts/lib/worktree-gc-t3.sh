# T3 paths require positive finished-state, full-tree age and open-FD proof.
t3_guard() {
  local detail
  if ! detail="$(python3 "$SCRIPT_DIR/lib/worktree-gc-state.py" t3-finished "$1" 2>&1)" ||
     ! detail="$(python3 "$SCRIPT_DIR/lib/worktree-gc-t3.py" "$1" 2>&1)"; then
    emit_row "$repo_name" "$1" "$2" not-checked undetermined KEEP-undetermined "T3 retirement unproven: $detail"
    return 1
  fi
}

# Owner's condition: default-branch ancestry alone cannot retire a T3 tree.
t3_pr_guard() {
  local raw detail
  merged_prs=""; merged_pr_failed=""
  if [[ -z "$pr_slug" || "$2" == '(detached)' || -n "$open_pr_failed" ]]; then
    detail="${open_pr_failed:-branch PR identity unavailable}"
  elif ! raw="$(gh pr list --repo "$pr_slug" --state all --head "$2" --limit 500 --json headRefName,headRefOid,state 2>"$REPORT_JOURNAL.gh-stderr")"; then
    detail="$(gh_category "$REPORT_JOURNAL.gh-stderr")"
  elif ! detail="$(python3 "$SCRIPT_DIR/lib/worktree-gc-prs.py" finished <<< "$raw")" ||
       ! line_in "$2" "$(cut -f1 <<< "$detail")"; then
    detail="merged or closed branch PR unproven"
  else
    # Only merged PRs cover ahead-of-base commits. Closed-only unique history keeps.
    merged_prs="$(python3 -c 'import json,sys
print("\n".join(r["headRefName"]+"\t"+r["headRefOid"] for r in json.load(sys.stdin) if r["state"]=="MERGED"))' <<< "$raw")"
    return 0
  fi
  emit_row "$repo_name" "$1" "$2" not-checked undetermined KEEP-undetermined "T3 PR state unproven: $detail"
  return 1
}
