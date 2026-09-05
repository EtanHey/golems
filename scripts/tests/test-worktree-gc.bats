#!/usr/bin/env bats

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  WORKTREE_GC="$REPO_ROOT/scripts/worktree-gc.sh"
  TEST_ROOT="$(mktemp -d)"
}

teardown() {
  rm -rf "$TEST_ROOT"
}

make_fixture_repo() {
  local name="$1"
  local base_branch="${2:-main}"
  local remote="$TEST_ROOT/$name-origin.git"
  local seed="$TEST_ROOT/$name-seed"
  local repo="$TEST_ROOT/$name"

  git init -q --bare "$remote"
  git init -q -b "$base_branch" "$seed"
  printf 'fixture\n' > "$seed/fixture.txt"
  git -C "$seed" add fixture.txt
  git -C "$seed" -c user.name=Fixture -c user.email=fixture@example.invalid \
    commit -qm 'initial fixture'
  git -C "$seed" remote add origin "$remote"
  git -C "$seed" push -q -u origin "$base_branch"
  git -C "$remote" symbolic-ref HEAD "refs/heads/$base_branch"
  git clone -q "$remote" "$repo"

  printf '%s\n' "$repo"
}

add_branch_worktree() {
  local repo="$1"
  local branch="$2"
  local base_ref="${3:-origin/main}"
  local worktree="$TEST_ROOT/$branch-worktree"

  git -C "$repo" worktree add -q -b "$branch" "$worktree" "$base_ref"
  (cd "$worktree" && pwd -P)
}

commit_fixture_file() {
  local worktree="$1"
  local filename="$2"

  printf 'fixture change\n' > "$worktree/$filename"
  git -C "$worktree" add "$filename"
  git -C "$worktree" -c user.name=Fixture -c user.email=fixture@example.invalid \
    commit -qm "add $filename"
}

@test "refuses a worktree with uncommitted files" {
  repo="$(make_fixture_repo dirty-repo)"
  worktree="$(add_branch_worktree "$repo" dirty-branch)"
  printf 'uncommitted\n' > "$worktree/dirty.txt"

  run "$WORKTREE_GC" --repo "$repo"

  [ "$status" -eq 0 ] &&
    [[ "$output" == *" · $worktree · "* ]] &&
    [[ "$output" == *" · KEEP-dirty · "* ]] &&
    [ -d "$worktree" ]
}

@test "refuses a worktree with commits absent from the fresh remote base" {
  repo="$(make_fixture_repo unpushed-repo)"
  worktree="$(add_branch_worktree "$repo" unpushed-branch)"
  commit_fixture_file "$worktree" unpushed.txt

  run "$WORKTREE_GC" --repo "$repo"

  [ "$status" -ne 0 ] &&
    [[ "$output" == *" · $worktree · "* ]] &&
    [[ "$output" == *" · ahead=1 · KEEP-unpushed · "* ]] &&
    [ -d "$worktree" ]
}

@test "fetches immediately before judging instead of trusting a stale safe census" {
  repo="$(make_fixture_repo stale-census-repo)"
  worktree="$(add_branch_worktree "$repo" stale-census-branch)"
  commit_fixture_file "$worktree" remote-only-until-fetch.txt
  worktree_head="$(git -C "$worktree" rev-parse HEAD)"

  git -C "$repo" update-ref refs/remotes/origin/main "$worktree_head"
  [ "$(git -C "$worktree" rev-list --count origin/main..HEAD)" -eq 0 ]

  run "$WORKTREE_GC" --repo "$repo"

  [ "$status" -ne 0 ] &&
    [[ "$output" == *" · $worktree · "* ]] &&
    [[ "$output" == *" · ahead=1 · KEEP-unpushed · "* ]] &&
    [ -d "$worktree" ]
}

@test "classifies an uncontained detached HEAD as KEEP-detached" {
  repo="$(make_fixture_repo detached-repo)"
  worktree="$TEST_ROOT/detached-worktree"
  git -C "$repo" worktree add -q --detach "$worktree" origin/main
  worktree="$(cd "$worktree" && pwd -P)"
  commit_fixture_file "$worktree" detached-only.txt

  run "$WORKTREE_GC" --repo "$repo"

  [ "$status" -eq 0 ] &&
    [[ "$output" == *" · $worktree · (detached) · "* ]] &&
    [[ "$output" == *" · KEEP-detached · "* ]] &&
    [[ "$output" != *" · $worktree · (detached) · "*"KEEP-unpushed"* ]] &&
    [ -d "$worktree" ]
}

@test "reports an eligible worktree without removing it" {
  repo="$(make_fixture_repo dry-run-repo)"
  worktree="$(add_branch_worktree "$repo" dry-run-branch)"

  run "$WORKTREE_GC" --repo "$repo"

  [ "$status" -eq 0 ] &&
    [[ "$output" == *" · $worktree · dry-run-branch · dirty=0 · ahead=0 · REMOVE · eligible; report only"* ]] &&
    [ -d "$worktree" ]
}

@test "rejects the retired apply flag and leaves the worktree in place" {
  repo="$(make_fixture_repo apply-repo)"
  worktree="$(add_branch_worktree "$repo" apply-branch)"

  run "$WORKTREE_GC" --apply --repo "$repo"

  [ "$status" -eq 2 ] &&
    [[ "$output" == *"Unknown argument: --apply"* ]] &&
    [ -d "$worktree" ]
}

@test "falls back to origin master when origin main does not exist" {
  repo="$(make_fixture_repo master-repo master)"
  worktree="$(add_branch_worktree "$repo" master-candidate origin/master)"

  run "$WORKTREE_GC" --repo "$repo"

  [ "$status" -eq 0 ] &&
    [[ "$output" == *" · $worktree · master-candidate · dirty=0 · ahead=0 · REMOVE · "* ]] &&
    [[ "$output" == *"represented by origin/master"* ]] &&
    [ -d "$worktree" ]
}

@test "keeps every candidate undetermined when neither remote base exists" {
  repo="$(make_fixture_repo trunk-repo trunk)"
  worktree="$(add_branch_worktree "$repo" trunk-candidate origin/trunk)"

  run "$WORKTREE_GC" --repo "$repo"

  [ "$status" -eq 0 ] &&
    [[ "$output" == *" · $worktree · trunk-candidate · dirty=not-checked · ahead=undetermined · KEEP-undetermined · "* ]] &&
    [ -d "$worktree" ]
}

@test "skips a repo-local cmux worktree namespace entirely" {
  repo="$(make_fixture_repo cmux-namespace-repo)"
  worktree="$repo/.cmux/worktrees/tool-owned"
  mkdir -p "$(dirname "$worktree")"
  git -C "$repo" worktree add -q -b cmux-owned "$worktree" origin/main
  worktree="$(cd "$worktree" && pwd -P)"

  run "$WORKTREE_GC" --repo "$repo"

  [ "$status" -eq 0 ] &&
    [[ "$output" != *"$worktree"* ]] &&
    [ -d "$worktree" ]
}

@test "skips the codex-workflows tool namespace entirely" {
  repo="$(make_fixture_repo codex-namespace-repo)"
  fake_home="$TEST_ROOT/home"
  worktree="$fake_home/Gits/worktrees/.codex-workflows/tool-owned"
  mkdir -p "$(dirname "$worktree")"
  git -C "$repo" worktree add -q -b codex-workflows-owned "$worktree" origin/main
  worktree="$(cd "$worktree" && pwd -P)"

  run env HOME="$fake_home" "$WORKTREE_GC" --repo "$repo"

  [ "$status" -eq 0 ] &&
    [[ "$output" != *"$worktree"* ]] &&
    [ -d "$worktree" ]
}

@test "default mode scans only top-level repositories with git directories under HOME Gits" {
  repo="$(make_fixture_repo scanned-repo)"
  fake_home="$TEST_ROOT/default-home"
  mkdir -p "$fake_home/Gits"
  mv "$repo" "$fake_home/Gits/scanned-repo"
  repo="$fake_home/Gits/scanned-repo"
  worktree="$(add_branch_worktree "$repo" scanned-candidate)"
  mkdir "$fake_home/Gits/not-a-repo"

  run env HOME="$fake_home" "$WORKTREE_GC"

  [ "$status" -eq 0 ] &&
    [[ "$output" == *" · $worktree · scanned-candidate · dirty=0 · ahead=0 · REMOVE · "* ]] &&
    [ -d "$worktree" ]
}

@test "writes each output row to a durable docs local log" {
  repo="$(make_fixture_repo logged-repo)"
  worktree="$(add_branch_worktree "$repo" logged-branch)"

  run "$WORKTREE_GC" --repo "$repo"
  [ "$status" -eq 0 ]

  log_paths="$(rg -l -F -- "$worktree" "$REPO_ROOT"/docs.local/worktree-gc-*.log)"

  [ "$(printf '%s\n' "$log_paths" | sed '/^$/d' | wc -l | tr -d ' ')" -eq 1 ] &&
    [ "$(sed -n '1p' "$log_paths")" = "$output" ]
}

@test "prunes deleted remote base refs before deciding a detached worktree is represented" {
  repo="$(make_fixture_repo deleted-base-repo)"
  worktree="$TEST_ROOT/deleted-base-detached"
  git -C "$repo" worktree add -q --detach "$worktree" origin/main
  worktree="$(cd "$worktree" && pwd -P)"
  git -C "$TEST_ROOT/deleted-base-repo-origin.git" update-ref -d refs/heads/main

  run "$WORKTREE_GC" --repo "$repo"

  [ "$status" -eq 0 ] &&
    [[ "$output" == *" · $worktree · (detached) · dirty=not-checked · ahead=undetermined · KEEP-undetermined · "* ]] &&
    [ -d "$worktree" ]
}

@test "reporting never prunes a temporarily unavailable worktree registration" {
  repo="$(make_fixture_repo dry-prune-repo)"
  worktree="$(add_branch_worktree "$repo" unavailable-branch)"
  moved_worktree="$worktree-temporarily-away"
  admin_dir="$(sed -n 's/^gitdir: //p' "$worktree/.git")"
  git -C "$repo" config gc.worktreePruneExpire now
  mv "$worktree" "$moved_worktree"

  run "$WORKTREE_GC" --repo "$repo"

  [ -d "$admin_dir" ]
  mv "$moved_worktree" "$worktree"
  census="$(git -C "$repo" worktree list --porcelain)"
  [ "$status" -eq 0 ] &&
    [[ "$output" == *" · $worktree · unavailable-branch · "*"KEEP-undetermined"* ]] &&
    [[ "$census" == *"worktree $worktree"* ]]
}

@test "re-fetches immediately before a REMOVE verdict when the remote changes after the repo fetch" {
  repo="$(make_fixture_repo removal-race-repo)"
  worktree="$TEST_ROOT/removal-race-detached"
  git -C "$repo" worktree add -q --detach "$worktree" origin/main
  worktree="$(cd "$worktree" && pwd -P)"
  wrapper_dir="$TEST_ROOT/git-wrapper"
  wrapper_state="$TEST_ROOT/git-wrapper-state"
  mkdir -p "$wrapper_dir"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    '"$REAL_GIT" "$@"' \
    'command_status=$?' \
    'if [[ "$command_status" -eq 0 && " $* " == *" fetch origin "* && ! -e "$RACE_STATE" ]]; then' \
    '  : > "$RACE_STATE"' \
    '  "$REAL_GIT" -C "$RACE_ORIGIN" update-ref -d refs/heads/main' \
    'fi' \
    'exit "$command_status"' > "$wrapper_dir/git"
  chmod +x "$wrapper_dir/git"

  run env REAL_GIT="$(command -v git)" RACE_ORIGIN="$TEST_ROOT/removal-race-repo-origin.git" \
    RACE_STATE="$wrapper_state" PATH="$wrapper_dir:$PATH" \
    "$WORKTREE_GC" --repo "$repo"

  [ "$status" -eq 0 ] &&
    [ -e "$wrapper_state" ] &&
    ! git -C "$TEST_ROOT/removal-race-repo-origin.git" show-ref --verify --quiet refs/heads/main &&
    [[ "$output" == *" · $worktree · (detached) · "*"KEEP-undetermined"* ]] &&
    [ -d "$worktree" ]
}

@test "keeps a worktree containing ignored local-only data" {
  repo="$(make_fixture_repo ignored-data-repo)"
  worktree="$(add_branch_worktree "$repo" ignored-data-branch)"
  printf '.env\n' >> "$repo/.git/info/exclude"
  printf 'local secret fixture\n' > "$worktree/.env"
  [ -z "$(git -C "$worktree" status --porcelain)" ]

  run "$WORKTREE_GC" --repo "$repo"

  [ "$status" -eq 0 ] &&
    [[ "$output" == *" · $worktree · ignored-data-branch · dirty=1 · "*"KEEP-dirty"* ]]
}

@test "overrides status config that hides ordinary untracked data" {
  repo="$(make_fixture_repo hidden-untracked-repo)"
  worktree="$(add_branch_worktree "$repo" hidden-untracked-branch)"
  git -C "$repo" config status.showUntrackedFiles no
  printf 'local-only fixture\n' > "$worktree/local-only.txt"
  [ -z "$(git -C "$worktree" status --porcelain)" ]

  run "$WORKTREE_GC" --repo "$repo"

  [ "$status" -eq 0 ] &&
    [[ "$output" == *" · $worktree · hidden-untracked-branch · dirty=1 · "*"KEEP-dirty"* ]]
}

@test "explicitly refreshes origin bases despite a custom fetch refspec" {
  repo="$(make_fixture_repo custom-refspec-repo)"
  seed="$TEST_ROOT/custom-refspec-repo-seed"
  remote="$TEST_ROOT/custom-refspec-repo-origin.git"
  release_head="$(git -C "$repo" rev-parse origin/main)"
  printf 'second remote commit\n' > "$seed/second.txt"
  git -C "$seed" add second.txt
  git -C "$seed" -c user.name=Fixture -c user.email=fixture@example.invalid \
    commit -qm 'second remote commit'
  git -C "$seed" push -q origin main
  git -C "$seed" branch release "$release_head"
  git -C "$seed" push -q origin release
  git -C "$repo" fetch -q origin
  worktree="$TEST_ROOT/custom-refspec-detached"
  git -C "$repo" worktree add -q --detach "$worktree" origin/main
  worktree="$(cd "$worktree" && pwd -P)"
  git -C "$repo" config --unset-all remote.origin.fetch
  git -C "$repo" config --add remote.origin.fetch \
    '+refs/heads/release:refs/remotes/origin/release'
  git -C "$remote" update-ref -d refs/heads/main

  run "$WORKTREE_GC" --repo "$repo"

  [ "$status" -eq 0 ] &&
    [[ "$output" == *" · $worktree · (detached) · "*"KEEP-undetermined"* ]]
}

@test "keeps a worktree explicitly locked in the Git census" {
  repo="$(make_fixture_repo locked-repo)"
  worktree="$(add_branch_worktree "$repo" locked-branch)"
  git -C "$repo" worktree lock --reason preserve "$worktree"

  run "$WORKTREE_GC" --repo "$repo"

  [ "$status" -eq 0 ] &&
    [[ "$output" == *" · $worktree · locked-branch · "*"KEEP-undetermined"*"locked"* ]]
}

@test "keeps worktrees containing submodules whose local data cannot be fully classified" {
  child_remote="$TEST_ROOT/submodule-child-origin.git"
  child_seed="$TEST_ROOT/submodule-child-seed"
  git init -q --bare "$child_remote"
  git init -q -b main "$child_seed"
  printf '*.local\n' > "$child_seed/.gitignore"
  printf 'child fixture\n' > "$child_seed/child.txt"
  git -C "$child_seed" add .gitignore child.txt
  git -C "$child_seed" -c user.name=Fixture -c user.email=fixture@example.invalid \
    commit -qm 'initial child fixture'
  git -C "$child_seed" remote add origin "$child_remote"
  git -C "$child_seed" push -q -u origin main
  git -C "$child_remote" symbolic-ref HEAD refs/heads/main

  repo="$(make_fixture_repo submodule-parent-repo)"
  git -C "$repo" -c protocol.file.allow=always submodule add -q \
    "$child_remote" modules/child
  git -C "$repo" add .gitmodules modules/child
  git -C "$repo" -c user.name=Fixture -c user.email=fixture@example.invalid \
    commit -qm 'add child submodule'
  git -C "$repo" push -q origin main
  git -C "$repo" fetch -q origin
  worktree="$(add_branch_worktree "$repo" submodule-parent-branch)"
  git -C "$worktree" -c protocol.file.allow=always submodule update --init -q
  printf 'ignored submodule-only data\n' > "$worktree/modules/child/private.local"
  [ -z "$(git -C "$worktree" -c status.showUntrackedFiles=all \
    status --porcelain --ignored --untracked-files=all)" ]

  run "$WORKTREE_GC" --repo "$repo"

  [ "$status" -eq 0 ] &&
    [[ "$output" == *" · $worktree · submodule-parent-branch · "*"KEEP-undetermined"*"submodule"* ]]
}

@test "accepts a linked worktree path as the explicit repository" {
  repo="$(make_fixture_repo linked-repo-path)"
  requested_worktree="$(add_branch_worktree "$repo" requested-linked-branch)"
  reported_worktree="$(add_branch_worktree "$repo" reported-linked-branch)"

  run "$WORKTREE_GC" --repo "$requested_worktree"

  [ "$status" -eq 0 ] &&
    [[ "$output" == *" · $reported_worktree · reported-linked-branch · "*"REMOVE"* ]]
}

@test "normal H index tags are not hidden flags under C locale" {
  repo="$(make_fixture_repo normal-index-c)"
  worktree="$(add_branch_worktree "$repo" normal-index-c-branch)"
  [[ "$(env LC_ALL=C LANG=C git -C "$worktree" ls-files -v fixture.txt)" == H\ * ]]

  run env LC_ALL=C LANG=C "$WORKTREE_GC" --repo "$repo"
  row="$(printf '%s\n' "$output" | grep -F " · $worktree · ")"

  [ "$status" -eq 0 ] &&
    [ "$row" = "normal-index-c · $worktree · normal-index-c-branch · dirty=0 · ahead=0 · REMOVE · eligible; report only; clean and fully represented by origin/main" ]
}

@test "normal H index tags are not hidden flags under en_US.UTF-8 locale" {
  repo="$(make_fixture_repo normal-index-utf8)"
  worktree="$(add_branch_worktree "$repo" normal-index-utf8-branch)"
  [[ "$(env LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 git -C "$worktree" ls-files -v fixture.txt)" == H\ * ]]

  run env LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 "$WORKTREE_GC" --repo "$repo"
  row="$(printf '%s\n' "$output" | grep -F " · $worktree · ")"

  [ "$status" -eq 0 ] &&
    [ "$row" = "normal-index-utf8 · $worktree · normal-index-utf8-branch · dirty=0 · ahead=0 · REMOVE · eligible; report only; clean and fully represented by origin/main" ]
}

@test "keeps a worktree whose tracked contents are hidden by assume-unchanged" {
  repo="$(make_fixture_repo hidden-assume-index)"
  worktree="$(add_branch_worktree "$repo" assume-hidden-branch)"
  git -C "$worktree" update-index --assume-unchanged fixture.txt
  printf 'assume-unchanged local content\n' > "$worktree/fixture.txt"
  [[ "$(git -C "$worktree" ls-files -v fixture.txt)" == h\ * ]]
  [ -z "$(git -C "$worktree" -c status.showUntrackedFiles=all \
    status --porcelain --ignored --untracked-files=all)" ]

  run "$WORKTREE_GC" --repo "$repo"
  row="$(printf '%s\n' "$output" | grep -F " · $worktree · ")"

  [ "$status" -eq 0 ] &&
    [ "$row" = "hidden-assume-index · $worktree · assume-hidden-branch · dirty=not-checked · ahead=undetermined · KEEP-undetermined · tracked paths use an assume-unchanged or skip-worktree index flag" ] &&
    [[ "$row" != *" · REMOVE · "* ]]
}

@test "keeps a worktree whose tracked contents are hidden by skip-worktree" {
  repo="$(make_fixture_repo hidden-skip-index)"
  worktree="$(add_branch_worktree "$repo" skip-hidden-branch)"
  git -C "$worktree" update-index --skip-worktree fixture.txt
  printf 'skip-worktree local content\n' > "$worktree/fixture.txt"
  [[ "$(git -C "$worktree" ls-files -v fixture.txt)" == S\ * ]]
  [ -z "$(git -C "$worktree" -c status.showUntrackedFiles=all \
    status --porcelain --ignored --untracked-files=all)" ]

  run "$WORKTREE_GC" --repo "$repo"
  row="$(printf '%s\n' "$output" | grep -F " · $worktree · ")"

  [ "$status" -eq 0 ] &&
    [ "$row" = "hidden-skip-index · $worktree · skip-hidden-branch · dirty=not-checked · ahead=undetermined · KEEP-undetermined · tracked paths use an assume-unchanged or skip-worktree index flag" ] &&
    [[ "$row" != *" · REMOVE · "* ]]
}

@test "rechecks hidden index flags immediately before a REMOVE verdict" {
  repo="$(make_fixture_repo hidden-index-race)"
  worktree="$(add_branch_worktree "$repo" hidden-index-race-branch)"
  wrapper_dir="$TEST_ROOT/hidden-index-wrapper"
  wrapper_state="$TEST_ROOT/hidden-index-wrapper-state"
  mkdir -p "$wrapper_dir"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    '"$REAL_GIT" "$@"' \
    'command_status=$?' \
    'if [[ "$command_status" -eq 0 && " $* " == *" -C $RACE_WORKTREE ls-files -v "* && ! -e "$RACE_STATE" ]]; then' \
    '  : > "$RACE_STATE"' \
    '  "$REAL_GIT" -C "$RACE_WORKTREE" update-index --assume-unchanged fixture.txt' \
    '  printf "hidden after initial index scan\\n" > "$RACE_WORKTREE/fixture.txt"' \
    'fi' \
    'exit "$command_status"' > "$wrapper_dir/git"
  chmod +x "$wrapper_dir/git"

  run env REAL_GIT="$(command -v git)" RACE_WORKTREE="$worktree" \
    RACE_STATE="$wrapper_state" PATH="$wrapper_dir:$PATH" \
    "$WORKTREE_GC" --repo "$repo"
  row="$(printf '%s\n' "$output" | grep -F " · $worktree · ")"

  [ "$status" -eq 0 ] &&
    [ -e "$wrapper_state" ] &&
    [[ "$(git -C "$worktree" ls-files -v fixture.txt)" == h\ * ]] &&
    [ -z "$(git -C "$worktree" -c status.showUntrackedFiles=all \
      status --porcelain --ignored --untracked-files=all)" ] &&
    [ "$row" = "hidden-index-race · $worktree · hidden-index-race-branch · dirty=not-checked · ahead=undetermined · KEEP-undetermined · tracked paths use an assume-unchanged or skip-worktree index flag" ] &&
    [[ "$row" != *" · REMOVE · "* ]]
}
