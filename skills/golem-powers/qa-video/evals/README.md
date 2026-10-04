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
Timeout and stream/truncation recovery are also covered in `../tests/`.

Fixtures are generated, synthetic 480x240 RGB PNGs: Arial 28px labels, white
background, optional red banner and blue circles. `alpha.png` has ALPHA,
ERROR: OFFLINE, three circles; `beta.png` has BETA, no banner, five circles.
No user screenshots or private evidence are included.
