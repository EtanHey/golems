# Fixture-only destructive GC harness. Never inherit TMPDIR inside a repository.
setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd -P)"
  fixture_parent="$HOME/.local/state/golems/gc-fixtures"
  mkdir -p "$fixture_parent"
  if git -C "$fixture_parent" rev-parse --show-toplevel >/dev/null 2>&1; then
    echo "Refusing fixture parent inside a repository" >&2; return 1
  fi
  TEST_ROOT="$(mktemp -d "$fixture_parent/test.XXXXXXXX")"
  export GC_FIXTURE_ROOT="$TEST_ROOT" GC_SOURCE="$REPO_ROOT/scripts/worktree-gc.sh"
  WORKTREE_GC="$TEST_ROOT/contained-gc"
  cat > "$WORKTREE_GC" <<'GUARD'
#!/usr/bin/env bash
set -euo pipefail
candidate=""
args=("$@")
while (( $# )); do
  case "$1" in --repo|--path) candidate="${2:?}"; shift ;; esac
  shift
done
if [[ -n "$candidate" ]]; then
  top="$(git -C "$candidate" rev-parse --show-toplevel 2>/dev/null || true)"
  [[ -n "$top" ]] || top="$candidate"
  top="$(cd "$top" && pwd -P)"
  [[ "$top" == "$GC_FIXTURE_ROOT/"* ]] || { echo "CONTAINMENT refused $top" >&2; exit 97; }
  # Positive fixtures must actually BE their own repo; no upward fallback.
  if git -C "$top" rev-parse --show-toplevel >/dev/null 2>&1; then
    [[ "$(git -C "$top" rev-parse --show-toplevel)" == "$top" ]] || exit 97
  fi
else
  [[ "$HOME" == "$GC_FIXTURE_ROOT/"* ]] || { echo "CONTAINMENT refused default HOME" >&2; exit 97; }
fi
exec "$GC_SOURCE" ${args[@]+"${args[@]}"}
GUARD
  chmod +x "$WORKTREE_GC"
}

teardown() {
  case "$TEST_ROOT" in "$HOME"/.local/state/golems/gc-fixtures/test.*) rm -rf "$TEST_ROOT" ;; *) return 1 ;; esac
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
  local worktree="$repo/.worktrees/$branch-worktree"

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
