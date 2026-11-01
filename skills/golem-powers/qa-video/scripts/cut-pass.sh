#!/usr/bin/env bash
# Sample full-size frames; score consecutive samples with ffmpeg's scene metric.
set -euo pipefail
[[ $# -ge 2 && $# -le 3 ]] || { echo 'usage: cut-pass.sh <video> <workdir> [fps=5]' >&2; exit 2; }
SCRIPTS="$(cd -- "$(dirname -- "$0")" && pwd)"
VIDEO="$1"; WORK="$2"; FPS="${3:-5}"
RATE="$(bash "$SCRIPTS/source-fps.sh" "$VIDEO")"
FPS="$(python3 - "$FPS" "$RATE" <<'PY'
import math, sys
try:
    requested, source = map(float, sys.argv[1:])
    if not all(math.isfinite(n) and n > 0 for n in (requested, source)):
        raise ValueError('invalid rate')
except ValueError:
    sys.exit('cut-pass: INVALID_FPS: expected positive finite rates')
print(min(requested, source))
PY
)"
[[ ! -e "$WORK/frames.tsv" && ! -e "$WORK/cuts.tsv" && ! -e "$WORK/cut-frames" ]] || {
  echo 'cut-pass: OUTPUT_EXISTS: use a fresh workdir' >&2; exit 1;
}
mkdir -p "$WORK/cut-frames"
ffmpeg -hide_banner -nostdin -n -i "$VIDEO" -map 0:v:0 \
  -vf "fps=$FPS,select='gte(scene,0)',metadata=print" -fps_mode passthrough \
  "$WORK/cut-frames/frame-%06d.png" 2> "$WORK/cut-pass.log"
python3 - "$SCRIPTS" "$WORK" <<'PY'
import re, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from provenance import record
work = Path(sys.argv[2]).resolve()
log = (work/'cut-pass.log').read_text()
pts = re.findall(r'frame:\s*\d+\s+pts:.*?pts_time:([-\d.e+]+)', log)
scores = re.findall(r'lavfi.scene_score=([\d.e+-]+)', log)
frames = sorted((work/'cut-frames').glob('frame-*.png'))
if not frames or not len(frames) == len(pts) == len(scores):
    sys.exit('cut-pass: FRAME_SCORE_MISMATCH: inspect cut-pass.log')
record(work, [(f, t, 'cut', '', '', '') for f, t in zip(frames, pts)])
(work/'cuts.tsv').write_text(''.join(f'{t}\t{s}\n' for t, s in zip(pts, scores)))
print(f'cut-pass: {len(frames)} frames; cuts={work / "cuts.tsv"}')
PY
