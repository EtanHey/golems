#!/usr/bin/env bash
# Per-step audio/transcription helper; hotspot judgement belongs to the agent.
set -euo pipefail
[[ $# -eq 2 ]] || { echo 'usage: extract.sh <video> <workdir>' >&2; exit 2; }
VIDEO="$1"; WORKDIR="$2"
mkdir -p "$WORKDIR"
# Failed retries must not leave an old transcript available for analysis.
rm -f "$WORKDIR/transcript.srt" "$WORKDIR/transcript.txt"
for tool in ffmpeg ffprobe whisper-cli; do
  command -v "$tool" >/dev/null 2>&1 || { echo "extract: $tool not found on PATH" >&2; exit 1; }
done
MODEL="${WHISPER_MODEL:-$HOME/.cache/whisper/ggml-small.bin}"
[[ -s "$MODEL" ]] || { echo "extract: whisper model missing: $MODEL (install ggml-small or set WHISPER_MODEL)" >&2; exit 1; }
[[ -f "$VIDEO" ]] || { echo "extract: video not found: $VIDEO" >&2; exit 1; }
# Frame pts_s count from the container start; the audio track may start later (0.159 s on a real
# recording). Pad that lead-in so transcript times share the frame timeline. N/A or negative -> 0.
probe() { ffprobe -v error "$@" -of csv=p=0 "$VIDEO" 2>/dev/null | head -1; }
AUDIO_START="$(probe -select_streams a:0 -show_entries stream=start_time)"
FORMAT_START="$(probe -show_entries format=start_time)"
OFFSET_MS="$(awk -v a="$AUDIO_START" -v f="$FORMAT_START" 'BEGIN { if (a !~ /^[-0-9.]+$/) a = 0; if (f !~ /^[-0-9.]+$/) f = 0; d = (a - f) * 1000; if (d < 0) d = 0; printf "%d", d + 0.5 }')"
AUDIO_FILTER=(); [[ "$OFFSET_MS" -gt 0 ]] && AUDIO_FILTER=(-af "adelay=${OFFSET_MS}:all=1")
printf '%s\n' "$OFFSET_MS" > "$WORKDIR/audio-offset-ms.txt"
ffmpeg -hide_banner -loglevel error -nostdin -y -i "$VIDEO" -vn ${AUDIO_FILTER[@]+"${AUDIO_FILTER[@]}"} \
  -acodec pcm_s16le -ar 16000 -ac 1 "$WORKDIR/audio.wav"
whisper-cli -m "$MODEL" -f "$WORKDIR/audio.wav" --output-srt --output-txt \
  -of "$WORKDIR/transcript" -l "${WHISPER_LANGUAGE:-en}" \
  --max-context 0 --suppress-nst --entropy-thold 2.4 --logprob-thold -1.0 \
  --no-speech-thold 0.6 --temperature 0 --temperature-inc 0.2
[[ -f "$WORKDIR/transcript.srt" && -f "$WORKDIR/transcript.txt" ]] \
  || { echo 'extract: whisper did not produce SRT and TXT' >&2; exit 1; }
echo "extract: audio (lead-in ${OFFSET_MS} ms aligned) + SRT/TXT -> $WORKDIR"
