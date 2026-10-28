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

