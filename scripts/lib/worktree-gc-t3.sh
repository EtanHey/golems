# Log full probe output (including successful row-skip diagnostics), but expose
# only a short category to reason cells. Preserve the probe's exit status.
gc_probe() {
  local category="$1" output rc=0
  shift
  output="$("$@" 2>&1)" || rc=$?
  if [[ -n "$output" ]]; then
    printf 'probe %s exit %s\n%s\n' "$category" "$rc" "$output" >> "$LOG_FILE"
  fi
  if [[ "$rc" -ne 0 ]]; then printf '%s\n' "$category"; fi
  return "$rc"
}

# T3 paths require positive finished-state, full-tree age and open-FD proof.
t3_guard() {
  local category
  if ! category="$(gc_probe t3-state-unproven python3 "$SCRIPT_DIR/lib/worktree-gc-state.py" t3-finished "$1")"; then
    emit_row "$repo_name" "$1" "$2" not-checked undetermined KEEP-undetermined "T3 retirement unproven: $category"
    return 1
  fi
  if [[ "$apply" -eq 0 && ! -f "${WORKTREE_GC_FILES_SNAPSHOT:-}" ]]; then
    emit_row "$repo_name" "$1" "$2" not-checked undetermined KEEP-undetermined "T3 retirement unproven: open-file-snapshot-unavailable"
    return 1
  fi
  if ! category="$(gc_probe t3-files-unproven python3 "$SCRIPT_DIR/lib/worktree-gc-t3.py" "$1")"; then
    emit_row "$repo_name" "$1" "$2" not-checked undetermined KEEP-undetermined "T3 retirement unproven: $category"
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
  elif ! detail="$(python3 "$SCRIPT_DIR/lib/worktree-gc-prs.py" finished 2>> "$LOG_FILE" <<< "$raw")" ||
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
