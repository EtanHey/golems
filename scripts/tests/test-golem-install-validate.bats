#!/usr/bin/env bats
# Tests for the skill-symlink section of
# skills/golem-powers/golem-install/scripts/validate.sh (--skills-only).
#
# AIDEV-NOTE: the old invariant greped `ls -l ~/.claude/commands` for
# 'skills/golem-powers'. The golems-cli backfill wrote commands/<name> ->
# ~/.claude/skills/<name>, which does NOT match that string — so the check passed
# while Claude Code still recursively listed every sub-file. validate.sh must fail
# on every legacy shape, not just the one that mentions golem-powers in its target.

setup() {
  SCRIPT="$BATS_TEST_DIRNAME/../../skills/golem-powers/golem-install/scripts/validate.sh"
  FAKE_HOME="$(mktemp -d "${BATS_TEST_TMPDIR:-/tmp}/validate-skills.XXXXXX")"
  export HOME="$FAKE_HOME"
  export GOLEMS_DIR="$FAKE_HOME/golems"

  COMMANDS="$FAKE_HOME/.claude/commands"
  SKILLS="$FAKE_HOME/.claude/skills"
  mkdir -p "$COMMANDS" "$SKILLS" "$FAKE_HOME/.config/golems" "$FAKE_HOME/.agents/skills"

  for name in github context7 coderabbit cmux prd; do
    mkdir -p "$GOLEMS_DIR/skills/golem-powers/$name"
    printf '# %s\n' "$name" > "$GOLEMS_DIR/skills/golem-powers/$name/SKILL.md"
    ln -s "$GOLEMS_DIR/skills/golem-powers/$name" "$SKILLS/$name"
  done
}

teardown() {
  [ -n "${FAKE_HOME:-}" ] && rm -rf "$FAKE_HOME"
}

# validate.sh colours its [PASS]/[FAIL] labels; assert on the plain text, and keep
# validate.sh's own exit code (not sed's) as $status.
run_validate() {
  run bash -c "bash '$SCRIPT' --skills-only >'$BATS_TEST_TMPDIR/out' 2>&1; rc=\$?; sed \$'s/\033\\[[0-9;]*m//g' '$BATS_TEST_TMPDIR/out'; exit \$rc"
}

@test "--skills-only passes on a clean skills/-only install" {
  run_validate
  [ "$status" -eq 0 ]
  [[ "$output" == *"[PASS] no legacy golem-powers entries in ~/.claude/commands/"* ]]
}

@test "--skills-only fails on the golems-cli backfill commands/<name> -> ~/.claude/skills/<name>" {
  ln -s "$SKILLS/cmux" "$COMMANDS/cmux"
  run_validate
  [ "$status" -eq 1 ]
  [[ "$output" == *"[FAIL] no legacy golem-powers entries in ~/.claude/commands/"* ]]
}

@test "--skills-only fails on a commands/<name> symlink into golems" {
  ln -s "$GOLEMS_DIR/skills/golem-powers/cmux" "$COMMANDS/cmux"
  run_validate
  [ "$status" -eq 1 ]
  [[ "$output" == *"[FAIL] no legacy golem-powers entries in ~/.claude/commands/"* ]]
}

@test "--skills-only fails on a REAL commands/<name> directory" {
  mkdir -p "$COMMANDS/prd"
  printf '# prd\n' > "$COMMANDS/prd/SKILL.md"
  run_validate
  [ "$status" -eq 1 ]
  [[ "$output" == *"[FAIL] no legacy golem-powers entries in ~/.claude/commands/"* ]]
}

@test "--skills-only fails on a dead symlink in ~/.claude/skills/" {
  ln -s "$FAKE_HOME/gone/sync-to-mac" "$SKILLS/sync-to-mac"
  run_validate
  [ "$status" -eq 1 ]
  [[ "$output" == *"[FAIL] no dead symlinks in ~/.claude/skills/"* ]]
}

@test "--skills-only leaves unrelated commands/ entries alone" {
  printf '# my own command\n' > "$COMMANDS/mine.md"
  run_validate
  [ "$status" -eq 0 ]
}

@test "--skills-only skips a spot-check skill that no longer exists in the repo" {
  # github/ and context7/ were removed from golem-powers but stayed hardcoded here,
  # so validate.sh reported a broken install on a perfectly healthy machine.
  rm -rf "$GOLEMS_DIR/skills/golem-powers/github" "$SKILLS/github"
  run_validate
  [ "$status" -eq 0 ]
  [[ "$output" == *"[SKIP] github skill"* ]]
}

@test "--skills-only still fails when a skill present in the repo is not linked" {
  rm -f "$SKILLS/coderabbit"
  run_validate
  [ "$status" -eq 1 ]
  [[ "$output" == *"[FAIL] coderabbit skill"* ]]
}
