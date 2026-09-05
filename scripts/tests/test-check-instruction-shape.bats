#!/usr/bin/env bats

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  CHECKER="$REPO_ROOT/scripts/check-instruction-shape.sh"
  TEST_ROOT="$(mktemp -d)"
}

teardown() {
  rm -rf "$TEST_ROOT"
}

make_repo() {
  local name="$1"
  local repo="$TEST_ROOT/$name"

  mkdir -p "$repo"
  git -C "$repo" init -q
  git -C "$repo" rev-parse --show-toplevel
}

track_agents() {
  local repo="$1"
  local content="${2:-# Shared agent instructions}"

  printf '%s\n' "$content" > "$repo/AGENTS.md"
  git -C "$repo" add AGENTS.md
}

make_conforming_repo() {
  local name="$1"
  local repo
  repo="$(make_repo "$name")"
  track_agents "$repo"
  printf '\n  \n@AGENTS.md\n\n# Claude-only lead instructions\n' > "$repo/CLAUDE.md"
  printf '%s\n' "$repo"
}

@test "passes a conforming repository and allows Claude-only content below the import" {
  repo="$(make_conforming_repo green)"

  run "$CHECKER" "$repo"

  [ "$status" -eq 0 ]
  [ "$output" = "PASS $repo — instruction-file shape conforms" ]
}

@test "passes when CLAUDE.md is absent" {
  repo="$(make_repo no-claude)"
  track_agents "$repo"

  run "$CHECKER" --repo "$repo"

  [ "$status" -eq 0 ]
  [ "$output" = "PASS $repo — instruction-file shape conforms" ]
}

@test "resolves an explicit subdirectory to its repository root" {
  repo="$(make_conforming_repo nested-path)"
  mkdir -p "$repo/packages/example"
  repo_root="$(git -C "$repo" rev-parse --show-toplevel)"

  run "$CHECKER" "$repo/packages/example"

  [ "$status" -eq 0 ]
  [ "$output" = "PASS $repo_root — instruction-file shape conforms" ]
}

@test "fails when AGENTS.md is missing" {
  repo="$(make_repo missing-agents)"

  run "$CHECKER" --repo "$repo"

  [ "$status" -ne 0 ]
  [ "$output" = "FAIL $repo — AGENTS.md is missing" ]
}

@test "fails when AGENTS.md is empty" {
  repo="$(make_repo empty-agents)"
  : > "$repo/AGENTS.md"
  git -C "$repo" add AGENTS.md

  run "$CHECKER" "$repo"

  [ "$status" -ne 0 ]
  [ "$output" = "FAIL $repo — AGENTS.md is empty" ]
}

@test "fails when AGENTS.md contains only whitespace" {
  repo="$(make_repo whitespace-agents)"
  printf '\n  \n\t\n' > "$repo/AGENTS.md"
  git -C "$repo" add AGENTS.md

  run "$CHECKER" "$repo"

  [ "$status" -ne 0 ]
  [ "$output" = "FAIL $repo — AGENTS.md is empty" ]
}

@test "fails when AGENTS.md is untracked" {
  repo="$(make_repo untracked-agents)"
  printf '# Local only\n' > "$repo/AGENTS.md"

  run "$CHECKER" "$repo"

  [ "$status" -ne 0 ]
  [ "$output" = "FAIL $repo — AGENTS.md is untracked" ]
}

@test "fails when AGENTS.md is gitignored even if it was already tracked" {
  repo="$(make_repo ignored-agents)"
  track_agents "$repo"
  printf 'AGENTS.md\n' > "$repo/.gitignore"

  run "$CHECKER" "$repo"

  [ "$status" -ne 0 ]
  [ "$output" = "FAIL $repo — AGENTS.md is gitignored" ]
}

@test "fails when AGENTS.md is a symlink" {
  repo="$(make_repo agents-symlink)"
  printf '# Shared agent instructions\n' > "$repo/shared-agents.md"
  ln -s shared-agents.md "$repo/AGENTS.md"
  git -C "$repo" add AGENTS.md

  run "$CHECKER" "$repo"

  [ "$status" -ne 0 ]
  [ "$output" = "FAIL $repo — AGENTS.md is a symlink" ]
}

@test "fails when AGENTS.md is a tracked submodule instead of a regular file" {
  module_repo="$(make_repo agents-module-source)"
  printf '# Module content\n' > "$module_repo/README.md"
  git -C "$module_repo" add README.md
  git -C "$module_repo" -c user.name=Test -c user.email=test@example.invalid commit -qm initial
  repo="$(make_repo agents-submodule)"
  git -c protocol.file.allow=always -C "$repo" submodule add -q "$module_repo" AGENTS.md

  run "$CHECKER" "$repo"

  [ "$status" -ne 0 ]
  [ "$output" = "FAIL $repo — AGENTS.md is not a regular file" ]
}

@test "fails when CLAUDE.md is a symlink" {
  repo="$(make_repo claude-symlink)"
  track_agents "$repo"
  printf '@AGENTS.md\n' > "$repo/claude-instructions.md"
  ln -s claude-instructions.md "$repo/CLAUDE.md"

  run "$CHECKER" "$repo"

  [ "$status" -ne 0 ]
  [ "$output" = "FAIL $repo — CLAUDE.md is a symlink" ]
}

@test "fails when CLAUDE.md first nonblank line is not the exact import" {
  repo="$(make_repo divergent)"
  track_agents "$repo"
  printf '\n# Standalone Claude instructions\n@AGENTS.md\n' > "$repo/CLAUDE.md"

  run "$CHECKER" "$repo"

  [ "$status" -ne 0 ]
  [ "$output" = "FAIL $repo — CLAUDE.md first nonblank line must be exactly @AGENTS.md" ]
}

@test "aggregates explicit repository paths and returns nonzero when any fail" {
  green_repo="$(make_conforming_repo green)"
  red_repo="$(make_repo red)"
  track_agents "$red_repo"
  printf '@agents.md\n' > "$red_repo/CLAUDE.md"

  run "$CHECKER" "$green_repo" "$red_repo"

  [ "$status" -ne 0 ]
  [ "${#lines[@]}" -eq 2 ]
  [ "${lines[0]}" = "PASS $green_repo — instruction-file shape conforms" ]
  [ "${lines[1]}" = "FAIL $red_repo — CLAUDE.md first nonblank line must be exactly @AGENTS.md" ]
}

@test "default mode checks each top-level Git repository under HOME/Gits" {
  test_home="$TEST_ROOT/home"
  mkdir -p "$test_home/Gits"
  green_repo="$(make_conforming_repo green-default)"
  red_repo="$(make_repo red-default)"
  mv "$green_repo" "$test_home/Gits/green-default"
  mv "$red_repo" "$test_home/Gits/red-default"
  green_repo="$(git -C "$test_home/Gits/green-default" rev-parse --show-toplevel)"
  red_repo="$(git -C "$test_home/Gits/red-default" rev-parse --show-toplevel)"
  mkdir "$test_home/Gits/not-a-repo"

  run env HOME="$test_home" "$CHECKER"

  [ "$status" -ne 0 ]
  [ "${#lines[@]}" -eq 2 ]
  [ "${lines[0]}" = "PASS $green_repo — instruction-file shape conforms" ]
  [ "${lines[1]}" = "FAIL $red_repo — AGENTS.md is missing" ]
}

@test "default mode fails closed when HOME/Gits contains no repositories" {
  test_home="$TEST_ROOT/home-without-gits"
  mkdir -p "$test_home"

  run env HOME="$test_home" "$CHECKER"

  [ "$status" -eq 2 ]
  [ "$output" = "No Git repositories found under $test_home/Gits" ]
}
