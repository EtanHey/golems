# Card detail affordances

Attribution: Etan, 2026-10-28 dashboard feedback.

A card without a visualization must not have a **View details** expander.
Repeating its existing text adds no useful detail. It may have no secondary
action, or offer **Listen deeper** to open an inner audio section: a more
detailed narrated sub-dashboard for that topic, with the same real-word-timed
read-along and word-click seek mechanics. Comparisons are the canonical use.
Cards with a visualization keep their existing detail affordance.

## Authoring-spec lint

Before rendering, describe each card's intended affordance in a separate format
spec. This is an authoring check, not new renderer job fields or an implementation
of the Listen deeper interaction. Declare `visualization` explicitly as a boolean;
`detailAffordance` may be omitted, `view-details`, or `listen-deeper`.
Listen deeper also requires `innerAudio` with non-empty `sceneIds`, `readAlong:
true`, and `wordSeek: true`. The scene IDs identify the intended deeper narration;
the author must supply and verify that audio through the normal pipeline.

```json
{
  "cards": [
    { "id": "comparison", "visualization": false,
      "detailAffordance": "listen-deeper",
      "innerAudio": { "sceneIds": ["comparison-deep"],
        "readAlong": true, "wordSeek": true } },
    { "id": "chart", "visualization": true, "detailAffordance": "view-details" },
    { "id": "summary", "visualization": false }
  ]
}
```

Run `bun scripts/lint-card-format.mjs <cards.json>` from the skill directory.
It rejects a text-only View details spec as `TEXT_ONLY_VIEW_DETAILS` (exit 1).
Invalid declarations and incomplete inner-audio specs also fail closed. This lint
checks the declared plan; it does not inspect HTML or prove audio playback.
Replay the regression check with `bun test evals/card-format.test.mjs`.
