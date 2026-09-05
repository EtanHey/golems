---
name: surface-sweep
description: "Sweep every surface a change touches before calling it done. Triggers: change done, frontend change, multi-client or multi-provider change, works on my path but may not elsewhere, adding a setting/command/keybinding/provider adapter, wire-contract change. NOT for single-file leaf fixes with no shared consumer, adapter, entry point, state transition, or user-facing surface."
---

# Surface Sweep

## Purpose

Prevent a change from working on the one path tested while remaining absent or
broken elsewhere. Before declaring a multi-surface change done, account for all
seven classes below. For every class, name the concrete sites checked or write
`N/A — <why this class does not exist or cannot be affected in this repo>`.
Silence is never an answer, and "all covered" is not a site inventory.

## The seven classes

| Surface class | What it means | Question that must be answered | Example defect caught |
|---|---|---|---|
| **Entry points** | Every route by which a user or automation reaches the feature: UI, command, keybinding, flag, tool, URL, or schedule. | Which settings screens, palettes, shortcuts, CLI flags, API/MCP tools, URLs, and scheduled jobs were checked? | A new mode works through its CLI flag, but the scheduled job still calls the old entry point. |
| **Clients** | Every consumer of the changed service, library, state, or protocol. | Which desktop, web, mobile, CLI, worker, extension, or external consumers were checked on their own path? | The desktop client sends a new field, but the CLI silently drops it. |
| **Providers** | Every backend or adapter behind the shared capability. | Which hosted, local, mock, legacy, and third-party adapters were checked, and which are truly out of scope? | One model adapter maps a new option while the local-provider adapter ignores it. |
| **Contracts** | Every schema, type, message, file format, or wire boundary crossed by the change, including both producer and consumer. | What contract changed or carried the value, and were both sides plus compatibility/default behavior checked? | An MCP server accepts the new property, but the published tool schema rejects clients that send it. |
| **Reverse states** | The off, undo, disconnect, remove, empty, cancel, and error transitions—not only the enabled happy path. | What returns the feature to its prior/empty state, and what happens on failure or partial completion? | Enabling a toggle works, but disabling it leaves the old value cached until restart. |
| **Connection modes** | The environments and lifecycle modes that can change routing or state: local/remote, online/offline, fresh/resumed, first-run/upgrade. | Which supported modes were exercised, or what repo evidence makes a mode inapplicable? | A fresh local session works, but a resumed remote session never receives the migrated setting. |
| **Docs** | Instructions and discoverability surfaces whose claims may now be stale: README, help, examples, descriptions, and agent instructions. | Which docs/help/tool descriptions were checked for lies, missing discovery, or an old default? | CLI help still documents the removed flag even though runtime behavior changed. |

## Required sweep ledger

1. Inspect the diff and inventory nearby entry-point registries, clients,
   adapters, contracts, negative transitions, runtime modes, and documentation.
2. Report all seven class labels. Under each, use one of these forms:
   - `Checked: <specific paths, symbols, commands, adapters, or states> — <result>`
   - `N/A — <repo-specific reason this class cannot be affected>`
3. Resolve every applicable site that is missing. If blocked, state the concrete
   blocker and stop: an explained but unchecked site still prevents done.

`N/A` is valid when it is reasoned. Examples: a library has no user entry point;
a local-only CLI has no connection modes; a change preserves a wire contract.
"Not relevant" without the repo fact that makes it irrelevant is invalid.

## Done and evidence

Fleet canon #4 defines done as user-visible. For a multi-surface change, that
includes availability and correct behavior across every applicable surface.
This ledger establishes coverage; it does not duplicate or replace
`false-green-gate`. At the Stop-hook position, after the candidate completion
claim is in the same-turn transcript and before that response leaves the seat,
run its packaged gate:

```bash
bun skills/golem-powers/false-green-gate/scripts/false-green-gate-cli.mjs path/to/transcript.jsonl
bun skills/golem-powers/false-green-gate/scripts/false-green-gate-cli.mjs - < path/to/transcript.jsonl
```

A live probe of one path cannot replace the sweep, and a complete sweep cannot
replace a required live probe.

## Fixture grading contract

A committed grader distinguishes the fixtures mechanically:

- All seven class headings must appear exactly once.
- Each class must contain either `Checked: <sites> — <result>` or
  `N/A — <repo-specific reason>` with the required fields non-empty.
- Scenario nouns are not scoring inputs: renaming products, providers,
  commands, or states cannot change the result, and mentioning one incidentally
  cannot turn an incomplete ledger green.

Semantic review still compares the named sites against the repository or
scenario inventory. Reject an omitted applicable sibling, a vague claim such
as "all clients covered," or an unsupported `N/A` even when the mechanical
grader passes.

Stated limit: this pair pins absent accounting versus a complete ledger. A
heading-complete but vague or fabricated ledger is still invalid under the
semantic inventory rule above, but that evasion shape is not separately pinned
by this fixture pair; add a new RED fixture if it recurs.

## Stop conditions

- Do not expand a single-file leaf fix into ceremony when no shared or
  user-facing surface can be affected.
- Do not treat passing unit/type/build checks as proof that every surface was
  reached.
- Do not accept one client, provider, entry point, or happy state as a sample
  for its siblings.
