#!/usr/bin/env bats
# A worktree a worker created minutes ago, with no commits yet, looks exactly
# like a clean merged tree. Every mode must keep it (golemsgreen-w3, 2026-11-26:
# dry run on the M1 reported REMOVE for two minutes-old voicelayer lanes).
# GC_FRESH_SOURCE runs the same cases against another script (base-fail proof).
load lib/worktree-gc-fixtures

gc() { env GC_FIXTURE_FRESH=1 GC_SOURCE="${GC_FRESH_SOURCE:-$GC_SOURCE}" "$WORKTREE_GC" "$@"; }

fixture() {
  repo="$(make_fixture_repo fresh)"
  worktree="$(add_branch_worktree "$repo" lane)"
}

# Backdate the tree and its admin dir, as if created and last touched 7h ago.
age_worktree() {
  python3 - "$1" <<'PY'
import os, subprocess, sys, time
root = sys.argv[1]
admin = subprocess.check_output(['git', '-C', root, 'rev-parse', '--absolute-git-dir'], text=True).strip()
old = time.time() - 7 * 3600
for base in (root, admin):
    for here, dirs, files in os.walk(base):
        for name in dirs + files:
            os.utime(os.path.join(here, name), (old, old), follow_symlinks=False)
    os.utime(base, (old, old))
PY
}

row_for() { grep -F "$worktree · " <<< "$output"; }

@test "fresh commit-less worktree: dry run says KEEP-active, never REMOVE" {
  fixture
  run gc --dry-run --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$(row_for)" == *" · KEEP-active · "* ]] || false
  [[ "$output" != *" · REMOVE · "* ]] || false
}

@test "fresh commit-less worktree: prune plan says KEEP-active" {
  fixture
  run gc --prune-plan --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$(row_for)" == *" · KEEP-active · "* ]] || false
  [[ "$output" != *" · REMOVE · "* ]] || false
}

@test "fresh commit-less worktree: apply with default idle hours keeps it" {
  fixture
  run gc --apply --path "$worktree"
  [ "$status" -eq 0 ]
  [[ "$(row_for)" == *" · KEEP-active · "* ]] || false
  [ -d "$worktree" ]
}

@test "fresh commit-less worktree: --idle-hours 0 cannot waive the 1h creation floor, with --path" {
  fixture
  run gc --apply --idle-hours 0 --path "$worktree"
  [ "$status" -eq 0 ]
  [[ "$(row_for)" == *" · KEEP-active · created under 60m ago; --idle-hours cannot waive this floor" ]] || false
  [[ "$output" != *REMOVED* ]] || false
  [ -d "$worktree" ]
}

@test "fresh commit-less worktree: --idle-hours 0 cannot waive the floor on a blanket --repo apply or plan" {
  fixture
  run gc --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$(row_for)" == *" · KEEP-active · created under 60m ago"* ]] || false
  [ -d "$worktree" ]
  run gc --dry-run --idle-hours 0 --repo "$repo"
  [[ "$(row_for)" == *" · KEEP-active · created under 60m ago"* ]] || false
}

@test "aged commit-less worktree is still eligible in every mode (control)" {
  fixture
  age_worktree "$worktree"
  run gc --dry-run --repo "$repo"
  [[ "$(row_for)" == *" · REMOVE · eligible; report only"* ]] || false
  run gc --prune-plan --repo "$repo"
  [[ "$(row_for)" == *" · REMOVE · "* ]] || false
  run gc --apply --path "$worktree"
  [ "$status" -eq 0 ]
  [[ "$output" == *"$worktree · lane · dirty=0 · ahead=0 · REMOVED · "* ]] || false
  [ ! -e "$worktree" ]
}

@test "old worktree with recent HEAD activity is KEEP-active in dry run and apply" {
  fixture
  age_worktree "$worktree"
  touch "$(git -C "$worktree" rev-parse --absolute-git-dir)/HEAD"
  run gc --dry-run --repo "$repo"
  [[ "$(row_for)" == *" · KEEP-active · created or HEAD/index/commit activity within 6h" ]] || false
  run gc --apply --path "$worktree"
  [[ "$(row_for)" == *" · KEEP-active · "* ]] || false
  [ -d "$worktree" ]
}

@test "in-repo .worktrees bound to a live T3 thread is KEEP-live in every mode, even when old" {
  fixture
  age_worktree "$worktree"
  sqlite3 "$WORKTREE_GC_T3_DB" "INSERT INTO orchestration_v2_projection_threads VALUES
    ('live',json_object('worktreePath','$worktree','createdAt','2026-11-26T00:00:00Z'),NULL);"
  for mode in --dry-run --prune-plan; do
    run gc "$mode" --repo "$repo"
    [[ "$(row_for)" == *" · KEEP-live · t3-binding-live" ]] || false
  done
  run gc --apply --idle-hours 0 --path "$worktree"
  [[ "$(row_for)" == *" · KEEP-live · t3-binding-live" ]] || false
  [ -d "$worktree" ]
}

@test "in-repo .worktrees with unreadable T3 state is KEEP-undetermined, even when old" {
  fixture
  age_worktree "$worktree"
  run env GC_FIXTURE_FRESH=1 WORKTREE_GC_T3_DB="$TEST_ROOT/missing.sqlite" GC_SOURCE="${GC_FRESH_SOURCE:-$GC_SOURCE}" \
    "$WORKTREE_GC" --apply --idle-hours 0 --path "$worktree"
  [[ "$(row_for)" == *" · KEEP-undetermined · "* ]] || false
  [ -d "$worktree" ]
}
