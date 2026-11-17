#!/usr/bin/env bats
load lib/worktree-gc-fixtures

runtime_repo() {
  repo="$(make_fixture_repo runtime)"
  worktree="$(add_branch_worktree "$repo" topic)"
  commit_fixture_file "$worktree" feature
  git -C "$repo" config "url.$TEST_ROOT/runtime-origin.git.insteadOf" https://github.com/fixture/runtime
  git -C "$repo" remote set-url origin https://github.com/fixture/runtime
  mkdir -p "$TEST_ROOT/bin"
  export CALLS="$TEST_ROOT/gh-calls" PR_SHA="$(git -C "$worktree" rev-parse HEAD)"
  export PATH="$TEST_ROOT/bin:$PATH"
}

@test "PR heads are fetched once per repo and reused at final recheck" {
  runtime_repo
  cat > "$TEST_ROOT/bin/gh" <<'SH'
#!/bin/bash
printf '%s\n' "$*" >> "$CALLS"
case "$*" in
 *'--state open'*) echo '[]' ;;
 *) printf '[{"headRefName":"topic","headRefOid":"%s","baseRefName":"main"}]\n' "$PR_SHA" ;;
esac
SH
  chmod +x "$TEST_ROOT/bin/gh"
  run "$WORKTREE_GC" --dry-run --repo "$repo"
  [ "$status" -eq 0 ]; [[ "$output" == *' · REMOVE · '* ]]
  [ "$(grep -c -- '--state merged' "$CALLS")" -eq 1 ]
  ! grep -q -- '--limit 10000' "$CALLS"
}

@test "T3 branch lookup is cheap cached and a failed branch does not poison a sibling" {
  runtime_repo
  local good="$worktree" bad="$(add_branch_worktree "$repo" bad)"
  commit_fixture_file "$bad" private-feature
  cat > "$TEST_ROOT/bin/gh" <<'SH'
#!/bin/bash
printf '%s\n' "$*" >> "$CALLS"
case "$*" in
 *'--state open'*) echo '[]' ;;
 *'--head bad '*) exit 1 ;;
 *'--head topic '*) printf '[{"headRefOid":"%s","baseRefName":"main"}]\n' "$PR_SHA" ;;
 *) exit 9 ;;
esac
SH
  chmod +x "$TEST_ROOT/bin/gh"
  # Helper mode directly exercises branch-cache boundaries without weakening
  # the independent T3 database/age gates.
  run python3 "$REPO_ROOT/scripts/lib/worktree-gc-prs.py" "$TEST_ROOT/cache" fixture/runtime t3 bad
  [ "$status" -ne 0 ]
  run python3 "$REPO_ROOT/scripts/lib/worktree-gc-prs.py" "$TEST_ROOT/cache" fixture/runtime t3 topic
  [ "$status" -eq 0 ]; [[ "$output" == *"$PR_SHA"* ]]
  run python3 "$REPO_ROOT/scripts/lib/worktree-gc-prs.py" "$TEST_ROOT/cache" fixture/runtime t3 topic
  [ "$status" -eq 0 ]
  [ "$(grep -c -- '--head topic ' "$CALLS")" -eq 1 ]
  [ "$(grep -c -- '--head bad ' "$CALLS")" -eq 1 ]
  ! grep -q -- '--limit 2001' "$CALLS"
}

@test "large repo probe is cached and resolves heads using five-row branch lookups" {
  runtime_repo
  cat > "$TEST_ROOT/bin/gh" <<'SH'
#!/bin/bash
printf '%s\n' "$*" >> "$CALLS"
case "$*" in
 *'--limit 2001'*) python3 -c 'import json; print(json.dumps([dict(headRefName="other",headRefOid="a"*40,baseRefName="main")]*2001))' ;;
 *'--head topic '*) printf '[{"headRefOid":"%s","baseRefName":"main"}]\n' "$PR_SHA" ;;
 *) echo '[]' ;;
esac
SH
  chmod +x "$TEST_ROOT/bin/gh"
  for branch in topic other topic; do
    run python3 "$REPO_ROOT/scripts/lib/worktree-gc-prs.py" "$TEST_ROOT/cache" fixture/runtime legacy "$branch"
    [ "$status" -eq 0 ]
  done
  [ "$(grep -c -- '--limit 2001' "$CALLS")" -eq 1 ]
  [ "$(grep -c -- '--head topic ' "$CALLS")" -eq 1 ]
  ! grep -q -- '--limit 10000' "$CALLS"
}

@test "wall budget interrupts a hanging PR child and publishes partial elapsed report without removal" {
  runtime_repo
  cat > "$TEST_ROOT/bin/gh" <<'SH'
#!/bin/bash
printf '%s\n' "$*" >> "$CALLS"
sleep 20
printf '[]\n'
SH
  chmod +x "$TEST_ROOT/bin/gh"
  run env WORKTREE_GC_BUDGET_SECONDS=2 "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  echo "$output"
  [ "$status" -eq 124 ]; [ -d "$worktree" ]
  python3 - "$WORKTREE_GC_REPORT_DIR/last-run.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
assert r['status']=='partial' and r['budget_exhausted'] is True
assert r['exit_status']==124 and 1.5 <= r['elapsed_seconds'] < 7
assert all(x['verdict'] not in ('REMOVED','REMOVING') for x in r['checkouts'])
PY
}

@test "budget preserves earlier decisions and never starts an unchecked removal" {
  runtime_repo
  local pinned; pinned="$(add_branch_worktree "$repo" a-pinned)"
  export WORKTREE_GC_PINS_FILE="$TEST_ROOT/pins"
  printf '%s\n' "$pinned" > "$WORKTREE_GC_PINS_FILE"
  cat > "$TEST_ROOT/bin/gh" <<'SH'
#!/bin/bash
sleep 20
printf '[]\n'
SH
  chmod +x "$TEST_ROOT/bin/gh"
  run env WORKTREE_GC_BUDGET_SECONDS=2 "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 124 ]; [ -d "$pinned" ]; [ -d "$worktree" ]
  python3 - "$WORKTREE_GC_REPORT_DIR/last-run.json" "$pinned" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
assert r['status']=='partial' and r['budget_exhausted'] and r['elapsed_seconds'] < 7
assert any(x['path']==sys.argv[2] and x['verdict']=='KEEP-pinned' for x in r['checkouts'])
assert all(x['verdict'] not in ('REMOVING','REMOVED') for x in r['checkouts'])
PY
}

@test "merged lookup failure keeps just that checkout while a known-safe sibling gets a verdict" {
  runtime_repo
  local safe; safe="$(add_branch_worktree "$repo" safe)"
  cat > "$TEST_ROOT/bin/gh" <<'SH'
#!/bin/bash
case "$*" in *'--state open'*) echo '[]';; *) exit 1;; esac
SH
  chmod +x "$TEST_ROOT/bin/gh"
  run "$WORKTREE_GC" --dry-run --repo "$repo"
  [ "$status" -eq 0 ]
  python3 - "$WORKTREE_GC_REPORT_DIR/last-run.json" "$worktree" "$safe" <<'PY'
import json,sys
r=json.load(open(sys.argv[1])); by_path={x['path']:x for x in r['checkouts']}
assert by_path[sys.argv[2]]['verdict']=='KEEP-undetermined'
assert by_path[sys.argv[3]]['verdict']=='REMOVE'
assert r['status']=='partial' and r['error_count']==0 and r['lookup_error_count']==1
PY
}
