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
@test "review repro: base and current non-T3 plans REMOVE with 19 of 20 pids" {
  repo="$(make_fixture_repo cov)"; worktree="$(add_branch_worktree "$repo" target)"; stub_partial_lsof
  mkdir -p "$TEST_ROOT/base"
  git -C "$REPO_ROOT" archive 0d8621b53af72ae35ce28f9d1896c09e346f0bbd scripts | tar -x -C "$TEST_ROOT/base"
  run env GC_SOURCE="$TEST_ROOT/base/scripts/worktree-gc.sh" "$WORKTREE_GC" --prune-plan --idle-hours 0 --repo "$repo"
  base_out="$output"
  run env GC_SOURCE="${GC_R2_SOURCE:-$GC_SOURCE}" "$WORKTREE_GC" --prune-plan --idle-hours 0 --repo "$repo"
  [[ "$base_out" == *" · $worktree · "*" · REMOVE · "* ]] || false
  [[ "$output" == *" · $worktree · "*" · REMOVE · "* ]] || false
}
@test "review repro: current plan REMOVE agrees with apply under partial full-file view" {
  repo="$(make_fixture_repo cov2)"; worktree="$(add_branch_worktree "$repo" target)"; stub_partial_lsof
  run env GC_SOURCE="${GC_R2_SOURCE:-$GC_SOURCE}" "$WORKTREE_GC" --prune-plan --idle-hours 0 --repo "$repo"
  [[ "$output" == *" · $worktree · "*" · REMOVE · "* ]] || false
  run env GC_SOURCE="${GC_R2_SOURCE:-$GC_SOURCE}" "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [[ "$output" == *REMOVED* ]]; [ ! -e "$worktree" ]
}
@test "plan removes its per-run snapshot files after successful capture" {
  repo="$(make_fixture_repo cleanup)"; worktree="$(add_branch_worktree "$repo" target)"
  stub_partial_lsof
  printf '#!/usr/bin/env bash\nseq 1 19\n' > "$TEST_ROOT/bin/ps"
  run env GC_SOURCE="${GC_R2_SOURCE:-$GC_SOURCE}" "$WORKTREE_GC" --prune-plan --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  plan="$(printf '%s\n' "$output" | sed -n 's/^List-only plan TSV: //p')"
  [ -f "$plan" ]
  for suffix in t3.sqlite files.json symlinks.json; do [ ! -e "${plan%.plan.tsv}.$suffix" ]; done
}
