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
  chmod +x "$stub/df"
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
  [[ "$output" == *'free_gb=13 floor=60 merged_worktrees=1 ceiling=25'* ]] || false
  [[ "$output" == *'measured health FAIL'* && "$output" == *'WARN (report-only)'* ]] || false
  [ -d "$eligible" ]
}

@test "disk collector rejects invalid df and invalid thresholds without a measurement" {
  repo="$(make_fixture_repo measured)"
  stub="$TEST_ROOT/bin"; mkdir "$stub"
  printf '#!/bin/sh\nprintf "Filesystem header\\nfixture 100 0 invalid 0 fixture\\n"\n' > "$stub/df"
  chmod +x "$stub/df"
  run env RATCHET_GITS_ROOT="$TEST_ROOT" PATH="$stub:$PATH" "$REPO_ROOT/scripts/ratchet/mac/disk-free-floor.sh"
  [ "$status" -eq 2 ]
  [[ "$output" != *'"health"'* ]] || false
  run env RATCHET_GITS_ROOT="$TEST_ROOT" DISK_FREE_FLOOR_GB=bad "$REPO_ROOT/scripts/ratchet/mac/disk-free-floor.sh"
  [ "$status" -eq 2 ]
  [[ "$output" != *'"health"'* ]] || false
}
