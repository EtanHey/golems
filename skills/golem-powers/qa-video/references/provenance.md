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
not the nominal `r_frame_rate`. Dense sampling permits 1–120 fps, warns above the
source average, and proceeds. An average does not describe every VFR interval.
Coverage selects a full-resolution still at 0, 30, 60… seconds before duration;
its PTS comes from decoded `showinfo` with `-copyts`, not the requested seek.
Dense/refine keep their existing fps-filter/showinfo timestamps plus seek offset;
these are sampled output presentation times, including duplicated samples.
Full-resolution JPEGs (`-q:v 3`) are written directly as `window_N-f_*.jpg`;
`DENSE_FRAME_FORMAT=png` explicitly selects lossless `window_N-f_*.png` instead.
The selected file is the durable inspection target: its own absolute path,
SHA256 and PTS are registered, with source=dense/refine and empty crop_of.
Only sheets are scaled. After each window and on failure, cleanup removes only
unregistered per-frame files; any local/run ledger reference always survives.
A failed window can therefore retain already-registered frames. `--keep-frames`
(trailing flag) or `DENSE_KEEP_FRAMES=1` also retains unregistered intermediates.
`DENSE_KEEP_LIST=<file>` protects additional absolute frame paths or output-relative
basenames, or `sheet<TAB>tile` rows (zero-based tile; sheet relative to this outdir).
A keep list supplements ledger retention; it never prunes referenced frames.
Before each window, `du -sk` checks this outdir against `DENSE_MAX_GB` (default 5,
1 GB = 1048576 KiB). Exceeding it refuses with `DENSE_BUDGET_EXCEEDED` and exact
used/max KiB before starting that window. This is a pre-window check, so a single
window can exceed the budget; it is not a global disk or concurrent-job limit.
Below 100 GB free (`df -g` / `df -k`), cap parallel dense-window jobs at 2;
this is a caller rule, with no slot-lock implementation. Logs (`window_N-showinfo.log`) and decoded
PTS (`window_N-pts.txt`) also stay flat beside them. Use fresh directories for retries.

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
local and root ledgers: the root contains each frame once. Record writers sharing
a run serialize ledger checks and appends with a run-level `fcntl` lock held on
`.provenance.lock` in the run root. `inspected.sh` accepts only existing frames
registered in that ledger.
It appends headerless `pts_s, frame, why, finding, sha256` to `inspected.tsv`; use it only
after actually viewing the full-size image or crop, never for merely extracting it.

`coverage-count.sh` prints exactly `extracted=N unique=N repeated=N inspected=N
pre-sorted-only=N` on one line. Unique means non-repeat rows. Inspected counts
distinct recorded frame paths whose inspection digest matches both the recorded
digest and current file bytes, so rechecks do not inflate it. Missing or changed
files and legacy inspection rows without a digest do not count; inspect again
after viewing the recorded bytes.
Pre-sorted-only counts recorded frames on successful (`ok: true`) helper sheets
in `visual/findings.jsonl`, excluding inspected paths; unread/unprocessed frames
are not called pre-sorted. These are artifact counts, not proof of human viewing.
