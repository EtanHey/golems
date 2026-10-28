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

## Rendered HTML evidence gate

Run `bun scripts/validate-evidence.mjs --spec <job.json> --published "<sync command>"`
after rendering and publishing, as in the canonical pipeline. The gate inspects
`.df-card`, `.dbx-card`, `.card`, and `[data-card]` surfaces, including nested
markup. A card without `svg`, `canvas`, `img`, or `figure` rejects as
`TEXT_ONLY_VIEW_DETAILS` if it contains `<details>` or a View details control.
Control icons do not count as visualizations. The teleprompter outside cards is
unaffected. Hand-built cards must use one of these card markers.
Replay the RED/GREEN HTML fixtures with `bun test evals/card-html.test.mjs`.
