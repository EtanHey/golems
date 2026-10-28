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
