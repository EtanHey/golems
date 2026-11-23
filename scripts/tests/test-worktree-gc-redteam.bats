#!/usr/bin/env bats
load lib/worktree-gc-fixtures

ordinary_fixture() {
  repo="$(make_fixture_repo redteam)"
  worktree="$(add_branch_worktree "$repo" topic)"
  sqlite3 "$WORKTREE_GC_T3_DB" '
CREATE TABLE IF NOT EXISTS orchestration_v2_projection_threads(thread_id TEXT,payload_json TEXT,deleted_at TEXT);
CREATE TABLE IF NOT EXISTS orchestration_v2_projection_runs(thread_id TEXT,status TEXT);
CREATE TABLE IF NOT EXISTS orchestration_v2_projection_provider_sessions(thread_id TEXT,status TEXT);'
}
bind_live() {
  sqlite3 "$WORKTREE_GC_T3_DB" "INSERT INTO orchestration_v2_projection_threads VALUES ('live',json_object('worktreePath','$worktree','archivedAt','2020-01-01T00:00:00Z'),NULL);"
}
@test "Opus A ordinary branch on base keeps when open PR snapshot fails" {
  ordinary_fixture
  git -C "$repo" config "url.$(git -C "$repo" remote get-url origin).insteadOf" https://github.com/fixture/redteam
  git -C "$repo" remote set-url origin https://github.com/fixture/redteam
  mkdir -p "$TEST_ROOT/bin"
  cat > "$TEST_ROOT/bin/gh" <<'STUB'
#!/usr/bin/env bash
# Real open list would contain topic #7; the request fails instead.
echo 'HTTP 502 Bad Gateway' >&2
exit 1
STUB
  chmod +x "$TEST_ROOT/bin/gh"
  run env PATH="$TEST_ROOT/bin:$PATH" "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]; [ -d "$worktree" ]
  [[ "$output" == *KEEP-undetermined*"pr-lookup"* ]]
}
@test "Opus B ordinary archived but unsettled thread remains live" {
  ordinary_fixture; bind_live
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]; [ -d "$worktree" ]; [[ "$output" == *KEEP-live* ]]
}
@test "Opus C ordinary live binding with missing table is undetermined" {
  ordinary_fixture; bind_live
  sqlite3 "$WORKTREE_GC_T3_DB" 'DROP TABLE orchestration_v2_projection_provider_sessions;'
  run "$WORKTREE_GC" --prune-plan --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]; [[ "$output" == *KEEP-undetermined* ]] || false; [ -d "$worktree" ]
  [[ "$output" != *Traceback* && "$output" != *SELECT* ]] || false
  plan="$(printf '%s\n' "$output" | sed -n 's/^List-only plan TSV: //p')"
  ! grep -Eq 'Traceback|SELECT|CalledProcessError' "$plan"
  grep -q 'no such table' "${plan%.plan.tsv}"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]; [ -d "$worktree" ]; [[ "$output" == *KEEP-undetermined* ]]
}
@test "Opus D malformed unrelated path cannot disable ordinary live guard" {
  ordinary_fixture
  sqlite3 "$WORKTREE_GC_T3_DB" "INSERT INTO orchestration_v2_projection_threads VALUES ('live',json_object('worktreePath','$worktree'),NULL); INSERT INTO orchestration_v2_projection_threads VALUES ('bad',json_object('worktreePath',5),NULL);"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]; [ -d "$worktree" ]; [[ "$output" == *KEEP-live* ]] || false
  journal="$(python3 -c 'import json,sys;print(json.loads(open(sys.argv[1]).read().splitlines()[-1])["journal"])' "$WORKTREE_GC_REPORT_DIR/receipts.jsonl")"
  grep -q 'worktree-path-invalid' "${journal%.rows.jsonl}"
}

@test "ordinary missing DB and unexpected state probe exits always keep" {
  ordinary_fixture; bind_live
  mv "$WORKTREE_GC_T3_DB" "$TEST_ROOT/preserved.sqlite"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]; [ -d "$worktree" ]; [[ "$output" == *KEEP-undetermined* ]] || false
  export REAL_PYTHON="$(command -v python3)"
  mkdir -p "$TEST_ROOT/bin"
  cat > "$TEST_ROOT/bin/python3" <<'STUB'
#!/usr/bin/env bash
if [[ "$1" == */worktree-gc-state.py && "$2" == t3 ]]; then
  echo 'Traceback fixture-only private diagnostic' >&2
  exit 7
fi
exec "$REAL_PYTHON" "$@"
STUB
  chmod +x "$TEST_ROOT/bin/python3"
  run env PATH="$TEST_ROOT/bin:$PATH" "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]; [ -d "$worktree" ]; [[ "$output" == *KEEP-undetermined* ]] || false
  [[ "$output" != *Traceback* ]]
}
