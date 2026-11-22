# T3 paths require positive finished-state, full-tree age and open-FD proof.
t3_guard() {
  local detail
  if ! detail="$(python3 "$SCRIPT_DIR/lib/worktree-gc-state.py" t3-finished "$1" 2>&1)" ||
     ! detail="$(python3 "$SCRIPT_DIR/lib/worktree-gc-t3.py" "$1" 2>&1)"; then
    emit_row "$repo_name" "$1" "$2" not-checked undetermined KEEP-undetermined "T3 retirement unproven: $detail"
    return 1
  fi
}
