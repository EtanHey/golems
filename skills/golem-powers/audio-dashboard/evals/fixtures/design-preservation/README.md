# Design preservation regression fixtures

Synthetic fixtures; no operator quotes, identities, or private dashboard content.
The previous/preserved pair changes copy while retaining the presentation.
Each named HTML removes one invariant. Behavior fixtures add decoded silent WAV
media, a word-seek handler, scoped clear buttons and an overall reset; their RED
variants remove one behavior. The reset variants cover each control separately.

Seed case IDs: AD-02 (persistent transport), AD-06 (transcript surface), AD-07
(question clear), AD-10 (playback state), AD-20 (stable layout), AD-32 (transcript).
This checks artifact preservation, not narration quality or agent uplift.

Run `bun test skills/golem-powers/audio-dashboard/evals/design-preservation.test.mjs`
and `bun test skills/golem-powers/audio-dashboard/evals/design-behavior.test.mjs`.
The local HTML CLI also exercises the completion entry point. A synthetic HTTP
server tests byte equality and publication-history custody; it is not a tailnet probe.

`proof/` contains desktop/390px PNGs and report-only pixel ratios for a copy edit.
`behavior/proof-result.json` retains decoded-media seek evidence: 0 to 1.5 seconds
at both widths; its PNGs show the initial state before any probe interaction.
