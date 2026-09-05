# Phase 1: Gather Facts + Verify

> This is the foundation phase. Every claim in Phase 2 content traces back to a fact verified here.

## Before Starting

```text
brain_search("maintenance <project> last run")
brain_search("<project> milestones recent PRs decisions")
brain_search("<project> architecture changes")
```

Look for: previous maintenance runs (what was already verified), recent milestones, PR merges, architecture decisions, known issues.

---

## Step 1: Automated Stats Collection

**Invoke `/nightly-docs-update --stats-only` first.** This script collects machine-verifiable numbers:

| Stat | Source | Why automate |
|---|---|---|
| Package count | `ls packages/` | Exact, no guessing |
| Test count | `bun test --reporter=summary` | Must be run, not remembered |
| Skill count | `ls skills/golem-powers/` | Changes frequently |
| BrainLayer chunks | SQLite query | Only way to get real number |
| PR count | `gh pr list --state merged` | Grows daily |
| Eval coverage | Count `evals/evals.json` files | Tracks quality progress |

**If `/nightly-docs-update` is unavailable**, collect stats manually via bash. The script is a convenience, not a dependency.

**Zero-value protection:** If any stat returns 0 and it was previously non-zero, this is a collection failure, NOT a real value. Log the failure and use the previous known value (from BrainLayer or last run).

Write automated stats as tagged facts:
```text
[STAT-1] Tests: 1012 pass, 0 fail, 89 files (collected 2026-03-17 via nightly-docs-update)
[STAT-2] BrainLayer chunks: 312,847 (SQLite direct query)
[STAT-3] Skills: 47 dirs, 42 SKILL.md, 18 with evals (38% coverage)
```

---

## Step 2: BrainLayer Sweep

Query BrainLayer for everything recent about the target project:

```text
brain_search("<project> PR merged", num_results=10)
brain_search("<project> milestone decision", num_results=10)
brain_search("<project> architecture learning", num_results=10)
brain_search("<project> bug fix", num_results=5)
```

**Parse each result.** Extract:
- What changed (feature, fix, refactor)
- When it changed (date, PR number)
- Why it changed (decision rationale)
- Measurable outcomes (test counts, performance numbers, size changes)

Write these as tagged facts:
```text
[FACT-1] PR #84 merged 2026-03-17: BrainBar Swift daemon. 209KB binary, 28 tests, zero external deps.
[FACT-2] Decision: single-writer SQLite architecture eliminates SQLITE_BUSY contention.
```

**Cross-validate with Step 1 stats.** If BrainLayer says "28 Swift tests" but `/nightly-docs-update` reports a different count, note the discrepancy — don't silently pick one.

---

## Step 3: Git Diff Analysis

For the target repo, pull recent history:

```bash
# Recent commits
git -C <repo-path> log --oneline -20

# Recent PRs (if GitHub)
gh pr list --repo EtanHey/<repo> --state merged --limit 10

# Current branch status
git -C <repo-path> status --short
```

Cross-reference git history with BrainLayer results. Git shows WHAT changed. BrainLayer shows WHY.

**Flag mismatches:** If BrainLayer has a milestone that doesn't appear in git, or git shows a merge that BrainLayer doesn't know about, note it. **Absence of data is data** — a missing BrainLayer entry for a merged PR means the brain_store was skipped during that session.

---

## Step 4: Current Content Audit

Read the content being updated. Depending on content type:

| Content Type | What to Read |
|---|---|
| README | `<repo>/README.md` |
| Portfolio | etanheyman.com project page (via WebFetch or local file) |
| Skill page | `skills/golem-powers/<skill>/SKILL.md` + eval results |
| Resume | Latest resume file or BrainLayer resume chunks |
| LinkedIn | Current profile sections (user provides or brain_search) |
| Docs | Target documentation files |

**For each claim in the current content, classify:**

| Classification | Meaning | Action |
|---|---|---|
| CURRENT | Claim matches verified facts | Keep |
| STALE | Claim was true but something changed | Update |
| WRONG | Claim was never true or is now misleading | Remove or correct |
| MISSING | Important fact not mentioned anywhere | Add |

---

## Step 5: Critique Waves (via `/critique-waves`)

**Invoke `/critique-waves`** — do NOT reinvent the parallel agent pattern.

### Setup

Run the critique-waves setup with a verification folder:

```bash
bash ~/.claude/commands/critique-waves/scripts/init-tracker.sh "maintenance-<project>" "Verify all facts and claims in <project> content"
```

### Instructions for the 3 agents

Write `docs.local/maintenance-<project>/instructions.md` with:

**FORBIDDEN patterns** (any of these = FAIL):
- Specific numbers that don't match Step 1 stats or Step 2 BrainLayer facts
- Aspirational language presented as current state ("supports X" when X is planned)
- References to removed/renamed features
- Superlatives without evidence ("fastest", "most reliable", "industry-leading")

**REQUIRED patterns** (missing any = FAIL):
- Every specific claim traces to a [FACT-N] or [STAT-N] tag
- Known limitations are disclosed
- Significant recent PRs are mentioned

### Agent Roles

Each of the 3 critique-wave agents gets the fact list from Steps 1-4 plus one specialized focus:

**Agent 1 (factChecker):** Read actual source files. Verify every number (test count, file size, line count, performance metric). Report: VERIFIED / WRONG (with correct value) / UNVERIFIABLE.

**Agent 2 (claimAuditor):** Read current published content. Flag future tense as present, superlatives without evidence, removed/changed features, scope overclaims.

**Agent 3 (gapFinder):** Compare verified facts against current content. Flag unmentioned PRs, undocumented architecture decisions, missing before/after numbers, undisclosed known issues.

### Collect Results

The critique-waves skill handles result collection and consensus tracking. Read the agent output files at `docs.local/maintenance-<project>/round-N-agent-X.md` and merge findings into the fact brief.

---

## Step 6: Synthesize Fact Brief

Merge all inputs into a single fact brief:

```markdown
## Fact Brief: <project> (<date>)

### Source Summary
- Automated stats: <count> collected via /nightly-docs-update
- BrainLayer chunks reviewed: <count>
- Git commits reviewed: <count>
- Critique wave results: <pass/fail summary>

### Verified Facts
<merged from Steps 1-3, confirmed by factChecker>

### Stale Claims
<from Step 4 classification + claimAuditor findings>

### Missing Content
<from gapFinder report>

### Discrepancies
<anything where sources disagree or critique waves flagged issues>

### Data Gaps
<sources that failed or returned no data — NOT silently skipped>

### Recommended Content Updates
<prioritized list of what should change, with fact tags>
```

**Store the fact brief in BrainLayer:**

```text
brain_store(
  content: "Maintenance fact brief for <project> (<date>): <count> verified facts, <count> stale claims, <count> gaps found. Key findings: <top 3>.",
  tags: ["maintenance", "fact-brief", "<project>"],
  importance: 7
)
```

**Tag resume-worthy findings for coachClaude:**

Scan the verified facts for achievements that would make strong resume bullets or LinkedIn posts (impressive numbers, before/after deltas, role clarity). For each:

```text
brain_store(
  content: "Resume-worthy: <project> — <achievement with specific numbers>. Role: <what Etan did>.",
  tags: ["resume-backlog", "coach-notify", "maintenance", "<project>"],
  importance: 6
)
```

Examples of resume-worthy:
- "Replaced 10 Python processes (931MB) with 1 Swift daemon (40MB)" — clear delta
- "Orchestrated 3 AI agents to build 3 daemons in 1 hour" — role + speed
- "28 Swift tests, 846 Python tests, zero regressions" — quality proof

NOT resume-worthy: routine doc updates, minor version bumps, config changes.

coachClaude picks these up via `brain_search("resume-backlog")` during job search sessions.

---

## Phase 1 Exit Criteria

Phase 1 is complete when:
1. Automated stats are collected (or failures logged)
2. All BrainLayer results are reviewed and tagged
3. Git history is cross-referenced
4. Current content is classified (CURRENT/STALE/WRONG/MISSING)
5. Critique waves have run and returned results
6. Fact brief is synthesized and stored
7. All data gaps are logged (no silent failures)
8. Resume-worthy findings tagged with `resume-backlog` + `coach-notify`

**If any critique agent flags a WRONG fact:** resolve it before proceeding to Phase 2. Read the actual file. Determine which source is correct. Update the fact brief.

**If the user only asked for an audit:** stop here. Present the fact brief. Don't proceed to Phase 2.

**If the user asked for content updates:** proceed to the relevant Phase 2 workflow with the fact brief.
