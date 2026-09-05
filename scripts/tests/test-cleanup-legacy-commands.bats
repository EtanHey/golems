#!/usr/bin/env bats
# Tests for skills/golem-powers/golem-install/scripts/cleanup-legacy-commands.sh
#
# AIDEV-NOTE: Claude Code reads ~/.claude/skills/<name>/SKILL.md one level deep but
# walks ~/.claude/commands/**/*.md recursively. Every legacy shape under commands/
# — a symlink into golems, a golems-cli backfill symlink into ~/.claude/skills/<name>,
# or a REAL directory created by an old `mkdir -p` INSTALL_PROMPT — re-lists every
# workflows/, references/ and evals/ file as its own "skill". All three must go.

setup() {
  SCRIPT="$BATS_TEST_DIRNAME/../../skills/golem-powers/golem-install/scripts/cleanup-legacy-commands.sh"
  FAKE_HOME="$(mktemp -d "${BATS_TEST_TMPDIR:-/tmp}/legacy-commands.XXXXXX")"
  export HOME="$FAKE_HOME"
  export GOLEMS_DIR="$FAKE_HOME/golems"

  COMMANDS="$FAKE_HOME/.claude/commands"
  SKILLS="$FAKE_HOME/.claude/skills"
  mkdir -p "$COMMANDS" "$SKILLS"

  for name in cmux prd figma-loop; do
    mkdir -p "$GOLEMS_DIR/skills/golem-powers/$name/workflows"
    printf '# %s\n' "$name" > "$GOLEMS_DIR/skills/golem-powers/$name/SKILL.md"
    printf 'workflow body\n' > "$GOLEMS_DIR/skills/golem-powers/$name/workflows/run.md"
  done
}

teardown() {
  [ -n "${FAKE_HOME:-}" ] && rm -rf "$FAKE_HOME"
}

run_cleanup() { run bash "$SCRIPT" "$@"; }

@test "removes a commands/ symlink pointing into golems skills/golem-powers" {
  ln -s "$GOLEMS_DIR/skills/golem-powers/cmux" "$COMMANDS/cmux"
  run_cleanup
  [ "$status" -eq 0 ]
  [ ! -e "$COMMANDS/cmux" ]
  [ ! -L "$COMMANDS/cmux" ]
}

@test "removes the golems-cli backfill symlink commands/<name> -> ~/.claude/skills/<name>" {
  ln -s "$GOLEMS_DIR/skills/golem-powers/cmux" "$SKILLS/cmux"
  ln -s "$SKILLS/cmux" "$COMMANDS/cmux"
  run_cleanup
  [ "$status" -eq 0 ]
  [ ! -L "$COMMANDS/cmux" ]
  # the real skills/ symlink survives
  [ -L "$SKILLS/cmux" ]
}

@test "removes the old commands/golem-powers namespace symlink" {
  ln -s "$GOLEMS_DIR/skills/golem-powers" "$COMMANDS/golem-powers"
  run_cleanup
  [ "$status" -eq 0 ]
  [ ! -L "$COMMANDS/golem-powers" ]
}

@test "migrates a REAL commands/<name> directory when skills/<name> is absent" {
  mkdir -p "$COMMANDS/prd"
  printf '# prd local\n' > "$COMMANDS/prd/SKILL.md"
  run_cleanup
  [ "$status" -eq 0 ]
  [ ! -e "$COMMANDS/prd" ]
  [ -f "$SKILLS/prd/SKILL.md" ]
  [ "$(cat "$SKILLS/prd/SKILL.md")" = "# prd local" ]
}

@test "deletes a REAL commands/<name> directory that duplicates skills/<name>" {
  ln -s "$GOLEMS_DIR/skills/golem-powers/prd" "$SKILLS/prd"
  mkdir -p "$COMMANDS/prd/workflows"
  printf '# prd\n' > "$COMMANDS/prd/SKILL.md"
  printf 'workflow body\n' > "$COMMANDS/prd/workflows/run.md"
  run_cleanup
  [ "$status" -eq 0 ]
  [ ! -e "$COMMANDS/prd" ]
  [ -L "$SKILLS/prd" ]
}

@test "leaves and warns on a REAL commands/<name> directory whose content differs from skills/<name>" {
  ln -s "$GOLEMS_DIR/skills/golem-powers/prd" "$SKILLS/prd"
  mkdir -p "$COMMANDS/prd"
  printf '# prd DIVERGED\n' > "$COMMANDS/prd/SKILL.md"
  run_cleanup
  [ "$status" -eq 0 ]
  [ -d "$COMMANDS/prd" ]
  [[ "$output" == *"WARN"* ]]
  [[ "$output" == *"prd"* ]]
}

@test "leaves and warns on a REAL commands/<name> directory with no SKILL.md" {
  mkdir -p "$COMMANDS/cmux"
  printf 'notes\n' > "$COMMANDS/cmux/notes.md"
  run_cleanup
  [ "$status" -eq 0 ]
  [ -d "$COMMANDS/cmux" ]
  [ -f "$COMMANDS/cmux/notes.md" ]
  [[ "$output" == *"WARN"* ]]
}

@test "removes dead symlinks left in ~/.claude/skills/" {
  ln -s "$FAKE_HOME/gone/sync-to-mac" "$SKILLS/sync-to-mac"
  ln -s "$GOLEMS_DIR/skills/golem-powers/cmux" "$SKILLS/cmux"
  run_cleanup
  [ "$status" -eq 0 ]
  [ ! -L "$SKILLS/sync-to-mac" ]
  [ -L "$SKILLS/cmux" ]
}

@test "leaves unrelated commands/ entries alone" {
  printf '# my own command\n' > "$COMMANDS/mine.md"
  mkdir -p "$FAKE_HOME/elsewhere/custom"
  ln -s "$FAKE_HOME/elsewhere/custom" "$COMMANDS/custom"
  run_cleanup
  [ "$status" -eq 0 ]
  [ -f "$COMMANDS/mine.md" ]
  [ -L "$COMMANDS/custom" ]
}

@test "--check exits 1 while a golems-cli backfill symlink remains" {
  ln -s "$GOLEMS_DIR/skills/golem-powers/cmux" "$SKILLS/cmux"
  ln -s "$SKILLS/cmux" "$COMMANDS/cmux"
  run_cleanup --check
  [ "$status" -eq 1 ]
  [ -L "$COMMANDS/cmux" ]   # --check never writes
}

@test "--check exits 1 while a REAL commands/<name> directory remains" {
  mkdir -p "$COMMANDS/prd"
  printf '# prd\n' > "$COMMANDS/prd/SKILL.md"
  run_cleanup --check
  [ "$status" -eq 1 ]
}

@test "--check exits 1 while a dead symlink remains in skills/" {
  ln -s "$FAKE_HOME/gone/railway" "$SKILLS/railway"
  run_cleanup --check
  [ "$status" -eq 1 ]
}

@test "--check exits 0 on a clean install" {
  ln -s "$GOLEMS_DIR/skills/golem-powers/cmux" "$SKILLS/cmux"
  printf '# my own command\n' > "$COMMANDS/mine.md"
  run_cleanup --check
  [ "$status" -eq 0 ]
}

@test "--check exits 0 when ~/.claude/commands does not exist at all" {
  rm -rf "$COMMANDS"
  run_cleanup --check
  [ "$status" -eq 0 ]
}

@test "--dry-run reports work but changes nothing" {
  ln -s "$SKILLS/cmux" "$COMMANDS/cmux"
  mkdir -p "$COMMANDS/prd"
  printf '# prd\n' > "$COMMANDS/prd/SKILL.md"
  run_cleanup --dry-run
  [ "$status" -eq 0 ]
  [ -L "$COMMANDS/cmux" ]
  [ -d "$COMMANDS/prd" ]
  [[ "$output" == *"dry-run"* ]]
}

@test "--check exits 1 while a REAL commands/<name> directory that differs from skills/<name> remains (warn-and-leave is still legacy)" {
  ln -s "$GOLEMS_DIR/skills/golem-powers/prd" "$SKILLS/prd"
  mkdir -p "$COMMANDS/prd"
  printf '# prd DIVERGED\n' > "$COMMANDS/prd/SKILL.md"
  run_cleanup --check
  [ "$status" -eq 1 ]
  [[ "$output" == *"LEGACY"* ]]
}

@test "--check exits 1 while a REAL commands/<name> directory with no SKILL.md remains (warn-and-leave is still legacy)" {
  mkdir -p "$COMMANDS/cmux"
  printf 'notes\n' > "$COMMANDS/cmux/notes.md"
  run_cleanup --check
  [ "$status" -eq 1 ]
  [[ "$output" == *"LEGACY"* ]]
}

@test "--golems-dir without a value is a usage error, not an unbound-variable abort" {
  run_cleanup --golems-dir
  [ "$status" -eq 2 ]
  [[ "$output" == *"--golems-dir"* ]]
}
