# AD2 word seek proof

Status: implementation proof; full audio eval suite remains RED on existing failures.

Base: 218a5a50111819cf8efd146890e0ed0b5341d372. The before captures use
that handler; the after captures add only the transcript focus exclusion.
Both use the same generated synthetic transcript and seekable silent PCM audio.
The fixture sets transcript line height to 40px to expose the focus jump reliably.
The time readout is a test overlay showing the real audio element's currentTime.

- `1280-red.png`, `390-red.png`: before, pointer click does not seek.
- `1280-green.png`, `390-green.png`: after, seek lands at 9.00s / 3.60s.
- `1280-pixel-diff.png`, `390-pixel-diff.png`: Pillow absolute RGB pixel differences.
- `word-click.gif`: real Chromium captures before/down/up, before then after.
- `keyboard.gif`: real Chromium captures of focus then End, after only; keyboard code unchanged.

GIFs are frame sequences at interaction boundaries, not continuous screen recordings.
The eval verifies pointerdown/mouseup/click target identity, audio landing within
0.1s, keyboard End word visibility clear of controller/dock, citation selection,
note textarea focus and modal dismissal at both viewport widths.

Reproduce captures with `AD2_OUTPUT=docs.local/ad2/green bun test skills/golem-powers/audio-dashboard/evals/decision-flow-word-seek.test.mjs`.
Capture the unchanged handler to `docs.local/ad2/red`, then run
`python3 skills/golem-powers/audio-dashboard/evals/ad2-visual-proof.py`.

Focused regression: RED exit 1 (both viewports), GREEN exit 0 (2 tests, 16 assertions).
Baseline full evals: 256 pass, 2 skip, 11 fail (including the 2 new regression failures).
Fixed full evals initially: 258 pass, 2 skip, 9 fail.
Nine existing failures reproduce with the unchanged handler: eight voice/render
gate failures and one drag-selection test whose word bounding box is null.
No existing tests or gates were changed to suppress these failures.

Final validation:

- Full audio eval command: exit 1; 258 passed, 2 skipped, 9 baseline failures.
- Full `python3 -m pytest scripts/tests -q`: exit 0; 784 passed, 1 skipped, 1078 subtests passed.
- `node scripts/ci/canon-drift-lint.mjs --check`: exit 0.
- `bash scripts/check-publish-boundary.sh`: exit 0; no new violations.
- `git diff --cached --check`: exit 0.
- Staged-added-line private-path scan: no matches (rg exit 1).
- CodeRabbit bounded local light review: exit 0, zero findings.
