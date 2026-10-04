#!/usr/bin/env bash
# Dispatcher-owned deterministic media prep. The manifest is the reader handoff.
set -euo pipefail
usage() { echo 'usage: prepare.sh <video> <workdir> [--fps N] [--mode qa|gems]' >&2; exit 2; }
die() { echo "prepare: $*" >&2; exit 1; }
[[ $# -ge 2 ]] || usage
VIDEO="$1"; WORKDIR="$2"; shift 2
FPS=10; MODE=qa
while [[ $# -gt 0 ]]; do
  [[ $# -ge 2 ]] || usage
  case "$1" in
    --fps) FPS="$2" ;;
    --mode) MODE="$2" ;;
    *) usage ;;
  esac
  shift 2
done
[[ "$FPS" =~ ^(5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20)$ ]] || usage
[[ "$MODE" == qa || "$MODE" == gems ]] || usage
mkdir -p "$WORKDIR"
WORKDIR="$(cd "$WORKDIR" && pwd -P)"
# A concurrent dispatcher must not invalidate another run's readiness.
mkdir "$WORKDIR/.prepare.lock" 2>/dev/null || die "workdir already preparing: $WORKDIR"
trap 'rm -f "$WORKDIR/manifest.json.tmp"; rmdir "$WORKDIR/.prepare.lock"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
rm -f "$WORKDIR/manifest.json"
for tool in ffmpeg ffprobe whisper-cli python3; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool not found on PATH (see qa-video prerequisites)"
done
MODEL="${WHISPER_MODEL:-$HOME/.cache/whisper/ggml-small.bin}"
[[ -s "$MODEL" ]] || die "whisper model missing: $MODEL (install ggml-small or set WHISPER_MODEL)"
[[ -f "$VIDEO" ]] || die "video not found: $VIDEO"
VIDEO="$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve())' "$VIDEO")"
SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
for script in scene-cues.sh dense-windows.sh; do
  [[ -r "$SCRIPTS/$script" ]] || die "missing helper: $SCRIPTS/$script"
done
DURATION="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$VIDEO")"
python3 -c 'import math,sys; d=float(sys.argv[1]); assert math.isfinite(d) and d>0' "$DURATION" \
  || die "cannot determine a positive video duration"
mkdir -p "$WORKDIR/frames" "$WORKDIR/dense"
ffmpeg -hide_banner -loglevel error -nostdin -y -i "$VIDEO" -vn \
  -acodec pcm_s16le -ar 16000 -ac 1 "$WORKDIR/audio.wav"
# Remove old transcripts so a successful but non-writing whisper cannot reuse them.
rm -f "$WORKDIR/transcript.srt" "$WORKDIR/transcript.txt"
whisper-cli -m "$MODEL" -f "$WORKDIR/audio.wav" --output-srt --output-txt \
  -of "$WORKDIR/transcript" -l auto
[[ -f "$WORKDIR/transcript.srt" && -f "$WORKDIR/transcript.txt" ]] \
  || die 'whisper did not produce SRT and TXT'
# Deterministic narration cues; the reader still performs semantic analysis.
python3 - "$WORKDIR" "$MODE" <<'PY'
import pathlib, re, sys
root, mode = pathlib.Path(sys.argv[1]), sys.argv[2]
actions = r'click\w*|press|tap|hover|drag|drop|scroll|open|close|select|toggle|switch|type|when I|now I|this|here|look|watch'
gems = r'insight|surpris\w*|important|claim|benchmark|example|warning|recommend|\d+'
pattern = re.compile(r'\b(?:' + (actions if mode == 'qa' else gems) + r')\b', re.I)
def seconds(t):
    h, m, s = t.replace(',', '.').split(':')
    return int(h)*3600 + int(m)*60 + float(s)
rows = []
for block in re.split(r'\n\s*\n', (root/'transcript.srt').read_text().strip()):
    match = re.search(r'(\d{2}:\d{2}:\d{2}[,.]\d+) --> (\d{2}:\d{2}:\d{2}[,.]\d+)', block)
    if match and pattern.search(block[match.end():]):
        rows.append(f'{seconds(match[1]):.3f}\t{seconds(match[2]):.3f}\t{"action" if mode == "qa" else "gem"}\n')
(root/'cues.tsv').write_text(''.join(rows))
PY
bash "$SCRIPTS/scene-cues.sh" "$VIDEO" >> "$WORKDIR/cues.tsv"
# Static/silent media still gets an initial dense window and coverage pass.
[[ -s "$WORKDIR/cues.tsv" ]] || printf '0\t0\tcoverage-fallback\n' > "$WORKDIR/cues.tsv"
bash "$SCRIPTS/dense-windows.sh" "$VIDEO" "$WORKDIR/cues.tsv" "$WORKDIR/dense" "$FPS"
# Strictly before EOF: a seek exactly at duration produces no image.
python3 - "$DURATION" <<'PY' > "$WORKDIR/coverage-times.txt"
import sys
for t in range(0, int(float(sys.argv[1])) + 1, 30):
    if t < float(sys.argv[1]):
        print(t)
PY
while IFS= read -r t; do
  rm -f "$WORKDIR/frames/interval-${t}s.jpg"
  ffmpeg -hide_banner -loglevel error -nostdin -y -ss "$t" -i "$VIDEO" \
    -frames:v 1 -q:v 2 "$WORKDIR/frames/interval-${t}s.jpg"
done < "$WORKDIR/coverage-times.txt"
# Validate every handoff artifact, then atomically publish ready only on success.
python3 - "$WORKDIR" "$VIDEO" "$DURATION" "$MODE" "$FPS" "$MODEL" <<'PY'
import json, pathlib, subprocess, sys
root, video, duration, mode, fps, model = sys.argv[1:]
root = pathlib.Path(root)
sheets = [str(root/'dense'/row.split('\t')[0]) for row in (root/'dense/index.tsv').read_text().splitlines()]
coverage = [str(root/'frames'/f'interval-{t}s.jpg') for t in (root/'coverage-times.txt').read_text().splitlines()]
assert sheets and coverage, 'missing sheet or coverage outputs'
for p in sheets + coverage + [str(root/'dense/frames.tsv'), str(root/'cues.tsv')]:
    assert pathlib.Path(p).stat().st_size > 0, f'empty artifact: {p}'
versions = {}
for tool, flag in [('ffmpeg', '-version'), ('ffprobe', '-version'), ('whisper-cli', '--version')]:
    result = subprocess.run([tool, flag], capture_output=True, text=True)
    output = (result.stdout + result.stderr).strip()
    assert output, f'no version/help output: {tool}'
    lines = [line for line in output.splitlines() if 'version' in line.lower()]
    assert result.returncode == 0 and lines, f'cannot read version: {tool}'
    versions[tool] = lines[0]
manifest = dict(ready=True, video=video, duration_seconds=float(duration), mode=mode,
                fps=int(fps), contact_sheets=sheets, coverage_frames=coverage,
                transcript={kind: str(root/f'transcript.{kind}') for kind in ['srt', 'txt']},
                cues=str(root/'cues.tsv'), index=str(root/'dense/index.tsv'),
                frame_timestamps=str(root/'dense/frames.tsv'),
                whisper_model=str(pathlib.Path(model).resolve()), tool_versions=versions)
target = root/'manifest.json.tmp'
target.write_text(json.dumps(manifest, indent=2) + '\n')
target.replace(root/'manifest.json')
PY
echo "prepare: ready -> $WORKDIR/manifest.json"
