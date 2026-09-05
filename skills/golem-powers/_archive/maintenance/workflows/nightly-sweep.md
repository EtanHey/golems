# Nightly Sweep Workflow

> Multi-repo content freshness audit. Run nightly via scheduled task, after N PRs, or manually.

## Triggers

| Trigger | When | How |
|---|---|---|
| **Scheduled** | Daily/weekly cron or Claude Scheduled Task | `maintenanceClaude sweep --repos orchestrator,golems,brainlayer,voicelayer` |
| **PR threshold** | After every 5th merged PR across the ecosystem | orcClaude tracks merges, invokes maintenance when threshold hit |
| **Manual** | "What needs updating?" / "nightly sweep" / "audit docs" | User invokes directly |
| **Post-sprint** | After a collab sprint completes | orcClaude invokes with sprint fact brief |

## Procedure

1. **Iterate over target repos** (user specifies, or default to ecosystem list)
2. For each repo: run Phase 1 (gather-facts.md) in **summary mode** — BrainLayer + git log only, skip critique waves for speed
3. Produce a single prioritized digest:

```markdown
## Nightly Sweep — <date>

### Repos with stale content
- brainlayer: README missing BrainBar daemon info (PR #84 merged 3 days ago)
- voicelayer: README still says "Python MCP server" (daemon is live)

### Repos up to date
- orchestrator: roadmap matches current state
- golems: README reflects recent PRs

### Recommended updates (by priority)
1. brainlayer README — high impact, 3+ stale claims
2. voicelayer README — medium impact, architecture section outdated
3. portfolio BrainLayer page — low impact, missing daemon metrics
```

4. The user decides which to act on.
5. For each selected repo, trigger the full Phase 1 + Phase 2 loop.

## Resume Backlog Tagging

During sweep, any fact that would make a good resume bullet gets tagged for coachClaude:

```text
brain_store(
  content: "Resume-worthy: <project> — <achievement with numbers>",
  tags: ["resume-backlog", "coach-notify", "maintenance", "<project>"],
  importance: 6
)
```

coachClaude picks these up via `brain_search("resume-backlog")` during job search sessions. This bridges the gap between shipping work and updating the resume — maintenanceClaude sees the facts, coachClaude uses them.

## Summary Mode vs Full Mode

| Mode | BrainLayer | Git log | Read files | Critique waves | Output |
|---|---|---|---|---|---|
| **Summary** (sweep) | Yes | Yes | README only | No | Digest with stale flags |
| **Full** (per-repo) | Yes | Yes | All target files | Yes | Complete fact brief |

Summary mode takes ~2 min per repo. Full mode takes ~5-10 min. Sweep uses summary, then upgrades to full for repos that need updates.
