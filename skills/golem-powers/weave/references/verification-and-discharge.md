# Verification, ledger, correction, and discharge

Read this after mining, when aggregating the ledger, re-scoring prior work, fact-checking claims, propagating corrections, discharging edits, or calculating correction rates.

## 4. The action-ledger + conversion-to-change

`scripts/weave-ledger.py` aggregates all findings into `ACTION-LEDGER.md` +
`ledger.json` and computes the metric that decides if the weave was worth it.
**Two denominators are reported — both, always:**

- **conversion-to-change (spec §4, the headline) = converged ÷ TOTAL findings.**
  This is the anti-waste number from the original spec ("0% conversion is
  token-waste, full stop") — it keeps `KEEP` confirmations in the denominator so
  the ratio can't be flattered by reclassifying findings as "not actionable."
- **conversion-to-change (refined) = converged ÷ ACTIONABLE**, where actionable =
  converged + open (`DEEP-RESEARCH`,`FOLLOW-UP`) + dropped (`REJECTED`,`PARKED`,
  `DUPLICATE`); `KEEP` is excluded because you can't "convert" a validated
  what-worked. The refined number is informative, but the **strict ÷-total number
  is the one that governs the SHIP/RETIRE decision** (see `EVAL.md`).
  (converged = `MERGED-PR`+`PR-FILED`+`PR-FIX`+`SKILL-NEW`+`SKILL-EDIT`.)
- **token cost per acted-on finding** = weave tokens ÷ converged (`--tokens N`).
  Report **tok/converted WITH the verification machinery in the denominator** —
  red-team + re-score + boss cost is part of the weave, not free. [g1:101 → 2026-06-06-evening.md:56]
- **Routing is mandatory.** `--strict` exits non-zero if any finding has an
  unknown disposition or is DROPPED without a reason. **Route EVERY finding.**
- **Tracks are mined from ledger dispositions ONLY — "not invented."** The forward
  large-plan's tracks come from real findings, never from a fixed template. [g1:89
  → gen17.md:43; gen17-wide:50; 2026-06-21.md:39]

A weave with 0% conversion is token-burn — the ledger surfaces that instead of
letting "we produced N nice docs" pass for progress.

### 4a. Re-score of the prior run — a PERMANENT stage (the number that can't be gamed)

Every weave re-scores the **prior** run: **proposed-converged ÷ actually-landed**,
`gh`/git verified. This is "the only number that can't be gamed" — the spine
finding was that weaves AUDIT/PROPOSE but don't LAND (true conversion ~9%, not the
claimed 34%). Prefer **LIVE REPRODUCTION** (pipe real payloads into the installed
hooks/gates) over transcript archaeology — it found a "wrong-emitter" defect in one
pass. The re-score writes registry state transitions (§7 (continuity-and-registry.md)). [g1:15-16,76 →
2026-05-31.md:20-23,108; 2026-06-06-evening.md:15-18,43-44]

## 4b. Red-team fact-check — MANDATORY closing stage (anti-hallucination guard)

**After synthesis, before ANY finding is trusted or acted on**, a red-team
workflow verifies **every load-bearing fact** in the ledger + synthesis against
the **raw JSONLs**. This is non-negotiable — it is the anti-hallucination guard
for the L0 memory problem: a wrong fact that reaches the plan or `brain_store`
poisons every downstream decision. (Proven valuable: the 2026-05-29 weave's
red-team caught a **wrong WhatsApp number for Etan** plus several other wrong
facts; the 2026-07-10 run's **13-way adversarial red-team overturned 6 solo-
verifier verdicts in both directions**.) [g1:57 → 2026-07-10.md:6; meta:52]

Structure it as **Red / Blue / Red, looping until a round yields nothing new**
(not a single pass). [g1:69 → 2026-05-30.md:82; 2026-06-01.md:38]

**Anchor on the highest-trust ground truth — what the OPERATOR said and did:**
1. **"What Etan SAID"** — every verbatim Etan quote / correction in the window.
   Re-grep the cited JSONL line; confirm the quote is **verbatim** (not
   paraphrased) and the **number / name / path / PR# is exactly right**.
   Cite raw `type:user` turns only. Do not cite relays, `queue-operation`,
   `last-prompt`, `task-notification`, worker summaries, or assistant
   `brain_store` paraphrases as Etan evidence. If the quote appears in both a
   relay and a raw user turn, cite the raw user turn. If no raw user turn exists,
   mark the claim as relay-only and do not treat it as verified operator speech.
2. **"What Etan FIXED"** — his decisions/corrections this window. Confirm the
   finding's claim about what was decided matches what the JSONL actually shows.
3. Then sweep the high-importance (≥8) findings: every cited `[line N]` must
   resolve to the quoted text; every attribution (who did what, which repo, which
   PR) must hold. **Widen sampling below the top-60** — the tail is where
   re-violations hide. [g1:54 → 2026-06-21.md:45]

**Standing verification laws (all enforced at this stage):**
- **Split compound claims before verification** — 0 claims were wholly refuted in
  one run yet **9 sub-claims were wrong** because they were verified as a bundle.
  [g1:71 → 2026-06-07.md:23]
- **Critic-as-gate + tagged-amendment protocol** (strike, never silently edit)
  runs a completeness pass **BEFORE Red-1** (a 22-gap pass caught an unmined
  succession). [g1:72-73 → 2026-06-07.md:9,21; 2026-06-06-evening.md:51-52]
- **Fabrication-auditor / B1 lens audits the weave's OWN artifacts** (brief,
  synthesis, re-score, empirics) — a permanent blue lens. [g1:73 →
  2026-06-06-evening.md:20-21,45; 2026-06-07.md:27]
- **Live-DB empiricist blue lens** — check `typeof(created_at)` etc. against
  sqlite/MCP directly, not just transcripts (a NULL-`created_at` was found via
  sqlite, invisible in a windowed query). [g1:74 → 2026-06-06.md:41-42]
- **Stamps come from `date`. Always.** Head-math timestamps were the systematic
  fabrication class. [g1:79 → 2026-06-07.md:22]

**Mechanism (a fan-out workflow):** one verifier per batch of claims, each
re-greps the raw JSONL and returns `{claim, verbatim_match, correct_attribution,
corrected_value, verdict}`. Any claim that fails is **corrected in place or
dropped with a reason** in the ledger before the plan/retro/`brain_store` are
trusted. **A claim only counts once it survives re-verify after re-mine; a
reverify that still fails is CONFIRMED-FAILED** (bounded — no infinite loop).
Default to skeptical. [g4:6 → weave-2026-07-02-report.md §R2.8]

> A weave's findings are only as trustworthy as this stage makes them. No weave
> output is "done" until the red-team fact-check has run and its corrections are
> folded back into the ledger.

### Correction-propagation sweep — runs after CORRECTIONS compiles (Fix-10)

A strike that doesn't reach ALL copies is laundering with a delay: the
2026-06-07 run struck its confessed-invented "47 sessions staged" at the
origin, a verbatim copy survived in the retirement dump, and the successor
generation's boot read the laundered count (specimen S31 / B1-F7). The
2026-05-29 prototype red-team did this sweep by hand once (the
APPLY-everywhere table) and it was never encoded — this encodes it.

**As soon as the run's CORRECTIONS doc is compiled, run the sweep:**

```bash
python3 skills/golem-powers/weave/scripts/correction-sweep.py \
  <run-dir>/CORRECTIONS.md <orchestrator-root> [<other-root>...]
```

For every §1 (run-lifecycle.md) strike row it extracts the struck literal strings, greps them
exactly across the target trees — weave doc, S-docs, collab, findings, boot
prompts, plans, dashboards — and emits a patched/not-patched table
(`file [line] | struck-string | ANNOTATED-or-RAW`), exiting non-zero while
any un-annotated copy survives. It is REPORT-only: it never edits. Strikes
stay human-applied — strikethrough + pointer, never a silent edit.

**Gate: RAW (not-patched) rows reach ZERO — or each carries an explicit defer
note in the weave doc — before §4c closes.** A surviving raw copy is exactly
the carrier the next generation boots on.

**Scope limit, stated honestly (B-adversary Fix-10 ruling):** the sweep
catches LITERAL-COPY laundering only. Derived-number laundering ("~14 merges"
→ 22 → 42, or a struck count re-worded into a new sentence) escapes
exact-literal grep by construction; the sweep surfaces such rows as
NO-LITERAL for manual review but cannot clear them. The derived half is
closed by the **canonical-source rule: every load-bearing number cites its
source artifact** (ledger.json, a gh command, a pinned grep method) — a
figure with no source cite is challengeable on sight even when no grep can
find it.

## 4c. §EDITS APPLICATION — MANDATORY final phase (capture ≠ convergence)

> **A weave that only captures is a diary, not convergence.**

After the red-team pass, the run is NOT complete until **every SKILL-EDIT or
SKILL-NEW item** in the weave doc's skill-candidates/edits section (the §3 (run-lifecycle.md)-style
"SKILL CANDIDATES / EDITS" list) is in exactly one of three discharge states:

| State | Required proof |
|---|---|
| **APPLIED** | PR link recorded next to the item (merged or open via `/pr-loop`) |
| **DISPATCHED** | Named owner + collab/inbox link where the owner acknowledged the item |
| **TRACKED** | Ledger row with `confidence` + `evidence_count`, plus the exact evidence references that future weaves can re-check |

No fourth state. "Captured for later" is the failure mode this phase exists to kill:
the gen-10 weave captured 9 behavioral fixes that were never applied — gen-11 then
re-violated them and Etan received the SAME lead-topology correction again
(2026-06-05). The weave doc + retro MUST include the discharge table (item →
state → proof). Do not count TRACKED as APPLIED in conversion-to-change; the
point is to prevent loss without pretending every suggestion became a code or
skill change.

> **"Build the gate, don't write the prose" (gen-18 core doctrine).** The only
> rule-families that held were the ones with a **replayable RED fixture**; 13
> chronic families recurred AGAIN because every prior fix was prose, not a
> replayable RED/GREEN gate. When you discharge a recurring rule, prefer
> converting it into a RED/GREEN fixture (the eval-first lens) over writing more
> prose. [g1:53,91 → 2026-06-21.md:6,33,40,48]

**TRACKED satisfies §4c** when the doctrine says to observe before editing. Etan's
raw `type:user` doctrine, typo preserved: "we can use pheonix to track it or the
ledger... suggestions are possible, not always taken as necessary"
(`orchestrator ce4072bf:[4960]`). Use TRACKED for skill-behavior suggestions
that need evidence across sessions or divergent agents; promote TRACKED -> APPLIED
only when the evidence matures into a multi-instance or unambiguous failure.

The orchestrator running the weave owns this phase. If an item's owner is another
LEAD, DISPATCHED requires the dispatch to have actually landed (collab ack or
monitor loop armed) — not a parking-lot note (orc C7: dispatch now, not later).

## 4d. FULL-RELAY standard — the successor reads EVERYTHING

> Etan (2026-06-05, verbatim): "Everything should be moved from the weaving from the
> previous session to the new session, not just the top things. Everything should be
> relayed so we get a very good next orc."

The successor orc's boot MUST require:
1. **Reading the ENTIRE weave doc** — not a curated highlights subset.
2. **A `brain_search` tag sweep of ALL stored corrections** from the closing session
   (orc-correction + frustration-capture stores), read in full.
3. **Item-by-item ACK** on (a) the §EDITS application table, (b) the corrections
   list, and (c) **every BROKEN-OPEN registry row** (§7 (continuity-and-registry.md)) — the successor states
   each item and its current state in its own words. [g1:99 → 2026-06-21.md:47-48]

Boot docs may summarize for orientation, but the summary MUST link the full weave
doc and MANDATE the full read + ACK, and be dispatched as a **one-line pointer**
(payload on disk, §2 (run-lifecycle.md) pointer-brief law). A boot doc that relays only "the top
things" is a relay failure — the dropped tail is exactly where re-violations come
from.

## 4e. Stale-at-write guards — facts go stale between audit and doc-write

Two self-defects across consecutive runs, same class: a number or state that was
true when audited but false when written (5 of 17 claims stale-at-write in one
re-score). Rules, all enforced at the moment a doc is WRITTEN:

1. **Re-poll every terminal-state claim at doc-write (rule E05).** Any "MERGED" /
   "OPEN" / "CI green" line in a ledger, retro, dashboard, or status board gets a
   fresh `gh pr view` at the moment the doc is written — not at audit time. Never
   relabel an earlier audit snapshot as "snapshot at doc-write". Session-scoped
   truths get gh-re-verified before a successor acts on them. [g1:78 →
   2026-06-06-evening.md:32-33; 2026-06-07.md:24,37]
2. **Day-counts close with the UTC day.** Publish a day-total (merges, PRs,
   sessions) only after the UTC day closes — or carry an explicit
   "as of HH:MMZ" label. A "22 merges" day-total snapshot-true at ~22:18 was
   42 by actual close.
3. **Status-board lines are OUTPUTS, not plans (specimen #0).** Never write a
   checked box, a DONE line, or a result number before the step actually ran.
   The weave seat itself wrote "DONE 18:04 / 47 sessions" from the plan, not
   the output — struck in place. If the weave seat does this under no pressure
   at all, every status line needs the output in hand before the line exists.
4. **Write-verification — every endgame/plan/dashboard write gets a same-turn
   read-back or curl-200 (2026-07-10 D9).** The dashboard post-Write sync gate
   (curl-200, verify CONTENT not status) must run **pre-publish**; a plan/registry
   write gets an immediate mtime/read-back. A write you didn't read back is a
   write you can't cite. [g1:97 → 2026-07-10.md:37; meta:29,48,28]

### 4f. Final-boss exit gate — one apex agent ends the loop (2026-07-10)

> **DESIGN SPEC — harness implementation pending (ships with the substrate-law + phase-recursion + final-boss bundle).**

The design requires the phase-recursion loop to exit only through **one apex agent** (Fable) returning
`FINISH` or `{phases-to-re-run}`. **No workflow self-declares done.** This was
"the single highest-leverage protocol addition… the ONLY mechanism that caught a
completeness defect by refusing to finish, which no eval assertion can express."
[g1:57 → 2026-07-10.md:9; meta:42,50-54; g3:82-89 → tree-wf-review-priorart.md:46]

**The boss diffs predicted-vs-actual against the retro ledger.** Its job is not
only internal grounding — it cross-checks the assembled run against the
**prior-art failure table**: *does this run reproduce a known-paid-for failure
mode?* The gap between what a shape *predicted it would do* and what identical
prior shapes *actually did* is the highest-value pre-launch/pre-finish signal.
[g3:86-89 → tree-wf-review-priorart.md:60-70]

### 4g. Canonical weave shape — the demand-driven agenda (2026-07-02 §R2.8)

The whole run is **ONE self-expanding, demand-driven agenda** — rounds create
rounds (unverified → red-team, gaps → re-gather, hotspots → deep-read, failures →
re-mine); **synthesis is pinned last**; the run **resumes the same run on crash**
(never restarts). Every round is a **~3-agent collaborating panel** with diverse
lenses + intra-round cross-check — majority decides, a single-lens dissent demands
a follow-up round; **never 1/1 micro-rounds**. **Every spawn is model-pinned**
(gather = cursor/codex off-Claude or sonnet/haiku; judgment/synthesis = opus) —
the unpinned-inherits-Fable bug is what capped pass-1. The loop is **budget-aware
loop-until-dry** — the mechanized answer to Etan's "1 haiku, no verifiers"
critique. [g4:3-8 → weave-2026-07-02-report.md:57-58 §R2.8; report.md:11]

## 4h. Per-failure CAUSE ATTRIBUTION — route the fix to the layer that made it possible (Etan, 2026-08-05; corrected framing via orc)

The weave already mines what went wrong. The step that was missing: **for every failure finding,
attribute WHICH LAYER made it possible, and route the fix there** —

- **(a) code** — the behavior was possible because nothing in the software prevented it
  (e.g. no pr-queue gate existed; brain_digest truncated silently)
- **(b) instruction files** — global/repo CLAUDE.md, AGENTS.md, canon prose enabled or failed to
  prevent it (e.g. the fabricated "review-required, wait for a human" stop; 16 dead CLAUDE.md
  symlinks silently loading nothing)
- **(c) tool description** — the rule was contradicted or hidden at the point of use
  (e.g. `server.ts:9212` asserting effort default `xhigh` while the launcher defaults `high` —
  agents "misbehaving" were OBEYING the description; `server.ts:6969`'s documented-but-unread
  `@word` hazard — a (c) of PLACEMENT: move the warning into the refusal path, not the prose)

Miner contract addition: failure findings carry **`cause_layer: "code" | "instructions" |
"tool-description"`** (+ optional `cause_note`), and the ledger's disposition routes to that
layer: (a) → a fix lane with a regression gate; (b) → the instruction-file's grill/edit queue;
(c) → a tool-description fix lane, generalising cmuxlayer #359's validate-at-call guard shape
where the assertion is enforceable. Verifiers treat a wrong `cause_layer` as a claim failure like
any other — attribution is evidence-cited (`file:line`+commit on both the behavior and the layer),
never vibes.

**Supporting technique for detecting (c):** mechanically extract testable assertions from
fleet-owned MCP tool descriptions (defaults, caps, flags, paths) and diff against source/launcher
ground truth; every mismatch is a (c)-finding even before an agent trips it.

Why attribution and not just discovery: the same symptom at different layers takes opposite fixes
— a recurring correction that is really a (c) needs one description edit, not another CLAUDE.md
line; a (b) that is really an (a) needs a gate, not a grill. Mis-routing is how six months of
re-explanation happened.

## 4i. Corrections rate — per-model, bucketed (the comparable number)

The comparable metric is **corrections per 100 user messages, per model**:
`correction_count × 100 ÷ user_messages`. Raw correction counts cannot compare model/harness
combinations observed over different numbers of user turns. The denominator is the sum of actual
user messages across every mined session for that model in the measurement window, including
sessions with zero corrections; it comes from the §3 (run-lifecycle.md) denominator sidecars, never an estimate.

Each correction uses exactly one bucket:

- **`wrong-impl`** — the implementation or answer is functionally wrong for the requested result.
- **`taste`** — the result works, but violates an expressed user preference or repository taste.
- **`process`** — a required workflow, gate, order of operations, or handoff was not followed.
- **`misread`** — the request, context, constraint, or cited evidence was misunderstood.
- **`tool-misuse`** — the wrong tool/command/flag was used, or the right tool was used incorrectly.
- **`overbuild`** — scope or complexity was added beyond what the request required.

The bucket and §4h `cause_layer` are orthogonal: the bucket says **what the correction was about**;
`cause_layer` says **which layer made it possible**. Do not collapse them. For example, a
`tool-misuse` correction can still have cause `(c) tool-description` when the point-of-use contract
misled the agent.

`scripts/corrections-rate.py` reads schema-pure correction JSONL plus a separate JSON object mapping
model names to positive-integer user-message counts. Before invocation, the aggregating
agent/operator materializes those inputs as follows; the current `weave-run.py aggregate` command
does **not yet automate this compilation**:

1. Read every `<WD>/findings/<label>.jsonl`, keep only `type:"correction"` rows, require the
   §3 (run-lifecycle.md) correction fields, scrub the known non-JSON miner footer leakage, and write the resulting
   schema-pure rows to `<WD>/corrections.jsonl`. Count every correction record; unlike the action
   ledger, the rate numerator is not title-deduped because repeated user corrections are repeated
   failures.
2. Read every `<label>.denominator.json`; require `user_messages` to be the exact value copied from
   that session's prepared context header (never recounted or estimated), key by stable `session`,
   collapse byte-equivalent re-mine duplicates, and hard-fail if duplicate session IDs disagree on
   `model` or `user_messages`. Sum the deduplicated positive-integer counts by model and write
   `<WD>/correction-denominators.json`.

The script emits deterministic JSON with models sorted, all six buckets present, raw count and
denominator beside each per-100 rate, and rates rounded to one decimal for display only. Unknown
buckets, missing model denominators, and zero denominators are hard errors (exit 2). A model with
fewer than **50 user messages** is marked `low-confidence`; its computed rate is emitted for
inspection but must not be presented as comparable to adequately sampled models.

```bash
python3 scripts/corrections-rate.py "$WD/corrections.jsonl" \
  --denominators "$WD/correction-denominators.json"
```
