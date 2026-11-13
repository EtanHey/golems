# Card detail affordances

Attribution: Etan, 2026-10-28 dashboard feedback.

A card without a visualization must not have a **View details** expander.
Repeating its existing text adds no useful detail. Either offer no secondary
action, or offer **Listen deeper** to open a more detailed narrated section
with the same real-word-timed read-along and word-click seek mechanics.
Comparisons are the canonical use. Cards with a visualization may keep a
**View details** expander that shows the visualization's underlying data.

For decision-flow cards, cinema decision boxes, and hand-built cards, deeper
sections open inline inside the parent card and pause parent audio. Inner scenes
belong to the parent decision, preserving exactly-one-decision scene ownership.
**Back to summary** closes the section, stops inner audio, and returns focus to
its **Listen deeper** button; parent audio stays paused until explicitly resumed.
This is authoring guidance; the renderer does not supply this interaction.

## Issue and PR references

Attribution: Etan, 2026-10-28 dashboard feedback (AD-16).

A card that names an issue or PR links it. Supply the repository-qualified URL
as a rail `href`: `{ "label": "PR", "value": "#39", "href":
"https://github.com/OWNER/REPO/pull/39" }`. The producer must already know the
repository; never infer one from a bare number. `build-dashboard` rejects any
`#N` on a card that has no matching linked rail row, and a `#N` row whose own
href is a generic URL. Put CSS colours in a `code span` or after a colour word
(`color #123`) so they are not read as references.

Run `bun scripts/validate-evidence.mjs --spec <job.json>` from the skill directory
after rendering (include `--published "<sync command>"` for publish evidence).
The HTML evidence gate inspects decision-flow, cinema and hand-built cards
(`.df-card`, `.dbx-card`, `.card`, `[data-card]`) and rejects text-only details
expanders with `TEXT_ONLY_VIEW_DETAILS`. Decorative control icons do not count
as visualizations. Inline SVG/canvas/images/figures and View details controls
that open a visual or visual dialog count. Narrated details sections with audio
and timed words or a Listen deeper audio block pass; a separate plain text
expander still fails. This runs at render time, without sweeping published files.

`data-open-visual` alone is not evidence of a visualization. The gate resolves an
explicit relative URL (a value containing `/` or ending in `.html`, including
query/fragment suffixes) against
`evidence.outputPath` and inspects that local page. Otherwise it resolves the
value as an in-document id of a dialog, `role="dialog"`, figure or section.
For opaque ids, the documented PHX producer convention is `visuals/<id>.html`
under the dashboard directory; the gate reads and inspects that file too.
New producers should declare explicit relative URLs. `aria-controls` can also
identify an in-document visual target. Targets need a non-control-icon SVG,
canvas, image, figure or video. Missing/unreadable files, unresolved ids,
external URLs, paths outside the dashboard directory and uninspected iframes
fail closed. Any `scheme:` value is treated as external and flagged. A local
URL fragment must identify a qualifying visual target on that page; a missing
or text-only element fails. A URL pointing back to the dashboard itself must
include such a fragment; a whole-page self-reference fails. No scripts execute
and no external pages are fetched.

## Comparisons

Attribution: Etan, 2026-10-28 dashboard feedback (AD-15).

A decision-flow card declares a comparison with `comparison: { url, label?,
title?, timeoutMs? }`. The renderer supplies the dialog. It shows Loading, then
the page, or a failure message with Retry and Back once the frame errors or
`timeoutMs` passes (default 10 s). It never waits forever. Retry loads a fresh
frame, and a late event from an earlier attempt is ignored.

Browsers fire `load` for 404s and network failures, so a load alone is not
success. The page must be readable and same-origin, and show a 2xx/3xx
`responseStatus`, or, where the browser reports no status (WebKit), carry the
ready marker. Every comparison page, hand-built or generated, must start in the
canonical form: optional doctype, `<html …>`, `<head …>`, and then, with only
HTML whitespace between (space, tab, LF, CR, FF; not a non-breaking space or
other Unicode space), this exact line as the first child of `<head>`. One BOM
is allowed at the very start:

```html
<!doctype html><html><head><meta name="adash-comparison" content="ready">
```

`data-adash-comparison="ready"` on the leading `<html>` start tag also works. A
meta that is the first child of an explicit `<head>` is in `document.head` in
every browser, so a page the build accepts is a page the runtime accepts. Any
other placement is rejected at build time, including ones a browser would
accept: a comment, text, `<title>` or `<template>` before the meta, a different
attribute order or letter case, or a meta outside the head. Run the page through
`markComparisonReady(html)` (from `src/decision-flow.mjs`). It inserts the
canonical marker right after the `<head>` start tag, creating `<head>` or
`<html>` if missing, and never removes anything. From a
`file:` dashboard the frame is unreadable and the dialog reports failure.

## Tables, charts, new-tab links

Decision-flow cards accept optional `tables` and `charts` arrays. Visuals appear
inline in list mode and in the existing answer sheet in story mode. Text is
escaped; authored HTML and unknown object keys are refused.

- `tables: [{ caption, columns: [string], rows: [[cell]], align?: [alignment] }]`.
  Each card allows 1–4 tables, each with 1–12 columns and 1–100 rows. Captions
  and column names are nonblank strings up to 160 characters. Each row matches
  the column count. A cell is a nonblank string up to 500 characters, a finite
  number, or `{ status: "pass" }`. The closed status set is `works`, `fixed`,
  `pass`, `bug`, `fail`, `open`. Use `—` for blank cells; `""` is refused.
  Optional `align` matches the column count and uses only `left`, `center`,
  or `right`.
- `charts: [{ type: "bar" | "line", title, unit, series: [{ name,
  values: [{ label, value }] }] }]`. Each card allows 1–4 charts, each with
  1–4 series and 1–30 points per series. Title is nonblank, up to 160
  characters; unit up to 40; series names and point labels up to 80. All
  series share the same unique ordered labels. Values are finite numbers
  with absolute magnitude at most 1e12, including negative and zero values.
  Charts include an exact accessible data summary and a Chart data disclosure.
  Small plots fit phone cards; dense plots and wide tables scroll locally.
  Panels use the page's card theme tokens in both system color schemes.
- `rail: [{ label, value, href, newTab: true }]` opens a separate tab with
  `rel="noopener noreferrer"`. `newTab` is boolean; `false` or omission keeps
  same-tab behavior. When supplied, the rail shape is strict: nonblank label
  up to 160 characters, nonblank value up to 500, and an absolute HTTP(S)
  href with a hostname, no credentials, whitespace, or backslash.

Strings refuse control characters. Combined serialized tables, charts, and
rails declaring `newTab` are capped at 256 KiB of UTF-8 per dashboard;
renderer and hosted prepare enforce this. The prepare manifest records
`visualPayloadBytes` and final `htmlBytes`. Flow/statecharts are unsupported.

BUILD computes the Details total from final MP3 durations, distinct rail values
labelled exactly `Section`, and final card count. Producers must not prepend
manual totals to subtitles. An exact legacy leading `Total audio N min N s · N
sections · N cards.` prefix is removed when the computed total is available;
the remaining subtitle is retained. With no valid clip durations, direct
renderer calls preserve the subtitle and omit the computed total.
