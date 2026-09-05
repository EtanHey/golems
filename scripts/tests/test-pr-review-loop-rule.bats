#!/usr/bin/env bats

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PR_LOOP="$REPO_ROOT/skills/golem-powers/pr-loop/SKILL.md"
  HOOK="$REPO_ROOT/.claude/hooks/block-dangerous-commands.py"
  TEST_ROOT="$(mktemp -d)"
}

teardown() {
  rm -rf "$TEST_ROOT"
}

@test "boot preamble keeps only universal repository rules under 100 lines" {
  run bash -c 'find "$1/.claude/rules" -maxdepth 1 -type f -name "*.md" -print | sed "s#^.*/##" | LC_ALL=C sort' _ "$REPO_ROOT"
  [ "$status" -eq 0 ]
  [ "$output" = $'golems-base.md\ntech-supabase.md' ]

  agents_lines="$(wc -l < "$REPO_ROOT/AGENTS.md" | tr -d ' ')"
  [ "$agents_lines" -le 50 ]

  total_lines="$(wc -l < "$REPO_ROOT/AGENTS.md")"
  total_lines=$((total_lines + $(wc -l < "$REPO_ROOT/CLAUDE.md")))
  total_lines=$((total_lines + $(wc -l < "$REPO_ROOT/.claude/rules/golems-base.md")))
  total_lines=$((total_lines + $(wc -l < "$REPO_ROOT/.claude/rules/tech-supabase.md")))
  [ "$total_lines" -le 100 ]

  run grep -F "Compact Instructions" "$REPO_ROOT/AGENTS.md"
  [ "$status" -ne 0 ]
}

@test "removed ambient rules have no tracked include references" {
  for name in \
    pr-review-loop jobs-pipeline launchd-services traceability \
    background-tasks kilo-safety recurring-protocols; do
    run git -C "$REPO_ROOT" grep -n -- ".claude/rules/$name"
    [ "$status" -ne 0 ]
  done
}

@test "PR loop prevents worker self-merge" {
  grep -F 'A worker must hand the reviewed PR to its lead unmerged.' "$PR_LOOP"

  run grep -F 'Default endpoint is a merged PR plus cleanup.' "$PR_LOOP"
  [ "$status" -ne 0 ]
  run grep -F 'FLAG ⇒ finish the loop to MERGED' "$PR_LOOP"
  [ "$status" -ne 0 ]
  run grep -F 'If round 3 still has new issues, merge and create follow-up ticket.' "$PR_LOOP"
  [ "$status" -ne 0 ]
  grep -F 'does not waive the review gate' "$PR_LOOP"
  grep -F 'only after at least one review' "$PR_LOOP"
  run grep -F 'self-merge only if CI is green' "$PR_LOOP"
  [ "$status" -ne 0 ]
  run grep -F 'self-merge ONLY if CI green' "$PR_LOOP"
  [ "$status" -ne 0 ]
}

@test "unique recurring and launchd guidance is preserved on demand" {
  grep -F 'import "../lib/load-env"' "$REPO_ROOT/skills/golem-powers/cmux-agents/SKILL.md"
  grep -F 'use a clean temporary worktree or sandbox' "$REPO_ROOT/skills/golem-powers/whats-new/SKILL.md"
  grep -F 'temporarily remove two or three candidate rule files there' "$REPO_ROOT/skills/golem-powers/whats-new/SKILL.md"
}

@test "tracked Supabase project references use public-safe indirection" {
  for file in \
    .claude/agents/migration-worker.md \
    .claude/rules/tech-supabase.md \
    GREPTILE_CONTEXT.md \
    golems.registry.json \
    scripts/migrate-to-kg.py; do
    run grep -E '(Project ID|projectId|project_id|project:)[^[:cntrl:]]*[a-z0-9]{20}' "$REPO_ROOT/$file"
    [ "$status" -ne 0 ]
  done

  grep -F 'GOLEMS_SUPABASE_PROJECT_REF' "$REPO_ROOT/.claude/agents/migration-worker.md"
  grep -F 'GOLEMS_SUPABASE_PROJECT_REF' "$REPO_ROOT/.claude/rules/tech-supabase.md"
  grep -F 'GOLEMS_SUPABASE_PROJECT_REF' "$REPO_ROOT/GREPTILE_CONTEXT.md"
  grep -F 'GOLEMS_SUPABASE_PROJECT_REF' "$REPO_ROOT/golems.registry.json"
  grep -F 'GOLEMS_SUPABASE_PROJECT_REF' "$REPO_ROOT/scripts/migrate-to-kg.py"
  run grep -F '<SUPABASE_PROJECT_REF>' "$REPO_ROOT/scripts/migrate-to-kg.py"
  [ "$status" -ne 0 ]

  SUPABASE_RULE="$REPO_ROOT/.claude/rules/tech-supabase.md"
  grep -F '@golems/shared/lib/supabase-factory' "$SUPABASE_RULE"
  run grep -E 'dashboard|tax-helper' "$SUPABASE_RULE"
  [ "$status" -ne 0 ]
}

@test "golems base omits stale launcher and icon-library claims" {
  BASE="$REPO_ROOT/.claude/rules/golems-base.md"
  run grep -E 'lucide-react|ralph[.]zsh|ln -s ../node_modules|cp ../[.]env' "$BASE"
  [ "$status" -ne 0 ]
  run grep -E 'lucide-react|SVG file creation' "$HOOK"
  [ "$status" -ne 0 ]

  grep -F 'repoGolem launcher' "$BASE"
  grep -F 'AIDEV-NOTE:' "$BASE"
  grep -F 'non-null assertions' "$BASE"
  grep -F 'docs/architecture/' "$BASE"
}

@test "Kilo is fail-closed in protected repositories" {
  run env -u CLAUDE_WORKER bash -c \
    'cd "$1" && printf "%s" '\''{"tool_name":"Bash","tool_input":{"command":"kilo inspect"}}'\'' | python3 "$2"' \
    _ "$REPO_ROOT" "$HOOK"

  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision": "block"'* ]]
  [[ "$output" == *'Kilo blocked'* ]]
}

@test "Kilo remains allowed outside protected repositories" {
  mkdir -p "$TEST_ROOT/allowed-project"

  run env -u CLAUDE_WORKER bash -c \
    'cd "$1" && printf "%s" '\''{"tool_name":"Bash","tool_input":{"command":"kilo inspect"}}'\'' | python3 "$2"' \
    _ "$TEST_ROOT/allowed-project" "$HOOK"

  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
}
