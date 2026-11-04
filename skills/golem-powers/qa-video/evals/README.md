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

Cases 15–16 pin the full narrated pass and silent visual catalog failures; case
17 is the unchanged ordinary-debrief control. `full-pass-score.py <capture.json>`
scores structured plans plus intercepted dispatch calls. A capture has `case`,
`available_frame_ids`, `dispatches`, and `plan` with `selected_frame_ids`,
`own_frame_ids`, `helper_batches` (`frame_ids` per batch), `densify_windows`,
`continue_with_unread_and_time`, `partial_causes`, `coverage_line_template`.
This is bounded live instruction-following evidence, not an executed video audit:
planned frames and stub attempts never count as reads/completed helpers. Runtime
model/effort, source hashes, elapsed seconds and auth/cost accompany each record.
No media or personal paths belong in committed results.

The managed `agents/video-gems.md` is picked up by the existing qa-video agents
glob in `orc/scripts/install.sh`; installation (including backup of a regular
file) is separate from eval/packaging proof.
