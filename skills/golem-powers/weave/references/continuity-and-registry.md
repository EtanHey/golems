# Continuity, retros, registry, and artifact inventory

Read this when closing a weave, writing its retro, updating the stable rule registry, recording roadmap-only model tracking, or locating the skill's files and integrations.

## 6. The snowball — retros make the next weave better

After each run, write `$ORCHESTRATOR_ROOT/weave-records/retros/<date>.md`
(private records repo): what we learned, what to improve next
time (better miner prompts, better disposition routing, what got missed), **what
the red-team fact-check (§4b (verification-and-discharge.md)) caught and corrected** (the wrong facts that would
otherwise have shipped), **the §4c (verification-and-discharge.md) application table** (every edit item APPLIED or
DISPATCHED with links), the **§4a (verification-and-discharge.md) re-score of the prior run**, the **§7 registry
state transitions**, and a delta vs the prior weave. `brain_store` the
conclusions. The next weave **starts
from the last retro** — that's the compounding. (The reason this never snowballed
before: the weave was never built or committed. Fixed here, permanently.)

## 6b. ROADMAP — model-change-tracking (weave-owned, NOT YET BUILT)

> **ROADMAP dimension — a planned emit, not a shipped mechanism. Do not block a
> run on it; do not report it as implemented.**

A planned weave dimension: whenever a new model
drops, the weave should **auto-surface skill-relevance actions**. Research agents
track what changed between the new model and the prior one (thinking/capability
deltas, what it now does natively), and for **each skill** the weave proposes:
*still needed? · model now smart enough → **RETIRE** · or make it **LEANER**? ·
what changed in the model's reasoning that affects it?* This ties straight into
`/skill-creator`'s **capability-uplift vs encoded-preference** classification:
capability-uplift skills obsolesce as models improve; encoded-preference skills
endure. Routing these proposals through the ledger turns each model bump into more
conversion-to-change. (Fold into a future iteration / retro — not the first build.)

## 7. The RULE REGISTRY — stable IDs + lifecycle states (`$ORCHESTRATOR_ROOT/weave-records/registry/RULES.md`)

> Born 2026-06-07 (Phase-2 Fix-7; adversary verdict KEEP with the named-owner
> amendment). The problem it kills: "E-numbers are PER-RUN namespaces, not stable
> rule IDs… Rules without stable identity cannot accumulate enforcement history"
> (A1 header) — E09 meant three different things across three runs while prose
> carried it as the passivity identity at 4+ generations.

`$ORCHESTRATOR_ROOT/weave-records/registry/RULES.md` (private records repo —
retros + registry contain operator comms) is the **durable, committed carrier** for rule FAMILIES: one
row per family with a stable `R-###` ID, born-event (date + cite), every encoding,
every break event, current lifecycle state, and a revisit trigger. States:
**HELD / BROKEN-OPEN / ENCODED-UNTESTED / RETIRED / SUPERSEDED
(/-UNRESOLVED) / LOST**.

**Current state — v1.6 (2026-08-24 IDT):** **49 family rows** (44 at v1.5 + R-046..R-050 appended by the 2026-08-24 monthly weave). R-037 is a burned ID, not a row and not a lifecycle state — it has no row and the validator's state enumeration is unchanged. Transitions written 08-24: R-003 → ENCODED-UNTESTED, R-034 HELD → BROKEN-OPEN (two weave closes without a registry write — the OWNER contract below, violated twice more, discharged by that write), R-044 → ENCODED-UNTESTED (send path). The validator counts main-table rows only (44); section-appended families are not yet counted — fold them into the main table or teach the validator (owed). [retro 2026-08-24-monthly.md]

**The contract (binding on every weave run):**

1. **The weave cites registry IDs, not per-run E-numbers.** Per-run E-numbers stay
   what they are — discharge-table keys local to one run (§4c (verification-and-discharge.md)). Any finding,
   ledger row, or weave-doc claim about a *known rule family* carries its `R-###`.
   New families get a new appended row (IDs never reused). The alias map in
   `$ORCHESTRATOR_ROOT/weave-records/registry/RULES.md` resolves historical E-number usage.
2. **Re-score writes state transitions.** The §re-score stage (§4a (verification-and-discharge.md), the prior-run
   audit) re-verifies every registry row touched by the window and records
   transitions in the row — dated, cited, append-style. Never delete history.
3. **Recurrence reopens — mechanically.** Any recurrence of a HELD / RETIRED /
   ENCODED-UNTESTED family flips it to BROKEN-OPEN with the break event appended.
   No judgment call, no "probably fine."
4. **Two clean weaves retire.** A family retires only on 2 consecutive clean
   weaves with its enforcement substrate live — the R-006 (E35 pane-churn / T08)
   precedent, the corpus's one formal evidence-based retirement.
5. **Supersession requires a cited raw `type:user` turn.** An operator reversal
   without a citable raw turn is SUPERSEDED-UNRESOLVED and MUST be surfaced to
   Etan (standing example: R-010 squash-ban, still SUPERSEDED-UNRESOLVED pending a
   BrainLayer-traceability gate). Latest raw operator turn wins (the 05-29
   prototype arbitration rule, A4 §c.3).

**OWNER (the adversary's named-owner amendment):** the **weave seat** owns the
registry at each run close — **a run whose window contains a break/encoding/
retirement of a registered family and does NOT touch this file has failed §7.**
This is not aspirational: the gen-18 (06-21) and 07-02 weaves both **CLAIMED
re-scores but wrote NOTHING** to the registry — v1.1 stayed frozen across two
claimed re-scores, an OWNER-contract violation recorded twice-silently on R-034
and closed only by the weave-07-10 write. **The registry write is a required
loop-closing exit step, not deferrable.** [g4:11 → RULES.md:161-163,193-194,208;
g1:57,92 → 2026-07-10.md:3; meta:46]
**Between weaves, the orc boot-gate ACKs the BROKEN-OPEN rows** item-by-item
(extends §4d (verification-and-discharge.md)'s ACK) and surfaces SUPERSEDED-UNRESOLVED rows. "A registry nobody
updates is carrier decay with better formatting" (B-ADV Fix-7).

Validate after any edit: `bash registry/validate-registry.sh
$ORCHESTRATOR_ROOT/weave-records/registry/RULES.md` (asserts: zero
per-run E-number row keys; E09 resolves to ONE stable ID; the R-006 retire path;
valid states; the supersession contract).

Fleet standing contracts are ambient (CLAUDE.md) — this skill states only weave-specific law.

## Files

| Path | Role |
|---|---|
| `$ORCHESTRATOR_ROOT/weave-records/registry/RULES.md` | The durable rule registry (PRIVATE records repo — retros + registry contain operator comms): stable `R-###` IDs, lifecycle states, born/encodings/breaks per family (§7); **v1.6, 49 family rows** [retro 2026-08-24-monthly.md] |
| `$ORCHESTRATOR_ROOT/weave-records/retros/<date>.md` | Per-run retros (PRIVATE records repo); `retros/README.md` here is the tombstone pointer |
| `registry/validate-registry.sh` | Re-runnable registry assertions — run `bash registry/validate-registry.sh $ORCHESTRATOR_ROOT/weave-records/registry/RULES.md` after every registry edit |
| `scripts/convergence-gate.sh` | The 4-condition gate + RAM check; arms "weave", bypassed by "weave now" |
| `scripts/weave-run.py` | Reproducible orchestrator: `discover` → `prepare` → `batches` → `aggregate` |
| `scripts/prepare-mine-context.py` | Compact per-session context (digest + grep excerpts with `jsonl_line=N`) for one miner; Claude + Codex formats |
| `scripts/validate-dispatch-brief.py` | Pre-send validation for §EDITS worker briefs (schema + required sections) |
| `scripts/weave-ledger.py` | Action-ledger + conversion-to-change + routing-contract enforcement (flags: `--findings-dir`/`--out-dir`/`--title`, [g1:84]) |
| `scripts/corrections-rate.py` | Per-model corrections per 100 user messages, with six-bucket breakdown and low-confidence floor (§4i (verification-and-discharge.md)) |
| `scripts/correction-sweep.py` | Fix-10 correction-propagation sweep: §1 (run-lifecycle.md) strikes grepped across all carriers; patched/not-patched table; REPORT-only, exit≠0 on RAW survivors |
| `references/topology.md` | flat-N vs staged, batch size, centerpieces-first, the round structure (see §2a (run-lifecycle.md)/§2b (run-lifecycle.md) for the flat-frontier + phase-recursion laws) |
| `EVAL.md` | Backtest baseline, flat-vs-staged eval, the conversion metric, smoke checks |
| `evals/fixtures/findings-{clean,violations}/` | Committed smoke fixtures: clean → `--strict` exit 0; violations → exit 2 |
| `evals/fixtures/correction-sweep/` | Committed RED/GREEN fixture: mini CORRECTIONS + tree-red (1 unpatched copy → exit 1) + tree-green (all struck → exit 0) |
| `evals/fixtures/corrections-rate/` | Committed exact-output fixture plus unknown-bucket and denominator hard-failure cases |

## Wiring (Etan's "right places")

- Invoked by the orchestrator at sprint close (the `/orc` convergence step).
- The ledger output feeds the next sprint's backlog / the gen-N large-plan.
- The mining engine is `/skill-creator` (`session-miner` + `session-miner.py`);
  `/weave` is the orchestrator wrapper that arms it, gates it on convergence, and
  routes its findings through the action-ledger. (`batch-session-miners` was
  folded into `/skill-creator` — single source of truth for mining; `/weave` is
  the only batch-mining *orchestrator* skill.)

## Integration with other skills

- `/skill-creator` — the mining engine (`mine-session`, `session-miner` sub-agent, the parser).
- `/large-plan` — weave intent briefs feed domain lead-authored large-plans; track intents come from findings.
- `/never-fabricate` — every finding cites verbatim evidence; no invented ledger rows.
- `/pr-loop` — converting a `SKILL-EDIT`/`PR-FIX` finding to `MERGED-PR` goes through it.
- `/orc` — convergence detection + dispatch of miners; surfaces the ledger to Etan.
