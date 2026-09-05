---
name: nightly-docs-update
description: "Automated sync between golems repo stats and etanheyman.com portfolio site. Collects package count, test count, skill count, BrainLayer chunk count, and PR count, then updates hardcoded numbers across portfolio files and detects dead references to removed packages. Use when: stats are stale, after merging significant PRs, nightly scheduled runs, or when someone says docs numbers look wrong. NOT for: editorial content rewrites or adding new portfolio sections."
execute: scripts/default.sh
---

# Nightly Docs Update

> Keeps etanheyman.com/golems in sync with the actual golems repo state. Runs stats collection, updates hardcoded numbers, detects dead references, and creates a PR.

## When to Use

- **Nightly:** Scheduled run to catch stat drift
- **Post-merge:** After significant golems PRs (new packages, skill additions, test changes)
- **Manual:** When someone says "docs are stale" or "numbers look wrong"

## Prerequisites

- `~/Gits/golems` exists and is a git repo
- `~/Gits/etanheyman.com` exists and is a git repo
- `gh` CLI authenticated
- `sqlite3` available (for BrainLayer chunk count)
- BrainLayer DB at `~/.local/share/zikaron/zikaron.db`

## What It Does

The `scripts/default.sh` script runs in two phases:

### Phase 1: Collect Stats (from golems repo)

| Stat | Source | Command |
|------|--------|---------|
| Package count | `ls packages/` | `ls ~/Gits/golems/packages/ \| wc -l` |
| Package list | `ls packages/` | `ls ~/Gits/golems/packages/` |
| Test count | `bun test` | `bun test --reporter=summary 2>&1 \| grep -E 'pass\|fail'` |
| Skill count | `ls skills/` | `ls ~/Gits/golems/skills/golem-powers/ \| wc -l` |
| Skill eval coverage | evals.json | Count dirs with `evals/evals.json` |
| BrainLayer chunks | SQLite | `sqlite3 ~/.local/share/zikaron/zikaron.db 'SELECT COUNT(*) FROM chunks'` |
| PRs merged | GitHub API | `gh pr list -R EtanHey/golems --state merged --limit 999 \| wc -l` |
| MCP servers | `.mcp.json` | Count active servers |

Stats are written to a temp JSON for the update phase.

### Phase 2: Update etanheyman.com (in portfolio repo)

#### Automatable Updates (sed replacements)

| Target File | What Changes |
|-------------|-------------|
| `golems-stats.json` | Full stats regeneration |
| `project-showcase-config.ts` | Package count, PR count, skill count, chunk count |
| `terminal-showcase-config.ts` | BrainLayer chunk numbers in terminal demo |
| `content/golems/architecture.md` | Package count in description |
| `content/golems/getting-started.md` | Monorepo tree, skill count, chunk count |
| `content/golems/faq.md` | Chunk count references |
| `content/golems/zikaron.md` | Chunk count references |
| `content/golems/llm.md` | Chunk count, skill count |
| `content/golems/mcp-tools.md` | Chunk count references |
| `content/golems/journey.md` | Chunk count references |

#### Dead Reference Detection (warn only)

The script scans for references to packages that no longer exist:

| Dead Reference | What It Means |
|----------------|---------------|
| `packages/autonomous/` | Removed — absorbed into services |
| `packages/orchestrator/` | Removed — now external repo at $ORCHESTRATOR_REPO |
| `packages/dashboard/` | Removed; public documentation moved out of this repository |
| `packages/ralph/` | Removed — ralph is now a skill + external repo |
| `packages/zikaron/` | Removed — now standalone BrainLayer repo |

Dead refs are **reported but not auto-fixed** — they may be historically accurate (journey sections).

### Phase 3: PR Creation

If any files changed:
1. Create branch `chore/nightly-docs-YYYY-MM-DD`
2. Commit with conventional message
3. Create PR with diff summary
4. Output PR URL

If no files changed: report "all stats current" and exit 0.

## Checklist of Places to Check

This is the full PRD of content that can drift. The script automates most of these.

### Hardcoded Numbers (HIGH priority — auto-fixable)

- [ ] Package count (currently 11)
- [ ] PR count (currently 261+)
- [ ] Skill count (currently 55)
- [ ] BrainLayer chunk count (currently 291K+)
- [ ] Test count and file count

### Structural References (MEDIUM priority — detection only)

- [ ] Package table in architecture.md matches actual `ls packages/`
- [ ] Monorepo tree in getting-started.md matches filesystem
- [ ] No references to removed packages (autonomous, orchestrator, dashboard, ralph, zikaron)
- [ ] Install commands reference correct package names (`docsite` not `dashboard`)

### Semantic Consistency (LOW priority — manual review)

- [ ] Golem count consistent across files (currently 7)
- [ ] Feature descriptions match actual CLAUDE.md per package
- [ ] External links still resolve (BrainLayer repo, VoiceLayer repo)

## Edge Cases

- **BrainLayer DB missing:** Skip chunk count, warn in output
- **Tests take too long:** Use `--skip-tests` flag to skip test counting
- **gh not authenticated:** Skip PR count, warn in output
- **etanheyman.com dirty:** Refuse to run, ask user to commit/stash first
- **No changes detected:** Exit 0 with "all current" message (not an error)

## Composability

- **Called by:** Night Shift (`@golems/services`), manual invocation
- **Calls:** `/pr-loop` for the PR creation step (when run manually with `--pr-loop`)
- **Produces:** `golems-stats.json` consumed by etanheyman.com dashboard

## Quick Reference

```bash
# Full run (collect + update + PR)
/nightly-docs-update

# Skip tests (faster, ~15s vs ~70s)
/nightly-docs-update --skip-tests

# Stats collection only (no file updates)
/nightly-docs-update --stats-only

# Detect dead refs only
/nightly-docs-update --dead-refs-only
```
