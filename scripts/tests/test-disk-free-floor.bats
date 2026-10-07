#!/usr/bin/env bats
load lib/worktree-gc-fixtures

@test "disk ratchet counts only GC REMOVE plans and excludes live and out-of-scope trees" {
  repo="$(make_fixture_repo measured)"
  eligible="$(add_branch_worktree "$repo" eligible)"
  live="$(add_branch_worktree "$repo" live)"
  locked="$(add_branch_worktree "$repo" locked)"
  git -C "$repo" worktree lock "$locked"
  git -C "$repo" worktree add -q --detach "$repo/.worktrees/hooks-live" origin/main
  git -C "$repo" worktree add -q --detach "$repo/.worktrees/group/deep" origin/main
  git -C "$repo" worktree add -q --detach "$TEST_ROOT/runtime" origin/main
  (cd "$live" && exec sleep 60) &
  holder=$!
  run env RATCHET_GITS_ROOT="$TEST_ROOT" DISK_FREE_FLOOR_GB=0 WORKTREE_GC_IDLE_HOURS=0 \
    "$REPO_ROOT/scripts/ratchet/mac/disk-free-floor.sh"
  kill "$holder" 2>/dev/null || true
  [ "$status" -eq 0 ]
  [[ "$output" == *'merged_worktrees=1 '* ]] || false
  [ -d "$eligible" ] && [ -d "$live" ]
}

@test "disk ratchet fails closed when GC cannot produce a plan" {
  repo="$(make_fixture_repo measured)"
  stub="$TEST_ROOT/bin"
  mkdir "$stub"
  printf '#!/usr/bin/env bash\n[[ " $* " == *" worktree list "* ]] && exit 2\nexec "$REAL_GIT" "$@"\n' > "$stub/git"
  chmod +x "$stub/git"
  run env RATCHET_GITS_ROOT="$TEST_ROOT" DISK_FREE_FLOOR_GB=0 \
    PATH="$stub:$PATH" REAL_GIT="$(command -v git)" "$REPO_ROOT/scripts/ratchet/mac/disk-free-floor.sh"
  [ "$status" -ne 0 ]
}
