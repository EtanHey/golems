# Card/audio summary disclosure

Static Chromium proof at 1280 and 390 px. Before renders `decision-flow.mjs`
from base `3309f088`; after renders this branch with identical synthetic inputs.
Only the new summary disclosure changes. No template files or interactions change.
The label remains visible outside the answer sheet and teleprompter.

- [Desktop before](1280-before.png) / [after](1280-after.png) / [diff](1280-diff.png)
- [Mobile before](390-before.png) / [after](390-after.png) / [diff](390-diff.png)
- [Measured visibility and media calls](observations.json), [pixel differences](diffs.json)

The browser ran muted, intercepted play, and recorded zero media play calls.
The isolated data URL has no account provider; the storage warning is expected.
This is synthetic renderer proof, not live audio or hosted account-sync proof.
