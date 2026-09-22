#!/usr/bin/env bats

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SKILL="$REPO_ROOT/skills/golem-powers/grill-me/SKILL.md"
}

@test "grill-me ports the upstream whole-frontier interview contract" {
  run rg -q 'design tree' "$SKILL"
  [ "$status" -eq 0 ]

  run rg -q 'whole frontier' "$SKILL"
  [ "$status" -eq 0 ]

  run rg -Uq 'dispatch a\s+sub-agent' "$SKILL"
  [ "$status" -eq 0 ]

  run rg -q "[Dd]on.t block|without blocking" "$SKILL"
  [ "$status" -eq 0 ]

  run rg -q '^---$' "$SKILL"
  [ "$status" -eq 0 ]
}

@test "grill-me keeps Etan's voice-friendly rulings" {
  run rg -q 'lettered options' "$SKILL"
  [ "$status" -eq 0 ]

  run rg -q '1A 2C' "$SKILL"
  [ "$status" -eq 0 ]

  run rg -q '(<=6|≤6) frozen bullets' "$SKILL"
  [ "$status" -eq 0 ]

  run rg -q '[Nn]ever answer for (him|the user)' "$SKILL"
  [ "$status" -eq 0 ]

  run rg -Uq 'silence is not a choice|Never treat\s+silence as a choice' "$SKILL"
  [ "$status" -eq 0 ]

  run rg -q 'Recommended' "$SKILL"
  [ "$status" -eq 0 ]
}

@test "grill-me drops the fixed cap and em dashes" {
  run rg -n 'Three to six|3-6|3–6|—' "$SKILL"
  [ "$status" -eq 1 ]
}

@test "grill-me is explicitly user-invoked in both harnesses" {
  run rg -q '^disable-model-invocation: true$' "$SKILL"
  [ "$status" -eq 0 ]

  run rg -q '^[[:space:]]*allow_implicit_invocation: false$' "$REPO_ROOT/skills/golem-powers/grill-me/agents/openai.yaml"
  [ "$status" -eq 0 ]
}

@test "grill-me records the exact upstream source and MIT notice" {
  run rg -q 'c55ee46073ed923f86ce59a5eb3b6d895095d1b7' "$SKILL"
  [ "$status" -eq 0 ]

  run rg -q 'Copyright \(c\) 2026 Matt Pocock' "$REPO_ROOT/skills/golem-powers/grill-me/LICENSE.upstream"
  [ "$status" -eq 0 ]
}
