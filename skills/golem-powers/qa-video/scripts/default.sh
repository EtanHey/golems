#!/usr/bin/env bash
set -euo pipefail

ORCHESTRATOR_REPO="${ORCHESTRATOR_REPO:-$HOME/Gits/orchestrator}"

echo "## /qa-video — Video-Based QA Pipeline"
echo ""
echo "### Prerequisites Check"

# Check ffmpeg
if command -v ffmpeg &>/dev/null; then
  echo "- [x] ffmpeg: $(ffmpeg -version 2>&1 | head -1 | cut -d' ' -f3)"
else
  echo "- [ ] ffmpeg: NOT FOUND (brew install ffmpeg)"
fi

# Check whisper-cli
if command -v whisper-cli &>/dev/null; then
  echo "- [x] whisper-cli: installed"
else
  echo "- [ ] whisper-cli: NOT FOUND (brew install whisper-cpp)"
fi

# Check whisper model
MODEL="$HOME/.cache/whisper/ggml-small.bin"
if [ -f "$MODEL" ]; then
  SIZE=$(du -h "$MODEL" | cut -f1)
  echo "- [x] ggml-small model: $SIZE"
else
  echo "- [ ] ggml-small model: NOT FOUND (whisper-cli --download-model small)"
fi

# Check click logger
LOGGER="$ORCHESTRATOR_REPO/scripts/qa/qa_click_logger.py"
if [ -f "$LOGGER" ]; then
  echo "- [x] qa_click_logger.py: exists"
else
  echo "- [ ] qa_click_logger.py: NOT FOUND"
fi

# Check qa-record.sh
RECORDER="$ORCHESTRATOR_REPO/scripts/qa/qa-record.sh"
if [ -f "$RECORDER" ]; then
  echo "- [x] qa-record.sh: exists"
else
  echo "- [ ] qa-record.sh: NOT FOUND"
fi

# Check pyobjc (optional)
if python3 -c "import Quartz" 2>/dev/null; then
  echo "- [x] pyobjc (click capture): installed"
else
  echo "- [ ] pyobjc (click capture): NOT INSTALLED (optional — pip3 install pyobjc-framework-Quartz pyobjc-framework-ApplicationServices pyobjc-framework-Cocoa)"
fi

echo ""
echo "### Available Workflows"
echo ""
echo "| Command | What it does |"
echo "|---------|-------------|"
echo "| \`/qa-video\` | This status check |"
echo "| Load \`workflows/record.md\` | Pre-QA checklist + recording setup |"
echo "| Load \`workflows/process.md\` | Process video → structured findings |"
echo "| Load \`workflows/handoff.md\` | Send findings to implementing agent |"
echo "| Load \`workflows/iterate.md\` | Multi-round QA cycle |"
echo ""
echo "### Quick Start"
echo ""
echo "1. **Record:** \`bash \"$ORCHESTRATOR_REPO/scripts/qa/qa-record.sh\" ~/Gits/<project>/docs/\`"
echo "2. **Process:** Give me the .mov path and I'll run the stalker pipeline"
echo "3. **Handoff:** I'll format findings and send to your implementing agent"
