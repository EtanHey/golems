#!/usr/bin/env bash
# Standalone Ajv for release receipts: no node_modules or network needed on a client.
set -euo pipefail
cd "$(dirname "$0")/.."
bun build node_modules/ajv/dist/ajv.js --target=node --format=esm --minify --outfile scripts/lib/vendor/receipt-ajv.generated.mjs
python3 - <<'PY'
from pathlib import Path
parts = []
for name in ['ajv', 'fast-deep-equal', 'fast-uri', 'json-schema-traverse', 'require-from-string']:
    package = Path('node_modules') / name
    license = next(package / p for p in ('LICENSE', 'LICENSE.md', 'LICENSE.txt') if (package / p).exists())
    parts.append(name + '\n' + license.read_text())
Path('scripts/lib/vendor/receipt-ajv.generated.LICENSE').write_text('\n\n'.join(parts))
PY
