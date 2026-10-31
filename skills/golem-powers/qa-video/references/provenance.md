# Frame provenance tools

Run commands sequentially in a fresh run directory. The source video is read-only.
Shell entry points support Bash 3.2 and call Python 3 / ffmpeg / ffprobe.

```bash
bash scripts/source-fps.sh "$VIDEO"
bash scripts/coverage.sh "$VIDEO" "$WORKDIR"
bash scripts/dense-windows.sh "$VIDEO" cues.tsv "$WORKDIR/dense" 50
QA_FRAME_SOURCE=refine bash scripts/dense-windows.sh "$VIDEO" refine.tsv "$WORKDIR/refine" 20 0 0
bash scripts/crop.sh "$FRAME" 100 200 300 400 "$WORKDIR/detail.png"
bash scripts/inspected.sh "$WORKDIR" "$FRAME" before F1
bash scripts/coverage-count.sh "$WORKDIR"
```

`source-fps.sh` reports ffprobe's video `avg_frame_rate`, evaluated as a rational,
not the nominal `r_frame_rate`. Dense sampling permits 5–50 fps, warns above the
source average, and proceeds. An average does not describe every VFR interval.
Coverage selects a full-resolution still at 0, 30, 60… seconds before duration;
its PTS comes from decoded `showinfo` with `-copyts`, not the requested seek.
Dense/refine keep their existing fps-filter/showinfo timestamps plus seek offset;
these are sampled output presentation times, including duplicated samples.
Full-resolution PNGs survive in `.frames/window_N/`; only sheets are scaled.
Logs and decoded PTS remain beside the frames. Use fresh directories for retries.

`frames.tsv` remains **headerless** for existing positional readers. Columns:

```text
sheet_file  tile  t_s  frame  pts_s  source  sheet  sha256  repeat_of  crop_of
```

The legacy three-column prefix stays unchanged. `frame` is absolute; `pts_s`
equals `t_s` in seconds to three decimals. `source` is coverage/dense/refine/crop.
`sheet` aliases `sheet_file`; sheet/tile are empty without a sheet. SHA256 hashes
the exact image file bytes. `repeat_of` points to the first identical SHA in run
append order, never a perceptual match. Crops inherit PTS and add `crop_of`.
Crops are lossless PNGs at original pixel size, with bounds checked; no scaling.
Debrief stills also carry appended provenance (source=refine).

Coverage creates the run ledger. A dense child mirrors rows into its parent run
when the parent has `frames.tsv`; `QA_RUN_DIR` explicitly selects another run root.
This shares repeat detection across coverage, dense, refinement and crops.
Directories named `refine*` default to source=refine; `QA_FRAME_SOURCE` overrides.
Each dense directory retains a local ledger for visual-batch.py. Do not sum both
local and root ledgers: the root contains each frame once. Concurrent writers are
unsupported. `inspected.sh` accepts only existing frames registered in that ledger.
It appends headerless `pts_s, frame, why, finding` to `inspected.tsv`; use it only
after actually viewing the full-size image or crop, never for merely extracting it.

`coverage-count.sh` prints exactly `extracted=N unique=N repeated=N inspected=N
pre-sorted-only=N` on one line. Unique means non-repeat rows. Inspected counts
distinct recorded frame paths in the ledger, so rechecks do not inflate it.
Pre-sorted-only counts recorded frames on successful (`ok: true`) helper sheets
in `visual/findings.jsonl`, excluding inspected paths; unread/unprocessed frames
are not called pre-sorted. These are artifact counts, not proof of human viewing.
