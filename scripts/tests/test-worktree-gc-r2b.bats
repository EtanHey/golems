#!/usr/bin/env bats
load lib/worktree-gc-fixtures

squash_fixture() {
  repo="$(make_fixture_repo squash)"
  worktree="$(add_branch_worktree "$repo" topic)"
  commit_fixture_file "$worktree" feature.txt
  merged_sha="$(git -C "$worktree" rev-parse HEAD)"
  git -C "$repo" merge --squash topic >/dev/null
  git -C "$repo" -c user.name=Fixture -c user.email=fixture@example.com commit -qm squash
  git -C "$repo" push -q origin main
  git -C "$repo" config "url.$(git -C "$repo" remote get-url origin).insteadOf" https://github.com/fixture/repo
  git -C "$repo" remote set-url origin https://github.com/fixture/repo
  mkdir -p "$TEST_ROOT/bin"
  cat > "$TEST_ROOT/bin/gh" <<'STUB'
#!/usr/bin/env bash
[[ " $* " == *" --state merged "* ]] || exit 0
[[ "${GH_FAIL:-0}" == 0 ]] || exit 1
printf '[{"headRefName":"topic","headRefOid":"%s"}]\n' "$MERGED_SHA"
STUB
  chmod +x "$TEST_ROOT/bin/gh"
  export PATH="$TEST_ROOT/bin:$PATH" MERGED_SHA="$merged_sha"
}

t3_fixture() {
  repo="$(make_fixture_repo t3-repo)"
  mkdir -p "$HOME/Gits"
  mv "$repo" "$HOME/Gits/"; repo="$HOME/Gits/t3-repo"
  worktree="$repo/.worktrees/candidate"
  git -C "$repo" worktree add -qb topic "$worktree" origin/main
  sqlite3 "$WORKTREE_GC_T3_DB" '
    CREATE TABLE orchestration_v2_projection_threads(thread_id TEXT PRIMARY KEY,payload_json TEXT,deleted_at TEXT);
    CREATE TABLE orchestration_v2_projection_runs(thread_id TEXT,status TEXT);
    CREATE TABLE orchestration_v2_projection_provider_sessions(thread_id TEXT,status TEXT);'
}

managed_t3_fixture() {
  t3_fixture
  mkdir -p "$HOME/.t3/worktrees/t3-repo"
  git -C "$repo" worktree move "$worktree" "$HOME/.t3/worktrees/t3-repo/candidate"
  worktree="$HOME/.t3/worktrees/t3-repo/candidate"
}

bind_thread() {
  sqlite3 "$WORKTREE_GC_T3_DB" "INSERT INTO orchestration_v2_projection_threads(thread_id,payload_json) VALUES ('child',json_object('worktreePath','$worktree','settledAt',$1,'lineage',json_object('rootThreadId','owner-root')));"
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
  git -C "$worktree" branch preserved-pr-tip "$MERGED_SHA"
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

@test "R2b T3 managed root skips even with missing DB" {
  managed_t3_fixture
  rm "$WORKTREE_GC_T3_DB"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *t3-managed* ]] || return 1
  [ -d "$worktree" ]
}

@test "R2b T3 settled binding permits removal but every active session status keeps" {
  t3_fixture; bind_thread "'2026-01-01'"
  for state in running starting queued waiting preparing; do
    sqlite3 "$WORKTREE_GC_T3_DB" "DELETE FROM orchestration_v2_projection_provider_sessions; INSERT INTO orchestration_v2_projection_provider_sessions VALUES ('child','$state');"
    run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
    [[ "$output" == *KEEP-live* ]] || return 1
    [ -d "$worktree" ]
  done
  sqlite3 "$WORKTREE_GC_T3_DB" 'DELETE FROM orchestration_v2_projection_provider_sessions;'
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [[ "$output" == *REMOVED* ]] || return 1
  [ ! -e "$worktree" ]
}

@test "R2b T3 invalid schema cannot authorize managed-root removal" {
  managed_t3_fixture
  sqlite3 "$WORKTREE_GC_T3_DB" 'DROP TABLE orchestration_v2_projection_runs;'
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [[ "$output" == *t3-managed* ]] || return 1
  [ -d "$worktree" ]
}

@test "R2b merged PR head from a different branch cannot authorize removal" {
  squash_fixture
  git -C "$worktree" branch -m reused-name
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 3 ]
  [[ "$output" == *KEEP-unpushed* ]] || return 1
  [ -d "$worktree" ]
}

@test "R2b pin file protects a path and a branch" {
  repo="$(make_fixture_repo pins)"
  worktree="$(add_branch_worktree "$repo" path-pin)"
  other="$(add_branch_worktree "$repo" branch-pin)"
  mkdir -p "$HOME/.config/golems"
  ln -s "$repo" "$HOME/pin-alias"
  for pin in "$worktree" "$worktree/" "~/pin-alias/.worktrees/path-pin-worktree/" "$HOME/pin-alias/.worktrees/path-pin-worktree"; do
    printf '  %s \r\nbranch-pin\n# comment\n' "$pin" > "$HOME/.config/golems/worktree-gc-pins.txt"
    run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
    [ "$status" -eq 0 ]
    [[ "$output" == *"$worktree · path-pin · dirty=not-checked · ahead=not-checked · KEEP-pinned"* ]] || return 1
    [ -d "$worktree" ]; [ -d "$other" ]
  done
}

@test "R2b dirty older than 72h is reported under T3 owner" {
  t3_fixture; bind_thread "'2026-01-01'"
  # A settled owner allows the dirty guard to run. Mock only admin birth time.
  printf dirty > "$worktree/local.txt"
  mkdir -p "$TEST_ROOT/bin"
  export REAL_STAT="$(command -v stat)"
  printf '#!/usr/bin/env bash\ncase "$*" in *%%B*|*%%W*) echo 1;; *) exec "$REAL_STAT" "$@";; esac\n' > "$TEST_ROOT/bin/stat"
  chmod +x "$TEST_ROOT/bin/stat"
  run env PATH="$TEST_ROOT/bin:$PATH" "$WORKTREE_GC"
  [ "$status" -eq 0 ]
  python3 - "$WORKTREE_GC_REPORT_DIR/latest.json" "$worktree" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))["owners"]["owner-root"][0]
assert r["path"] == sys.argv[2] and r["reason"] == "KEEP-dirty" and r["size_bytes"] > 0
PY
  [ -s "$WORKTREE_GC_REPORT_DIR/latest.md" ]
  [ -s "$WORKTREE_GC_REPORT_DIR/receipts.jsonl" ]
}

@test "FIX1 partial and scan-error runs preserve the full owner report" {
  t3_fixture
  printf dirty > "$worktree/local.txt"
  age_worktrees
  "$WORKTREE_GC" >/dev/null
  python3 -c 'import json,sys; assert json.load(open(sys.argv[1]))["owners"]' "$WORKTREE_GC_REPORT_DIR/latest.json"
  cp "$WORKTREE_GC_REPORT_DIR/latest.json" "$TEST_ROOT/full.json"
  cp "$WORKTREE_GC_REPORT_DIR/latest.md" "$TEST_ROOT/full.md"
  other="$(add_branch_worktree "$repo" clean)"
  for args in path repo prune error scan-error; do
    case "$args" in
      path) run "$WORKTREE_GC" --path "$other" ;;
      repo) run "$WORKTREE_GC" --repo "$repo" ;;
      prune) run "$WORKTREE_GC" --prune-plan --repo "$repo" ;;
      error) run "$WORKTREE_GC" --repo "$HOME" ;;
      scan-error) mkdir -p "$HOME/Gits/broken/.git"; run "$WORKTREE_GC" ;;
    esac
    case "$args" in *error) [ "$status" -eq 2 ] ;; *) [ "$status" -eq 0 ] ;; esac
    cmp "$TEST_ROOT/full.json" "$WORKTREE_GC_REPORT_DIR/latest.json"
    cmp "$TEST_ROOT/full.md" "$WORKTREE_GC_REPORT_DIR/latest.md"
  done
}

age_worktrees() {
  mkdir -p "$TEST_ROOT/bin"; export REAL_STAT="$(command -v stat)"
  printf '#!/usr/bin/env bash\ncase "$*" in *%%B*|*%%W*) echo 1;; *) exec "$REAL_STAT" "$@";; esac\n' > "$TEST_ROOT/bin/stat"
  chmod +x "$TEST_ROOT/bin/stat"; export PATH="$TEST_ROOT/bin:$PATH"
}

@test "FIX1 failing report size helper never aborts reaping a later sibling" {
  t3_fixture; age_worktrees
  printf dirty > "$worktree/local.txt"
  other="$repo/.worktrees/z-clean"
  git -C "$repo" worktree add -qb clean "$other" origin/main
  printf '#!/usr/bin/env bash\nprintf "123\\tfixture\\n"; exit 1\n' > "$TEST_ROOT/bin/du"
  chmod +x "$TEST_ROOT/bin/du"
  run "$WORKTREE_GC" --apply --idle-hours 0
  [ "$status" -eq 0 ]; [ ! -e "$other" ]; [ -d "$worktree" ]
  [[ "$output" == *"size unknown"* ]]
  python3 -c 'import json,sys; r=json.load(open(sys.argv[1]))["owners"]["t3-repo"][0]; assert r["size_bytes"] is None' "$WORKTREE_GC_REPORT_DIR/latest.json"
}

@test "FIX1 old unsettled deleted T3 binding is reported to its owner" {
  t3_fixture; bind_thread NULL; age_worktrees
  sqlite3 "$WORKTREE_GC_T3_DB" "UPDATE orchestration_v2_projection_threads SET payload_json=json_set(payload_json,'$.createdAt','2026-01-01'),deleted_at='2026-02-01';"
  run "$WORKTREE_GC"
  [ "$status" -eq 0 ]; [ -d "$worktree" ]
  python3 - "$WORKTREE_GC_REPORT_DIR/latest.json" <<'CHECK'
import json,sys
r=json.load(open(sys.argv[1]))["owners"]["owner-root"][0]
assert r["reason"] == "KEEP-live" and "2026-01-01" in r["detail"] and "2026-02-01" in r["detail"]
CHECK
}

@test "FIX1 T3 binding protects repo-local worktrees too" {
  t3_fixture
  git -C "$repo" worktree move "$worktree" "$repo/.worktrees/topic"
  worktree="$repo/.worktrees/topic"; bind_thread NULL
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]; [[ "$output" == *KEEP-live* ]]; [ -d "$worktree" ]
}

@test "FIX1 a failed report row cannot abort sibling reaping" {
  t3_fixture; age_worktrees
  printf dirty > "$worktree/local.txt"
  other="$repo/.worktrees/z-clean"
  git -C "$repo" worktree add -qb clean "$other" origin/main
  export REAL_PYTHON="$(command -v python3)"
  printf '#!/usr/bin/env bash\n[[ "$2" == add ]] && exit 1\nexec "$REAL_PYTHON" "$@"\n' > "$TEST_ROOT/bin/python3"
  chmod +x "$TEST_ROOT/bin/python3"
  run "$WORKTREE_GC" --apply --idle-hours 0
  [ "$status" -eq 0 ]; [ ! -e "$other" ]; [[ "$output" == *"report row failed"* ]]
}

@test "H1 merged T3 roots skip all descendants and report one count per repo" {
  t3_fixture
  root="$HOME/.t3/worktrees"
  for name in first nested/second; do
    git -C "$repo" worktree add -q --detach "$root/t3-repo/$name" origin/main
  done
  run "$WORKTREE_GC" --apply --idle-hours 0
  [ "$status" -eq 0 ]
  [ -d "$root/t3-repo/first" ]; [ -d "$root/t3-repo/nested/second" ]
  [[ "$output" == *"t3-managed (T3 storageCleanup owns it): 2 skip"* ]]
  [[ "$output" != *"$root/t3-repo/first"* ]]
  python3 - "$WORKTREE_GC_REPORT_DIR/latest.json" <<'CHECK'
import json,sys
assert json.load(open(sys.argv[1]))["t3_managed_skips"] == {"t3-repo": 2}
assert open(sys.argv[1].replace(".json", ".md")).read().count("t3-managed") == 1
CHECK
}
@test "H1 canonical adapter root skips but similarly prefixed sibling is removed" {
  t3_fixture
  ln -s "$repo/.worktrees" "$HOME/root-alias"
  export WORKTREE_GC_T3_ROOTS="$HOME/root-alias/candidate"
  other="$(add_branch_worktree "$repo" candidate-sibling)"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]; [ -d "$worktree" ]; [ ! -e "$other" ]
  [[ "$output" == *t3-managed* ]]
}
@test "H1 detached live symlink sources are kept across every protected root" {
  repo="$(make_fixture_repo sources)"
  worktree="$repo/.worktrees/skills-main"
  git -C "$repo" worktree add -q --detach "$worktree" origin/main
  for root in .agents .codex .claude/skills .claude/hooks .golems; do
    mkdir -p "$HOME/$root/nested"
    ln -s "$worktree/fixture.txt" "$HOME/$root/nested/source"
    run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
    [ "$status" -eq 0 ]; [ -d "$worktree" ]
    [[ "$output" == *"KEEP-live"*"live-symlink-target $HOME/$root/nested/source"* ]]
    rm "$HOME/$root/nested/source"
  done
}
@test "H1 symlinked skills directory protects resolved descendants without prefix collisions" {
  repo="$(make_fixture_repo source-alias)"
  worktree="$(add_branch_worktree "$repo" live)"
  other="$(add_branch_worktree "$repo" live-sibling)"
  mkdir -p "$HOME/.agents" "$HOME/shared-skills"
  ln -s "$HOME/shared-skills" "$HOME/.agents/skills"
  ln -s "$worktree" "$HOME/shared-skills/source"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]; [ -d "$worktree" ]; [ ! -e "$other" ]
  [[ "$output" == *live-symlink-target* ]]
}

@test "H1b refused middle repo is reported and later repos are still processed" {
  mkdir -p "$HOME/Gits"
  for name in a-first b-refused c-last; do
    repo="$(make_fixture_repo "$name")"
    mv "$repo" "$HOME/Gits/"
    repo="$HOME/Gits/$name"
    add_branch_worktree "$repo" topic >/dev/null
  done
  git -C "$HOME/Gits/b-refused" config core.bare true
  run "$WORKTREE_GC" --dry-run
  [ "$status" -eq 2 ]
  [[ "$output" == *"a-first · "*"REMOVE"* ]] || return 1
  [[ "$output" == *"ERROR $HOME/Gits/b-refused exit 2: Refusing --repo"* ]] || return 1
  [[ "$output" == *"c-last · "*"REMOVE"* ]] || return 1
  python3 - "$WORKTREE_GC_REPORT_DIR/last-run.json" "$HOME/Gits/b-refused" <<'PY'
import json, sys
report = json.load(open(sys.argv[1]))
assert report['exit_status'] == 2
row, = report['owners']['b-refused']
assert row['path'] == sys.argv[2] and row['reason'] == 'ERROR'
assert 'exit 2: Refusing --repo' in row['detail']
PY
  [ -d "$HOME/Gits/a-first/.worktrees/topic-worktree" ]
  [ -d "$HOME/Gits/c-last/.worktrees/topic-worktree" ]
}

@test "H1b unexpected repo failure retains errexit and continues safely" {
  mkdir -p "$HOME/Gits" "$TEST_ROOT/bin"
  for name in a-first c-last; do
    repo="$(make_fixture_repo "$name")"
    mv "$repo" "$HOME/Gits/"
    add_branch_worktree "$HOME/Gits/$name" topic >/dev/null
  done
  export REAL_SED="$(command -v sed)"
  cat > "$TEST_ROOT/bin/sed" <<'STUB'
#!/usr/bin/env bash
input="$(cat)"
if [[ "$*" == '-n s/^worktree //p' && "$input" == *'/a-first'* ]]; then
  echo 'fixture census parser failed' >&2
  exit 7
fi
exec "$REAL_SED" "$@" <<< "$input"
STUB
  chmod +x "$TEST_ROOT/bin/sed"
  run env PATH="$TEST_ROOT/bin:$PATH" "$WORKTREE_GC" --apply --idle-hours 0
  [ "$status" -eq 2 ]
  [[ "$output" == *"ERROR $HOME/Gits/a-first exit 7: fixture census parser failed"* ]] || return 1
  [ -d "$HOME/Gits/a-first/.worktrees/topic-worktree" ]
  [ ! -e "$HOME/Gits/c-last/.worktrees/topic-worktree" ]
}
