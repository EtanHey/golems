#!/usr/bin/env bats
load lib/worktree-gc-fixtures

finished_fixture() {
  repo="$(make_fixture_repo finished)"
  worktree="$HOME/.t3/worktrees/finished/topic"
  git -C "$repo" worktree add -qb topic "$worktree" origin/main
  sqlite3 "$WORKTREE_GC_T3_DB" "
    CREATE TABLE orchestration_v2_projection_threads(thread_id TEXT,payload_json TEXT,deleted_at TEXT);
    CREATE TABLE orchestration_v2_projection_runs(thread_id TEXT,status TEXT);
    CREATE TABLE orchestration_v2_projection_provider_sessions(thread_id TEXT,status TEXT);
    CREATE TABLE orchestration_v2_projection_runtime_requests(thread_id TEXT,status TEXT);
    CREATE TABLE orchestration_v2_projection_provider_threads(thread_id TEXT,payload_json TEXT,status TEXT);
    CREATE TABLE orchestration_v2_projection_turn_items(thread_id TEXT,status TEXT);
    CREATE TABLE projection_projects(workspace_root TEXT);
    CREATE TABLE scheduled_tasks(thread_id TEXT,enabled INTEGER);
    INSERT INTO orchestration_v2_projection_threads VALUES ('t',json_object('worktreePath','$worktree','settledAt','2020-01-01','status','idle'),NULL);"
  mkdir -p "$TEST_ROOT/bin"
  cat > "$TEST_ROOT/bin/lsof" <<'SH'
#!/bin/bash
ps -o pid= -u "$(id -u)" | while read -r pid; do printf 'p%s\nn/\n' "$pid"; done
[[ -z "${GC_LIVE_PATH:-}" ]] || printf 'p999999\nn%s\n' "$GC_LIVE_PATH"
SH
  chmod +x "$TEST_ROOT/bin/lsof"
  export PATH="$TEST_ROOT/bin:$PATH"
  age_tree
}
age_tree() {
  python3 - "$worktree" <<'PY'
import os, subprocess, sys
root=sys.argv[1]; admin=subprocess.check_output(['git','-C',root,'rev-parse','--absolute-git-dir'],text=True).strip()
for base in (root,admin):
 for here, dirs, files in os.walk(base):
  for name in dirs+files: os.utime(os.path.join(here,name),(1,1),follow_symlinks=False)
  os.utime(here,(1,1))
PY
}
@test "T3 merged clean old settled checkout is removed" {
  finished_fixture
  mkdir -p "$worktree/.build.noindex"
  printf '.build*/\n' >> "$repo/.git/info/exclude"
  printf cache > "$worktree/.build.noindex/out"
  age_tree
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  echo "$output"
  [ "$status" -eq 0 ]; [[ "$output" == *REMOVED* ]]; [ ! -e "$worktree" ]
  [ ! -e "$repo/docs.local/worktree-archive/topic/.build.noindex" ]
}
@test "T3 dirty unpushed recent pinned and live checkouts keep named reasons" {
  finished_fixture
  printf local > "$worktree/local"
  run "$WORKTREE_GC" --apply --repo "$repo"
  [[ "$output" == *KEEP-dirty* ]]; [ -f "$worktree/local" ]
  rm "$worktree/local"
  commit_fixture_file "$worktree" local-commit
  age_tree
  run "$WORKTREE_GC" --apply --repo "$repo"
  [[ "$output" == *KEEP-unpushed* ]]; [ -d "$worktree" ]
  export WORKTREE_GC_PINS_FILE="$TEST_ROOT/pins"
  printf '%s\n' "$worktree" > "$WORKTREE_GC_PINS_FILE"
  run "$WORKTREE_GC" --apply --repo "$repo"
  [[ "$output" == *KEEP-pinned* ]]; [ -d "$worktree" ]
}
@test "T3 recent and live merged checkouts are protected even with idle-hours zero" {
  finished_fixture
  touch "$worktree/fixture.txt"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [[ "$output" == *KEEP-active* ]]; [ -d "$worktree" ]
  age_tree
  run env GC_LIVE_PATH="$worktree" "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [[ "$output" == *KEEP-live* ]]; [ -d "$worktree" ]
}
@test "kept old T3 and local trees trim ignored caches preserving tracked unignored docs and symlinks" {
  finished_fixture
  for location in t3 local; do
    if [[ "$location" == local ]]; then
      worktree="$(add_branch_worktree "$repo" local)"
    fi
    printf '.build*/\nnode_modules/\n.venv/\ndocs.local/\n' >> "$repo/.git/info/exclude"
    mkdir -p "$worktree/.build" "$worktree/node_modules" "$worktree/docs.local" "$worktree/pkg/.venv"
    mkdir -p "$worktree/brain-bar/.build" "$worktree/.build.noindex/swift" "$worktree/.build.noindex/docs.local"
    printf cache > "$worktree/brain-bar/.build/out"
    printf cache > "$worktree/.build.noindex/swift/out"
    printf receipt > "$worktree/.build.noindex/docs.local/only-copy"
    printf cache > "$worktree/.build/out"
    printf cache > "$worktree/node_modules/out"
    printf durable > "$worktree/docs.local/receipt"
    ln -s docs.local "$worktree/.venv"
    mkdir -p "$worktree/plain/node_modules"
    printf '!plain/node_modules/\n!plain/node_modules/**\n' >> "$repo/.git/info/exclude"
    printf keep > "$worktree/plain/node_modules/unignored"
    printf unignored > "$worktree/dirty"
    printf tracked > "$worktree/pkg/.venv/tracked"
    git -C "$worktree" add -f pkg/.venv/tracked
    age_tree
    run "$WORKTREE_GC" --dry-run --repo "$repo"
    [[ "$output" == *TRIM* ]]; [ -d "$worktree/.build" ]
    run "$WORKTREE_GC" --apply --repo "$repo"
    echo "$output"
    [ ! -e "$worktree/.build" ]; [ ! -e "$worktree/node_modules" ]
    [ ! -e "$worktree/brain-bar/.build" ]; [ ! -e "$worktree/.build.noindex/swift" ]
    [ "$(cat "$worktree/.build.noindex/docs.local/only-copy")" = receipt ]
    [ -L "$worktree/.venv" ]; [ -f "$worktree/plain/node_modules/unignored" ]
    [ -f "$worktree/fixture.txt" ]; [ -f "$worktree/docs.local/receipt" ]; [ -f "$worktree/pkg/.venv/tracked" ]
  done
}
@test "T3 missing state unsettled queued or archived running threads fail closed" {
  finished_fixture
  for mode in unsettled queued missing; do
    case "$mode" in
      unsettled) sqlite3 "$WORKTREE_GC_T3_DB" "UPDATE orchestration_v2_projection_threads SET payload_json=json_remove(payload_json,'$.settledAt');" ;;
      queued) sqlite3 "$WORKTREE_GC_T3_DB" "UPDATE orchestration_v2_projection_threads SET payload_json=json_set(payload_json,'$.archivedAt','2020-01-01'); INSERT INTO orchestration_v2_projection_runs VALUES ('t','queued');" ;;
      missing) rm "$WORKTREE_GC_T3_DB" ;;
    esac
    run "$WORKTREE_GC" --apply --repo "$repo"
    [[ "$output" == *KEEP-* ]]; [ -d "$worktree" ]
  done
}
@test "T3 squash without exact head PR stays kept" {
  finished_fixture
  commit_fixture_file "$worktree" feature
  git -C "$repo" merge --squash topic
  git -C "$repo" -c user.name=Fixture -c user.email=fixture@example.com commit -qm squash
  git -C "$repo" push -q origin main
  age_tree
  run "$WORKTREE_GC" --apply --repo "$repo"
  [[ "$output" == *KEEP-unpushed* ]]; [ -d "$worktree" ]
}
@test "T3 remote default wins over a main-named feature ref" {
  finished_fixture
  git -C "$repo" branch -m main trunk
  git -C "$repo" push -q origin trunk
  git -C "$TEST_ROOT/finished-origin.git" symbolic-ref HEAD refs/heads/trunk
  commit_fixture_file "$worktree" local-only
  git -C "$repo" push -q origin topic:main
  age_tree
  run "$WORKTREE_GC" --apply --repo "$repo"
  [[ "$output" == *KEEP-unpushed* ]]; [ -d "$worktree" ]
}
@test "T3 pending runtime request background work and native pin protect caches too" {
  finished_fixture
  for mode in request background pin; do
    case "$mode" in
      request) sqlite3 "$WORKTREE_GC_T3_DB" "INSERT INTO orchestration_v2_projection_runtime_requests VALUES ('t','pending');" ;;
      background) sqlite3 "$WORKTREE_GC_T3_DB" "DELETE FROM orchestration_v2_projection_runtime_requests; INSERT INTO orchestration_v2_projection_provider_threads VALUES ('t','{\"pendingBackgroundTasks\":[{}]}','idle');" ;;
      pin) sqlite3 "$WORKTREE_GC_T3_DB" "DELETE FROM orchestration_v2_projection_provider_threads; UPDATE orchestration_v2_projection_threads SET payload_json=json_set(payload_json,'$.pinnedAt','2020-01-01');" ;;
    esac
    run "$WORKTREE_GC" --apply --repo "$repo"
    [[ "$output" == *KEEP-undetermined* ]]; [ -d "$worktree" ]
  done
}
@test "T3 cache dry-run counts a disposable container once" {
  finished_fixture
  mkdir -p "$worktree/.build.noindex/swift"
  printf '.build*/\n' >> "$repo/.git/info/exclude"
  printf cache > "$worktree/.build.noindex/swift/out"
  printf local > "$worktree/dirty"
  age_tree
  run "$WORKTREE_GC" --dry-run --repo "$repo"
  echo "$output"
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | rg -c '^\{"action": "TRIM"')" -eq 1 ]
  [ -f "$worktree/.build.noindex/swift/out" ]
}
