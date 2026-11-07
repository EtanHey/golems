# Account answer persistence visual proof

Status: captured from the pinned base and candidate with real Chromium.
Base: `e74ac6ab6e5b0d546eaef85df604d8237fc6549b`.

Neutral fixture: one question, Keep/Change, and one three-word scene. No private
reference dashboard content is included. Each renderer was captured at 1280×900
and 390×900 under light and dark system preferences. Both templates retain their
existing dark palette under either preference. Decision-flow also has story-view
captures. Cinema captures use its classic-list answer surface.

`*-before.png` renders the base checkout. `*-after.png` renders the candidate.
`*-diff.png` shows amplified pixel differences; `diffs.json` records changed-pixel
counts, not an approval threshold. `capture.json` pins the base and rendered HTML
hashes. Account injection is absent for these captures, so the after images must
show “Answers saved on this device only.” The browser tests separately exercise
account and parent-frame bridges, remote changes and pending edits.

Inspection: the fallback status is readable in list and story modes and above
cinema decisions; controls retain their existing styling. The added status row
uses normal document flow in list mode and reserved transport space in story
mode. No animation was added.
