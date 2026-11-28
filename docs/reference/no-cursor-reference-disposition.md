# Cursor retirement: reference disposition

Owner rule: orc → all leads, 2026-11-27 21:09 IST, NO CURSOR IN THE FLEET.
Etan: "why are we using my cursor usage again...? I need the usage kept for grokbot, and cursor doesnt have that good of models anyway".

## Live routes removed

- `agent-routing/SKILL.md`: gather/worker routes, pin exceptions and review panel.
- `agent-routing/references/*.md`: fan-out recipes, templates and dispatch guidance.
- `pr-loop/SKILL.md`: Cursor endpoint and Bugbot panel entries.
- `pr-loop/references/*.md`: retired triggers; preserved signing, fallback and repository guidance.
- `pr-loop/adapters/{codex,cursor}.md`: Cursor recipes retired; historical link retained.
- `coderabbit/workflows/{red-team,blue-team}.md`: Cursor dispatch steps retired.
- `weave/{SKILL.md,references/*.md}`: Cursor mining and gathering routes retired.
- `cmux-agents/adapters/*`: retired provider and Bugbot capabilities.
- `cmux-agents/references/tool-contracts.md`: dispatch and approval fallback retired.
- `cmux-agents/scripts/{run.sh,agent-functions.sh}`: Cursor modes refuse.
- `scripts/repogolem/dispatch/cursor.zsh`: refusal points to supported roles.
- `large-plan/{SKILL.md,adapters/*,workflows/execute-phase.md}`: old audit routes retired.
- `agada-bench/{SKILL.md,adapters/*,workflows/*.md}`: Cursor judge launch examples removed.
- `orc/SKILL.md`, `skill-creator/SKILL.md`: audit routes use supported roles.
- `1password/SKILL.md`, `cmux-agents/INSTALL_PROMPT.md`, `README.md`: launch examples corrected.
- `standards/fleet-canon.md`: eligibility points to routing SSOT; no pin exception.
- `standards/model-roles.json`: already has no Cursor model role.

## Kept categories

- `**/evals/**`, `**/fixtures/**`: saved runs, historical triggers and regression inputs.
- `**/tests/**`, `**/__tests__/**`: parser/refusal and historical compatibility tests.
- `agent-routing/references/fan-out-head-to-head.md`: dated measurements, no live route.
- `whats-new/references/changelog-sources.md`: historical product facts, not dispatch authority.
- `agada-bench/references/{prior-runs,judge-panel,grading-rubric}.md`: historical judge data.
- `**/vendor/**`, `skills/vendor/*`: upstream provenance and assets.
- Runtime parsers, transcript readers and UI assets: provider compatibility or mouse/text cursor terms.
- Retired adapter and launcher names remain for fail-closed compatibility.

## Enforcement and proof

`test_no_live_cursor_routes_across_fleet_tree` scans skills, standards,
repoGolem scripts and README for live provider/trigger/headless launch patterns.
It fails on master and passes on the candidate; history/fixture exclusions are explicit.
This is static/code regression proof, not a measured real-agent behavior eval.
