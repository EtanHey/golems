# Sources drawer proof — PR 1185

Synthetic UI fixture: `evals/fixtures/sources-drawer.mjs`. Baseline renderer/template: 6002e3bd; candidate source: 40028d53. All HTML is local synthetic material; the clipboard is mocked. No live narration, authenticated account synchronization or publication is proven.

At 1280 and 390 px, `before.png` omits the unsupported drawer on the base; `after-closed.png` shows its default state; `after.png` shows the keyboard-open drawer with preconditions above the copy control. `interaction.gif` records closed → keyboard-open → clicked Copy/Copied. The GIF contains three actual Chromium screenshots, held for 900/900/1800 ms. `diff.png` is the raw per-pixel before/open-after difference, aligned at the top-left and padded with the page background. Read `index.json` for hashes and assertions.

The amber focus ring is the real keyboard focus indicator. The Storage unavailable warning comes from the isolated data-URL origin; it occurs on both base and candidate. It is not evidence of account sync. Browser instances were closed in `finally` blocks.

Design preservation initially rejected COPY_BUTTONS at both widths. The synthetic job's scoped, predecessor-bound redesign records only that fired invariant, with approvedBy `Etan via orc 2026-11-08 (sources drawer request)`. The recheck passes. No design gate implementation or threshold was changed. Layout issue 1168 remains separate.
