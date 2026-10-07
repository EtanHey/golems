#!/usr/bin/env bats
load lib/worktree-gc-fixtures

prepare_private() {
  mkdir -p "$TEST_ROOT/home"
  export HOME="$TEST_ROOT/home" GOLEMS_HEAVY_LOCK="$TEST_ROOT/lock"
  export WORKTREE_GC_CMUX_REGISTRY="$TEST_ROOT/registry.jsonl"
  : > "$WORKTREE_GC_CMUX_REGISTRY"
}
clean_git() {
  env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE \
    -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES git "$@"
}
snapshot() {
  python3 - "$1" <<'PY'
import hashlib,json,sys
from pathlib import Path
p=Path(sys.argv[1])
print(json.dumps({str(f.relative_to(p)):hashlib.sha256(f.read_bytes()).hexdigest()
                 for f in sorted(p.rglob('*')) if f.is_file()},sort_keys=True))
PY
}

@test "D1 raw GC: polluted main and hook-local env cannot touch bystander repo" {
  prepare_private
  for shape in main hook; do
    a="$(make_fixture_repo "a-$shape")"; b="$(make_fixture_repo "b-$shape")"
    target="$(add_branch_worktree "$a" target)"; victim="$(add_branch_worktree "$b" victim)"
    [ "$(clean_git -C "$a" rev-parse --show-toplevel)" = "$a" ]
    [ "$(clean_git -C "$b" rev-parse --show-toplevel)" = "$b" ]
    before="$(snapshot "$b")"
    gitdir="$b/.git"
    if [[ "$shape" == hook ]]; then gitdir="$(clean_git -C "$victim" rev-parse --absolute-git-dir)"; fi
    run timeout -k 3 30 env GIT_DIR="$gitdir" GIT_INDEX_FILE="$gitdir/index" \
      "$GC_SOURCE" --apply --idle-hours 0 --repo "$a"
    [ "$status" -eq 0 ]
    [ -d "$victim" ]
    [ "$(snapshot "$b")" = "$before" ]
    [ ! -d "$target" ]
  done
}

@test "D1 wrapper nightly and prune-plan clear repository-local redirects" {
  prepare_private
  for mode in wrapper nightly plan; do
    a="$(make_fixture_repo "a-$mode")"; b="$(make_fixture_repo "b-$mode")"
    target="$(add_branch_worktree "$a" target)"; victim="$(add_branch_worktree "$b" victim)"
    [ "$(clean_git -C "$a" rev-parse --show-toplevel)" = "$a" ]
    before="$(snapshot "$b")"
    args=("$WORKTREE_GC" --apply --idle-hours 0 --repo "$a")
    [[ "$mode" == nightly ]] && args=("$REPO_ROOT/scripts/worktree-gc-nightly.sh" --idle-hours 0 --repo "$a")
    [[ "$mode" == plan ]] && args=("$GC_SOURCE" --prune-plan --idle-hours 0 --repo "$a")
    run timeout -k 3 30 env GIT_DIR="$b/.git" GIT_WORK_TREE="$b" GIT_COMMON_DIR="$b/.git" \
      GIT_INDEX_FILE="$b/.git/index" GIT_OBJECT_DIRECTORY="$b/.git/objects" \
      GIT_ALTERNATE_OBJECT_DIRECTORIES="$b/.git/objects" GIT_CONFIG_COUNT=broken "${args[@]}"
    [ "$status" -eq 0 ]
    [ -d "$victim" ]
    [ "$(snapshot "$b")" = "$before" ]
    [[ "$output" != *" · $victim · "* ]] || false
  done
}

@test "D2 linked inner and symlink repo arguments refuse before census or fetch, including --path" {
  prepare_private
  a="$(make_fixture_repo scope)"; target="$(add_branch_worktree "$a" target)"
  mkdir "$a/inner"; ln -s "$a" "$TEST_ROOT/alias"
  stub="$TEST_ROOT/bin"; mkdir "$stub"
  cat > "$stub/git" <<'SH'
#!/bin/bash
case " $* " in *" worktree list "*|*" fetch "*) echo operation >> "$TRACE" ;; esac
exec "$REAL_GIT" "$@"
SH
  chmod +x "$stub/git"
  for bad in "$target" "$a/inner" "$TEST_ROOT/alias"; do
    for mode in gc nightly path; do
      rm -f "$TEST_ROOT/trace"
      args=("$GC_SOURCE" --prune-plan --repo "$bad")
      [[ "$mode" == nightly ]] && args=("$REPO_ROOT/scripts/worktree-gc-nightly.sh" --repo "$bad")
      [[ "$mode" == path ]] && args=("$GC_SOURCE" --apply --repo "$bad" --path "$target")
      run timeout -k 3 30 env PATH="$stub:$PATH" REAL_GIT="$(command -v git)" TRACE="$TEST_ROOT/trace" "${args[@]}"
      [ "$status" -eq 2 ]
      [ ! -e "$TEST_ROOT/trace" ]
      [ -d "$target" ]
    done
  done
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$a" --path "$target"
  [ "$status" -eq 0 ]; [ ! -d "$target" ]
}

@test "D3 detached non-HEAD worktree rewritten and bisect refs preserve their source" {
  prepare_private
  for namespace in worktree rewritten bisect; do
    a="$(make_fixture_repo "ref-$namespace")"; target="$(add_branch_worktree "$a" target)"
    clean_git -C "$target" checkout -q --detach origin/main
    tip="$(printf orphan | clean_git -C "$target" -c user.name=Fixture -c user.email=fixture@example.invalid commit-tree 'HEAD^{tree}')"
    clean_git -C "$target" update-ref "refs/$namespace/preserved" "$tip"
    run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$a"
    [ "$status" -eq 0 ]
    [[ "$output" == *"KEEP-worktree-refs"* ]] || false
    [ -d "$target" ]
    [ "$(clean_git -C "$target" rev-parse "refs/$namespace/preserved")" = "$tip" ]
  done
}

@test "D5 required registry missing directory malformed partial or renamed fields keeps tree" {
  prepare_private
  for state in missing directory malformed partial renamed; do
    a="$(make_fixture_repo "registry-$state")"; target="$(add_branch_worktree "$a" target)"
    reg="$TEST_ROOT/$state.jsonl"
    case "$state" in
      directory) mkdir "$reg" ;;
      malformed) printf '{bad\n' > "$reg" ;;
      partial) printf '{"pid":%s,"cwd":"%s"}\n{bad\n' "$$" "$TEST_ROOT" > "$reg" ;;
      renamed) printf '{"process_id":%s,"working_directory":"%s"}\n' "$$" "$target" > "$reg" ;;
    esac
    run env WORKTREE_GC_CMUX_REGISTRY="$reg" "$WORKTREE_GC" --apply --idle-hours 0 --repo "$a"
    [ "$status" -eq 0 ]
    [[ "$output" == *"KEEP-undetermined"*"registry"* ]] || false
    [ -d "$target" ]
  done
}

@test "D5 valid empty registry allows fixture cleanup; valid live registry preserves lane" {
  prepare_private
  a="$(make_fixture_repo registry-empty)"; target="$(add_branch_worktree "$a" target)"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$a"
  [ "$status" -eq 0 ]; [ ! -d "$target" ]
  a="$(make_fixture_repo registry-live)"; target="$(add_branch_worktree "$a" target)"
  printf '{"pid":%s,"cwd":"%s"}\n' "$$" "$target" > "$WORKTREE_GC_CMUX_REGISTRY"
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$a"
  [ "$status" -eq 0 ]; [ -d "$target" ]
  [[ "$output" == *"KEEP-live"* ]] || false
}

@test "D3 an active real bisect survives while HEAD is remotely represented" {
  a="$(make_fixture_repo bisect)"
  for n in 1 2 3; do commit_fixture_file "$a" "$n.txt"; done
  clean_git -C "$a" push -q origin main
  target="$(add_branch_worktree "$a" bisect)"
  clean_git -C "$target" bisect start origin/main origin/main~3
  run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$a"
  [ "$status" -eq 0 ]; [ -d "$target" ]
  [[ "$output" == *"KEEP-worktree-refs"* ]] || false
  [ -n "$(clean_git -C "$target" for-each-ref --format='%(refname)' refs/bisect)" ]
}

@test "D5 standalone absent registry is optional; nightly absent registry refuses cleanup" {
  a="$(make_fixture_repo optional)"; target="$(add_branch_worktree "$a" target)"
  run env -u WORKTREE_GC_CMUX_REGISTRY "$WORKTREE_GC" --apply --idle-hours 0 --repo "$a"
  [ "$status" -eq 0 ]; [ ! -d "$target" ]
  a="$(make_fixture_repo required)"; target="$(add_branch_worktree "$a" target)"
  run env -u WORKTREE_GC_CMUX_REGISTRY "$REPO_ROOT/scripts/worktree-gc-nightly.sh" --idle-hours 0 --repo "$a"
  [ "$status" -eq 0 ]; [ -d "$target" ]
  [[ "$output" == *"KEEP-undetermined"*"registry"* ]] || false
}

@test "D5 invalid pid cwd or duplicate fields cannot masquerade as a dead empty registry" {
  a="$(make_fixture_repo schema)"; target="$(add_branch_worktree "$a" target)"
  for row in '{"pid":true,"cwd":"/"}' '{"pid":1,"cwd":"relative"}' '{"pid":1,"pid":2,"cwd":"/"}' '{"pid":1,"cwd":"/","launch_cwd":null}'; do
    printf '%s\n' "$row" > "$WORKTREE_GC_CMUX_REGISTRY"
    run "$WORKTREE_GC" --apply --idle-hours 0 --repo "$a"
    [ "$status" -eq 0 ]; [ -d "$target" ]
    [[ "$output" == *"KEEP-undetermined"*"registry"* ]] || false
  done
}

@test "D6 default sweep skips aliases, reaches later repos once, and explicit aliases refuse" {
  prepare_private
  mkdir -p "$HOME/Gits"
  [[ "$HOME" == "$GC_FIXTURE_ROOT/"* ]] || false
  for name in aaa ccc; do
    source_repo="$(make_fixture_repo "$name")"
    mv "$source_repo" "$HOME/Gits/$name"
    [ "$(clean_git -C "$HOME/Gits/$name" rev-parse --show-toplevel)" = "$HOME/Gits/$name" ]
    add_branch_worktree "$HOME/Gits/$name" lane >/dev/null
  done
  ln -s "$HOME/Gits/aaa" "$HOME/Gits/bbb-link"
  b="$(make_fixture_repo bystander)"; victim="$(add_branch_worktree "$b" victim)"
  [ "$(clean_git -C "$b" rev-parse --show-toplevel)" = "$b" ]
  before="$(snapshot "$b")"
  for mode in --dry-run --prune-plan; do
    run timeout -k 3 30 "$WORKTREE_GC" "$mode" --idle-hours 0
    [ "$status" -eq 0 ]
    for name in aaa ccc; do
      [ "$(printf '%s\n' "$output" | grep -c "^$name · .* · REMOVE · ")" -eq 1 ]
      [ -d "$HOME/Gits/$name/.worktrees/lane-worktree" ]
    done
  done
  run timeout -k 3 30 "$REPO_ROOT/scripts/worktree-gc-nightly.sh" --idle-hours 0
  [ "$status" -eq 0 ]
  for name in aaa ccc; do
    [ "$(printf '%s\n' "$output" | grep -c "^$name · .* · REMOVED · ")" -eq 1 ]
    [ ! -d "$HOME/Gits/$name/.worktrees/lane-worktree" ]
  done
  for entry in "$WORKTREE_GC" "$REPO_ROOT/scripts/worktree-gc-nightly.sh"; do
    run timeout -k 3 30 "$entry" --repo "$HOME/Gits/bbb-link"
    [ "$status" -eq 2 ]
    [[ "$output" == *"Refusing --repo"* || "$output" == *"--repo must be"* ]] || false
  done
  [ -d "$victim" ]; [ "$(snapshot "$b")" = "$before" ]
}
