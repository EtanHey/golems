---
name: phoenix-human-view
description: "Phoenix human-eval UX: replay, IDs, filters, mark-wrong, mobile, attribution. Triggers: phoenix view, eval UI."
---

# phoenix-human-view — the human-eval UX contract

> Documentation-of-standard. This contract was extracted from **~25 live Etan
> corrections** during the gen-10 Phoenix sprint (gen-10 weave #15, imp10) and is
> ALREADY ENCODED in shipped code (status table below). Items 11–12 were added
> from a gen-13 raw Etan correction (gen-13 weave E10, 2026-06-07) and are NOT
> yet encoded — see the status table. Any new Phoenix/eval view MUST satisfy the
> contract; any review of one checks against it.

## The contract

A human-eval view is a **reading surface for a human**, not a database admin panel.

1. **Turn-by-turn scrollable REPLAY, not a scorecard.** The human reads the
   conversation as it happened — a CLI-transcript feel — and judges in place.
   Aggregate scores are secondary chrome, never the primary surface.
2. **Fewer, human-readable columns.** Show what a human reads (who said what,
   when, verdict). Everything else is detail-on-demand.
3. **IDs are hidden but copyable.** Session/trace/chunk IDs never occupy reading
   space — but one tap copies them (debugging needs the ID, reading never does).
4. **Thinking and tool churn collapse by default.** Consecutive thinking bundles
   under one collapsible "💭 Thinking" header, default COLLAPSED, global toggle.
   Auto-critic flags stay visible even when their turn is collapsed.
5. **Identity chips: repo + agent + model + role.** Every session/turn carries
   its identity as compact chips — who ran, where, on what model, in which role.
6. **Tool filters.** Filter sessions/turns by which tools were used.
7. **Tiny frozen starter dataset.** Human grading starts on a small FROZEN set
   (suite-versioned), not a firehose. Frozen = re-gradable = comparable.
8. **Mark-wrong-in-thread.** The human flags a wrong turn WHERE THEY READ IT —
   in the replay — not in a separate form.
9. **Mobile-first.** Etan grades from his phone at work. Every view ships
   working mobile layout, screenshot-verified on both (pr-loop Visual Self-QA
   Gate: clicked-into desktop + mobile shots before merge).
10. **Turn-type honesty.** Local-command artifacts (`<local-command-stdout>`,
    `<command-name>`, harness caveats) are ⚙️ COMMAND turns, never 🧑 USER turns
    — mislabeling poisons human judgment of "what the user said."
11. **Review unit = bite-sized judgeable cards.** Human GRADING is served as a
    small judgeable ask ("orchestrator said X, assistant used BrainLayer in way
    Y — what should have been done?") with expand-before/after for context.
    Each card is still a thread slice, so mark-wrong-in-thread (item 8) applies
    inside it. Full-transcript replay (item 1) is for READING — it is NOT the
    unit of judging. Etan, paraphrased: "I need byte-sized pieces of this — not
    1,000,000-token conversations that I can't read at all"
    (orchestrator__71a8e3f5#19).
12. **Relay attribution.** Agent relays and queued commands arrive as
    `type:user` and MUST NOT render as the human — "There's no user who types
    like this." Identity chips (item 5) and the turn-type taxonomy (item 10)
    must distinguish relay/queued-command turns from raw human turns
    (`promptSource:typed`) — never-fabricate R14 trust classes, applied to the
    view. Mislabeled relays poison human judgment exactly like item 10's
    command turns.

## Status — shipped vs pending (verified 2026-06-05)

Paths below are relative to `skills/golem-powers/skill-creator/` — the Phoenix
pipeline lives inside the skill-creator skill, not at repo root.

| Contract item | State | Where |
|---|---|---|
| JSONL→trace ingest (source-of-truth transcripts, not screen scrape) | ✅ #462 | `scripts/jsonl_to_phoenix_traces.py` |
| Mobile-first annotation view | ✅ #457 | `scripts/phoenix_mobile.py` + `static/phoenix-mobile/` |
| Auto-critic judge write-back + badges | ✅ #458/#459 | `scripts/phoenix_auto_critic.py` |
| Identity chips (repo/agent/model/role) | ✅ #460 | session cards (`scripts/phoenix_mobile.py`) |
| Tiny frozen starter dataset (suite-versioned) | ✅ #453-#455 | frozen cmux usage starter set |
| Capture v2 agent identity | ✅ #461 | `scripts/cmux_capture.py` |
| Project switcher (cmux ↔ coach, one server, `:6043` retires) | ⏳ PHX-LEAD | `phx-lead-gen2-kickoff.md` item 1 |
| Turn-type taxonomy (USER/ORCHESTRATOR/COMMAND/ASSISTANT/TOOL) | ⏳ PHX-LEAD | kickoff item 2 (fixes contract item 10) |
| Thinking-collapse (default collapsed, global toggle) | ⏳ PHX-LEAD | kickoff item 3 |
| Tool-usage filters | ⏳ PHX-LEAD | kickoff item 4 |
| Mobile-from-work persistence (`:6042`/`:6043` → launchd service) | ⏳ open loop | gen-10 weave open-loop #3 — the SAFE always-on (orc C12) |
| Bite-sized judgeable review units (contract item 11) | ⏳ open | gen-13 weave E10 — `:6042` view product fix rides bl's existing FOLLOW-UP |
| Relay-vs-human attribution in chips/taxonomy (contract item 12) | ⏳ open | gen-13 weave E10 — extends kickoff item 2's turn-type taxonomy |

Update this table when PHX items land — a stale ✅/⏳ here misleads every future
view PR.

## Hard rules for builders

- **Screenshot-gate every view PR**: clicked-into desktop + mobile shots → orc →
  Etan's 👍 before merge (HOLD final design sign-off for Etan — never autonomous).
- **Never log raw finding/chunk/personal text into datasets** (PII-by-log rule,
  eval-harness collab :286). Synthetic docs are QUARANTINED by `suite_version`.
- **/yash-upstream to Arize Phoenix is HOLD-for-Etan** — outward-facing.
- Apply `/ui-ux-pro-max`, `/interaction-design`, `/html-dashboard` for polish.

## Integration

| Skill | Relationship |
|---|---|
| `/pr-loop` | Visual Self-QA Gate enforces the screenshot-gate on every view PR |
| `/never-fabricate` | R7 receipts for the visual claims; R9 for dataset counts; R14 relay trust classes back contract item 12 |
| `/skill-creator` | Phoenix scripts live in its `scripts/`; eval datasets follow its RED/GREEN discipline |
| `/orc` | C12: launchd is the allowed always-on for mobile-from-work persistence |
