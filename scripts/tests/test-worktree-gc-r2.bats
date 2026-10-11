#!/usr/bin/env bats
load lib/worktree-gc-fixtures

@test "R2 containment: subdirectory repo arguments never evaluate the enclosing repo" {
  repo="$(make_fixture_repo containment)"
  worktree="$(add_branch_worktree "$repo" sentinel)"
  mkdir -p "$repo/innocent/notrepo"
  before="$(git -C "$repo" worktree list --porcelain)"
  for mode in --dry-run --apply; do
    run "$WORKTREE_GC" "$mode" --idle-hours 0 --repo "$repo/innocent/notrepo"
    [ "$status" -eq 2 ]
    [[ "$output" != *" · "* ]] || false
    [ "$(git -C "$repo" worktree list --porcelain)" = "$before" ]
    [ -f "$worktree/fixture.txt" ]
  done
}

@test "R2 containment: applying one fixture never evaluates another repository" {
  repo="$(make_fixture_repo selected)"
  other="$(make_fixture_repo bystander)"
  worktree="$(add_branch_worktree "$repo" target)"
  sentinel="$(add_branch_worktree "$other" sentinel)"
  before="$(git -C "$other" worktree list --porcelain)"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *"REMOVED"* && "$output" != *"$other"* ]] || false
  [ ! -e "$worktree" ]
  [ -f "$sentinel/fixture.txt" ]
  [ "$(git -C "$other" worktree list --porcelain)" = "$before" ]
}

@test "R2 B1: cache names below non-cache ignored ancestors are always archived" {
  repo="$(make_fixture_repo archive-names)"
  worktree="$(add_branch_worktree "$repo" target)"
  printf 'docs.local/\nscratch/\n' >> "$repo/.git/info/exclude"
  mkdir -p "$worktree/docs.local/run/build" "$worktree/packages/x/docs.local/proof/dist" "$worktree/scratch/node_modules/lib"
  printf analysis > "$worktree/docs.local/run/build/ANALYSIS.md"
  printf wheel > "$worktree/packages/x/docs.local/proof/dist/app.whl"
  printf notes > "$worktree/scratch/node_modules/lib/notes.md"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *"REMOVED"* ]] || false
  archive="$repo/docs.local/worktree-archive/$(basename "$worktree")"
  [ "$(cat "$archive/docs.local/run/build/ANALYSIS.md")" = analysis ]
  [ "$(cat "$archive/packages/x/docs.local/proof/dist/app.whl")" = wheel ]
  [ "$(cat "$archive/scratch/node_modules/lib/notes.md")" = notes ]
}

@test "R2 B2: nested clone under docs.local build or scratch node_modules keeps local commits" {
  for rel in docs.local/build/clone scratch/node_modules/lib node_modules/lib; do
    repo="$(make_fixture_repo "nested-${rel//\//-}")"
    worktree="$(add_branch_worktree "$repo" target)"
    printf 'docs.local/\nscratch/\nnode_modules/\n' >> "$repo/.git/info/exclude"
    git init -q "$worktree/$rel"
    commit_fixture_file "$worktree/$rel" local.txt
    run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
    [ "$status" -eq 0 ]
    [[ "$output" == *"KEEP-undetermined"*"nested git"* ]] || false
    [ -f "$worktree/$rel/local.txt" ]
  done
}

@test "R2 B2: another repo linked worktree under docs.local dist is preserved" {
  repo="$(make_fixture_repo nested-gitfile)"
  other="$(make_fixture_repo other)"
  worktree="$(add_branch_worktree "$repo" target)"
  printf 'docs.local/\n' >> "$repo/.git/info/exclude"
  nested="$worktree/docs.local/dist/otherlane"
  git -C "$other" worktree add -q --detach "$nested" origin/main
  printf WIP > "$nested/WIP.md"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *"KEEP-undetermined"*"nested git"* ]] || false
  [ "$(cat "$nested/WIP.md")" = WIP ]
}

@test "R2 B3: detached HEAD reflog local-only history is kept" {
  repo="$(make_fixture_repo reflog)"
  worktree="$repo/.worktrees/detached"
  git -C "$repo" worktree add -q --detach "$worktree" origin/main
  commit_fixture_file "$worktree" local.txt
  saved="$(git -C "$worktree" rev-parse HEAD)"
  git -C "$worktree" checkout -q origin/main
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *"KEEP-reflog"* ]] || false
  [ -f "$worktree/.git" ]
  [[ "$(git -C "$worktree" reflog --format=%H HEAD)" == *"$saved"* ]] || false
}

@test "R2 N-L2: nested worktree namespace is outside the one-level scope" {
  repo="$(make_fixture_repo deep-scope)"
  worktree="$repo/.worktrees/group/lane"
  git -C "$repo" worktree add -q --detach "$worktree" origin/main
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *"KEEP-out-of-scope"* ]] || false
  [ -d "$worktree" ]
}

@test "R2 N-L3: FIFO archive never opens the pipe and records special" {
  repo="$(make_fixture_repo fifo)"
  worktree="$(add_branch_worktree "$repo" target)"
  printf 'docs.local/\n' >> "$repo/.git/info/exclude"
  mkdir -p "$worktree/docs.local"
  mkfifo "$worktree/docs.local/pipe"
  printf receipt > "$worktree/docs.local/proof.txt"
  run python3 -c 'import os,signal,subprocess,sys
p=subprocess.Popen(sys.argv[1:],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
try: out,err=p.communicate(timeout=8)
except subprocess.TimeoutExpired:
    os.killpg(p.pid,signal.SIGKILL); p.communicate(); sys.exit(124)
print(out,err); sys.exit(p.returncode)' "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *"REMOVED"* ]] || false
  archive="$repo/docs.local/worktree-archive/$(basename "$worktree")"
  [ ! -e "$archive/docs.local/pipe" ]
  grep -q $'^docs.local/pipe\tspecial\t' "$archive/RECEIPT.tsv"
  [ "$(cat "$archive/docs.local/proof.txt")" = receipt ]
}

@test "R2 receipt: tabs newlines and backslashes cannot split receipt rows" {
  repo="$(make_fixture_repo receipt)"
  worktree="$(add_branch_worktree "$repo" target)"
  printf 'docs.local/\n' >> "$repo/.git/info/exclude"
  mkdir -p "$worktree/docs.local"
  printf data > "$worktree/docs.local/"$'tab\tline\nback\\slash'
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  [ "$status" -eq 0 ]
  archive="$repo/docs.local/worktree-archive/$(basename "$worktree")"
  [ "$(wc -l < "$archive/RECEIPT.tsv" | tr -d ' ')" -eq 1 ]
  [[ "$(cat "$archive/RECEIPT.tsv")" == *'tab\tline\nback\\slash'* ]] || false
}

@test "R2 log-before-remove: failed durable log prevents removal" {
  repo="$(make_fixture_repo log-first)"
  worktree="$(add_branch_worktree "$repo" target)"
  copy="$TEST_ROOT/source"
  mkdir -p "$copy/scripts"
  cp "$REPO_ROOT/scripts/worktree-gc.sh" "$copy/scripts/"
  cp -R "$REPO_ROOT/scripts/lib" "$copy/scripts/"
  mkdir "$copy/docs.local"
  chmod 500 "$copy/docs.local"
  if [[ -n "${GC_LOG_TEST_REF:-}" ]]; then
    git -C "$REPO_ROOT" show "$GC_LOG_TEST_REF:scripts/worktree-gc.sh" > "$copy/scripts/worktree-gc.sh"
  fi
  run env GC_SOURCE="$copy/scripts/worktree-gc.sh" "$WORKTREE_GC" --apply --idle-hours 0 --repo "$repo"
  chmod 700 "$copy/docs.local"
  [ "$status" -ne 0 ]
  [ -d "$worktree" ]
}

@test "R2 prune plan uses nightly idle live and scope guards without deleting" {
  repo="$(make_fixture_repo plan)"
  worktree="$(add_branch_worktree "$repo" target)"
  live="$(add_branch_worktree "$repo" live)"
  (cd "$live" && exec sleep 60) &
  holder=$!
  run "$WORKTREE_GC" --prune-plan --idle-hours 0 --repo "$repo"
  kill "$holder" 2>/dev/null || true
  [ "$status" -eq 0 ]
  [[ "$output" == *" · $worktree · "*" · REMOVE · "* ]] || false
  [[ "$output" == *" · $live · "*"KEEP-live"* ]] || false
  [ -d "$worktree" ] && [ -d "$live" ]
  run "$WORKTREE_GC" --prune-plan --repo "$repo"
  [ "$status" -eq 0 ]
  [[ "$output" == *"KEEP-active"* && "$output" != *" · REMOVE · "* ]] || false
}
