# Mine Session Workflow

> Extract a Claude Code session JSONL transcript into a structured 10-section markdown digest. Use for handoff docs, end-of-day mining waves, claim-verification audits, or reconstructing a session that compacted.

## Prerequisites

- A session JSONL path under `~/.claude/projects/<project-slug>/<uuid>.jsonl`
- A target output path (convention: `$ORCHESTRATOR_ROOT/docs.local/handoffs/<date>/<label>-session-mine.md`)
- Active skill-creator session — this workflow uses the `session-miner` sub-agent which is **only invokable from cwd inside `$SKILL_CREATOR_ROOT/`** (`skillCreatorClaude` / `skillCreatorCodex` / `skillCreatorRepoGolem`)

## Why a sub-agent for this

Mining is a recurring, structured task with high fabrication risk if done by a general-purpose agent in narrative mode. The converged pattern (proven across 4 parallel miners on 2026-05-15) is a parameterized python parser + a thin agent shell that enforces:

- Verbatim user-correction quotes
- Event-index citation for every claim
- GAP REPORT when parent's brief claims work that isn't in the JSONL
- Soft cap ~800 lines (calibrated against orc's 798-line output from 5.9 MB / 3641 events)

## Dispatch Chain

```
orcClaude (cwd=orchestrator)
   └─→ spawns skillCreatorClaude (current top Opus at 1M, cwd=skill-creator)
          └─→ spawns N session-miner sub-agents in parallel
                 └─ each mines one JSONL, returns MINE_DONE <label> <path> <line_count>
```

orc cannot spawn `session-miner` directly — the agent is repo-scoped to skill-creator. Going through skillCreatorClaude is the intended pattern.

## Steps

### 1. Identify the JSONL(s)

```bash
ls -la ~/.claude/projects/-Users-etanheyman-Gits-<repo>/*.jsonl
```

For end-of-day waves: one JSONL per active surface (orc, brainlayer, voicelayer, coach, etc.).

### 2. Decide the output convention

```
$ORCHESTRATOR_ROOT/docs.local/handoffs/<YYYY-MM-DD>-<wave-label>/<agent-label>-session-mine.md
```

Create the directory if needed.

### 3. Invoke the sub-agent

From a skillCreatorClaude session:

```python
Agent(
  subagent_type="session-miner",
  description="Mine <label> session for handoff",
  prompt="Mine ~/.claude/projects/.../<uuid>.jsonl and write the digest to <out>. Label='<label>'. If the parent brief claims specific work (PR numbers, commit SHAs), verify against the JSONL and produce a GAP REPORT if absent.",
)
```

For parallel mining waves, dispatch multiple Agent calls in a single message — they run concurrently.

### 4. Verify outputs

After each `MINE_DONE` signal:

```bash
wc -l <out>             # confirm in 200-1000 range
head -10 <out>          # confirm time span is what you expect
grep -c "^## " <out>    # should be 10 (or 11 with GAP REPORT)
```

If the time span shows a date that contradicts the parent brief, the sub-agent should have already added a HONESTY DISCLAIMER. If not, prompt it to add one.

### 5. Synthesize (optional)

If the wave is for a unified handoff doc, the parent agent (typically orc) reads each mined digest and produces the consolidated handoff. The mined digests are inputs, not the final deliverable.

## Batch mining + synthesis (folded in from the retired `batch-session-miners`)

`batch-session-miners` is **retired** — its job is this workflow run at scale, so
it lives here as a single source of truth (no separate skill to lose).

**Batch fan-out (the EOD-wave / weave pattern):** one miner per session, N
sessions concurrently (batches of ~5). From a skillCreator session, dispatch
multiple `Agent(subagent_type="session-miner", ...)` calls in a single message —
they run in parallel. Loop the batches until the corpus is exhausted. This is the
engine `/weave` wraps for cross-session mining.

**Synthesis stage — pick the runtime by its strength:**

| Workload | Best runtime |
|---|---|
| Fan-out 5+ miners in parallel | Codex (`spawn_agents_on_csv`) or Claude (parallel `Agent` calls) |
| Mine + synthesize in one shot | Claude (after the batch, run a synthesis `Agent` call) |
| Synthesize EXISTING digests across many sessions | **Gemini** — long-context advantage; reads all N digests in one window |
| Multi-modal synthesis (digests + screenshots + audio) | **Gemini** — only one with native multi-modal |

Gemini's natural role is **synthesizer, not foreman** (no typed sub-agents): once
N digests exist, hand the directory to Gemini for the unified roll-up —

```bash
geminiCLI "Read every *.md in <handoffs-dir>/. Produce a unified handoff: top \
decisions across all sessions, recurring user corrections, cross-session \
blockers, what's safe to ship next."
```

A major end-of-week roll-up composes all three: Codex (fast fan-out) → N digests
→ Gemini (long-context synthesis) → Claude (architectural critique / decision
verification) → ship-ready doc. For the structured findings→disposition variant
of this (with a conversion-to-change ledger), use `/weave`.

## Parser Details

The agent runs `$SKILL_CREATOR_ROOT/scripts/session-miner.py` under the hood. The parser:

- Reads JSONL line-by-line, categorizes events (user / assistant / queue-op / system / tool calls / tool results)
- Filters loop-counter / cron-poll noise via regex (`orc monitor tick`, `Monitor check:`, etc.)
- Dedups same-hour TaskCreate retries and content-equal architectural decisions
- Suppresses low-importance brain_store ticks (importance < 6, counted but not quoted)
- Emits `MINE_DONE <label> <out_path> <line_count>` as terminator

Run standalone for debugging:

```bash
python3 $SKILL_CREATOR_ROOT/scripts/session-miner.py \
  --src "<jsonl>" --out "<md>" --label "<short-label>"
```

## Output Schema

10 fixed sections:

1. Major dispatches timeline (TaskCreate, cmux comms, spawn_agent, Agent subagent_type)
2. User corrections (verbatim with event index)
3. Architectural decisions (brain_store importance≥7 or decision-tagged)
4. Task list evolution
5. Files created (Write tool)
6. brain_* call outcomes (search / store / digest grouped)
7. Sub-agent communications (cmux send_input / read_screen by surface)
8. Cron / monitoring (CronCreate / Delete / ScheduleWakeup)
9. BrainLayer health events (keyword-scanned, deduped)
10. Session close state (last asst text, away_summary, last 30 events)

Plus optional **HONESTY DISCLAIMER** + **GAP REPORT** when claims don't match data.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Trying to invoke `session-miner` from orcClaude directly | Dispatch skillCreatorClaude first, let it spawn the miner |
| Accepting the digest at face value when the parent brief was specific | Always grep the JSONL for claimed PR numbers / SHAs / branch names; produce GAP REPORT if absent |
| Output >1000 lines on a <5 MB session | Check Section 7 (sub-agent comms) — dedup may need tightening |
| Hand-rewriting the parser per-session | The parameterized parser handles all current calibration points — use `--label` and `--src/--out` flags, don't fork the script |
| Skipping verification because parser exited 0 | Always Read the output and check the 10 sections rendered |

## When NOT to use this workflow

- Live session monitoring (use cmux read_screen / orc instead)
- Current-state recall for the active session (use the harness's own git status/diff or briefing flow)
- Mining a Codex session (different log format — Codex sessions live in `~/.codex/sessions/`, not `.claude/projects/`)
- Producing the final handoff prose (this workflow produces structured digest material; the prose is a downstream step)

## Calibration Reference

Proven against four real fixtures on 2026-05-15:

| Session | Size | Events | Output lines | Notes |
|---|---|---|---|---|
| orc cbc7681e | 5.9 MB | 3641 | 798 (hand) / 658 (parser) | Gold standard; 36/36 TaskCreates captured; 11/11 corrections |
| brainlayer 1a0a5c31 | 1.2 MB | 612 | 395 | Single-agent audit + master prompt |
| skill-creator 8fd8513a | 4.3 MB | 1318 | 357 (hand) / 875 (parser, wider net) | Captures meta-finding at idx 874 |
| voicelayer 9063eb60 | 0.4 MB | 269 | 203 (hand, gap-honesty) / 84 (parser) | **Best gap-honesty.** Refused to fabricate PR #199. |

See `$SKILL_CREATOR_ROOT/docs.local/research/2026-05-15-session-miner-{design,eval}.md` for the full rationale and eval results.
