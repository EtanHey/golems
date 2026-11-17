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
  [ "$status" -eq 0 ]
  [[ "$output" != *' · REMOVE'* ]] || return 1
  [ -d "$failed_tree" ] && [ -d "$detached" ]
  python3 - "$WORKTREE_GC_REPORT_DIR" "$failed_tree" "$detached" "$healthy_tree" <<'PYTEST'
import datetime,json,pathlib,sys
root=pathlib.Path(sys.argv[1]); r=json.loads((root/'latest.json').read_text())
assert r['status']=='partial' and r['error_count']==0 and r['network_error_count']==2
assert r['exit_status']==0
datetime.datetime.fromisoformat(r['generated_at'])
rows={row['path']:row for row in r['checkouts']}
for path in sys.argv[2:4]:
    assert rows[path]['verdict']=='KEEP-undetermined'
    assert 'git fetch origin failed' in rows[path]['detail']
    assert rows[path]['detail'] and len(rows[path]['detail']) < 500
assert rows[sys.argv[4]]['verdict']=='KEEP-dirty'
assert json.loads((root/'last-run.json').read_text())==r
md=(root/'latest.md').read_text()
assert r['generated_at'] in md and 'partial' in md and 'errors=0' in md
for path in sys.argv[2:4]:
    assert rows[path]['detail'] in md
assert not list(root.glob('.latest.*'))
PYTEST
}

@test "PR lookup failure publishes partial report and classifies healthy sibling" {
  report_fixture
  commit_fixture_file "$failed_tree" unpublished
  git -C "$failed" config remote.origin.url https://github.com/fixture/failed.git
  git -C "$failed" config url."$TEST_ROOT/a-failed-origin.git".insteadOf https://github.com/fixture/failed.git
  cat > "$TEST_ROOT/bin/gh" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *'--state merged'*)
    case "$GC_PR_FAILURE" in merged) exit 1;; incomplete) echo '{}';; *) echo '[]';; esac ;;
  *) [[ "$GC_PR_FAILURE" != open ]] || exit 1; echo '[]' ;;
esac
SH
  chmod +x "$TEST_ROOT/bin/gh"
  stage=pr-lookup
  for failure in open merged incomplete; do
    run env GC_PR_FAILURE="$failure" "$WORKTREE_GC" --dry-run
    [ "$status" -eq 0 ]
    python3 - "$WORKTREE_GC_REPORT_DIR/latest.json" "$failed_tree" "$detached" <<'CHECK'
import json,sys
r=json.load(open(sys.argv[1]))
assert r['status']=='partial' and r['error_count']==0 and r['lookup_error_count']==1
by_path={x['path']:x for x in r['checkouts']}
assert by_path[sys.argv[2]]['verdict']=='KEEP-undetermined'
assert 'PR lookup' in by_path[sys.argv[2]]['detail']
assert by_path[sys.argv[3]]['verdict']=='REMOVE'
assert r['owners']['z-healthy'][0]['reason']=='KEEP-dirty'
CHECK
  done
}

@test "missing origin publishes partial report and classifies healthy sibling" {
  report_fixture
  git -C "$failed" remote remove origin
  stage=fetch
  run "$WORKTREE_GC" --dry-run
  assert_partial_report
}

@test "every full scan rewrites latest artifacts with a new timestamp" {
  report_fixture
  run "$WORKTREE_GC" --dry-run
  [ "$status" -eq 0 ]
  cp "$WORKTREE_GC_REPORT_DIR/latest.json" "$TEST_ROOT/first.json"
  run "$WORKTREE_GC" --dry-run
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

@test "scoped scans preserve every repo in the last full report byte for byte" {
  report_fixture
  printf dirty > "$failed_tree/local.txt"
  run "$WORKTREE_GC" --dry-run
  [ "$status" -eq 0 ]
  python3 - "$WORKTREE_GC_REPORT_DIR/latest.json" <<'PYTEST'
import json, sys
assert set(json.load(open(sys.argv[1]))['owners']) == {'a-failed', 'z-healthy'}
PYTEST
  cp "$WORKTREE_GC_REPORT_DIR/latest.json" "$TEST_ROOT/full.json"
  cp "$WORKTREE_GC_REPORT_DIR/latest.md" "$TEST_ROOT/full.md"
  for scope in repo path prune; do
    case "$scope" in
      repo) run "$WORKTREE_GC" --repo "$healthy" ;;
      path) run "$WORKTREE_GC" --path "$healthy_tree" ;;
      prune) run "$WORKTREE_GC" --prune-plan ;;
    esac
    [ "$status" -eq 0 ]
    cmp "$TEST_ROOT/full.json" "$WORKTREE_GC_REPORT_DIR/latest.json"
    cmp "$TEST_ROOT/full.md" "$WORKTREE_GC_REPORT_DIR/latest.md"
    [ -s "$WORKTREE_GC_REPORT_DIR/last-run.json" ]
  done
}

@test "full scan processing error still publishes partial with error row" {
  report_fixture
  mkdir -p "$HOME/Gits/broken/.git"
  run "$WORKTREE_GC" --dry-run
  [ "$status" -eq 2 ]
  python3 - "$WORKTREE_GC_REPORT_DIR/latest.json" <<'PYTEST'
import json, sys
r = json.load(open(sys.argv[1]))
assert r['status'] == 'partial' and r['exit_status'] == 2
assert r['error_count'] == 1
assert r['owners']['broken'][0]['reason'] == 'ERROR'
assert 'z-healthy' in r['owners']
PYTEST
}

@test "publish failure exits nonzero and cleans stage files with json committed last" {
  report_fixture
  for artifact in latest.md latest.json; do
    rm "$WORKTREE_GC_REPORT_DIR/$artifact"
    mkdir "$WORKTREE_GC_REPORT_DIR/$artifact"
    run "$WORKTREE_GC" --dry-run
    [ "$status" -ne 0 ]
    [[ "$output" == *"report publish failed"* ]] || return 1
    python3 - "$WORKTREE_GC_REPORT_DIR" "$artifact" <<'PYTEST'
import pathlib, sys
root = pathlib.Path(sys.argv[1])
assert not list(root.glob('.latest.*'))
assert not list(root.glob('.last-run.*'))
if sys.argv[2] == 'latest.md':
    assert (root / 'latest.json').read_text() == 'stale\n'
else:
    assert 'status=complete' in (root / 'latest.md').read_text()
PYTEST
    rmdir "$WORKTREE_GC_REPORT_DIR/$artifact"
    printf 'stale\n' > "$WORKTREE_GC_REPORT_DIR/$artifact"
  done
}

@test "apply keeps eligible failed repo tree and removes eligible healthy sibling" {
  report_fixture
  rm "$healthy_tree/local.txt"
  git -C "$failed" remote remove origin
  run "$WORKTREE_GC" --apply --idle-hours 0
  [ "$status" -eq 0 ]
  [ -d "$failed_tree" ]
  [ -d "$detached" ]
  [ ! -e "$healthy_tree" ]
  [[ "$output" == *"REMOVED"* ]] || return 1
  python3 - "$WORKTREE_GC_REPORT_DIR/latest.json" "$failed_tree" <<'PYTEST'
import json, sys
r = json.load(open(sys.argv[1]))
assert r['status'] == 'partial' and r['error_count'] == 1
row, = [row for row in r['owners']['a-failed'] if row['path'] == sys.argv[2]]
assert row['reason'] == 'KEEP-undetermined'
PYTEST
}
