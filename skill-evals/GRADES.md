# Skill Quality Grades

> Graded 2026-03-27 by golems-worker-C-R1. Grades reflect quality infrastructure readiness (eval specs + adapters + workflows), not behavioral pass rates (no evals have been executed yet).

---

## Summary

| Grade | Count | Criteria |
|-------|-------|----------|
| **Gold** | 4 | >=3 eval specs AND >=2 adapters |
| **Silver** | 25 | >=3 eval specs OR knowledge-only with good structure |
| **Bronze** | 14 | Some structure but no eval specs |
| **Archived** | 7 | No evals, no adapters, duplicated or trivially available |
| **Paused** | 4 | Inactive/unreliable, marked `status: experimental` |

**Total: 50 skills graded** (39 active, 4 experimental, 7 archived)

---

## Gold (4 skills)

Best quality infrastructure. Eval specs + multiple adapters.

| Skill | Adapters | Evals | Assertions | Fixtures |
|-------|----------|-------|------------|----------|
| commit | 4 (claude, codex, cursor, +1) | 3 | 10 | Yes |
| cmux-agents | 6 (claude, codex, cursor, gemini, kiro, +1) | 3 | 18 | No |
| large-plan | 4 (claude, codex, cursor, +1) | 3 | 11 | No |
| pr-loop | 4 (claude, codex, cursor, +1) | 3 | 11 | Yes |

---

## Silver (25 skills)

Eval specs exist but no/few adapters, or knowledge-only with good structure. Includes 4 paused skills (marked experimental).

| Skill | Evals | Assertions | Workflows | Notes |
|-------|-------|------------|-----------|-------|
| 1password | 3 | 10 | 6 | Workflow-rich |
| archive | 2 | 8 | 2 | Has fixtures |
| brave | 3 | 13 | 4 | PAUSED - experimental |
| catchup | 3 | 10 | 0 | |
| cli-agents | 3 | 13 | 0 | |
| cmux | 3 | 8 | 0 | |
| coderabbit | 3 | 8 | 6 | Workflow-rich |
| context7 | 3 | 9 | 1 | |
| convex | 3 | 9 | 8 | Most workflows |
| critique-waves | 3 | 10 | 3 | PAUSED - experimental |
| figma-loop | 3 | 13 | 3 | |
| github | 3 | 9 | 0 | |
| github-research | 3 | 9 | 0 | |
| golem-install | 3 | 10 | 6 | |
| interview-practice | 3 | 12 | 0 | |
| never-fabricate | 3 | 9 | 0 | Has fixtures |
| obsidian | 3 | 9 | 4 | |
| prd | 3 | 9 | 0 | PAUSED - experimental |
| presentation-builder | 3 | 7 | 0 | |
| research | 3 | 10 | 0 | Has fixtures |
| skills | 3 | 12 | 0 | |
| test-plan | 3 | 13 | 0 | |
| video-showcase | 3 | 12 | 0 | PAUSED - experimental |
| voice-sessions | 3 | 8 | 6 | |
| writing-skills | 3 | 10 | 2 | |

---

## Bronze (14 skills)

Active and useful but lacking eval specs. Priority targets for C-R2 eval writing.

| Skill | Adapters | Workflows | Usage | Priority for Evals |
|-------|----------|-----------|-------|---------------------|
| coach | 3 | 4 | Active | HIGH - has adapters, needs evals |
| context-check | 4 | 0 | Active | HIGH - has adapters, needs evals |
| maintenance | 1 | 9 | Active | HIGH - most workflows |
| orc | 0 | 0 | Active | HIGH - orchestrator |
| ecosystem-health | 0 | 0 | Active | MEDIUM |
| nightly-journal | 0 | 0 | Active | MEDIUM |
| code-review | 0 | 0 | Active | MEDIUM |
| worktrees | 0 | 5 | Active | MEDIUM |
| railway | 0 | 5 | Active | MEDIUM |
| linkedin-post | 0 | 5 | Rare | LOW |
| wizard | 0 | 0 | Rare | LOW |
| qa-video | 0 | 0 | Rare | LOW |
| video-extract | 0 | 0 | Rare | LOW |
| claude-web-research | 0 | 0 | Rare | LOW |

---

## Paused (4 skills) — `status: experimental`

Marked experimental due to inactivity or unreliability. Will be re-evaluated when behavioral evals are runnable.

| Skill | Grade | Reason |
|-------|-------|--------|
| critique-waves | Silver | No production usage, theoretical multi-agent consensus |
| prd | Silver | No description in frontmatter, Ralph-specific, inactive |
| brave | Silver | Superseded by Chrome MCP, fallback only |
| video-showcase | Silver | Remotion dependency, rarely used |

---

## Archived (7 skills) — moved to `_archive/`

| Skill | Reason |
|-------|--------|
| ralph-commit | Duplicated by commit skill's Ralph mode |
| lsp | Wrapper for built-in LSP tool, no added value |
| nightly-docs-update | Superseded by maintenance skill's docs workflow |
| content | Overlaps with maintenance + linkedin-post skills |
| email-golem | Launchd daemon config, not a skill pattern |
| notify | Shell function wrapper, trivially available without skill |
| figma-swarm | Never used in production, theoretical multi-agent pipeline |

---

## Description Audit

10 descriptions rewritten (expanded from ~30 words to 80-120 words):

1. cli-agents (30 -> 98 words)
2. wizard (31 -> 93 words)
3. 1password (31 -> 95 words)
4. large-plan (32 -> 97 words)
5. convex (33 -> 94 words)
6. github (33 -> 96 words)
7. skills (33 -> 92 words)
8. worktrees (33 -> 98 words)
9. test-plan (34 -> 91 words)
10. writing-skills (34 -> 94 words)

All rewritten descriptions include: trigger words, negative triggers ("NOT for:"), and capability summary.

---

## Next Steps

1. **C-R2**: Write PromptFoo behavioral eval specs for Bronze HIGH-priority skills (coach, context-check, orc, maintenance)
2. **Run evals**: Execute existing eval specs to populate `behavior_pass_rate` field
3. **Re-grade**: After eval execution, re-grade based on actual pass rates
4. **Promote**: Bronze skills with passing evals -> Silver; Silver skills gaining adapters -> Gold
