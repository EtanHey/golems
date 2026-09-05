# Fact Propagation — orc Workflow

> **When this fires:** orc receives a user message containing an objective fact (date, PR number, merge SHA, version, cited correction), OR a tool event lands an objective fact (e.g., `gh pr merge` success). The workflow MUST run **before** the next dispatch boundary — not at end-of-turn, not on next monitor-tick.
>
> **Why this exists:** Wed-May-27 propagation gap. orc-may21 [3589] received `"I'm presenting Wednesday not Sunday"`, relayed it as a parenthetical inside another request to brainlayerClaude, then dispatched 7h of Codex workers carrying stale `"Sunday May 24"` DESIGN.md content. coachClaude didn't absorb the correction until ~67h later, after Etan re-stated it on 4 separate attempts. RT1-corrected evidence: **6 corroborating digests directly cite event [3589], severity 10.** The fix is structural: objective facts auto-relay to all owning agents — independent of conversational ACK to the user, and independent of any same-turn scope-restriction that applies to a *different* subjective decision. See rollup at `$ORCHESTRATOR_ROOT/docs.local/handoffs/2026-05-25-72h-mine/_rollup.md` for the full chronology.

---

## CORE DISTINCTION (read this once, never re-derive mid-turn)

> **Objective facts and subjective decisions propagate differently. Conflating them caused the 67-hour gap.**

### Objective facts (MUST relay to all owning agents)
- Dates and deadlines (`"Wed-May-27"`, `"sprint cuts Thursday"`)
- PR numbers, merge SHAs, branch names
- Released versions (`"v0.14.0 shipped"`)
- Cited fact-corrections from the user (`"it's not Nitai, it's Sagit"`)
- Stable preferences once stated (`"less visuals in coach output"` — flagged 9 times before propagating)
- Sprint-level objective facts (`"this sprint's p95 latency target is 200ms"` — propagates to all sprint agents per mandate decision Q3)

### Subjective decisions (relay ONLY to immediately-affected agents)
- Scope choices (`"do we ship X this sprint?"`)
- Tone / style preferences (`"be more terse"`)
- Routing choices (`"Codex on this one, not Claude"`)
- Sprint direction (`"focus on cmuxlayer, defer brainlayer"`)

**The conflation rule:** when the user issues BOTH an objective fact AND a subjective decision in the same turn, NEVER assume that scope-restricting one (e.g., `"don't ping coach"`) restricts the other (the date fact). Treat them as independent. See Step 5 + Conflation Traps below.

---

## THE WORKFLOW (5 steps)

### Step 1 — Detect the fact class

For each new piece of information arriving (user turn, tool result, monitor signal), classify:

```text
classify_fact(segment):
  if segment matches: date / deadline / "PR #" / SHA / "version v" / "merged" / "shipped"
    → "objective"
  if segment matches: scope / "don't ship" / "focus on" / tone / "more terse" / routing
    → "subjective"
  if segment is a user-correction of a prior agent claim
    → "objective"  # corrections of factual errors are always objective
  else
    → "ambiguous" → DEFAULT TO OBJECTIVE  # safer default; over-relay is recoverable
```

Run this per-segment, not per-turn. A single user message can contain multiple facts of different classes; classify each one independently.

### Step 2 — Identify owning agents

For each objective fact, build the owner set. An agent is an *owner* if its current task references or depends on that fact.

```text
find_owning_agents(fact):
  owners = ∅
  # Dates: coach owns when lecture-prep / calendar work is in scope
  if fact.kind == "date" and any_active_agent("coach"):
    owners.add("coach")
  # PR / SHA: repo-LEAD owns when the repo matches
  if fact.kind in ("PR_number", "SHA") and fact.repo == "brainlayer":
    owners.add("brainlayer-LEAD")
  # Codex workers: anyone whose DESIGN.md / mandate references the fact
  for codex_worker in active_codex_workers():
    if fact.value.appears_in(codex_worker.design_doc):
      owners.add(codex_worker.id)
  # Sprint-level facts: all agents in the active sprint
  if fact.tags includes "sprint-goal":
    owners ∪= active_sprint_agents()
  return owners
```

If the owner set is empty AND the fact is `ambiguous → objective` (default), do nothing for the owner-relay step — but DO still `brain_store` it (Step 3). The propagation gap risk is highest when owners exist and we miss them; the cost of brain_store-only when no owners exist is one BL chunk.

### Step 3 — Auto-relay (do NOT ask permission for objective facts)

For each `(objective_fact, owner)` pair:

1. **Send the fact to the owner** via `mcp__cmuxlayer__send_to({ agent_id: owner_agent_id, text: HEADS_UP_MESSAGE })` when the owner is a registered visible-pane agent — that is the default `mode:"agent"` path. `send_to({ mode: "surface", surface: owner_surface, text: HEADS_UP_MESSAGE })` is the lower-level escape hatch (consult `/cmux-agents` for surface-targeting hygiene).
2. **`brain_store` the fact** at `importance ≥ 8` with `tags = [objective-fact, fact-propagation, <fact-kind>, ...]`. If BrainLayer transport fails, fall back per `/brain-store-fallback` (SHIP-2). Eat your own dogfood — this workflow's facts must persist even when BL is down.
3. **Log the relay** in `$HOME/Gits/golems/docs.local/audits/fact-propagation/<YYYY-MM-DD>-relays.md` (one line per relay: time, fact, owner, transport status). If `docs.local/audits/fact-propagation/` does not exist, create it.

#### The HEADS-UP message format (verbatim)

```text
HEADS-UP (fact-propagation): <fact verbatim>
Source: <where this fact came from — user turn at [event-id], PR merge, etc.>
Owners notified: <comma-separated list of owning agents>
Action required: none — informational. Update your source-of-truth files when convenient.
```

The HEADS-UP framing matches the May 22 13:18 IDT direct-relay that worked on the 4th attempt → 1st landing. It is a **notification, not a directive**. Workers absorb without dropping the current task. The "Action required: none" line is load-bearing — it prevents the receiving agent from interpreting the relay as a new directive that would interrupt its current work.

**Do NOT** bundle two facts into one HEADS-UP. **Do NOT** embed the fact inside a different request (that is AP1, the parenthetical-relay trap). One fact per HEADS-UP.

### Step 4 — Verify landing

Within **5 minutes** of relay (or at the next monitor-tick, whichever is sooner), verify the owning agent absorbed the fact. Two canonical mechanisms:

- **(A) Monitor-tick `read_screen` check** (default, more robust): at the next scheduled monitor tick (≤5 min for active orc sessions), call `mcp__cmuxlayer__read_screen({ surface_id: owner_surface, lines: 50, scrollback: true })` and grep for the fact verbatim OR a paraphrase. A paraphrase counts as landing (e.g., relay says `"Wed-May-27"` → screen says `"Wednesday the 27th"` → ✅).
- **(B) `wait_for` pattern** (faster when available): if `wait_for` is available for the owner's surface and you can specify a `target_state` or `pattern`, prefer it with a 5-min `timeout_ms`. This is event-driven, not polling, so it composes with C5/S3 (`wait_for`-first monitoring).

Default to (A) for robustness — it does not require the owner agent to enter a specific state.

#### Verify outcomes

- **✅ Landed** (fact appears in owner screen / output): mark relay successful in the audit log. Done.
- **❌ Not landed after 5 min:** re-send the HEADS-UP a **second** time. Update the audit log row.
- **❌❌ Not landed after second 5-min check:** **escalate to Etan** (Step 4.5).

#### The 2-relay rule

After **2 failed relays**, STOP re-sending. The 2-relay rule prevents BOTH:

- The "1-relay assumption that worked" pattern (fact relayed once, never checked, worker was busy and dropped it — the May 21 [3599] parenthetical-class).
- The "spam-relay" pattern (10 HEADS-UPs back-to-back pollute worker context and train the worker to ignore them).

### Step 4.5 — Escalation channel

After 2 failed relays, emit an **inline ESCALATION line in orc's own pane** that the user sees on next check-in:

```text
ESCALATION: HEADS-UP <fact verbatim> not absorbed by <owner agent> after 2 relays at <t1>, <t2>. Manual nudge recommended.
```

This is **NOT** a Telegram ping, not a separate escalation file, not an out-of-band notification. It is one line in orc's own output that the next user check-in surfaces. The user reads it on the next round-trip and decides whether to intervene.

### Step 5 — Handle the conflation case

When the user issues a scope-restricting decision in the **same turn** as an objective fact:

1. The objective fact ALWAYS propagates per Steps 2–4.
2. The scope restriction applies ONLY to the subjective decision (e.g., content updates, tone, routing).
3. orc MUST explicitly acknowledge both in its response, **on separate lines**:

```text
ACK on objective fact: <fact verbatim> — relaying to <owner list>.
ACK on scope decision: <decision verbatim> — limiting scope of <subjective work> to <agents in-scope>.
```

**This is the structural fix for the May 21 [4509] conflation.** The orc that wrote `"Got it. Not pinging coachClaude. If Phase 4 ships fast enough, the lecture content updates with the live system anyway."` was conflating: it took `"don't ping coach"` (scope-restricting *content* updates) and silently dropped the date relay too. The two-line ACK above forces orc to declare both decisions out loud and ensures the objective fact still propagates regardless of the scope decision.

---

## WORKED EXAMPLES

### Example 1 — Date correction (the canonical case)

**User message at orc-may21 [3589]:**
> "I'm not presenting Sunday again. I'm presenting Wednesday."

**Classify:** OBJECTIVE (date correction; user-correction of prior agent claim).

**Owners:**
- `coachClaude` (active, lecture-prep in scope)
- Any Codex worker spawned with DESIGN.md referencing `"Sunday May 24"` (per-grep, 14 mentions across batch sessions).

**Relay:**
- To `coachClaude`:
  ```text
  HEADS-UP (fact-propagation): Presenting date is Wed 2026-05-27, NOT Sun 2026-05-24.
  Source: User turn at orc-may21 event [3589].
  Owners notified: coachClaude, codex-batch-may20-21-mid (3 workers).
  Action required: none — informational. Update lecture-prep artifacts when convenient.
  ```
- To each affected Codex worker:
  ```text
  HEADS-UP (fact-propagation): Your DESIGN.md contains stale "Sunday May 24" content. The correct date is Wed 2026-05-27.
  Source: User turn at orc-may21 event [3589].
  Owners notified: coachClaude, codex-batch-may20-21-mid (3 workers).
  Action required: none — informational. Update DESIGN.md the next time you edit it.
  ```

**Verify:** within 5 min, `read_screen` coachClaude pane and grep for `"Wed"`, `"Wednesday"`, `"05-27"`, `"May 27"`. Within next monitor-tick on Codex workers, check their DESIGN.md edits.

**brain_store:**
```text
brain_store(
  content: "[2026-05-21] Fact propagated: presenting date is Wed 2026-05-27 (NOT Sun 2026-05-24). Source: orc-may21 [3589]. Owners notified: coach, 3 codex-batch workers.",
  tags: ["objective-fact", "fact-propagation", "date", "techgym-lecture", "wed-may-27", "agent:orcClaude"],
  importance: 9,
  project: "orchestrator"
)
```

**If user ALSO says `"don't ping coach about content"` in the same turn** (the canonical conflation case):

```text
ACK on objective fact: presenting date is Wed 2026-05-27 — relaying to coach + 3 codex-batch workers.
ACK on scope decision: not pinging coach about lecture *content* updates — limiting to coach-self-driven updates only.
```

The date relay happens regardless of the content-scope decision. These are independent decisions.

### Example 2 — PR merge SHA (low-friction case, tool-detected)

**Source:** orc detects `gh pr merge` success for brainlayer PR #313, mergeCommit `7b5ceea2`.

**Classify:** OBJECTIVE (merge SHA).

**Owners:** `brainlayerClaude-LEAD` (active), any Codex worker referencing the pre-merge state.

**Relay:**
```text
HEADS-UP (fact-propagation): brainlayer PR #313 MERGED — mergeCommit 7b5ceea2 on main.
Source: gh pr merge success at <timestamp>.
Owners notified: brainlayer-LEAD, codex-bl-readpath-019e4ba2.
Action required: none — informational. Pull/rebase your worktree when convenient.
```

**brain_store:** `importance=8`, `tags=[objective-fact, fact-propagation, PR-merge, brainlayer, pr-313, agent:orcClaude]`.

### Example 3 — Subjective decision (no propagation)

**User message:** `"Let's defer brainlayer Phase 4 until after the lecture."`

**Classify:** SUBJECTIVE (scope decision).

**Action:** orc updates its own sprint plan. Notifies `brainlayer-LEAD` only (it's the immediately-affected agent). Does NOT propagate to other agents because Phase 4 doesn't appear in their dispatch — they have nothing to update.

**No HEADS-UP fires.** No brain_store at importance ≥8 for fact-propagation purposes (orc may still store the scope decision separately under its own routing tags).

### Example 4 — Ambiguous → default to objective

**User message:** `"Actually use Postgres not SQLite for the read path."`

**Classify:** AMBIGUOUS. It reads as both a technology decision (could be subjective scope) AND a concrete architectural fact (Postgres is the choice now).

**Default to OBJECTIVE.** Propagate to all repos/agents potentially affected: `brainlayer-LEAD`, any researcher who cited SQLite, any Codex worker whose mandate mentions SQLite paths.

**Trade-off:** worst-case is over-relay (slightly noisy worker context). Best-case is propagation closes a future divergence gap. Over-relay is recoverable; missed propagation is the F69 class we're closing. Bias toward over-relay.

---

## CONFLATION TRAPS — known patterns to avoid

| User says... | Trap | Correct read |
|---|---|---|
| "Don't ping coach" + (in same turn) "date changed to Wed" | Generalizing the scope to cover the date fact too | Don't ping coach about *content*; DO relay the date as an objective fact |
| "We're not doing Phase 4 this sprint" + (in same turn) "PR #320 merged" | Treating the merge as scoped-out | The merge is objective; the Phase 4 cancellation is the only scope change |
| "Skip the audit" + (in same turn) "researcher said Letta-on-FastAPI is wrong" | Treating the SOTA finding as auditable-only | The SOTA finding is an objective fact about a research output; relay to whoever cited Letta |
| "Less verbose with me" + (in same turn) "I just merged #299" | Treating the merge fact as part of the tone-feedback turn | Tone-restrict orc's voice; relay the merge fact normally |

The pattern across all four rows: a subjective decision in turn N is being **generalized** beyond its actual scope to silence an objective fact in the same turn. Step 5's two-line ACK forces orc to declare the boundaries explicitly.

---

## CONFLICT BETWEEN OBJECTIVE FACTS

If two objective facts contradict (e.g., session A: `"use Postgres"`, session B 3 days later: `"use SQLite again"`):

- **Latest fact wins.** The older fact is superseded.
- Mark the supersession via `brain_store` with a tag `[supersedes-fact:<old-chunk-id>]` on the new fact entry. (Note: `brain_supersede` MCP is currently a stub per CLAUDE.md BrainBar warnings — use the tag-based pattern until it is wired.)
- Re-propagate the new fact to all owners per Steps 2–4.
- The audit log line for the new relay should include `(supersedes <old-fact-summary>)` so the chain is greppable.

This handles `"latest fact wins"` per mandate decision Q4.

---

## ANTI-PATTERNS

### AP1 — Relaying as parenthetical
The May 21 [3599] relay buried the date inside a Drive-staging verification request to brainlayerClaude. Workers don't notice parentheticals; they parse the main task. Use the HEADS-UP format above; one fact per relay; never inside another request.

### AP2 — Conversational ACK substitutes for relay
The May 21 [3593] response was `"got it"` — to the user. It did NOT trigger relay to coach or workers. ACK to user is fine, but the relay MUST happen as a separate, explicit action. ACK ≠ relay.

### AP3 — Asking permission for objective fact relays
`"Should I tell coach about the date?"` is the wrong question. Objective facts auto-relay. Subjective decisions require permission. If you find yourself asking permission for an objective fact, you are conflating object/subjective.

### AP4 — Skipping the verify step
The May 21 relay never verified coach landed. coach didn't absorb until ~67h later. Step 4 (5-min verify + 2-relay max + escalate) closes this. Verify is not optional; "I sent it" is not landing.

### AP5 — Auto-relaying subjective decisions as if they were objective
Spamming workers with `"we changed scope"` updates pollutes their context and trains them to ignore HEADS-UPs. Only objective facts get auto-relay. Subjective decisions go to immediately-affected agents only.

### AP6 — Believing once is enough
The Wed-May-27 fact was stated by the user **once** at [3589]. orc's `"I told them in the next dispatch"` attempt failed. Plan for **three landing channels**:
1. `brain_store` at importance ≥8 (durable, searchable)
2. Owner-direct HEADS-UP relay (Step 3)
3. Owner-side source-of-truth file update (verified in Step 4)

If any one fails, the others backstop it.

---

## COMPOSITION

- **`/brain-store-fallback`** (SHIP-2, merged) — Step 3 brain_store calls use this for transport failure resilience. Objective facts at importance ≥8 must survive BL daemon flaps.
- **`/frustration-capture`** (SHIP-1, merged) — when the user expresses frustration about an un-relayed fact (the 9-time `"Sunday"` pattern before the May 21 correction), frustration-capture stores the verbatim correction at importance ≥9 AND triggers Step 1 of this workflow on the correction segment. Frustration-detected corrections are always classified OBJECTIVE.
- **`/session-handoff`** — handoff packets MUST include a `## Pending fact-relays` section listing any in-flight HEADS-UPs that haven't verified yet, so the next orc generation doesn't drop them.
- **`/agent-routing`** — when routing decisions reference an objective fact (`"Codex-3 is on PR #225"`), the PR # propagates per this workflow.
- **`/cmux-agents`** — the HEADS-UP delivery uses `mcp__cmuxlayer__send_to` (agent mode, or surface mode as the escape hatch) per the standard surface-targeting pattern. See `/cmux-agents` for surface-ref hygiene and registry drift recovery.
- **`/orc`** body — references this workflow in a "Fact Propagation (Objective vs Subjective Facts)" section near the dispatch-policy area. The body of the workflow is loaded only when this workflow is invoked (Tier-2 progressive disclosure).

---

## WHEN THIS WORKFLOW DOES NOT FIRE

- The fact is purely subjective (Example 3) — handle inline, no propagation.
- The owner set is empty AND the fact is non-ambiguous-subjective — still `brain_store` if importance ≥8 warrants, but skip the owner-relay step.
- The fact is already known-stored at importance ≥8 with the same value (no change). Don't double-store; check via `brain_search` if uncertain.
- You are NOT the dispatcher. Worker agents do not have multi-agent visibility — this workflow is orc-only by design (RT2 verdict). If a worker detects a stale fact in its own dispatch, it should flag back to orc rather than try to propagate.

---

## DONE STATE

A fact is fully propagated when:

1. ✅ `brain_store` succeeded at importance ≥8 (or fallback file written per `/brain-store-fallback`)
2. ✅ Every owner in the owner-set received the HEADS-UP
3. ✅ Step 4 verify passed within 5 min for each owner (OR escalation fired after 2 failed relays for any owner that didn't land)
4. ✅ Audit log line written at `$HOME/Gits/golems/docs.local/audits/fact-propagation/<date>-relays.md`

Any of (1)–(4) missing = not done. "I sent it" is not done.
