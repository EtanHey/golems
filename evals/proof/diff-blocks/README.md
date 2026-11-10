# Diff fence proof

Synthetic instruction-review card rendered through `renderDecisionFlow`, Chromium,
1280×844 and 390×844, dark and light system preferences. The existing code well
uses an opaque dark palette in both themes. No paid calls or audio validation.

Before: origin/master cfca596f, original renderer and copy assets.
After: this branch's renderer and assets. Side-by-side shows the same raw fence.
GIF: none: no animation or interaction changed

Fail-first test against master: 1 pass, 2 fail (classification and exact raw copy).
Candidate focused test: 3 pass, 0 fail. Browser checks clipboard bytes and computed
contrast >=4.5:1 for each line, in both system themes. Non-diff snapshot passes
on both versions. Screenshots are visual evidence, not narration or release proof.
