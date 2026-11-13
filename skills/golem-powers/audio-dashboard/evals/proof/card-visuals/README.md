# Card visuals: synthetic renderer proof

Status: ready for the lead's independent review; no hosted/account/audio-delivery claim.
Base: c6e47591c832219bd6fced5a44d4c5db87e47a37. Captured with real Chromium,
1280×1100 and 390×1100, both system color schemes, reduced motion.
The dashboard and new visual panels share the existing card theme tokens under both system color schemes (round-2 correction).

## Data contract

- `tables: [{caption, columns: [string], rows: [[string | number | {status}]], align?: ["left" | "center" | "right"]}]`.
  Status is exactly works, bug, fixed, open, pass or fail. Align, when supplied, matches column count.
  At most 4 tables per card, 12 columns, 100 rows, 500 characters per text cell.
- `charts: [{type: "bar" | "line", title, unit, series: [{name, values: [{label, value}]}]}]`.
  At most 4 charts, 4 series/chart, 30 points/series; series share unique ordered labels.
  Values are finite numbers with absolute magnitude at most 1e12. Negative/zero/single points work.
  SVGs have an exact accessible summary and a keyboard-accessible Chart data disclosure.
  Dense plots scroll locally, preserving label size. Flow/statecharts are deferred.
- `rail: [{label, value, href, newTab: true}]` opts into a strict HTTP(S), credential-free
  link shape with `_blank` and `noopener noreferrer`. Omitting newTab preserves legacy anchors.
- New objects refuse unknown keys. Combined serialized visual fields are limited to 256 KiB
  of UTF-8, validated in renderer and hosted prepare. asset-manifest.json records
  visualPayloadBytes and final htmlBytes (including computed drawer totals).
- Details sums final clip durations passed by BUILD's existing MP3 ffprobe step, rounds once,
  and counts distinct rail values whose label is exactly Section, plus all final cards.
  No Section metadata means zero sections. Direct renderer calls lacking valid durations omit the total;
  BUILD already rejects missing/invalid final audio. No job subtitle mutation is needed.

## Observed checks

Latest focused run: 48 pass, 0 fail (278 assertions, 4 files), including new fields,
real hosted-prepare accounting, real Chromium popup/no opener, keyboard focus, local scrolling,
list/story sheet reachability and existing Sources/diff/header controls.
A separate real BUILD used ffmpeg-generated synthetic tones and real ffprobe: rebuilding from
1-second to 2-second final clips changed Details from `0 min 1 s` to `0 min 2 s` without editing subtitle.
Registry location alone was isolated; tones are not narration or live listening proof.

The earlier full audio-dashboard run finished 1099 pass / 5 skip / 1 fail (1105 tests, 48 files).
The failure is publish-handoff.test.mjs:76: expected PUBLISH_HANDOFF_FIRST_LINEAGE_APPROVAL_CHANGED,
received DESIGN_LINEAGE_RESET_REFUSED. An isolated untouched-base file copy reproduced it
(1 pass / 1 fail). Full suite was run before the final sheet placement/reference-gate additions;
the 48-test focused run covers the final source. Do not call the full suite green.

Base renderer probes: table FAIL, chart FAIL, newTab FAIL, computed total FAIL, all expected.
Sources/prompt/options and plain-rail legacy article markup compares byte-identically to base.
Existing fixture/golden files were not edited; card-visuals.html is the new full-HTML golden.

Browser measurements: page scrollWidth equals 1280/390 in all four captures;
visual widths 704/322 respectively. Pass-pill AA contrast: 6.492 light, 9.531 dark.
Desktop light and phone dark after images were inspected full-size by the builder.
The captures use setContent: the visible Storage unavailable notice is the existing synthetic
origin restriction, not authenticated persistence evidence. The recording uses a local file.
All owned browser contexts were closed. Independent video/taste review remains with the lead.

## Artifacts

`*-before.png` / `*-after.png`: full-page desktop/phone light/dark, Details open.
RGB screenshot differences are retained only in the local CI-repair archive; before/after captures and JSON measurements remain reviewable here.
`interaction.webm` / `interaction.gif`: phone chart scrolling and Chart data open/close.
`receipts.txt`: baseline, build and verification receipts. These are synthetic fixtures only.

## Round 2: r1254 fixes

B1 removes only the exact leading legacy manual total when the computed total
exists; preserved subtitle text and no-duration behavior have regression checks.
N3 renders singular section/card nouns. B2 fits 1–4 points into a 390 px card
and retains local overflow for dense plots. N4 uses the existing card's `--moon`,
`--panel`, `--line`, and `--line-strong` tokens under both system preferences;
status and series colors keep the readable dark-page pairs. N1 documents fields
and limits in references/card-format.md, linked from SKILL.md. N2 chooses the
explicit producer rule: use `—` for blank cells; empty strings remain refused.

Fail-first at b9e708ed with the added checks: 16 pass / 3 fail (manual duplicate,
singular nouns, and small-chart overflow). See r2-red.txt. Before browser
measurements in r2-before.json independently record the theme mismatch, two total
lines, and phone chart 540/322 with the second bar outside the visible region.
After: r2-after.json records one total, phone chart 322/322, both bars visible,
and table/chart colors identical to their card in light and dark. Screenshots
r2-390-light-after.png and r2-390-dark-after.png were inspected at full size.
Desktop 1280 light/dark before/after captures are included too. Reproduce captures
from the skill directory with `bun evals/proof/card-visuals/capture-r2.mjs after`.
All owned Chromium contexts close in finally blocks.

The full suite's previously reported publish-handoff failure remains unresolved;
this round does not claim full-suite green, live narration, authenticated
persistence, or hosted delivery. Producer-side audio-total.py retirement is
outside this renderer checkout; producers must stop prepending manual totals.

Round-2 validation: 200 pass / 0 fail, 657 assertions across card-visuals,
copy-blocks, decision-flow-sources, and decision-flow-header (r2-green.txt and
r2-related.txt). The renderer file contributes 19 tests, including real browser
1–4-point phone-fit, dense scroll, both themes, and list/story reachability.
Round-2 RGB differences were removed from publication history after the boundary rejected their binary bytes; r2-before.json and r2-after.json retain the measurements.
Documentation is schema/reference guidance; agent-behavior eval is unmeasured.
