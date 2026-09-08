#!/usr/bin/env bats

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
}

@test "golems MLX launch and script defaults use port 8081" {
  run grep -F '<string>8081</string>' "$REPO_ROOT/launchd/com.golems.mlx-server.plist"
  [ "$status" -eq 0 ]

  local expected_files=(
    packages/shared/src/lib/mlx-llm.ts
    packages/services/src/doctor.ts
    packages/services/src/wizard.ts
    packages/shared/CLAUDE.md
    packages/shared/src/glm/mcp-server.ts
    scripts/auto-enrich.sh
    scripts/enrich.sh
    scripts/enrichment-lazy.sh
    scripts/enrichment-window.sh
    scripts/mlx-server-night-only.sh
    scripts/summarize-file.sh
  )

  local file
  for file in "${expected_files[@]}"; do
    run grep -F '8081' "$REPO_ROOT/$file"
    [ "$status" -eq 0 ]
    run grep -F '8080' "$REPO_ROOT/$file"
    [ "$status" -ne 0 ]
  done
}

@test "unrelated and voicelayer-owned defaults remain on port 8080" {
  run grep -F 'process.env.PORT || "8080"' "$REPO_ROOT/packages/services/src/cloud-worker.ts"
  [ "$status" -eq 0 ]

  run grep -F 'voicelayer-stt-polish-8080' "$REPO_ROOT/scripts/reconcile-profile.json"
  [ "$status" -eq 0 ]
  run grep -F 'http://127.0.0.1:8080/v1/chat/completions' "$REPO_ROOT/scripts/reconcile-profile.json"
  [ "$status" -eq 0 ]

  run grep -F 'http://127.0.0.1:8080/api/send' "$REPO_ROOT/scripts/tests/test-stream-helpers.bats"
  [ "$status" -eq 0 ]

  run grep -F 'http://127.0.0.1:8080/api/send' "$REPO_ROOT/scripts/lib/stream-helpers.sh"
  [ "$status" -eq 0 ]

  run grep -F 'localhost:8080/health' "$REPO_ROOT/skills/golem-powers/fleet-wrap-gate/evals/fixtures/red/03-standing-by-but-healthwatch-armed.json"
  [ "$status" -eq 0 ]

  run grep -F 'localhost:8080/digest.html' "$REPO_ROOT/skills/golem-powers/html-dashboard/evals/fixtures/tailnet-sync-gate/red/04-200-on-wrong-host.json"
  [ "$status" -eq 0 ]
}

@test "enrichment window never replaces an explicit MLX_URL with a default-port server" {
  run grep -F 'MLX_URL_OVERRIDDEN=true' "$REPO_ROOT/scripts/enrichment-window.sh"
  [ "$status" -eq 0 ]

  run grep -F 'if [ "$MLX_URL_OVERRIDDEN" = true ]; then' "$REPO_ROOT/scripts/enrichment-window.sh"
  [ "$status" -eq 0 ]
}
