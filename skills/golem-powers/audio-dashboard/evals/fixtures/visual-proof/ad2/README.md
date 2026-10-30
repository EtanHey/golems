# AD2 word seek proof

Status: regenerated after Claude r1. Production fix unchanged and approved by r1;
lead verification of these regenerated artifacts is pending.

Base handler: 218a5a50111819cf8efd146890e0ed0b5341d372. Before captures use
that handler; after captures add only the transcript focus exclusion.
Both use the same generated synthetic transcript and seekable silent PCM audio.
The fixture sets transcript line height to 40px to expose the focus jump reliably.
The time readout is a test overlay showing the real audio element's currentTime.

## Visually inspected artifacts

Each PNG and every decoded GIF frame was viewed after regeneration.

- `1280-red.png`: Audio: 0.00s, word74 hover underline after the focus jump; no target highlight.
- `1280-green.png`: Audio: 9.00s, word90 highlighted amber.
- `390-red.png`: Audio: 0.00s, word36 visible lower in the shifted transcript, without an amber highlight.
- `390-green.png`: Audio: 3.60s, word36 highlighted amber.
- `1280-pixel-diff.png`: absolute RGB difference, including ghosted text at the two scroll positions and amber word90.
- `390-pixel-diff.png`: absolute RGB difference, including ghosted text at the two scroll positions and amber word36.
- `word-click.gif`: five decoded frames. BEFORE shows 0.00s and the transcript jump;
  AFTER shows the stable transcript, then Audio: 3.60s with word36 highlighted amber.
  Caption text sits in a separate 52px band above the unmodified capture; the full readout is visible.
- `keyboard.gif`: two decoded frames. Tab then ArrowRight shows the amber paragraph focus ring
  and glass outline on word37, with word36 still amber from the seek. End moves the glass outline
  to word239, visible inside the teleprompter and above the dock. Both frames show Audio: 3.60s.

GIFs are frame sequences at interaction boundaries, not continuous recordings.
The eval waits for both the readout (within 0.1s) and target highlight before pausing
and capturing a successful click. RED captures precede the failing target assertion.
Identical consecutive GIF frames may be merged by Pillow. All artifacts are below 160KB.

## Reproduction and scope

Run `env -u GOLEMS_EXPERT_VOICE AD2_OUTPUT=docs.local/ad2/green bun test skills/golem-powers/audio-dashboard/evals/decision-flow-word-seek.test.mjs`.
Capture the unchanged handler to `docs.local/ad2/red`, then run
`python3 skills/golem-powers/audio-dashboard/evals/ad2-visual-proof.py`.
Without AD2_OUTPUT, this eval uses an in-memory routed page and writes no HTML or screenshots.

The regression checks the under-controller paragraph precondition, real pointer target
identity and audio landing, real Tab entry with focus-visible under the controller,
ArrowRight hit-testing against clipping/overlays, End visibility clear of controller/dock,
citation selection, note textarea focus and modal dismissal at both widths.
Playing-audio clicks, default motion and keyboard smooth scrolling remain follow-ups.

Focused regression: RED exit 1 (both viewports), GREEN exit 0 (2 tests, 22 assertions).
The full audio eval run with GOLEMS_EXPERT_VOICE unset reports 266 pass, 2 skip,
1 fail: the previously reproduced drag-selection test has a null word bounding box.
The earlier run with the ambient voice override also had eight voice/render gate failures;
unsetting that override resolves those eight without changing their tests or gates.

## Validation after r1

- `env -u GOLEMS_EXPERT_VOICE bun test skills/golem-powers/audio-dashboard/evals`: exit 1; 266 passed, 2 skipped, 1 baseline failure.
- `python3 -m pytest scripts/tests -q`: exit 0; 784 passed, 1 skipped, 1078 subtests passed (403.01s).
- `node scripts/ci/canon-drift-lint.mjs --check`: exit 0.
- `bash scripts/check-publish-boundary.sh`: exit 0; 2339 paths scanned, no new violations.
- Focused default-mode eval: exit 0; existing HTML/PNG/GIF files unchanged by the run.
- Staged diff whitespace check: exit 0. Added-line private-path grep: exit 1 (no matches).
