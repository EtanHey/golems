# Instruction-File Standard

This document records Etan's ratified convention for repository instruction files. It does not create policy beyond the rulings listed here.

## Repository shape

### `AGENTS.md` is the shared body

Every repository has a normal, committed `AGENTS.md` containing the instructions shared across agent harnesses. Codex, Cursor, and Antigravity read this file natively.

Etan ratified this ruling with “Yes” on 2026-08-01 (R1).

### `CLAUDE.md` imports the shared body

When `CLAUDE.md` is present, its first nonblank line is exactly:

```text
@AGENTS.md
```

Claude-only material may follow the import. Lead material is Claude-only and therefore belongs below it.

`CLAUDE.md` is a normal file, not a symlink. A symlink would leave nowhere for the Claude-only material.

Etan ratified this ruling with “Sounds right to me” on 2026-08-01 (R2, including the Claude-only lead-material placement).

## Conformance is a shape check

Conformance is enforced by `scripts/check-instruction-shape.sh`, not by prose or by hoping that another check notices drift. Etan's standard was: “I am sure we dont need to 'hope' ci catches drift.”

For each repository, the gate checks only this shape:

- `AGENTS.md` exists as a regular file, contains at least one nonblank line, is tracked, is not gitignored, and is not a symlink.
- If `CLAUDE.md` exists, it is not a symlink and its first nonblank line is exactly `@AGENTS.md`.
- Claude-only content below the import is allowed and is not inspected.

The gate checks the Git repositories under `~/Gits` by default. Explicit repository paths and `--repo <path>` are also supported.

Wiring the gate into a weekly ecosystem-health job is not part of this standard's current installation.

## Content installation gate

Core-repository instruction bodies are installed only after Etan ratifies their wording through read-aloud. Mechanical tail repositories only reshape existing content into the standard file structure; that work does not authorize new rules.

Source: the 2026-08-01 ratification record's “Rulings” preamble, which records read-aloud before ratification and the correction that the read-aloud caught.

## Glossary block

At the top of `AGENTS.md`, below its title and above its body, a small glossary block defines the ambiguity-carrying words that the repository actually uses. Start from `you`, `we`, `user`, `agent`, `provider`, `client`, `environment`, and `project`, with one definition per line.

The shape is shared, but the contents are repository-specific: define terms for the local fleet, omit terms that do not collide there, and do not invent a `provider` line in a repository with no providers.

Etan approved this convention with “yes” on 2026-08-11, routed via maintenanceClaude from the Theo-gems adoption sprint.

This convention is advisory, not gated: `scripts/check-instruction-shape.sh` is not extended to require a glossary, because a hard gate would turn every repository in the fleet red on day one.

Installing glossary wording in a core repository's `AGENTS.md` remains subject to the content installation gate above, including read-aloud ratification before the wording lands.

## Global-layer content

The following fleet rulings were made by voice on 2026-08-02 and handed off through `@brainlayer`. They are recorded here as global-layer content:

- Roles are lead and worker only. Orchestrator is not a third role: orc is a lead whose workers are other leads.
- Sonnet-tier never holds a seat. It is for sub-agents only.

Source: Etan's 2026-08-02 voice rulings, conveyed in the `@brainlayer` handoff. Their global installation was verified in `~/.claude/CLAUDE.md` on 2026-08-02; installation status is not a pending policy claim here.

## Conforming examples

- `cmuxlayer`: live-conforming in PR #344.
- `brainlayer`: ratified; installation is in flight.

## Out of scope until ruled

`GEMINI.md` remains undecided under open item SD-GEMINI. It remains gitignored and is not changed by this standard.
