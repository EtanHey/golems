# Transcript sections and visual cuts

Run in a fresh workdir, keeping the input recording read-only:

```bash
bash scripts/cut-pass.sh "$VIDEO" "$WORKDIR" 5
# Read the SRT; write draft.tsv with one subject/task per row.
python3 scripts/sections.py "$WORKDIR/draft.tsv" "$WORKDIR/cuts.tsv" "$DURATION" \
  --out "$WORKDIR/sections.tsv"
# Optional runner corrections, applied after automatic reconciliation:
python3 scripts/sections.py "$WORKDIR/draft.tsv" "$WORKDIR/cuts.tsv" "$DURATION" \
  --overrides "$WORKDIR/overrides.tsv"
```

Cut-pass samples at `min(requested fps, source-fps.sh average)` (default 5).
Full-size PNGs live in `cut-frames/`. `cut-pass.log` retains ffmpeg diagnostics.
After the fps filter, `select='gte(scene,0)'` computes ffmpeg's deterministic
`lavfi.scene_score` for every sampled frame (0–1, first frame 0). This metric
compares successive samples using ffmpeg's scene-change algorithm; scores depend
on the ffmpeg version and sampling rate. `cuts.tsv` is headerless `pts_s, score`,
TAB separated. Times are sampled output PTS, relative to the video start.
Every PNG is registered through H2 provenance as `source=cut`, including exact-byte
SHA256 and `repeat_of`. The existing ten headerless ledger columns are preserved
(see [provenance.md](provenance.md)). Extraction does not mean inspection.

All section files use TAB-separated columns; input headers are optional:

- Draft: `id, start_s, end_s, topic, why` (nonempty unique ids).
- Final: draft columns plus `boundary_source, cut_pts_s, cut_score, origin_id`, with a header.
- Overrides: `id, start_s, end_s`, referring to the **final** sequential ids (`S01`, `S02`, …), never draft ids.

Defaults: `--snap-window 2` seconds inclusive, `--max-section 90` seconds,
`--min-section 3` seconds. Positive-score cuts only; strongest score wins,
with earlier PTS breaking ties. Metadata describes each section's **start**;
the initial zero boundary is transcript-sourced. No cut in the window keeps the
transcript boundary. Crossing snaps fail. Short sections merge first, into the
neighbour whose original transcript topic boundary is nearer the short section's
midpoint (ties left; endpoints have only one neighbour). Topics/reasons combine,
and the neighbour's original draft id survives as `origin_id`. A sole section may be shorter than the minimum.
Long sections then split repeatedly at the strongest internal cut leaving at
least the minimum on each side; topics/reasons and original draft id carry forward.
After snap/merge/split, final ids are sequential in time order: `S01`, `S02`, …,
zero-padded to at least two digits, with a uniform width that grows with the section count.
No usable internal cut fails `LONG_SECTION_NO_CUT`.

Overrides move both shared edges, updating adjacent intervals; conflicting
adjacent overrides fail `OVERRIDE_CONFLICT`. Moved starts become transcript-sourced.
Overrides are authoritative over length thresholds. Each accepted override appends
`id, origin_id, old_start_s, old_end_s, new_start_s, new_end_s` to `sections-overrides.log`.
The final TSV is also printed. Keep the draft to rerun: final has extra columns.
Draft, reconciled and overridden sections must be contiguous, non-overlapping,
cover exactly `[0, duration]`, and have `start < end`. Named errors include
`GAP`, `OVERLAP`, `COVERAGE`, `INVALID_INTERVAL`, `INVALID_NUMBER`, `INVALID_CUTS`,
`INVALID_ID`, `INVALID_COLUMNS`, `INVALID_OVERRIDE_ID`, and `INVALID_THRESHOLDS`.
Validation failures leave existing output and override logs untouched.
