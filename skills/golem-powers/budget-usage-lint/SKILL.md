---
name: budget-usage-lint
description: "Non-blocking hook flagging conserve-Claude / weekly-budget / usage-percent / stay-thin / go-light framing. Triggers: budget lint, conserve Claude, stay thin, usage percent. NOT for real sourced cost reporting or context/token budget estimation."
---

# budget-usage-lint — full throttle is the standing rule

Hook-carried skill. The enforcing artifact is `hooks/budget-usage-lint.py`
(a **non-blocking** PostToolUse/Stop hook); this page is its contract.

## Scope

Full-throttle is the standing rule; there is NO real conservation premise. It runs as a PostToolUse/Stop hook over agent-facing output.

## The rule

**Full-throttle is the standing rule. There is NO real conservation premise.**

Any agent-facing output that frames work around *conserving Claude* / *staying
thin* / *going light* / *switching to a cheaper model "to save budget"* is
re-encoding a premise that was never real. This hook surfaces that framing so
it is corrected once, loudly — instead of silently re-litigated session after
session (R-032, the "most re-encoded family").

### Corrected provenance (pinned — do not lose this)

- The **"free Codex cap"** that triggered the original conserve push was
  **self-inflicted** (a config choice), not an external budget limit.
- The famous **"76% of the weekly budget"** quote was an **orc RELAY
  paraphrase, NOT a direct Etan turn.** It was treated for sessions as if Etan
  had ordered conservation; he did not. The relay manufactured a premise.

If a *real, sourced* limit ever exists, surface that — with its source. The
lint flags FRAMING, not factual cost reporting.

## How it fires

- **Input:** hook JSON on stdin (PostToolUse `tool_response`, or Stop
  `last_assistant_message` / content blocks).
- **Hit:** emits a non-blocking warning — `{"systemMessage": "..."}` on stdout
  plus a stderr note. **Exit code is ALWAYS 0.** It never blocks a tool call or
  a stop.
- **FAIL OPEN:** any error, malformed payload, or empty stdin → exit 0, no
  warning. Advisory only.

## RED — must FIRE (conserve-framing about Claude / token spend)

- `we're at 76% of the weekly budget, let's conserve Claude`
- `stay thin on tokens`
- `go light / conserve`
- `usage is high, switch to a cheaper model to save budget`

## GREEN — must NOT fire

- Normal full-throttle output, no conserve framing.
- **Factual + sourced cost reporting** — a verified invoice amount, a number
  with a source. Reporting a cost is fine; *framing work around conserving* is
  not. (`"the Anthropic invoice was $312.00 per the dashboard"` → no fire.)
- The word **"budget"** in planning/estimation contexts: **time budget**,
  **context budget**, **token budget estimation**, **performance budget** → no
  fire. Only CONSERVE-framing about Claude/token spend fires.
- "budget" + a number **without** conserve intent
  (`"we're at 76% of the weekly budget — plenty of headroom, full throttle"`)
  → no fire. The usage-% / weekly-budget path requires a paired conserve intent.

## Detection logic (why it avoids false positives)

The word "budget" alone never fires. Three tiers, each requiring a *conserve
verb*:

1. **Explicit phrases** — `conserve {Claude|tokens|usage|budget|spend}`,
   `let's/we should conserve`, `stay thin`, `go light (/conserve | on tokens)`.
2. **Usage-% / weekly-budget framing** — a `NN% of … budget/usage/quota` OR
   `weekly budget` OR `usage is high` reference **AND** a conserve intent
   (`conserve`, `save budget`, `dial it back`, `switch to a cheaper model`, …).
   Either alone is GREEN.
3. **Cheaper-model downgrade for cost** — `switch/move/drop to a cheaper model`
   **AND** a `save {budget|tokens|cost}` / `to conserve` frame.

**Self-exclusion:** the warning text necessarily quotes the phrases it detects
("76% of the weekly budget", "conserve framing"). Any text carrying the
`BUDGET-USAGE-LINT` sentinel is the lint talking about itself and is excluded
from scanning, so the hook never re-fires on its own echoed warning.

## How it wires (document — do NOT auto-register globally)

See `hooks/INSTALL.md`. Symlink the hook into `~/.claude/hooks/` and append a
`command` entry to **both** the `PostToolUse` (matcher `*`) and `Stop` hooks
arrays in `~/.claude/settings.json`. This registration is a **per-seat
decision** — the committed source lives in the repo; do not auto-wire it
fleet-wide without an owner's call.

## Tests

`hooks/tests/test_budget_usage_lint.py` (pytest) — RED fires, GREEN stays
quiet, fail-open holds:

```bash
python3 -m pytest skills/golem-powers/budget-usage-lint/hooks/tests/ -v
```
