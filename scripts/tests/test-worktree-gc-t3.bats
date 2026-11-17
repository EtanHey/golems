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
ps -o pid= -u "$(id -u)" | while read -r pid; do printf 'p%s\nfcwd\nn/\n' "$pid"; done
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
  mkdir -p "$worktree/.build.noindex/swift"
  printf '.build*/\n' >> "$repo/.git/info/exclude"
  printf cache > "$worktree/.build.noindex/swift/out"
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
@test "T3 cache dry-run selects the exact child once" {
  finished_fixture
  mkdir -p "$worktree/.build.noindex/swift"
  printf '.build*/\n' >> "$repo/.git/info/exclude"
  printf cache > "$worktree/.build.noindex/swift/out"
  printf local > "$worktree/dirty"
  age_tree
  run "$WORKTREE_GC" --dry-run --repo "$repo"
  echo "$output"
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | grep -c '^{"action": "TRIM"')" -eq 1 ]
  [ -f "$worktree/.build.noindex/swift/out" ]
}

@test "R2 exact trim outputs preserve build-like data and legacy removal archives it" {
  finished_fixture
  for path in .build-receipts .buildkite-local .build.noindex/review .build.noindex/snapshots .build.noindex/e2e24; do
    mkdir -p "$worktree/$path"; printf receipt > "$worktree/$path/only-copy"
  done
  mkdir -p "$worktree/.build.noindex/swift" "$worktree/.build.noindex/review/node_modules" "$worktree/.build-receipts/.build"
  printf receipt > "$worktree/.build.noindex/review/node_modules/proof"
  printf receipt > "$worktree/.build-receipts/.build/proof"
  printf cache > "$worktree/.build.noindex/swift/out"
  printf '.build*/\n' >> "$repo/.git/info/exclude"
  printf dirty > "$worktree/local"
  age_tree
  run "$WORKTREE_GC" --apply --repo "$repo"
  [ "$status" -eq 0 ]; [ ! -e "$worktree/.build.noindex/swift" ]
  for path in .build-receipts .buildkite-local .build.noindex/review .build.noindex/snapshots .build.noindex/e2e24; do
    [ "$(cat "$worktree/$path/only-copy")" = receipt ]
  done
  [ -f "$worktree/.build.noindex/review/node_modules/proof" ]
  [ -f "$worktree/.build-receipts/.build/proof" ]
  local legacy; legacy="$(add_branch_worktree "$repo" legacy)"
  mkdir -p "$legacy/.build.noindex/swift" "$legacy/.build-receipts"
  printf receipt > "$legacy/.build-receipts/proof"
  printf cache > "$legacy/.build.noindex/swift/out"
  run "$WORKTREE_GC" --apply --idle-hours 0 --path "$legacy"
  [ "$status" -eq 0 ]; [ ! -e "$legacy" ]
  [ -f "$repo/docs.local/worktree-archive/legacy-worktree/.build-receipts/proof" ]
  [ -f "$repo/docs.local/worktree-archive/legacy-worktree/.build.noindex/swift/out" ]
}

@test "R3 permission failure names target and continues trimming and sibling judgments" {
  finished_fixture
  local kept; kept="$(add_branch_worktree "$repo" akeep)"
  printf 'node_modules/\nvenv/\n' >> "$repo/.git/info/exclude"
  mkdir -p "$kept/node_modules/a" "$kept/node_modules/z/locked" "$kept/venv"
  printf x > "$kept/node_modules/a/f"; printf x > "$kept/node_modules/z/locked/f"
  printf x > "$kept/venv/f"; printf dirty > "$kept/dirty"
  local saved="$worktree"; worktree="$kept"; age_tree; worktree="$saved"
  chmod 500 "$kept/node_modules/z/locked"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  chmod 700 "$kept/node_modules/z/locked"
  echo "$output"
  [ "$status" -eq 0 ]; [[ "$output" == *KEEP-trim-error*node_modules*'partially deleted'* ]]
  [ ! -e "$kept/venv" ]; [ ! -e "$worktree" ]
}

@test "R4 busy trim lock records KEEP-busy and still judges siblings" {
  finished_fixture
  local kept; kept="$(add_branch_worktree "$repo" kept)"
  printf 'node_modules/\n' >> "$repo/.git/info/exclude"
  mkdir -p "$kept/node_modules"; printf x > "$kept/node_modules/f"; printf dirty > "$kept/dirty"
  local saved="$worktree"; worktree="$kept"; age_tree; worktree="$saved"
  python3 -c 'import fcntl,sys,time; f=open(sys.argv[1],"a"); fcntl.flock(f,fcntl.LOCK_EX); open(sys.argv[2],"w").close(); time.sleep(30)' "$GOLEMS_HEAVY_LOCK" "$TEST_ROOT/locked" &
  local holder=$!
  while [ ! -e "$TEST_ROOT/locked" ]; do :; done
  run "$WORKTREE_GC" --apply --repo "$repo"
  kill "$holder"
  [ "$status" -eq 0 ]; [[ "$output" == *KEEP-busy* ]]; [ -f "$kept/node_modules/f" ]
  [[ "$output" == *"$worktree"* ]]
}

@test "R5 real lsof sees an open file with cwd outside the checkout" {
  finished_fixture
  local real_lsof; real_lsof="$(PATH=/usr/sbin:/usr/bin:/sbin:/bin command -v lsof)"
  mkdir -p "$worktree/.venv"; printf live > "$worktree/.venv/state.db"
  printf '.venv/\n' >> "$repo/.git/info/exclude"
  age_tree
  (cd "$TEST_ROOT" && exec tail -f "$worktree/.venv/state.db" >/dev/null) &
  local holder=$!
  # First prove the descriptor is present, avoiding a sleep-based readiness race.
  local seen=0
  for attempt in {1..100}; do
    if "$real_lsof" -p "$holder" -Fn | grep -q "n$worktree/.venv/state.db"; then seen=1; break; fi
  done
  if [ "$seen" -ne 1 ]; then kill "$holder"; return 1; fi
  run env PATH=/usr/sbin:/usr/bin:/sbin:/bin python3 "$REPO_ROOT/scripts/lib/worktree-gc-builds.py" trim "$worktree" apply
  kill "$holder"
  echo "$output"
  [ "$status" -eq 0 ]; [ -f "$worktree/.venv/state.db" ]
  [[ "$output" == *KEEP-live*'open file or mapping'* ]]
}

@test "archived and explicitly settled threads ignore retained limit recovery" {
  finished_fixture
  sqlite3 "$WORKTREE_GC_T3_DB" "UPDATE orchestration_v2_projection_threads SET payload_json=json_set(payload_json,'$.settledOverride','settled','$.limitRecovery',json('{}'));"
  # Use a nonempty recovery payload.
  sqlite3 "$WORKTREE_GC_T3_DB" "UPDATE orchestration_v2_projection_threads SET payload_json=json_set(payload_json,'$.limitRecovery',json('{\"autoResume\":true}'));"
  run "$WORKTREE_GC" --dry-run --repo "$repo"
  [ "$status" -eq 0 ]; [[ "$output" == *' · REMOVE · '* ]]
  sqlite3 "$WORKTREE_GC_T3_DB" "UPDATE orchestration_v2_projection_threads SET payload_json=json_set(json_remove(payload_json,'$.settledAt','$.settledOverride'),'$.archivedAt','2020-01-01');"
  run "$WORKTREE_GC" --dry-run --repo "$repo"
  [ "$status" -eq 0 ]; [[ "$output" == *' · REMOVE · '* ]]
}

@test "R8 exact-head PR requires the actual default base" {
  finished_fixture
  local remote="$TEST_ROOT/finished-origin.git"
  git -C "$repo" config remote.origin.url https://github.com/fixture/stack
  git -C "$repo" config "url.$remote.insteadOf" https://github.com/fixture/stack
  commit_fixture_file "$worktree" feature
  export PR_SHA="$(git -C "$worktree" rev-parse HEAD)"
  cat > "$TEST_ROOT/bin/gh" <<'SH'
#!/bin/bash
case " $* " in
  *' --state merged '*) printf '[{"headRefName":"topic","headRefOid":"%s","baseRefName":"%s"}]\n' "$PR_SHA" "$PR_BASE" ;;
esac
SH
  chmod +x "$TEST_ROOT/bin/gh"
  age_tree
  run env PR_BASE=parent "$WORKTREE_GC" --dry-run --repo "$repo"
  [ "$status" -eq 3 ]; [[ "$output" == *KEEP-unpushed* ]]; [ -d "$worktree" ]
  run env PR_BASE=main "$WORKTREE_GC" --dry-run --repo "$repo"
  echo "$output"
  [ "$status" -eq 0 ]; [[ "$output" == *' · REMOVE · '* ]]
}

@test "lsof error keeps exact build target and still judges later worktrees" {
  finished_fixture
  local kept; kept="$(add_branch_worktree "$repo" error)"
  printf 'node_modules/\n' >> "$repo/.git/info/exclude"
  mkdir -p "$kept/node_modules"; printf data > "$kept/node_modules/f"; printf dirty > "$kept/dirty"
  local saved="$worktree"; worktree="$kept"; age_tree; worktree="$saved"
  cat > "$TEST_ROOT/bin/lsof" <<'SH'
#!/bin/bash
case "$*" in *-Fpfan*) exit 1;; esac
ps -o pid= -u "$(id -u)" | while read -r pid; do printf 'p%s\nfcwd\nn/\n' "$pid"; done
SH
  run "$WORKTREE_GC" --apply --repo "$repo"
  [ "$status" -eq 0 ]; [ -f "$kept/node_modules/f" ]; [ ! -e "$worktree" ]
  [[ "$output" == *KEEP-trim-error*node_modules* ]]
}

@test "T3 archive preserves every unknown direct noindex child even with a generic cache name" {
  finished_fixture
  printf '.build*/\n' >> "$repo/.git/info/exclude"
  for name in node_modules .build .build.noindex venv review snapshots; do
    mkdir -p "$worktree/.build.noindex/$name"
    printf only-copy > "$worktree/.build.noindex/$name/proof"
  done
  mkdir -p "$worktree/.build.noindex/swift"; printf cache > "$worktree/.build.noindex/swift/out"
  age_tree
  run "$WORKTREE_GC" --apply --repo "$repo"
  [ "$status" -eq 0 ]; [ ! -e "$worktree" ]
  for name in node_modules .build .build.noindex venv review snapshots; do
    [ "$(cat "$repo/docs.local/worktree-archive/topic/.build.noindex/$name/proof")" = only-copy ]
  done
  [ ! -e "$repo/docs.local/worktree-archive/topic/.build.noindex/swift" ]
}
