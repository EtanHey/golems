# Visual-gatherer evals

`python3 evals/run_suite.py` validates packaging and exercises the routing capture
scorer, including rejected lead-Read and judgment counterexamples. It does not
claim a live Agent-tool dispatch or a model-based routing uplift. Score actual
parent tool traces with `python3 evals/run_suite.py <capture.json>`; captures use
`{"case":"screenshots|judgment","image_paths":["/frame.png"],"calls":[{"tool":"Agent","arguments":{"subagent_type":"visual-gatherer"}}]}`.
Document Reads are allowed; image Reads and Reads without an auditable path fail.

`python3 evals/run_suite.py --live` runs the real helper twice, sequentially:
synthetic accuracy, then a forced 1ms print timeout with one singleton retry round.
Never run this concurrently with another Gemini call stream. Default CI is offline.
The first round uses batches of at most six images; only missing results from
those batches receive one serial singleton retry.
Timeout and stream/truncation recovery are also covered in `../tests/`.

Fixtures are generated, synthetic 480x240 RGB PNGs: Arial 28px labels, white
background, optional red banner and blue circles. `alpha.png` has ALPHA,
ERROR: OFFLINE, three circles; `beta.png` has BETA, no banner, five circles.
No user screenshots or private evidence are included.

## Full-pass regression cases

Case 15's Claude master baseline reproduces the thin pattern: 12/40 planned
frames and zero reader dispatches. Case 16's Codex master captures already plan
**all 48 frames**, scroll/hover refinement, continued unread work and a strict
partial-stop policy. They fail narrowly on reader/batch counts and coverage-line
wording; they do not demonstrate missing-frame coverage. Case 17 is the ordinary
debrief control; case 18 adds "full transcript debrief" as a false-trigger check.
The old results are historical evidence for `9cef80ad`, not the round-2 text.

`full-pass-score.py <capture.json>` scores structured plans and intercepted calls;
its current batch check caps each helper task at six full-size frames, including
overlap. The round-1 replay explicitly disables that new cap to retain its
original verdicts. The round-1 coverage-line check is a literal template match,
not observed behaviour. Its measured prompt partly reveals the answer: it supplies
the scorer's field names, stop-cause identifiers and known scroll/hover cues.
Those seeded scores cannot establish independent discovery or execution of the
workflow. The old captures, narrow failure reasons and exact redacted prompts
remain in `results/2026-11-04-full-pass.json`.

Round 2 removes those field names, cause identifiers and action cues from the
measured prompt. Natural-language plans are assessed by the existing pinned
semantic judge, with verbatim supporting quotes and prompt/claim/transcript
hashes; no regex over prose or footer-template match is used for that comparison.
The fresh results, individual verdicts and runtime provenance are recorded in
`results/2026-11-04-full-pass-r2.json`. A failed compound verdict is retained;
it is not silently upgraded from helper counts alone.

Both rounds are **planning-only** loaded-body A/Bs, not skill-free baselines or
executed video audits. Planned frames and stub attempts are not reads or completed
helpers: actual media reads and completed helpers are zero. They run from a
**top-level cell**; the nested `Agent(video-gems)` / NEEDS_READERS handoff has no
live eval. Sample sizes are small: one Claude capture per arm per case, three
Codex captures per arm for the silent case. Report pass counts, not an uplift or
statistical claim. Runtime model/effort, source hashes, elapsed time and API cost
accompany records. No media or private paths belong in committed results.

The managed `agents/video-gems.md` is picked up by the qa-video agents glob in
`skills/golem-powers/orc/scripts/install.sh`. Installation, including backup of a
regular file, is separate from packaging and planning proof. The six-frame cap
borrows the real visual-gatherer's six-image call limit; applying it to large
full-size frames is a conservative policy, not a measured context-capacity guarantee.

## Cue-bracketing regression (offline)

Run `python3 evals/test_cue_bracket.py` (also included in `evals/run_suite.py`)
from this skill directory. The invented SRT and synthetic cue list in
`fixtures/cue-bracket/` describe speech at 6s after a screen cue at 3.5–4.5s.
The test generates an 8s black video with a white frame window using ffmpeg;
there is no person's speech or screen and no model call. It checks actual
ffmpeg decoded PTS and white pixels, not image-reader accuracy or command legibility.

On master `4ed1012edad2956d1b41eaf7886fc93cb0015f67`, the same test's
historical single-still fallback decodes only 6.0s and fails the target-window
assertion. Cue bracketing decodes 0.0s and 4.0s, hitting the target window.
The other case checks a first-segment cue and unscored preceding segments.
This is a bounded mechanical regression, not a model-arm uplift claim.
Live model arms: NOT_RUN (not required for this change).
