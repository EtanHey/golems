---
name: content-demo-creation
description: "Create app/Remotion demos. Triggers: demo video, walkthrough, showcase."
metadata:
  home: TBD (Content Golem — repo to confirm; $HOME/Gits/contentGolem is a slide-deck repo, not the demo home)
  author: skillCreatorClaude (gen-9 s:4)
  status: v1-draft (eval pending)
  seeded_from: codex-019e6d0f BrainBar CU-demo precedent (verified) + contentClaude live Remotion run on surface:14 (observed)
---

# Content Demo Creation

> Produce a genuinely good product demo video. Two modes. Pick by what exists: a running app (CU-demo) or only docs/a target UX (mimic-demo). The output is always a **video an absent stakeholder can watch remotely** — delivered to iCloud/Obsidian, not left on a local desktop.

## Decision: which mode?

| You have… | Mode | Output |
|---|---|---|
| A real, runnable app | **CU-demo** | Screen-recorded narrated walkthrough of the live app |
| Only docs / a UX to recreate | **mimic-demo** | Deterministic Remotion render that recreates the UX |
| A running app but want a *polished* (not raw) result | **Both** | CU-demo for truth + mimic-demo polish; or CU footage as reference for the render |

If unsure, default to **mimic-demo** — it's deterministic, re-renderable, and doesn't depend on a fragile live app state.

---

## Gate 0 — Reference reality first, invent nothing visual (MANDATORY, both modes)

> **Before you recreate ANY pixel, ground the demo in the REAL product UI.** This gate is non-negotiable and applies to both modes — it is the #1 way a demo fails.

The authoritative reference is, in priority order:
1. A **screenshot/screen-recording of the running app** (Computer Use on the actual app), AND/OR
2. A **user-provided screen recording of the real setup, processed into frames** — a first-class reference when the app can't be driven directly (see the allowlist gap below). Frames of the live UI in each state (e.g. the VoiceBar pill recording / transcribing / speaking) ARE ground truth. AND/OR
3. The **real UI source** — the actual implementation components (e.g. `flow-bar/Sources/VoiceBar/*.swift`, the real React/SwiftUI views that ship).

**Allowlist gap (real, 2026-05-29):** some apps aren't in the Computer-Use allowlist, so you literally cannot screenshot them live (voice-LEAD hit this with the VoiceBar). When that happens, do NOT fall back to inventing — ask the user for a **screen recording of the real setup**, run it through the qa-video frame pipeline, and use those frames as the Gate 0 reference. A recording the user already made beats a live screenshot you can't take.

**NEVER mimic from:**
- ❌ the **marketing site** / landing-page components (e.g. a `pipeline.tsx` on the product website) — those are idealized inventions, not the product.
- ❌ a **design blueprint / spec / Figma** — aspirational, not what ships.
- ❌ your own imagination of "what it probably looks like."

**Why (real failure, 2026-05-28):** a VoiceLayer demo was built off the marketing site + blueprint. Etan: *"looks nothing like my setup, nor the VoiceBar."* The truth was in `flow-bar/Sources/VoiceBar/*.swift`. A beautiful render of the wrong UI is a failed demo.

**Checklist before rendering/filming:**
- [ ] I have ONE of: a running-app screenshot, frames from a user-provided recording of the real setup, OR the real shipping UI source — open as my reference.
- [ ] I can name the exact source files/paths/frames my visuals are derived from.
- [ ] I am NOT deriving any visual from a marketing site or a blueprint.
- [ ] If the app isn't Computer-Use-allowlisted, I asked for a screen recording instead of inventing.
- [ ] If I can't reach any real reference, I STOP and ask — I do not invent.

---

## Mode A — CU-demo (drive the real app)

Hard-won rules (each is a real correction from a prior demo run — see codex-019e6d0f BrainBar demo):

1. **Computer Use is the driver, NOT bash screenshots.** The polished cursor and real interaction only come from Computer Use. `screencapture`/bash screenshots look dead and are disqualified. *("bash screenshots aren't the same.")*
2. **Screen RECORDING, not a few screenshots.** A demo is a continuous video. *("do a video or a screen recording and not just a few screenshots.")*
3. **Pre-flight a known launch state.** Don't film a cold/ambiguous app. Use the app's reset/toggle hook (e.g. a `/tmp/.<app>-toggle` file, a fresh launch, a seeded fixture) so the walkthrough is reproducible.
4. **Exercise features at decision points** — open the thing, click the feature, show the result. Narrate what's happening and why it matters.
5. **When you hit a bug, FIX it (or dispatch a subagent to), don't just film it.** A demo that shows a known broken state is a failed demo. *("When you find a bug... why don't you fix this?")*
6. **Deliver where the stakeholder can watch.** Save the final MP4 into iCloud (`~/Library/Mobile Documents/com~apple~CloudDocs/...`) or the synced Obsidian folder, then report the exact path. *("put it inside of iCloud or the Obsidian folders so they sync... and tell me where it is.")*
7. **Parallelize with a read-only monitor subagent** if a PR/CI is in flight while you film — fork it to watch, don't context-switch. *(read-only monitor pattern, codex-019e6d89.)*

Pipeline:
```
pre-flight state  →  start screen recording  →  CU drives the app feature-by-feature
   →  narrate (live or scripted)  →  stop recording  →  trim/assemble
   →  fix any bug surfaced, re-take the affected segment  →  deliver to iCloud/Obsidian  →  report path
```

---

## Mode B — mimic-demo (recreate UX from docs)

Working hypothesis (to validate in eval, grounded in contentClaude's live run): **for UI-accurate demos, a deterministic Remotion + `@remotion/three` render beats prompting an AI video model.** The render is pixel-controlled, re-renderable, and never hallucinates the UI. contentClaude (surface:14) independently chose this stack for the VoiceLayer demo and hit the version-mismatch trap below — eval round 1 will confirm whether the render quality justifies the approach.

Pipeline:
```
PASS GATE 0 (reference the REAL shipping UI — screenshot of running app and/or real UI source; NOT marketing site, NOT blueprint)
  →  read how-it-works docs (README, feature pages) for FLOW/narrative only — never for visuals
  →  build a Remotion + @remotion/three composition recreating the REAL UX
  →  PIN all remotion package versions to one number (see scripts/check-remotion-versions.sh)
  →  render deterministic MP4
  →  [optional] AI video model (LTX local when RAM allows, else cloud) for B-roll / ambient ONLY
  →  [optional] voiceover (VoiceLayer TTS to dogfood, or silent + on-screen captions)
  →  deliver to iCloud/Obsidian  →  report path
```

Rules:
1. **Pin Remotion versions.** A version mismatch (observed in contentClaude's run: `4.0.422` core vs `4.0.421` `@remotion/google-fonts`/`@remotion/paths`) breaks React context, hooks, and renders. Pin every `@remotion/*` + `remotion` to the SAME exact version (drop the `^`). Run `scripts/check-remotion-versions.sh` before rendering.
2. **The AI video model is a B-roll stage, not the UI stage.** Never ask LTX/cloud to render the actual product UI — it will hallucinate. Use it only for ambient/atmospheric shots that frame the deterministic UI render.
3. **Voiceover is optional for round 1.** Ship silent + captions to get a reviewable artifact fast; add VoiceLayer TTS narration in a later round (dogfooding VoiceLayer is on-brand when the demo is *of* VoiceLayer).

---

## AI video stage (LTX) — RAM-gated, switchable

The video-gen stage MUST be **cloud-or-local switchable**. LTX-2.3 Q4 is ~19.4GB into unified memory.

- **Before any local LTX run:** check free RAM (`scripts/ram-gate.sh`). If `free+inactive` is not comfortably above the model size while the agent fleet runs, **do NOT run locally** — route to cloud (Replicate/fal). Do not OOM the running ecosystem.
- **Download is disk-only and safe anytime.** Running/loading is the gated step.
- Image gen (Draw Things) is already local and light — no gating needed there.

---

## Definition of "good" (what eval scores)

A demo is shippable when:
- [ ] **Gate 0 passed**: every visual traces to the real running app or real shipping UI source — nothing derived from a marketing site or blueprint. *(Hard fail if violated, no matter how polished.)*
- [ ] It is a **video**, watchable end-to-end, delivered to a synced location with the path reported.
- [ ] The UI shown is **real or pixel-accurate** (no hallucinated UI, no known-broken states).
- [ ] It **narrates the value** of each feature, not just the clicks.
- [ ] It is **reproducible** (pre-flight state for CU-demo; pinned deps for mimic-demo).
- [ ] Any bug surfaced during filming was **fixed and re-taken**, not shipped.

## Few-shot loop (how this skill improves)

This skill is built the skillCreator way: produce a demo → review quality → feed specific feedback → improve the skill → re-render. Not one-shot. See `EVAL.md` for the running rounds + deltas.
