# Fixture-only destructive GC harness. Never inherit TMPDIR inside a repository.
setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd -P)"
  export GC_ENV_SCRUB="$REPO_ROOT/scripts/lib/worktree-git-env.sh"
  source "$GC_ENV_SCRUB"
  fixture_parent="$HOME/.local/state/golems/gc-fixtures"
  mkdir -p "$fixture_parent"
  if git -C "$fixture_parent" rev-parse --show-toplevel >/dev/null 2>&1; then
    echo "Refusing fixture parent inside a repository" >&2; return 1
  fi
  TEST_ROOT="$(mktemp -d "$fixture_parent/test.XXXXXXXX")"
  export HOME="$TEST_ROOT/home" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
  unset GOLEMS_WORKTREE_GC_PIN_ROOT
  mkdir -p "$HOME"
  export WORKTREE_GC_REPORT_DIR="$TEST_ROOT/report" WORKTREE_GC_T3_DB="$TEST_ROOT/t3.sqlite"
  export WORKTREE_GC_CMUX_REGISTRY="$TEST_ROOT/registry.jsonl" GOLEMS_HEAVY_LOCK="$TEST_ROOT/lock"
  : > "$WORKTREE_GC_CMUX_REGISTRY"
  export GC_FIXTURE_ROOT="$TEST_ROOT" GC_SOURCE="$REPO_ROOT/scripts/worktree-gc.sh"
  export WORKTREE_GC="$TEST_ROOT/contained-gc"
  cat > "$WORKTREE_GC" <<'GUARD'
#!/usr/bin/env bash
set -euo pipefail
source "$GC_ENV_SCRUB"
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
  export WORKTREE_GC_NIGHTLY="$TEST_ROOT/contained-nightly"
  cat > "$WORKTREE_GC_NIGHTLY" <<'NIGHTLY'
#!/usr/bin/env bash
set -euo pipefail
source "$GC_ENV_SCRUB"
source "$GC_FIXTURE_HELPERS"
make_nightly_pin "$GC_SOURCE"
GC_SOURCE="$NIGHTLY_PIN/scripts/worktree-gc-nightly.sh" exec "$WORKTREE_GC" "$@"
NIGHTLY
  export GC_FIXTURE_HELPERS="$BATS_TEST_DIRNAME/lib/worktree-gc-fixtures.bash"
  export REPO_ROOT TEST_ROOT
  chmod +x "$WORKTREE_GC_NIGHTLY"
}

teardown() {
  case "$TEST_ROOT" in "$fixture_parent"/test.*) rm -rf "$TEST_ROOT" ;; *) return 1 ;; esac
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
  git -C "$seed" -c user.name=Fixture -c user.email=fixture@example.com \
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
  git -C "$worktree" -c user.name=Fixture -c user.email=fixture@example.com \
    commit -qm "add $filename"
}

# A synthetic golems repository supplies the nightly pin; never use an installed pin.
make_nightly_pin() {
  local gc_source="$1" repo="$HOME/Gits/golems"
  NIGHTLY_PIN="$repo/.worktrees/hooks-live"
  export NIGHTLY_PIN
  [[ -d "$NIGHTLY_PIN" ]] && return 0
  mkdir -p "$repo/scripts/lib"
  cp "$REPO_ROOT/scripts/worktree-gc-nightly.sh" "$repo/scripts/"
  cp "$gc_source" "$repo/scripts/worktree-gc.sh"
  cp -R "$REPO_ROOT/scripts/lib/." "$repo/scripts/lib/"
  git init -q -b master "$repo"
  printf '.worktrees/\ndocs.local/\n' > "$repo/.git/info/exclude"
  git -C "$repo" add scripts
  git -C "$repo" -c user.name=Fixture -c user.email=fixture@example.com commit -qm 'nightly fixture'
  git -C "$repo" update-ref refs/remotes/origin/master HEAD
  git -C "$repo" worktree add -q --detach "$NIGHTLY_PIN" HEAD
}
