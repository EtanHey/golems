#!/usr/bin/env bats
load lib/worktree-gc-fixtures

@test "disk ratchet counts only GC REMOVE plans and excludes live and out-of-scope trees" {
  repo="$(make_fixture_repo measured)"
  eligible="$(add_branch_worktree "$repo" eligible)"
  live="$(add_branch_worktree "$repo" live)"
  locked="$(add_branch_worktree "$repo" locked)"
  git -C "$repo" worktree lock "$locked"
  git -C "$repo" worktree add -q --detach "$repo/.worktrees/hooks-live" origin/main
  git -C "$repo" worktree add -q --detach "$repo/.worktrees/group/deep" origin/main
  git -C "$repo" worktree add -q --detach "$TEST_ROOT/runtime" origin/main
  (cd "$live" && exec sleep 60) &
  holder=$!
  run env RATCHET_GITS_ROOT="$TEST_ROOT" DISK_FREE_FLOOR_GB=0 WORKTREE_GC_IDLE_HOURS=0 \
    "$REPO_ROOT/scripts/ratchet/mac/disk-free-floor.sh"
  kill "$holder" 2>/dev/null || true
  [ "$status" -eq 0 ]
  [[ "$output" == *'merged_worktrees=1 '* ]] || false
  [ -d "$eligible" ] && [ -d "$live" ]
}

@test "disk ratchet fails closed when GC cannot produce a plan" {
  repo="$(make_fixture_repo measured)"
  stub="$TEST_ROOT/bin"
  mkdir "$stub"
  printf '#!/usr/bin/env bash\n[[ " $* " == *" worktree list "* ]] && exit 2\nexec "$REAL_GIT" "$@"\n' > "$stub/git"
  chmod +x "$stub/git"
  run env RATCHET_GITS_ROOT="$TEST_ROOT" DISK_FREE_FLOOR_GB=0 \
    PATH="$stub:$PATH" REAL_GIT="$(command -v git)" "$REPO_ROOT/scripts/ratchet/mac/disk-free-floor.sh"
  [ "$status" -ne 0 ]
}

@test "disk report-only collector keeps actual unhealthy measurements visible through the table" {
  repo="$(make_fixture_repo measured)"
  eligible="$(add_branch_worktree "$repo" eligible)"
  stub="$TEST_ROOT/bin"; mkdir "$stub"
  printf '#!/bin/sh\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 99999999 0 13631488 0 fixture\\n"\n' > "$stub/df"
  printf '#!/bin/sh\nexit 127\n' > "$stub/brainlayer"
  chmod +x "$stub/df" "$stub/brainlayer"
  run env RATCHET_GITS_ROOT="$TEST_ROOT" WORKTREE_GC_IDLE_HOURS=0 PATH="$stub:$PATH" \
    node --input-type=module -e '
      const root=process.argv[1];
      const {readFileSync}=await import("node:fs");
      const {runRows}=await import(root+"/scripts/ratchet/run-rows.mjs");
      const {evaluate,renderTable}=await import(root+"/scripts/ratchet/table.mjs");
      const row=JSON.parse(readFileSync(root+"/scripts/ratchet/rows.json")).rows.find(r=>r.id==="disk-free-floor");
      row.command=root+"/"+row.command;
      const rows={schema:1,rows:[row]},head="c".repeat(40);
      const result=runRows({rows,head,cwd:root});
      const table=evaluate({rows,baseRows:rows,results:result,head});
      console.log(renderTable(table,{marker:"fixture"}));
      process.exit(table.ok?0:1);
    ' "$REPO_ROOT"
  [ "$status" -eq 0 ]
  [[ "$output" == *'free_gb=13.958643712 floor=50 merged_worktrees=1 ceiling=25'* ]] || false
  [[ "$output" == *'measured health FAIL'* && "$output" == *'WARN (report-only)'* ]] || false
  [ -d "$eligible" ]
}

@test "disk collector rejects invalid df and invalid thresholds without a measurement" {
  repo="$(make_fixture_repo measured)"
  stub="$TEST_ROOT/bin"; mkdir "$stub"
  printf '#!/bin/sh\nprintf "Filesystem header\\nfixture 100 0 invalid 0 fixture\\n"\n' > "$stub/df"
  printf '#!/bin/sh\nexit 127\n' > "$stub/brainlayer"
  chmod +x "$stub/df" "$stub/brainlayer"
  run env RATCHET_GITS_ROOT="$TEST_ROOT" PATH="$stub:$PATH" "$REPO_ROOT/scripts/ratchet/mac/disk-free-floor.sh"
  [ "$status" -eq 2 ]
  [[ "$output" != *'"health"'* ]] || false
  run env RATCHET_GITS_ROOT="$TEST_ROOT" DISK_FREE_FLOOR_GB=bad "$REPO_ROOT/scripts/ratchet/mac/disk-free-floor.sh"
  [ "$status" -eq 2 ]
  [[ "$output" != *'"health"'* ]] || false
}

@test "D1 disk collector clears hook redirects and preserves independent bystander repo" {
  a="$(make_fixture_repo measured)"; mkdir "$TEST_ROOT/gits"
  mv "$a" "$TEST_ROOT/gits/a"; a="$TEST_ROOT/gits/a"
  target="$(add_branch_worktree "$a" target)"
  b="$(make_fixture_repo bystander)"; victim="$(add_branch_worktree "$b" victim)"
  [ "$(git -C "$a" rev-parse --show-toplevel)" = "$a" ]
  [ "$(git -C "$b" rev-parse --show-toplevel)" = "$b" ]
  before="$(find "$b" -type f -exec shasum -a 256 {} + | LC_ALL=C sort)"
  admin="$(git -C "$victim" rev-parse --absolute-git-dir)"
  run timeout -k 3 30 env RATCHET_GITS_ROOT="$TEST_ROOT/gits" DISK_FREE_FLOOR_GB=0 WORKTREE_GC_IDLE_HOURS=0 \
    GIT_DIR="$admin" GIT_WORK_TREE="$b" GIT_COMMON_DIR="$b/.git" GIT_INDEX_FILE="$admin/index" \
    GIT_OBJECT_DIRECTORY="$b/.git/objects" GIT_ALTERNATE_OBJECT_DIRECTORIES="$b/.git/objects" \
    GIT_CONFIG_COUNT=broken "$REPO_ROOT/scripts/ratchet/mac/disk-free-floor.sh"
  [ "$status" -eq 0 ]; [ -d "$target" ] && [ -d "$victim" ]
  [[ "$output" == *'merged_worktrees=1 '* ]] || false
  [ "$(find "$b" -type f -exec shasum -a 256 {} + | LC_ALL=C sort)" = "$before" ]
}

@test "disk collector skips remote planning for a repo with only its main worktree" {
  repo="$(make_fixture_repo measured)"
  stub="$TEST_ROOT/bin"; mkdir "$stub"
  cat > "$stub/git" <<'STUB'
#!/usr/bin/env bash
if [[ " $* " == *" fetch "* ]]; then
  touch "$FETCH_MARKER"
  echo unexpected-fetch >&2
  exit 99
fi
exec "$REAL_GIT" "$@"
STUB
  chmod +x "$stub/git"
  run env RATCHET_GITS_ROOT="$TEST_ROOT" DISK_FREE_FLOOR_GB=0 \
    PATH="$stub:$PATH" REAL_GIT="$(command -v git)" FETCH_MARKER="$TEST_ROOT/fetched" "$REPO_ROOT/scripts/ratchet/mac/disk-free-floor.sh"
  [ "$status" -eq 0 ]
  [ ! -e "$TEST_ROOT/fetched" ]
  [[ "$output" != *unexpected-fetch* ]] || false
  [[ "$output" == *'merged_worktrees=0 '* ]] || false
}

@test "disk collector sums independent plans across a full batch and its remainder" {
  # Count plans against one idle process snapshot. Real ps/lsof snapshots can
  # disagree as concurrent GC children exit, legitimately producing KEEP rows.
  mkdir "$TEST_ROOT/bin"
  printf '#!/bin/sh\nprintf "4242\\n"\n' > "$TEST_ROOT/bin/ps"
  printf '#!/bin/sh\nprintf "p4242\\nn%s\\n" "$GC_FIXTURE_ROOT"\n' > "$TEST_ROOT/bin/lsof"
  chmod +x "$TEST_ROOT/bin/ps" "$TEST_ROOT/bin/lsof"
  mkdir "$TEST_ROOT/gits"
  for i in 1 2 3 4 5; do
    repo="$(make_fixture_repo "measured$i")"
    mv "$repo" "$TEST_ROOT/gits/measured$i"
    add_branch_worktree "$TEST_ROOT/gits/measured$i" eligible >/dev/null
  done
  run env PATH="$TEST_ROOT/bin:$PATH" RATCHET_GITS_ROOT="$TEST_ROOT/gits" DISK_FREE_FLOOR_GB=0 WORKTREE_GC_IDLE_HOURS=0 \
    "$REPO_ROOT/scripts/ratchet/mac/disk-free-floor.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *'merged_worktrees=5 '* ]] || false
  # Fail a child plan after its preflight census; queued work must still drain.
  cat > "$TEST_ROOT/bin/git" <<'STUB'
#!/usr/bin/env bash
if [[ " $* " == *"/measured1 worktree list "* ]]; then
  if [[ -e "$FAIL_MARKER" ]]; then exit 2; fi
  touch "$FAIL_MARKER"
fi
exec "$REAL_GIT" "$@"
STUB
  chmod +x "$TEST_ROOT/bin/git"
  run timeout 60 env RATCHET_GITS_ROOT="$TEST_ROOT/gits" DISK_FREE_FLOOR_GB=0 WORKTREE_GC_IDLE_HOURS=0 \
    PATH="$TEST_ROOT/bin:$PATH" REAL_GIT="$(command -v git)" FAIL_MARKER="$TEST_ROOT/census" \
    "$REPO_ROOT/scripts/ratchet/mac/disk-free-floor.sh"
  [ "$status" -eq 2 ]
  [[ "$output" != *'"health"'* ]] || false
}
