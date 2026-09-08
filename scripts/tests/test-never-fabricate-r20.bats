#!/usr/bin/env bats

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SKILL="$REPO_ROOT/skills/golem-powers/never-fabricate/SKILL.md"
}

@test "never-fabricate documents artifact-based closure" {
  grep -Fq "## R20: CLOSURE VERIFIES AGAINST THE ARTIFACT, NOT THE DONE MARKER" "$SKILL"
  grep -Fq "A DONE marker is a claim by the agent **about itself**" "$SKILL"
}
