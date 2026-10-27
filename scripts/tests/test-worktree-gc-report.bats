#!/usr/bin/env bats
load lib/worktree-gc-fixtures

report_fixture() {
  mkdir -p "$HOME/Gits" "$WORKTREE_GC_REPORT_DIR"
  for name in a-failed z-healthy; do
    repo="$(make_fixture_repo "$name")"
    mv "$repo" "$HOME/Gits/"
  done
  failed="$HOME/Gits/a-failed"
  healthy="$HOME/Gits/z-healthy"
  failed_tree="$(add_branch_worktree "$failed" candidate)"
  detached="$failed/.worktrees/detached"
  git -C "$failed" worktree add -q --detach "$detached" origin/main
  healthy_tree="$(add_branch_worktree "$healthy" candidate)"
  printf dirty > "$healthy_tree/local.txt"
  # Age the healthy KEEP row into the existing owner queue.
  mkdir -p "$TEST_ROOT/bin"
  export REAL_STAT="$(command -v stat)"
  printf '#!/usr/bin/env bash\ncase "$*" in *%%B*|*%%W*) echo 1;; *) exec "$REAL_STAT" "$@";; esac\n' > "$TEST_ROOT/bin/stat"
  chmod +x "$TEST_ROOT/bin/stat"
  export PATH="$TEST_ROOT/bin:$PATH"
  printf 'stale\n' | tee "$WORKTREE_GC_REPORT_DIR/latest.json" > "$WORKTREE_GC_REPORT_DIR/latest.md"
}

assert_partial_report() {
  [ "$status" -eq 0 ] # Existing PR/fetch lookup failures are KEEP, not exit 2.
  [[ "$output" != *' · REMOVE'* ]] || return 1
  [ -d "$failed_tree" ] && [ -d "$detached" ]
  python3 - "$WORKTREE_GC_REPORT_DIR" "$stage" "$failed_tree" "$detached" "$healthy_tree" <<'PY'
import datetime, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
r = json.loads((root / 'latest.json').read_text())
assert r['status'] == 'partial' and r['error_count'] == 1
assert r['exit_status'] == 0
datetime.datetime.fromisoformat(r['generated_at'])
rows = r['owners']['a-failed']
error, = [row for row in rows if row['reason'] == 'ERROR']
assert error['repo'] == 'a-failed' and error['stage'] == sys.argv[2]
assert error['detail'] and len(error['detail']) < 500
for path in sys.argv[3:5]:
    row, = [row for row in rows if row['path'] == path]
    assert row['reason'] == 'KEEP-undetermined'
row, = r['owners']['z-healthy']
assert row['path'] == sys.argv[5] and row['reason'] == 'KEEP-dirty'
md = (root / 'latest.md').read_text()
assert 'partial' in md and 'errors=1' in md
assert r['generated_at'] in md and error['stage'] in md and error['detail'] in md
assert json.loads((root / 'last-run.json').read_text()) == r
assert not list(root.glob('.latest.*'))
PY
}

@test "PR lookup failure publishes partial report and classifies healthy sibling" {
  report_fixture
  git -C "$failed" config remote.origin.url https://github.com/fixture/failed.git
  git -C "$failed" config url."$TEST_ROOT/a-failed-origin.git".insteadOf https://github.com/fixture/failed.git
  cat > "$TEST_ROOT/bin/gh" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *'--state merged'*)
    case "$GC_PR_FAILURE" in merged) exit 1;; incomplete) echo '{}';; *) echo '[]';; esac ;;
  *) [[ "$GC_PR_FAILURE" != open ]] ;;
esac
SH
  chmod +x "$TEST_ROOT/bin/gh"
  stage=pr-lookup
  for failure in open merged incomplete; do
    run env GC_PR_FAILURE="$failure" "$WORKTREE_GC" --dry-run
    assert_partial_report
  done
}

@test "missing origin publishes partial report and classifies healthy sibling" {
  report_fixture
  git -C "$failed" remote remove origin
  stage=fetch
  run "$WORKTREE_GC" --dry-run
  assert_partial_report
}

@test "every run rewrites latest artifacts with a new timestamp" {
  report_fixture
  run "$WORKTREE_GC" --dry-run --repo "$healthy"
  [ "$status" -eq 0 ]
  cp "$WORKTREE_GC_REPORT_DIR/latest.json" "$TEST_ROOT/first.json"
  run "$WORKTREE_GC" --dry-run --repo "$healthy"
  [ "$status" -eq 0 ]
  python3 - "$TEST_ROOT/first.json" "$WORKTREE_GC_REPORT_DIR" <<'PY'
import json, pathlib, sys
before = json.load(open(sys.argv[1]))
root = pathlib.Path(sys.argv[2])
after = json.loads((root / 'latest.json').read_text())
assert after['generated_at'] > before['generated_at']
assert after['status'] == 'complete' and after['error_count'] == 0
assert after['generated_at'] in (root / 'latest.md').read_text()
PY
}
