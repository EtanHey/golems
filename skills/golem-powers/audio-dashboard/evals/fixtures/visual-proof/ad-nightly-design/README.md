# Nightly decisions-first design pass (decision-flow)

Task marker: `cloud-credit-20261104-dashboard`. Base: `f4bdb28c2238e27ab7b7201614d89fd4029d9e4c`.

Everything here uses synthetic content. It is not the live nightly page, its cards
or its openers. Media is a stub data URI, so no audio is generated or played. The
fixture has five cards: two open questions with options (one with a long bare
evidence URL and a markdown link, one with a fenced command), a checklist, a
free-text question, and a reply appended as the last card (`status: "REPLY"`).

Reproduce from the repo root (needs workspace deps and a Playwright Chromium):

```bash
node skills/golem-powers/audio-dashboard/evals/fixtures/visual-proof/ad-nightly-design/capture.mjs <base-checkout>/skills/golem-powers/audio-dashboard/src/decision-flow.mjs before <out>
node skills/golem-powers/audio-dashboard/evals/fixtures/visual-proof/ad-nightly-design/capture.mjs skills/golem-powers/audio-dashboard/src/decision-flow.mjs after <out>
```

Each run captures 1280×900 and 390×844 at device scale 2 with reduced motion. One
note is saved on card 1 through the real dialog, so the note-count state is shown.
Card crops (`*-card-*.png`) hide only the sticky controller and fixed dock, which
would otherwise overlap the cropped card. The full-page shots are at CSS scale.
`*-diff.png` dims the after image and paints changed pixels (channel delta > 16)
red. `diffs.json` holds changed-pixel counts for every pair, including pairs not
committed here. These counts are evidence, not a threshold. `receipt-*.json` pins
the rendered HTML hash and the probe values below.
`decision-flow-390-reply-card-before.png` was re-encoded losslessly at PNG level 9
(pixel-identical). Its compressed bytes happened to match the publish-boundary
email pattern, a false positive in binary data.

## What the evidence showed (base)

| Finding | Evidence (`receipt-before.json`, screenshots) |
|---|---|
| A long bare URL in card prose widened the phone page | 390: `pageOverflowPx: 60`, 1 link fragment outside the card; `decision-flow-390-full-before.png` is 450 px wide; `decision-flow-390-top-before.png` clips the URL at the right edge |
| Prose links looked like body text | link colour `rgb(213, 219, 230)` = paragraph colour; rail links already use sea-glass |
| The card note button's name ignored saved notes | every card: `Add or review notes for <title>`, including the card with 1 note. The count badge sits inside an aria-labelled button, so screen readers never hear it |
| Copy button press target under 44 px | 40 px tall at its centre |
| An appended reply card looked like one more open question | status rendered as faint `Reply` text, same as `Open` |

## Change (candidate)

| File | Change |
|---|---|
| `templates/decision-flow/decision-flow.css` | `.df-question{overflow-wrap:anywhere}`; `.df-question a` uses the rail-link sea-glass colour, underline colour and offset, with a fine-pointer hover; `.df-question .ad-copy-block button::after` adds an invisible 6 px ring, so the copy press target reaches 44 px or more without changing the look; `.df-status[data-status="reply"]` renders as a small outlined pill |
| `templates/decision-flow/decision-flow.js` | `answerMarks` sets the card note button name: `Add a note to <title>` with no notes, `Review N note(s) on <title>, or add another` once notes exist. It updates on save, delete, restore and remote change |
| `src/decision-flow.mjs` | static markup starts with `Add a note to <title>` |
| `SKILL.md` | producer rule: replies append as new END decisions with a new stable `id` and `status: "REPLY"`; never rename, reorder or reuse decision ids, `spec.id` or `dashboardId` |
| `evals/decision-flow-interactions.test.mjs` | +2 tests: note-button name across add, review, delete and seeded restore, plus the static markup |
| `evals/decision-flow-layout.test.mjs` | +1 Chromium test at 360, 390 and 1280: a long prose URL causes no page overflow, no link fragment leaves the card, and prose links differ in colour from prose text |

Candidate probes (`receipt-after.json`): `pageOverflowPx: 0` at both widths, no link
fragment outside the card, link colour `rgb(121, 207, 194)`, note names
`Review 1 note on Pick tonight's release lane, or add another` / `Add a note to …`,
copy press target 51 px, Reply pill. Unchanged: the 5 card ids, 14 answer inputs
and 12 player controls. At 1280 the copy card pair has 0 changed pixels, because
the press ring is invisible.

Keyboard (`keyboard-390-after.gif`, 18 Tab stops from the document start at
390 px): Cinema link → Details → transport → speed → Story → five chips → Copy
answers → card 1 note → Play → Restart → prose links → rail link. Every stop showed
a focus ring and stayed inside the viewport. The base order is identical; only the
note button's name differs.

## Recommendations not implemented (left for the lead)

1. **Dock before cards in Tab order (phone).** `.df-side` (index and Copy answers)
   precedes `<main>` in the DOM, so on the phone, where the dock is fixed to the
   bottom, keyboard users reach Copy answers before card 1. A fix means moving
   `<aside class="df-side">` after `<main>` in `shell.html`. The desktop grid areas
   already place it, but the index's reading order on desktop would change. That
   needs a design-preservation and verifier check first.
2. **Controller targets of 40–42 px.** Chips (40), play, speed and Story (42) sit
   under 44 px by the documented 360 px phone budget comment. They pass WCAG 2.5.8
   (24 px). Raising them costs controller height (`--ctrl-clearance`).
3. **Copy block palette.** `COPY_BLOCK_ASSETS` (`src/copy-blocks.mjs`) hard-codes
   `#111b2d`, `#64748b` and 8 px radius for both types. In decision-flow it reads
   as a slightly foreign panel. Its 52 px top padding also costs phone height.
   Restyling belongs in a shared change covering cinema too.
4. **Cinema** was not audited in this pass. Its decision boxes share
   `renderCardBody`, so the long-URL wrap may need the same one-line rule in
   `vendor/agent-html/templates/v4-story-mode/cinema.css`. That is unverified.

Not covered here: runtime, account-sync plumbing, Lakebed, UploadThing, tailnet
bridge and audio (NarrationLayer's lane). The account answer store path is
untouched. Captures ran without a bridge, so they show the visible device-only
fallback.
