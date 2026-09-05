---
paths:
  - "flow-bar/**"
  - "scripts/**"
---

# VoiceBar Visual Verification

> Path-scoped rule for `flow-bar/**` and any VoiceBar UI/mock work. Born: the 2026-06-11 v9 incident — a build shipped 4× on snapshot evidence and was rejected by the operator. Promoted from voicelayer `docs.local/design/v9-incident-rules-drafts.md` via the skills-ctx rules-promotion path (PLAN §9).

---

- A **SwiftUI snapshot render** or a **cropped band capture** is NOT visual verification — it shows content in isolation, not notch-conformance, position, or whether it reads as a notch bar. ("recording.png matched the mock" while the deployed app was "not a notch bar app" — 2026-06-11.)
- The ONLY valid visual check is a **real screenshot of the ACTUAL running app on the real screen**, showing the bar IN the notch context (camera island + menu bar), side-by-side with the mock.
- "`swift test` green + snapshot matches mock" = **meaningless** for visual correctness. Tests catch crashes/logic, never appearance.
- Mock QA renderer: full Chrome `--headless=new`. **`chrome-headless-shell` is BANNED** (no backdrop-filter/clip-path — root cause of 3 broken ships). The Antigravity real-renderer qa-video gate is mandatory per design iteration.
- **Rendered mocks are reference-for-feel, NEVER structural truth.** Etan's verbatim spec outranks pixels ("the images are not structured right").
