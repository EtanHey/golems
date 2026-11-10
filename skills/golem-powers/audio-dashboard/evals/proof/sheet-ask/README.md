# Answer sheet shows the spoken ask (Etan, 2026-11-10)

Complaint, via orc: "the full transcript repeated inside card details; letter/number options he
couldn't decode; a single voice saying 'look below'".

## The 0400-r3 job, built unchanged, now rejects

`bun scripts/build-dashboard.mjs --spec <0400-r3>/job.json --job-dir <0400-r3>/job --out <scratch>`
(`GOLEMS_EXPERT_VOICE=theo`). It reads the recorded segments, so no synthesis. Exit 1, the job's sha256
is unchanged, no HTML is written, receipts are `[voice-role PASS, card-authoring REJECT]`:

| Rejection | Count |
|---|---|
| ASK_MISSING | 13 |
| OPTION_LABEL_CODE | 24 (`A: move pages…`, `R2 · Done means…`, `T10 · …`, `7 merges: B3→J6…`) |
| DECISION_SINGLE_VOICE | 13 |
| SCREEN_REFERENCE | 10 (below ×7, tick ×2, above ×1) |

## A 3-card fixture passes

One explainer, one options card and one checklist card. Each card has a host scene (`ben-c1`)
and an expert scene (`theo-c4s`), synthesized by the local TTS daemon. Every BUILD gate is PASS:
voice-role, card-authoring, card-text-audio, transcript-fidelity, acoustic, onset-energy,
teleprompter-drift, answer-persistence, copy-blocks and design-preservation (BASELINE,
first in its own fixture lineage). One host take was re-rolled after `DURATION_WORD_SIBLING_RATIO`,
then the line was reworded; the gate was not changed.

Story-view answer sheet of the options card, headless Chromium:

- `sheet-story-390.png`: 390 px.
- `sheet-story-1280.png`: 1280 px.

At both widths `.df-ask` appears once with the host's question, the expert's narration is absent
from the sheet, and the question text appears once.
