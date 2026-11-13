# Card visuals: synthetic renderer proof

Status: ready for the lead's independent review; no hosted/account/audio-delivery claim.
Base: c6e47591c832219bd6fced5a44d4c5db87e47a37. Captured with real Chromium,
1280×1100 and 390×1100, both system color schemes, reduced motion.
The surrounding dashboard retains its existing dark design; new visual surfaces follow the system theme.

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
`*-diff.png`: padded absolute RGB screenshot differences, expected to differ for added content.
`interaction.webm` / `interaction.gif`: phone chart scrolling and Chart data open/close.
`receipts.txt`: baseline, build and verification receipts. These are synthetic fixtures only.
