#!/usr/bin/env bats
load lib/worktree-gc-fixtures

teardown() {
  # Baseline failures can copy protected modes/flags into the fixture archive.
  [[ "$(uname -s)" != Darwin ]] || chflags -R nouchg "$TEST_ROOT"
  chmod -R u+rwX "$TEST_ROOT"
  case "$TEST_ROOT" in "$fixture_parent"/test.*) rm -rf "$TEST_ROOT" ;; *) return 1 ;; esac
}

readonly_fixture() {
  repo="$(make_fixture_repo readonly)"
  mkdir -p "$HOME/Gits"
  mv "$repo" "$HOME/Gits/"; repo="$HOME/Gits/readonly"
  worktree="$(add_branch_worktree "$repo" candidate)"
  printf 'docs.local/\n' >> "$repo/.git/info/exclude"
  mkdir -p "$worktree/docs.local/a" "$worktree/docs.local/b"
  printf 'preserve me\n' > "$worktree/docs.local/a/evidence"
}

assert_kept() {
  [ "$status" -eq 0 ]
  [[ "$output" == *KEEP-undetermined*'read-only or immutable content:'* ]] || return 1
  [ "$(cat "$worktree/docs.local/a/evidence")" = 'preserve me' ]
  [ -f "$worktree/fixture.txt" ]
  git -C "$repo" worktree list --porcelain | grep -Fx "worktree $worktree"
  [ ! -e "$repo/docs.local/worktree-archive" ]
}

@test "R2f read-only ignored directories KEEP intact and registered with owner report" {
  readonly_fixture
  chmod u-w "$worktree/docs.local/a" "$worktree/docs.local/b"
  run "$WORKTREE_GC" --apply --idle-hours 0
  chmod u+w "$worktree/docs.local/a" "$worktree/docs.local/b"
  assert_kept
  [[ "$output" == *"$worktree/docs.local/a (+1 more)"* ]] || return 1
  python3 - "$WORKTREE_GC_REPORT_DIR/latest.json" "$WORKTREE_GC_REPORT_DIR/latest.md" "$worktree" <<'PY'
import json, sys
row, = json.load(open(sys.argv[1]))['owners']['readonly']
assert row['path'] == sys.argv[3] and row['reason'] == 'KEEP-undetermined'
assert 'read-only or immutable content:' in row['detail']
assert row['detail'] in open(sys.argv[2]).read()
PY
}

@test "R2f ordinary clean merged tree still removes" {
  readonly_fixture
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *REMOVED* ]] || return 1
  [ ! -e "$worktree" ]
}

@test "R2f macOS immutable file and directory KEEP without archiving" {
  [[ "$(uname -s)" == Darwin ]] || skip 'macOS immutable flags'
  readonly_fixture
  for entry in "$worktree/docs.local/a/evidence" "$worktree/docs.local/a"; do
    chflags uchg "$entry"
    run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
    chflags nouchg "$entry"
    assert_kept
    [[ "$output" == *"$entry"* ]] || return 1
  done
}
