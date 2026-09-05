---
name: render-done-gate
description: "Mechanical kill-gate: block a narration/AfterCode 'render done / give it a play' without a same-turn ls+ffprobe(size>0,duration>0) of the CLAIMED mp3 + a reachable surface + a registered cloned voice. Triggers: render complete, give it a play, narration done, audio mp3 done."
disable-model-invocation: true
---

# Skill: Render-Done Kill-Gate (gen-18 Track 2 #3 — narration-specialized)

> A "render complete / give it a play" message ≠ an mp3 on disk. A 2-voice render that silently fell back
> to system-TTS for speaker 2 ≠ the registered clone. The script text ≠ the audio artifact.
> No narration render-done leaves the seat without a SAME-TURN composite probe. (Closes R-035 UNPROVEN/S10 + R-024 LOST.)

## What It Is

A deterministic detector over an agent transcript, **specialized for narration/AfterCode audio**. The generic
`/false-green-gate` already blocks a render "done" without a same-turn `ffprobe`. THIS gate is the
narration-SPECIALIZED, stricter **composite probe** a "give it a play" actually requires:

1. **`ls` + `ffprobe`** proving **size>0 AND duration>0** of the **CLAIMED** `.mp3` path (a probe of a
   *different* file does not count; sub-second durations are valid).
2. A **reachable-surface** check — the artifact is located where it is claimed (file-on-disk at the claimed
   path), or — when the claim points the listener at a **served surface** (dashboard / URL) — an **HTTP-200**
   on the served audio URL **or** an **embedded-clickable** player a browser actually drove.
3. A **voice-profile** gate — the resolved `--reference` is a **REGISTERED clone** (`theo-c4` / `theo-c4s` /
   `ben-c1`), **FAIL-CLOSED** on a missing profile and on a silent system-TTS / neutral-reader fallback
   (never fail-open).
4. An **AUDIO-not-SCRIPT** contract — relaying the **script text** in place of the rendered audio artifact is
   not a render-done.

Evidence comes ONLY from REAL probe execution — Bash COMMAND strings, probe tool NAMES, and tool_result
OUTPUTS — never assistant narrative and never an incidental marker in a non-probe tool's input. The pinned
RED/GREEN transcript fixtures ARE the replayable gate (R-003/R-014 pattern).

## The Rule — required same-turn evidence

| Missing evidence | Violation |
|---|---|
| no `ls`+`ffprobe` proving size>0 AND duration>0 of the **claimed** mp3 path | `RENDER_NO_FFPROBE` |
| `--reference` not a registered clone / system-TTS or neutral-reader fallback / missing profile (fail-closed) | `RENDER_WRONG_OR_MISSING_VOICE` |
| the claimed artifact/surface not verified reachable (file-on-disk / HTTP-200 / embedded-clickable) | `RENDER_SURFACE_UNREACHABLE` |
| relayed the **script text** instead of the rendered audio artifact | `RENDER_SCRIPT_NOT_AUDIO` |

"Same turn" = the events since the last human message — the probe tool calls **and their results** the agent
ran before the claim. Negated/in-progress statements ("not done yet", "still encoding") are not claims, and a
non-render "done" is N/A here (the generic gate covers it).

## Composition — specializes /false-green-gate's render path

This gate **composes with / specializes** the render path of `/false-green-gate`. The generic gate's
`FALSE_GREEN_FFPROBE` / `FALSE_GREEN_VOICE` are the broad render+voice false-green checks; render-done-gate is
the **stricter narration sibling**: it additionally requires the `ls` half of the composite probe, ties the
probe to the *claimed* artifact path, adds the reachable-surface and audio-not-script contracts, and makes the
voice gate **fail-closed** on a missing profile. Run both: the generic gate over any completion claim, this gate
over a narration/AfterCode render-done.

## How /pr-loop Consumes It

`/pr-loop` states the **Deploy Truth Gate** in prose; this gate makes the narration render-done mechanical:
before a worker emits a "render done / give it a play / here's the mp3" message, run the gate on the turn —
`bun skills/golem-powers/render-done-gate/scripts/render-done-gate-cli.mjs <transcript|->` (exit 3 = FLAG). A
FLAG means the claim is not yet earned: run the missing composite probe, then claim.

## Run It

```bash
bun test skills/golem-powers/render-done-gate/evals/render-done-gate.test.mjs   # replay (CI-safe)
bun skills/golem-powers/render-done-gate/scripts/render-done-gate-cli.mjs <transcript.jsonl|->
```

Programmatic: `import { detectRenderDone } from "./src/render-done-gate.mjs"` → `{ verdict, claim, domains, violations }`.

## Stated Limits (honesty rule)

- Evidence is marker-anchored over the same-turn blob built from tool commands + tool_result outputs (never
  prose). A probe *described* but not actually run reads as ABSENT — the prose-bypass RED fixture pins this.
- "Same turn" is bounded by the last human message; a probe run two turns earlier does not count (by design —
  the render-done false-green class is precisely a stale or absent same-turn probe).
- New evasion shapes are added as RED fixtures (R-003 model).

## Provenance

RED specimens: narrationlayer/e3a91210#1 ('give it a play', no mp3), narrationlayer/9bfa306b#9-#10
(neutral-reader / system-TTS for speaker 2), R-024 ffprobe-path-mismatch (probed a different file),
script-relay (script text instead of audio). Evasion REDs: ffprobe-only-no-ls, surface-unreachable-dashboard,
prose-bypass-no-tools, narrate-write-supplies-path (the path-tie binds to the ffprobe/ls COMMANDS, not any
command — a `narrate -o <path>` write can't supply the match; cursor HIGH). GREEN references: composite-probe
+ theo-c4 resolved, no-render (N/A), MCP-Bash-name-normalized + sub-second duration, served-surface verified
(HTTP-200 + embedded-click), embedded-wording-local-file (bare "embedded" prose must not force served-only
verification; cursor MEDIUM).
