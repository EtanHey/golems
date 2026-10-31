#!/usr/bin/env bash
# Per-step audio/transcription helper; hotspot judgement belongs to the agent.
set -euo pipefail
[[ $# -eq 2 ]] || { echo 'usage: extract.sh <video> <workdir>' >&2; exit 2; }
VIDEO="$1"; WORKDIR="$2"
mkdir -p "$WORKDIR"
# Failed retries must not leave an old transcript available for analysis.
rm -f "$WORKDIR/transcript.srt" "$WORKDIR/transcript.txt"
for tool in ffmpeg whisper-cli; do
  command -v "$tool" >/dev/null 2>&1 || { echo "extract: $tool not found on PATH" >&2; exit 1; }
done
MODEL="${WHISPER_MODEL:-$HOME/.cache/whisper/ggml-small.bin}"
[[ -s "$MODEL" ]] || { echo "extract: whisper model missing: $MODEL (install ggml-small or set WHISPER_MODEL)" >&2; exit 1; }
[[ -f "$VIDEO" ]] || { echo "extract: video not found: $VIDEO" >&2; exit 1; }
ffmpeg -hide_banner -loglevel error -nostdin -y -i "$VIDEO" -vn \
  -acodec pcm_s16le -ar 16000 -ac 1 "$WORKDIR/audio.wav"
whisper-cli -m "$MODEL" -f "$WORKDIR/audio.wav" --output-srt --output-txt \
  -of "$WORKDIR/transcript" -l "${WHISPER_LANGUAGE:-en}" \
  --max-context 0 --suppress-nst --entropy-thold 2.4 --logprob-thold -1.0 \
  --no-speech-thold 0.6 --temperature 0 --temperature-inc 0.2
[[ -f "$WORKDIR/transcript.srt" && -f "$WORKDIR/transcript.txt" ]] \
  || { echo 'extract: whisper did not produce SRT and TXT' >&2; exit 1; }
echo "extract: audio + SRT/TXT -> $WORKDIR"
