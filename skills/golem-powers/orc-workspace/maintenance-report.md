# Skill Maintenance Report — 2026-03-18 (sweep 2)

Auditor: orcClaude via direct filesystem verification
Files checked: orc, cmux, cmux-agents, pr-loop skill files + collab TEMPLATE.md

---

## 1. Line Counts

| File | Lines | Target | Status | Headroom |
|------|-------|--------|--------|----------|
| orc/SKILL.md | 199 | ≤250 | OK | 51 |
| cmux/SKILL.md | 214 | ≤250 | OK | 36 |
| cmux-agents/SKILL.md | 159 | ≤200 | OK | 41 |
| pr-loop/SKILL.md | 409 | ≤450 | OK | 41 |
| collab/TEMPLATE.md | 356 | — | OK | — |

All within targets. cmux is tightest at 36 lines of headroom.

---

## 2. Frontmatter

All four skills have correct `name:` and `description:` fields. Trigger language verified:

- **orc**: Covers sprints, agent spawning, status checks, collab kickoffs, cross-repo, incident response, research dispatch. Comprehensive.
- **cmux**: "control panes, splits, browser, sidebar, coordinate multi-agent workflows." Mostly correct but see Issue #3 below.
- **cmux-agents**: Covers cmux agents, terminal agents, split agents, multi-agent orchestration. Clean.
- **pr-loop**: "creating a PR or finishing work, NOT optional, no exceptions." Strong.

---

## 3. Cross-References — All Skills

### Verified OK

| From | Reference | Resolves? |
|------|-----------|-----------|
| orc line 79 | `/cmux-agents` | YES — ~/.claude/commands/cmux-agents symlink ✓ |
| orc line 80 | `/cmux` (recovery section) | YES — cmux/SKILL.md stuck-state cheat sheet at line 181 ✓ |
| orc line 81 | `/pr-loop` | YES ✓ |
| orc line 82 | `/never-fabricate` | YES — symlink ✓ |
| orc line 82 | `/superpowers:verification-before-completion` | YES — installed plugin at ~/.claude/plugins/cache/superpowers-marketplace/superpowers/3.4.1/ ✓ |
| orc line 83 | `/superpowers:brainstorming` | YES — same plugin ✓ |
| orc line 84 | `$ORCHESTRATOR_REPO/collab/TEMPLATE.md` | YES ✓ |
| orc line 130 | `repoGolem launcher` | YES — still real name in .zshrc (rename pending per MEMORY.md TODO) ✓ |
| orc line 191 | `pgrep -fl BrainBar` | YES — BrainBar.app is running at /Applications/BrainBar.app ✓ |
| cmux line 213 | `/cmux-agents` (monitoring loops, CronCreate) | YES ✓ |
| cmux line 214 | `/orc` (orchestration decisions) | YES ✓ |
| cmux-agents line 14 | `~/.claude/commands/cmux-agents/scripts/agent-functions.sh` | YES — symlink resolves correctly, file exists ✓ |
| cmux-agents line 55 | `spawn-agent`, `agent-status`, `agent-nudge`, `agent-kill` | YES — all 4 functions present in agent-functions.sh ✓ |
| cmux-agents line 79 | `adapters/` + `adapters/capabilities.yaml` | YES — 6 files in adapters/: capabilities.yaml, claude.md, codex.md, cursor.md, gemini.md, kiro.md ✓ |
| cmux-agents line 90 | `workflows/prompt-audit.md` | YES ✓ |
| cmux-agents line 117 | `$ORCHESTRATOR_REPO/collab/TEMPLATE.md` | YES ✓ |
| cmux-agents line 117 | `collab-guard.py hook` | YES — ~/.claude/hooks/collab-guard.py ✓ |
| cmux-agents line 138 | `worktrees` skill | YES — ~/.claude/commands/worktrees ✓ |
| pr-loop line 34 | `Daemon Verification Gate` (internal anchor) | YES — section at line 317 ✓ |
| pr-loop line 385 | `/commit` | YES — ~/.claude/commands/commit ✓ |
| pr-loop line 386 | `/superpowers:test-driven-development` | YES — installed plugin ✓ |
| pr-loop line 387 | `/superpowers:verification-before-completion` | YES — installed plugin ✓ |
| pr-loop line 388 | `/never-fabricate` | YES ✓ |
| pr-loop line 381 | `/large-plan` | YES — ~/.claude/commands/large-plan ✓ |
| pr-loop line 305 | `$ORCHESTRATOR_REPO/roadmap/README.md` | YES ✓ |
| TEMPLATE.md line 224 | `$ORCHESTRATOR_REPO/standards/research-lifecycle.md` | YES ✓ |
| TEMPLATE.md line 289 | `$ORCHESTRATOR_REPO/standards/autonomous-checkin.md` | YES ✓ |
| TEMPLATE.md line 267 | `$ORCHESTRATOR_REPO/roadmap/README.md` | YES ✓ |

---

## 4. Issues Found

### Issue 1 — RESOLVED: retired CLI-agent command consolidated into `/cmux-agents`

`cli-agents` was previously referenced in:
- `TEMPLATE.md` line 169: mandatory skills table
- `orchestrator/CLAUDE.md` line 197: auto-lookup trigger table

The active command is now `/cmux-agents`; repoGolem launcher rules live there
with detailed flag references in `/repogolem`.

### Issue 2 — MEDIUM: Score gate iteration cap mismatch (orc vs TEMPLATE)

- `orc/SKILL.md` line 33: "Score ≥9 from critic, OR max 2 design iterations reached" (PLAN→SPAWN transition)
- `TEMPLATE.md` line 137: "Score <7 → iterate, max 3 rounds total"

These are subtly different: orc caps at 2 iterations in the state machine transition; template's SCORE GATE caps at 3. Agents reading both files get conflicting limits. The ≥9 threshold and 7-8 behavior are consistent — only the fallback cap differs.

**Recommend:** Pick one. "max 3 rounds" in template matches the pr-loop review round cap (3 rounds) and feels more ergonomic. Update orc:33 to say "max 3 design iterations" for consistency.

### Issue 3 — LOW: cmux description includes "coordinate multi-agent workflows"

`cmux/SKILL.md` frontmatter description includes "coordinate multi-agent workflows." This overlaps with orc and cmux-agents triggers. cmux is about pane primitives — the coordination concept belongs to orc.

**Recommend:** Change "coordinate multi-agent workflows" to "agent-to-agent messaging" in cmux description. This sharpens the trigger and avoids false disambiguation.

### Issue 4 — LOW: Codex model version inconsistency

- `cmux-agents/SKILL.md` line 73: "Output contracts, GPT-5.4"
- `pr-loop/SKILL.md` line 160: "GPT-5.2-codex"

MEMORY.md (March 6 session) establishes GPT-5.4 as the current Codex model. pr-loop has the older string.

**Fix (applied below).**

### Issue 5 — LOW: cmux `golem-terminal Integration Note` not labeled as aspirational

`cmux/SKILL.md` lines 148–157 contain a mapping table for `golem-terminal` equivalents (`orchestrate.py split <slot>`, `HTTP POST localhost:3847/notify`, etc.). `golem-terminal` does not exist as a repo and `orchestrate.py` does not exist anywhere in `~/Gits/`. Without a "future reference" label, agents could attempt these commands and fail confusingly.

**Fix (applied below).**

### Issue 6 — LOW: cmux-agents has no See Also section

orc and cmux both point to cmux-agents. cmux-agents has no reciprocal navigation. Agents who arrive at cmux-agents have no pointer to orc (orchestration decisions) or cmux (low-level pane ops) or pr-loop (every agent needs to PR).

**Fix (applied below).**

---

## 5. Composability Map Check

| From → To | Explicit pointer | Reciprocal |
|-----------|-----------------|------------|
| orc → cmux-agents | YES (line 79) | PARTIAL (cmux-agents mentions "cmux MCP tools" generically, no See Also) |
| orc → cmux | YES (line 80) | YES (cmux See Also line 214) |
| orc → pr-loop | YES (line 81) | PARTIAL (pr-loop Composability lists "/large-plan" and "/commit" but not orc) |
| cmux → cmux-agents | YES (line 213) | FIXED (See Also added) |
| cmux → orc | YES (line 214) | YES (orc composition map) |
| cmux-agents → orc | NONE before fix | FIXED (See Also added) |
| cmux-agents → cmux | Implicit only | FIXED (See Also added) |
| cmux-agents → pr-loop | NONE (collab section implies but doesn't say) | FIXED (See Also added) |
| pr-loop → commit | YES (line 385) | commit skill is standalone, no back-pointer needed |
| pr-loop → superpowers | YES (lines 386-387) | superpowers plugin doesn't reference pr-loop (expected) |

---

## Fixes Applied

### Fix A: cmux-agents See Also section (added)

Added at end of `cmux-agents/SKILL.md` before final line:

```
## See Also

- `/cmux` — low-level pane operations (splits, reads, sends, browser)
- `/orc` — orchestration decisions, state machine, collab protocols
- `/pr-loop` — every agent working on code must invoke this for every PR
```

### Fix B: cmux golem-terminal section labeled as future reference

Added `> **Future reference only — golem-terminal is not yet built.**` as the first line of the "golem-terminal Integration Note" section in `cmux/SKILL.md`.

### Fix C: pr-loop Codex model version updated

Changed `pr-loop/SKILL.md` line 160:
- Before: `| Codex Cloud | AI code review (GPT-5.2-codex) |`
- After: `| Codex Cloud | AI code review (GPT-5.4) |`

---

## Confirmed Not Stale

- `BrainBar` daemon name: confirmed running at `/Applications/BrainBar.app` ✓
- `repoGolem` launcher: still correct name in .zshrc (rename is pending TODO, not done yet) ✓
- `cmux notify "Title" "Body"` positional syntax: tested, returns OK ✓
- `tools/cmux-mcp/` deletion: intentional, replaced by `~/Gits/cmuxlayer/src/index.ts` per .mcp.json ✓
- `collab-guard.py` hook: exists and active at `~/.claude/hooks/collab-guard.py` ✓
- `superpowers:*` skills: accessible via installed plugin (not missing) ✓
- All `mcp__cmuxlayer__*` tool names in cmux-agents match the available deferred tools in session ✓

---

## Action Items (not auto-fixed — require decision)

| Priority | Item | Location |
|----------|------|---------|
| DONE | Retired CLI-agent command consolidated into `/cmux-agents`; remove old symlink during retire flow | skill-cut PR |
| MEDIUM | Align score gate iteration cap: pick "max 2" (orc) or "max 3" (template) | orc/SKILL.md:33, TEMPLATE.md:137 |
| LOW | Narrow cmux description: "coordinate multi-agent workflows" → "agent-to-agent messaging" | cmux/SKILL.md frontmatter |
