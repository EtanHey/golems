# Layout notes proof — issue 1168

Before = base `e92f73ec`; after = this branch. Both pages come from a real BUILD
(`scripts/build-dashboard.mjs`) of `examples/job.json`. The segments are synthetic:
tone WAV/MP3 and word timings taken token-for-token from each scene's own script, in an
isolated design registry. Screenshots use Playwright Chromium with overlay scrollbars
switched off, so the classic scrollbars Etan sees on a desktop are actually drawn.

| Width | Before | After | Diff |
|---|---|---|---|
| 390 | [dark](390-dark-before.png) · [light](390-light-before.png) | [dark](390-dark-after.png) · [light](390-light-after.png) | [diff](390-diff.png) |
| 1280 | [dark](1280-dark-before.png) · [light](1280-light-before.png) | [dark](1280-dark-after.png) · [light](1280-light-after.png) | [diff](1280-diff.png) |
| 1920 | [dark](1920-dark-before.png) · [light](1920-light-before.png) | [dark](1920-dark-after.png) · [light](1920-light-after.png) | [diff](1920-diff.png) |

- **Width.** At ≥1440 px the layout grows from 1120 to 1680 px. The rail grows from 260 px to
  `clamp(280px,17vw,340px)` and the cards from 740 to 1250 px at 1920. Prose stays 594 px wide
  (64ch) at every width; [index.json](index.json) has the measured boxes, including 2560 px.
- **Rail gap.** 56 → 32 px at ≥1040 px, 40 px at ≥1440 px. At 1280 the 24 px goes to the cards (740 → 764).
- **Scrollbars.** Thin, palette-tinted and transparent-tracked. The rail list and read-along keep a
  stable gutter and brighten on hover or keyboard focus. Rail thumb on the ink background:
  rest RGB 58,68,88; hover/focus 98,110,131. [Rail before](rail-1920-hover-before.png) /
  [after](rail-1920-hover-after.png); [GIF](interaction.gif) = rest → hover → keyboard focus.
- **390 px.** No layout change. The diff is the classic test scrollbar narrowing 15 → 11 px.
  Phones draw overlay scrollbars.
- **Light.** The template is dark-only (`color-scheme:dark`, no light palette), so the light
  captures are pixel-identical to the dark ones (before 390 px: 17 anti-aliased pixels off by 1).
- **Design preservation.** Without a waiver the BUILD rejects `LAYOUT` at 1280 px only. A scoped
  `redesign` naming only `LAYOUT`, bound to the predecessor hash, passes (`REDESIGN_APPROVED`).
  No gate code or threshold changed.

Not proven here: live narration, Whisper timing, hosted publish, account sync, or the Safari
`::-webkit-scrollbar` fallback (Chromium uses the standard properties).
