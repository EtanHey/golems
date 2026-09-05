# Weave topology — flat-N vs staged, and the round structure

> Topology is an **eval variable, not a guess** (Etan: *"maybe all 9 agents at
> once, or 5 then 2 then 5 — we need to experiment"*). This file says when to
> use which, and what the eval is supposed to settle.

## The two shapes

### Flat-N (all miners at once)
- All N miners fan out over N sessions simultaneously; synthesis merges at the end.
- **Pros:** fastest wall-clock; trivially parallel; no coordination.
- **Cons:** no cross-pollination — miner A can't see what miner B found, so
  duplicate findings and shallow threads survive into synthesis.
- **Use when:** the corpus is small (≤ ~10 sessions), or you just need a fast
  first-pass ledger and will dedup in aggregation.

### Staged (e.g. 5 → 2 → 5)
- Round 1 mines the broadest / centerpiece sessions; round 2 reads round-1
  findings and chases the threads; round 3 mines the long tail with that context.
- **Pros:** later stages dedup, go deeper, and refine raw hits into actionable
  recommendations. Higher quality *per token*.
- **Cons:** slower wall-clock; needs the orchestrator to pass round-1 findings
  into round-2 prompts.
- **Use when:** the corpus is large, the centerpiece sessions are dense (the two
  orc sessions), or conversion-to-change matters more than wall-clock.

**Hypothesis the eval tests:** *staged beats flat on conversion-to-change per
token*, because round-2 miners turn round-1's raw hits into recommendations a
disposition can actually be assigned to. Unproven — that's what the eval decides
(`EVAL.md`). Baseline is "no weave at all."

## Batch size

The mining engine fans **one miner per session**, in batches of ~5 concurrent
(the proven "May night" cadence). Batch size is a concurrency knob, independent
of flat-vs-staged:
- **Round 1 = 7+ miners** — the proven first-round fan-out width from the original
  May-night weave. Open wide on the first sweep (centerpieces + the densest
  per-track sessions), then narrow to ~5-concurrent batches for the tail.
- ~5 keeps RAM and token-rate sane next to a live fleet.
- The convergence gate should have quiesced the fleet first, so 5–8 is safe.
- Loop the batches until the corpus is exhausted (`weave-run.py batches`).

## Centerpieces first

The orchestrator's own session JSONLs are the **centerpieces** — they hold the
night's decisions, corrections, and failures that no single worker saw. Always:
1. Produce a deterministic digest for each centerpiece first (`session-miner.py`).
2. Mine the centerpieces in round 1 (deep), before the worker/Codex long tail.
3. Let their findings seed the round-2 prompts in staged mode.

`weave-run.py discover` tags centerpiece sessions (default: the `orchestrator`
repo) and sorts them first in the batch plan.

## Round structure (loop-until-dry, cap ~9)

"9 rounds" is Etan's **depth intent**, not a fixed structure. Define depth by the
backtest, not by a number — stop early when a round surfaces nothing new.

- **Rounds 1–3 (broad sweep):** anti-patterns, recurring frustrations,
  what-worked vs what-hurt — by agent and by topic. Centerpieces in round 1.
- **Rounds 4–6 (drill):** skill gaps, capability-uplift vs encoded-preference
  candidates, cross-session patterns the sweep only hinted at.
- **Rounds 7–9 (synthesize + adversarial):** a completeness critic ("what did we
  miss — a session not mined, a claim unverified?"), dedup, then propose concrete
  skills/evals/PRs and score each.

Each round is a fan-out (miners mine slices → synthesis merges). **If a round
surfaces nothing new, stop — don't burn the cap.** The depth is only justified if
it converts (see the conversion-to-change metric in `weave-ledger.py`); the
backtest decides whether 9 is right or whether it plateaus at 4–5.

## Where this maps in the harness

- `weave-run.py discover|prepare|batches` = the fan-out plumbing (flat or staged).
- `prepare-mine-context.py` = the compact per-session context each miner reads.
- `weave-ledger.py` = the synthesis/aggregation + conversion metric.
- A Workflow (the `agent()`/`pipeline()` form) is the natural way to run staged
  mode: round N's `pipeline` stage reads round N-1's findings.
