# Outputs and coordination

Read this when emitting track intents, the self-QA gate, grill carryover, collab identity claims, or persistent monitor contracts.

## 5. What the weave EMITS (it's the front of a snowball, not a report)

`/weave → intent briefs / track intents → domain leads author large-plans → orchestrator runs parallel tracks → ship → re-weave.`
The ledger is the compounding instrument across loops.

**Deliverable 2 is the highest-priority emit** (Etan emphatic 3×), even though
Deliverable 1 is the *terminal* artifact. If you can only land one, land the gate.

1. **Intent briefs / track intents that feed lead-authored large-plans (terminal artifact).**
   The weave **ORGANIZES INTENT; it never designs domain solutions.** It emits up
   to 5 parallel track intents, each **populated by mined findings** (from ledger
   dispositions ONLY, §4 (verification-and-discharge.md) — not invented). Big initial collab = **modularize/
   componentize first**, then 4–5 LEAD orchestrators (one per track). These are
   **example track intents only; leads own the design**:
   - **cmuxLayer** — fix deterministic pane placement (the recurring pain).
   - **BrainLayer** — engine/package split; BrainBar = its own package.
   - **VoiceLayer**.
   - **MCL (Meta-Comms Layer)** — its own *secure* repo, cmux-adjacent, **all AI
     reviewers enforced**; a deep-research candidate.
   - **MCP-layer**.
   Per the project-OS vision, each domain **LEAD** authors and owns that track's
   large-plan from the weave's intent brief; the weave does not author any plan.
   The lead-authored large-plans coordinate through **collab files** (+ Google
   Drive + BrainLayer + **MCL as a
   4th channel**), and the conductor is a **clickable drill-down** (track → that
   domain's lead-authored large-plan).
2. **The self-QA-before-handoff gate (HIGHEST priority).** Formalize the rule
   that closes the verify-gap: **ship = build → FUNCTIONAL self-QA against the
   fix-list → comparison artifact → THEN handoff.** "Generated" ≠ "verified";
   "merged" ≠ "converged into one verified build." Mechanical checks (PID running,
   commit-matches) are NOT a functional pass. Concretely: **gate merges on Codex
   computer-use** — actually click/screenshot/verify the UI (BrainBar / VoiceBar /
   dashboard) before merge. (Same family as `/never-fabricate` + the `/qa-video`
   method-attribution rule.)
   - **Use CODEX for the CU pass, not Claude.** Codex is strong at computer-use
     and **has driven the BrainBar menu-bar app before**; Claude CU is weak at it.
     So route visual/functional QA of menu-bar apps to Codex CU.
   - **Known gotcha (not a hard block):** a CU session can hit a "BrainBar (not
     installed) / 0 apps" grant dialog for the `LSUIElement` menu-bar app — that's
     a grant/focus state, not an impossibility. Fallbacks when it blocks direct
     CU: `screencapture` CLI + coordinate clicks, or an in-app PNG-export
     affordance (qa-video hotspot #13).

3. **GRILL-CARRYOVER — rulings already given, routed per repo (07-28 shuttle v2, "the highest-leverage deliverable per operator").**
   Working copy `<WD>/GRILL-CARRYOVER.md`; **committed copy at
   `$ORCHESTRATOR_ROOT/weave-records/grill-carryover/<date>.md`** (the private records repo — `<WD>`
   is gitignored scratch and does not count). It lists every operator ruling the corpus already
   contains, VERBATIM with its finding id and verification state (V1-PASS / ADJ-CONFIRMED /
   CORRECTED / relay-only / unverified), grouped by the repo/grill it pre-answers, plus a "governs
   every grill" section. Routing contract: the maintenance/grill lead reads it BEFORE asking Etan
   anything; **only entries marked VERIFIED (V1-PASS, ADJ-CONFIRMED, or CORRECTED with the
   corrected text) pre-answer a question** — relay-only or unverified entries stay eligible for
   clarification and are listed under a separate "ask, do not assume" heading (§4b (verification-and-discharge.md): a relay is
   never operator speech). Write it as soon as the first verified findings land — not at close —
   and update it at each checkpoint. Its absence from a run is a §5 defect.

> **North-star kill target: FALSE-GREEN** (gen-17). "PR merged but live system
> still broken." E2E gates must **assert LIVE behavior** — watcher ingesting,
> enrichment moving, dashboard URLs return **200 with the right CONTENT** (verify
> content, not status — the weave once dogfooded a live false-green: a 200 that
> was really a 404) — **not PR-merged alone**. This is the same axis as
> Deliverable 2. [g1:48,90 → gen17.md:26,93; gen17-wide:103; 2026-06-21.md:34]

## 5b. Name-claim protocol — collab channels (standing rule)

> Born: 2026-06-11 gen-16 night — 6 ephemeral worker identities in one night
> broke @-mentions and monitor targeting (voicebarClaude-builder/-pass2/
> dashboard-audio-agent/dashboard-v2-regen/graphify-pilot/-rollout).
> Etan (verbatim): "Agents need to claim names in colabs and use them to
> monitor and communicate with eachother, so its not flappy."

Every channel the weave coordinates through (§5 item 1: **collab files** +
Drive + BrainLayer + MCL) runs name-claims:

1. **CLAIM-ON-ENTRY.** A seat's first post in any collab channel begins with a
   grep-stable claim line:
   `> CLAIM name=<name> role=<lead|worker|weaver|orc> monitor=<task-id|none>`
   `monitor=none` is an explicit contract: "no delivery guarantee — nudge me."
2. **STABILITY.** The name is immutable for the channel's life; post headers
   are `### <claimed-name> (<ts>)`, byte-identical to the claim. Rename only
   via `> CLAIM name=<new> supersedes=<old>` (rare, loud).
3. **WORKERS INHERIT.** Workers are named `<lead-claim>-w<N>`, assigned at
   spawn by the lead, claimed by the lead on the worker's behalf. Never ad-hoc
   per-post identities.
4. **ADDRESSING.** @-mentions use claimed names ONLY; mentioning an unclaimed
   name is the mentioner's comms error. Channel monitors anchor on claimed
   names (`@<name>|### <name>`) — only safe because of 1–2.

Roster query: `grep '^> CLAIM' <channel-file>`.

> **Collab channels are append-only (2026-07-02 fleet standing contract).** Never
> Edit/Write-tool a live collab (rewrites flood tail monitors) — `cat >>` heredoc
> appends only; claim updates are new posts. Monitors run the **offset-watermark
> loop** (newest-header keyed), never `tail -f`. Worker COMPLETION watching =
> durable artifacts + registry polling, never session heartbeats. [g2:30]

## 5c. Monitor-on-arm law — the weaver/leads are NEVER idle-and-blind (Etan top priority)

> Born: 2026-06-14 — a lead finished its lane, posted "Back to silent 👋" with
> **no monitor armed**; dashboard work routed to it via collab was a **silent
> no-op**. Etan: *"leads and orchestrators should all have very, very good
> rules about monitors."*

The weaver coordinates through collab channels (§5 item 1) — so it lives and dies by the same monitor law it enforces on every lead it seeds:

1. **ARM AN INBOUND MONITOR AS FIRST ACTION.** Persistent native `Monitor` on the channel (`^### |BLOCKED|@<your-name>`, exclude own posts) BEFORE any mining/dispatch. Post your `> CLAIM … monitor=<task-id>` only with the real task id from that monitor. This is what makes the `monitor=<task-id>` field in §5b TRUE instead of aspirational.
2. **NEVER IDLE-AND-BLIND.** Lane/weave done → either pick up monitor-surfaced work or post `✅ DONE … standing by, monitor ARMED` and keep it running. A stopped/never-armed monitor on a "standing by" seat is THE failure.
3. **VERIFY ENGAGEMENT WHEN YOU ROUTE.** When the weave routes an action `@some-lead` (§4 (verification-and-discharge.md)/§5 conversion-to-change), confirm the lead actually engaged (`read_screen` / `list_agents({agent_ids:[id], detail:"full"})` shows it on the NEW task) — a route to a monitor-less lead is a dropped action, and dropped actions are exactly what the weave exists to prevent. Flag monitor-suspect leads in the action-ledger.
4. **SEED IT DOWNSTREAM.** Every lead-boot brief the weave emits (§5) MUST include "arm a persistent collab monitor as your FIRST action" as a gate, not a suggestion.

Canonical law + `Monitor` command pattern: `/cmux-agents` → "LEAD/ORCHESTRATOR MONITOR LAW"; orchestrator framing: `/orc` → "THE SECOND CARDINAL RULE".
