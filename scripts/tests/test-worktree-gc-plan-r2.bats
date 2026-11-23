#!/usr/bin/env bats
load lib/worktree-gc-fixtures
stub_partial_lsof() {
  mkdir -p "$TEST_ROOT/bin"
  printf '#!/usr/bin/env bash\nseq 1 20\n' > "$TEST_ROOT/bin/ps"
  cat > "$TEST_ROOT/bin/lsof" <<'STUB'
#!/usr/bin/env bash
for i in $(seq 1 19); do printf 'p%s\nfcwd\nn/outside\n' "$i"; done
STUB
  chmod +x "$TEST_ROOT/bin/ps" "$TEST_ROOT/bin/lsof"
  export PATH="$TEST_ROOT/bin:$PATH"
}
@test "review repro: non-T3 plan retains base 90 percent cwd coverage" {
  repo="$(make_fixture_repo cov)"; worktree="$(add_branch_worktree "$repo" target)"; stub_partial_lsof
  run env GC_SOURCE="${GC_R2_SOURCE:-$GC_SOURCE}" "$WORKTREE_GC" --prune-plan --idle-hours 0 --repo "$repo"
  [[ "$output" == *" · $worktree · "*" · REMOVE · "* ]] || false
}
@test "review repro: current plan REMOVE agrees with apply under partial full-file view" {
  repo="$(make_fixture_repo cov2)"; worktree="$(add_branch_worktree "$repo" target)"; stub_partial_lsof
  run env GC_SOURCE="${GC_R2_SOURCE:-$GC_SOURCE}" "$WORKTREE_GC" --prune-plan --idle-hours 0 --repo "$repo"
  [[ "$output" == *" · $worktree · "*" · REMOVE · "* ]] || false
  run env GC_SOURCE="${GC_R2_SOURCE:-$GC_SOURCE}" "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [[ "$output" == *REMOVED* ]] || false
  [ ! -e "$worktree" ]
}
@test "plan removes its per-run snapshot files after successful capture" {
  repo="$(make_fixture_repo cleanup)"; worktree="$(add_branch_worktree "$repo" target)"
  stub_partial_lsof
  printf '#!/usr/bin/env bash\nseq 1 19\n' > "$TEST_ROOT/bin/ps"
  run env GC_SOURCE="${GC_R2_SOURCE:-$GC_SOURCE}" "$WORKTREE_GC" --prune-plan --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  plan="$(printf '%s\n' "$output" | sed -n 's/^List-only plan TSV: //p')"
  [ -f "$plan" ]
  for suffix in t3.sqlite files.json symlinks.json; do
    [ ! -e "${plan%.plan.tsv}.$suffix" ] || return 1
  done
}
