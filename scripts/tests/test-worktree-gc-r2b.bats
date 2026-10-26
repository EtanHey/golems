#!/usr/bin/env bats
load lib/worktree-gc-fixtures

squash_fixture() {
  repo="$(make_fixture_repo squash)"
  worktree="$(add_branch_worktree "$repo" topic)"
  commit_fixture_file "$worktree" feature.txt
  merged_sha="$(git -C "$worktree" rev-parse HEAD)"
  git -C "$repo" merge --squash topic >/dev/null
  git -C "$repo" -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm squash
  git -C "$repo" push -q origin main
  git -C "$repo" config "url.$(git -C "$repo" remote get-url origin).insteadOf" https://github.com/fixture/repo
  git -C "$repo" remote set-url origin https://github.com/fixture/repo
  mkdir -p "$TEST_ROOT/bin"
  cat > "$TEST_ROOT/bin/gh" <<'STUB'
#!/usr/bin/env bash
[[ " $* " == *" --state merged "* ]] || exit 0 || return 1
[[ "${GH_FAIL:-0}" == 0 ]] || exit 1 || return 1
printf '[{"headRefName":"topic","headRefOid":"%s"}]\n' "$MERGED_SHA"
STUB
  chmod +x "$TEST_ROOT/bin/gh"
  export PATH="$TEST_ROOT/bin:$PATH" MERGED_SHA="$merged_sha"
}

t3_fixture() {
  repo="$(make_fixture_repo t3-repo)"
  worktree="$HOME/.t3/worktrees/t3-repo/candidate"
  git -C "$repo" worktree add -qb topic "$worktree" origin/main
  sqlite3 "$WORKTREE_GC_T3_DB" '
    CREATE TABLE orchestration_v2_projection_threads(thread_id TEXT PRIMARY KEY,payload_json TEXT);
    CREATE TABLE orchestration_v2_projection_runs(thread_id TEXT,status TEXT);
    CREATE TABLE orchestration_v2_projection_provider_sessions(thread_id TEXT,status TEXT);'
}

bind_thread() {
  sqlite3 "$WORKTREE_GC_T3_DB" "INSERT INTO orchestration_v2_projection_threads VALUES ('child',json_object('worktreePath','$worktree','settledAt',$1,'lineage',json_object('rootThreadId','owner-root')));"
}

@test "R2b squash merged exact head is removed" {
  squash_fixture
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *REMOVED* ]] || return 1
  [ ! -e "$worktree" ]
}

@test "R2b squash merged ancestor head is removed" {
  squash_fixture
  commit_fixture_file "$worktree" later-pr-commit.txt
  export MERGED_SHA="$(git -C "$worktree" rev-parse HEAD)"
  git -C "$worktree" reset --hard "$merged_sha" >/dev/null
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *REMOVED* ]] || return 1
  [ ! -e "$worktree" ]
}

@test "R2b extra local commit after merged head is kept" {
  squash_fixture
  commit_fixture_file "$worktree" local.txt
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 3 ]
  [[ "$output" == *KEEP-unpushed* ]] || return 1
  [ -d "$worktree" ]
}

@test "R2b failed merged PR lookup is undetermined" {
  squash_fixture
  run env GH_FAIL=1 "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *KEEP-undetermined* ]] || return 1
  [ -d "$worktree" ]
}

@test "R2b T3 unbound clean merged path is removed" {
  t3_fixture
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *REMOVED* ]] || return 1
  [ ! -e "$worktree" ]
}

@test "R2b T3 unsettled binding is kept" {
  t3_fixture; bind_thread NULL
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *KEEP-live* ]] || return 1
  [ -d "$worktree" ]
}

@test "R2b T3 settled binding with a queued run is kept" {
  t3_fixture; bind_thread "'2026-01-01'"
  sqlite3 "$WORKTREE_GC_T3_DB" "INSERT INTO orchestration_v2_projection_runs VALUES ('child','queued');"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *KEEP-live* ]] || return 1
  [ -d "$worktree" ]
}

@test "R2b T3 missing DB fails closed" {
  t3_fixture; rm "$WORKTREE_GC_T3_DB"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *KEEP-undetermined* ]] || return 1
  [ -d "$worktree" ]
}

@test "R2b pin file protects a path and a branch" {
  repo="$(make_fixture_repo pins)"
  worktree="$(add_branch_worktree "$repo" path-pin)"
  other="$(add_branch_worktree "$repo" branch-pin)"
  mkdir -p "$HOME/.config/golems"
  printf '%s\nbranch-pin\n' "$worktree" > "$HOME/.config/golems/worktree-gc-pins.txt"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *KEEP-pinned* ]] || return 1
  [ -d "$worktree" ]
  [ -d "$other" ]
}

@test "R2b dirty older than 72h is reported under T3 owner" {
  t3_fixture; bind_thread "'2026-01-01'"
  # A settled owner allows the dirty guard to run. Mock only admin birth time.
  printf dirty > "$worktree/local.txt"
  mkdir -p "$TEST_ROOT/bin"
  export REAL_STAT="$(command -v stat)"
  printf '#!/usr/bin/env bash\ncase "$*" in *%%B*|*%%W*) echo 1;; *) exec "$REAL_STAT" "$@";; esac\n' > "$TEST_ROOT/bin/stat"
  chmod +x "$TEST_ROOT/bin/stat"
  run env PATH="$TEST_ROOT/bin:$PATH" "$WORKTREE_GC" --repo "$repo"
  [ "$status" -eq 0 ]
  python3 - "$WORKTREE_GC_REPORT_DIR/latest.json" "$worktree" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))["owners"]["owner-root"][0]
assert r["path"] == sys.argv[2] and r["reason"] == "KEEP-dirty" and r["size_bytes"] > 0
PY
  [ -s "$WORKTREE_GC_REPORT_DIR/latest.md" ]
  [ -s "$WORKTREE_GC_REPORT_DIR/receipts.jsonl" ]
}
