#!/usr/bin/env bash
# Standard golems-owned Python dependency bootstrap; safe to rerun.
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
venv="$HOME/.golems/venv"
if [[ ! -x "$venv/bin/python3" ]]; then
  command -v python3 >/dev/null || { echo "golems Python: install Python 3.8+ first" >&2; exit 1; }
  python3 -m venv "$venv"
fi
python="$venv/bin/python3"
if "$python" -c 'import yaml; assert yaml.__version__ == "6.0.3"' 2>/dev/null; then
  echo "golems Python: PyYAML 6.0.3 already installed in $venv"
  exit 0
fi
"$python" -m pip install --disable-pip-version-check --require-hashes --only-binary=:all: --no-deps \
  -r "$script_dir/python-requirements.txt"
"$python" -c 'import yaml; assert yaml.__version__ == "6.0.3"'
echo "golems Python: PyYAML 6.0.3 installed in $venv"
