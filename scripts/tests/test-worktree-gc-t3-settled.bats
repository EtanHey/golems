#!/usr/bin/env bats
load lib/worktree-gc-fixtures

fixture() {
  export GC_SOURCE="${GC_BASELINE_SOURCE:-$GC_SOURCE}"
  repo="$(make_fixture_repo settled)"
  worktree="$HOME/.t3/worktrees/settled/topic"
  git -C "$repo" worktree add -qb topic "$worktree" origin/main
  sqlite3 "$WORKTREE_GC_T3_DB" "
CREATE TABLE IF NOT EXISTS orchestration_v2_projection_threads(thread_id TEXT,payload_json TEXT,deleted_at TEXT);
CREATE TABLE IF NOT EXISTS orchestration_v2_projection_runs(thread_id TEXT,status TEXT);
CREATE TABLE IF NOT EXISTS orchestration_v2_projection_provider_sessions(thread_id TEXT,status TEXT);
CREATE TABLE IF NOT EXISTS orchestration_v2_projection_runtime_requests(thread_id TEXT,status TEXT);
CREATE TABLE IF NOT EXISTS orchestration_v2_projection_provider_threads(thread_id TEXT,status TEXT,payload_json TEXT);
CREATE TABLE IF NOT EXISTS orchestration_v2_projection_turn_items(thread_id TEXT,status TEXT);
CREATE TABLE IF NOT EXISTS scheduled_tasks(thread_id TEXT,enabled INTEGER);
CREATE TABLE IF NOT EXISTS projection_projects(workspace_root TEXT);
INSERT INTO orchestration_v2_projection_threads VALUES ('t',json_object('worktreePath','$worktree','settledAt','2020-01-01T00:00:00Z'),NULL);"
  mkdir -p "$TEST_ROOT/bin"
  cat > "$TEST_ROOT/bin/lsof" <<'STUB'
#!/usr/bin/env bash
[[ "${LSOF_FAIL:-0}" == 0 ]] || exit 1
printf 'p1\nf1\nn%s\n' "${OPEN_FILE:-/outside}"
STUB
  printf '#!/usr/bin/env bash\necho 1\n' > "$TEST_ROOT/bin/ps"
  cat > "$TEST_ROOT/bin/gh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$GH_CALLS"
if [[ " $* " == *' --state open '* ]]; then
  [[ "${OPEN_FAIL:-0}" == 0 ]] || { echo 'HTTP 429 secondary rate limit' >&2; exit 1; }
  printf '%s\n' "${OPEN_PRS:-[]}"
else
  [[ " $* " != *' --head unknown '* ]] || { echo 'HTTP 403 API rate limit exceeded' >&2; exit 1; }
  if [[ "${NO_PR:-0}" == 1 ]]; then echo '[]'; else
    printf '[{"headRefName":"topic","headRefOid":"%s","state":"%s"}]\n' "$PR_SHA" "${PR_STATE:-MERGED}"
  fi
fi
STUB
  chmod +x "$TEST_ROOT/bin/"*
  export PATH="$TEST_ROOT/bin:$PATH" GH_CALLS="$TEST_ROOT/gh-calls"
  git -C "$repo" config "url.$(git -C "$repo" remote get-url origin).insteadOf" https://github.com/fixture/settled
  git -C "$repo" remote set-url origin https://github.com/fixture/settled
  export PR_SHA="$(git -C "$worktree" rev-parse HEAD)"
}
age() {
  python3 - "$worktree" <<'PY'
import os,sys,time,subprocess
root=sys.argv[1]
admin=subprocess.check_output(['git','-C',root,'rev-parse','--absolute-git-dir'],text=True).strip()
for base in (root,admin):
 for here,ds,fs in os.walk(base):
  for n in fs+ds:
   os.utime(os.path.join(here,n),(time.time()-172800,)*2,follow_symlinks=False)
 os.utime(base,(time.time()-172800,)*2)
PY
}
@test "settled T3 merged PR archives ignored notes and removes with receipt" {
  fixture
  commit_fixture_file "$worktree" feature
  export PR_SHA="$(git -C "$worktree" rev-parse HEAD)"
  printf 'docs.local/\n' >> "$(git -C "$repo" rev-parse --absolute-git-dir)/info/exclude"
  mkdir -p "$worktree/docs.local"; echo precious > "$worktree/docs.local/note"
  age
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]; [[ "$output" == *REMOVED* ]]; [ ! -e "$worktree" ]
  [ "$(cat "$repo/docs.local/worktree-archive/topic/docs.local/note")" == precious ]
  [ -s "$repo/docs.local/worktree-archive/topic/RECEIPT.tsv" ]
  [ "$(grep -c -- '--state open' "$GH_CALLS")" -eq 1 ]
}
@test "T3 live unsettled recent dirty open PR and unknown states keep" {
  fixture; age
  for why in unsettled live recent dirty open unknown; do
    sqlite3 "$WORKTREE_GC_T3_DB" "UPDATE orchestration_v2_projection_threads SET payload_json=json_set(payload_json,'$.settledAt','2020-01-01T00:00:00Z'); DELETE FROM orchestration_v2_projection_runs;"
    export OPEN_PRS='[]' OPEN_FILE=/outside
    case "$why" in
      unsettled) sqlite3 "$WORKTREE_GC_T3_DB" "UPDATE orchestration_v2_projection_threads SET payload_json=json_remove(payload_json,'$.settledAt');" ;;
      live) export OPEN_FILE="$worktree/fixture.txt" ;;
      recent) touch "$worktree/fixture.txt" ;;
      dirty) echo local > "$worktree/local" ;;
      open) export OPEN_PRS='[{"headRefName":"topic","number":1}]' ;;
      unknown) sqlite3 "$WORKTREE_GC_T3_DB" 'DELETE FROM orchestration_v2_projection_threads;' ;;
    esac
    run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
    [ -d "$worktree" ]; [[ "$output" == *KEEP-* ]]
    [[ "$why" != dirty ]] || unlink "$worktree/local"
    age
  done
}
@test "one failed branch proof keeps only unknown branch and records category" {
  fixture
  unknown="$repo/.worktrees/unknown"
  git -C "$repo" worktree add -qb unknown "$unknown" origin/main
  commit_fixture_file "$unknown" unknown
  age
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]; [ ! -e "$worktree" ]; [ -d "$unknown" ]
  [[ "$output" == *rate-limit* ]]
  [ "$(grep -c -- '--state open' "$GH_CALLS")" -eq 1 ]
}
@test "T3 open lookup failure keeps even a head on default branch" {
  fixture; age
  run env OPEN_FAIL=1 "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]; [ -d "$worktree" ]; [[ "$output" == *KEEP-undetermined* ]]
}
@test "archived-only binding and incomplete open-file view cannot authorize removal" {
  fixture; age
  run env LSOF_FAIL=1 "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ -d "$worktree" ]; [[ "$output" == *KEEP-undetermined* ]]
  sqlite3 "$WORKTREE_GC_T3_DB" "UPDATE orchestration_v2_projection_threads SET payload_json=json_set(json_remove(payload_json,'$.settledAt'),'$.archivedAt','2020-01-01T00:00:00Z');"
  run env LSOF_FAIL=1 "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ -d "$worktree" ]; [[ "$output" == *KEEP-live* ]]
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]; [ -d "$worktree" ]
}
@test "pending request and unknown run status protect settled T3 trees" {
  fixture; age
  for status in pending unknown; do
    if [[ "$status" == pending ]]; then
      sqlite3 "$WORKTREE_GC_T3_DB" "INSERT INTO orchestration_v2_projection_runtime_requests VALUES ('t','pending');"
    else
      sqlite3 "$WORKTREE_GC_T3_DB" "DELETE FROM orchestration_v2_projection_runtime_requests; INSERT INTO orchestration_v2_projection_runs VALUES ('t',NULL);"
    fi
    run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
    [ -d "$worktree" ]; [[ "$output" == *KEEP-undetermined* ]]
  done
}
@test "T3 archive failure keeps the tree" {
  fixture; age
  export REAL_PYTHON="$(command -v python3)"
  cat > "$TEST_ROOT/bin/python3" <<'STUB'
#!/usr/bin/env bash
if [[ "$1" == */worktree-archive.py && "$2" == archive ]]; then
  echo 'fixture archive failure'; exit 1
fi
exec "$REAL_PYTHON" "$@"
STUB
  chmod +x "$TEST_ROOT/bin/python3"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ -d "$worktree" ]; [[ "$output" == *"KEEP-undetermined · fixture archive failure"* ]]
  [[ "$output" != *REMOVING* ]]
}

@test "T3 default-branch ancestry without a PR keeps but closed PR permits" {
  fixture; age
  run env NO_PR=1 "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]; [ -d "$worktree" ]; [[ "$output" == *"T3 PR state unproven"* ]]
  run env PR_STATE=CLOSED "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]; [ ! -e "$worktree" ]
}
@test "prune-plan TSV lists every tree size reasons and notes without copying or removing" {
  fixture
  printf 'docs.local/\nnode_modules/\n' >> "$(git -C "$repo" rev-parse --absolute-git-dir)/info/exclude"
  mkdir -p "$worktree/docs.local" "$worktree/node_modules"
  echo notes > "$worktree/docs.local/note"
  echo cache > "$worktree/node_modules/cache"
  age
  sibling="$(add_branch_worktree "$repo" dirty)"
  echo dirty > "$sibling/local"
  run "$WORKTREE_GC" --prune-plan --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]; [ -d "$worktree" ]; [ -d "$sibling" ]
  [ ! -e "$repo/docs.local/worktree-archive" ]
  plan="$(printf '%s\n' "$output" | sed -n 's/^List-only plan TSV: //p')"
  [ -f "$plan" ]
  python3 - "$plan" "$worktree" "$sibling" <<'CHECK'
import csv,json,sys
rows=list(csv.DictReader(open(sys.argv[1]), delimiter='\t'))
assert len(rows)==2
by={r['path']:r for r in rows}
a=by[sys.argv[2]]
assert a['verdict']=='REMOVE' and int(a['size_bytes'])>0 and a['reason']
assert a['inventory_status']=='complete'
notes=json.loads(a['notes_to_archive_json'])
assert 'docs.local/note' in notes and 'node_modules/cache' not in notes
b=by[sys.argv[3]]
assert b['verdict']=='KEEP-dirty' and int(b['size_bytes'])>0 and b['reason']
CHECK
}

@test "T3 no-flag report says would remove dry run and never REMOVE" {
  fixture; age
  run "$WORKTREE_GC" --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]; [ -d "$worktree" ]
  [[ "$output" == *"would remove (dry run)"* ]]
  [[ "$output" != *" · REMOVE · "* && "$output" != *REMOVING* ]]
}
