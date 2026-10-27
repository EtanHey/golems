#!/usr/bin/env bash
# Standalone Ajv for release receipts: no node_modules or network needed on a client.
set -euo pipefail
cd "$(dirname "$0")/.."
expected_bun=$(cat .bun-version)
[ "$(bun --version)" = "$expected_bun" ] || { echo 'Bun version mismatch for receipt validator' >&2; exit 2; }
expected_ajv=$(python3 - <<'PY_VERSION'
from pathlib import Path
import re
print(re.search(r'"ajv": \["ajv@([^" ]+)"', Path('bun.lock').read_text())[1])
PY_VERSION
)
actual_ajv=$(node -p 'require("./node_modules/ajv/package.json").version')
[ "$actual_ajv" = "$expected_ajv" ] || { echo 'Ajv version mismatch for receipt validator' >&2; exit 2; }
target=scripts/lib/vendor
if [ "${1:-}" = --check ]; then
  mkdir -p docs.local
  target=$(mktemp -d "$PWD/docs.local/receipt-validator.XXXXXX")
  trap 'rm -r "$target"' EXIT
elif [ "$#" -ne 0 ]; then echo 'usage: build-receipt-validator.sh [--check]' >&2; exit 2; fi
bun build node_modules/ajv/dist/ajv.js --target=node --format=esm --minify --outfile "$target/receipt-ajv.generated.mjs"
python3 - "$target" <<'PY'
from pathlib import Path
import sys
parts = []
for name in ['ajv', 'fast-deep-equal', 'fast-uri', 'json-schema-traverse', 'require-from-string']:
    package = Path('node_modules') / name
    license = next((p for p in sorted(package.glob('*')) if p.is_file()
                    and p.name.lower() in ('license', 'license.md', 'license.txt')), None)
    if license is None:
        sys.exit('receipt validator: Missing license for ' + name + ' in ' + str(package))
    parts.append(name + '\n' + license.read_text())
Path(sys.argv[1], 'receipt-ajv.generated.LICENSE').write_text('\n\n'.join(parts))
PY
if [ "${1:-}" = --check ]; then
  cmp scripts/lib/vendor/receipt-ajv.generated.mjs "$target/receipt-ajv.generated.mjs"
  cmp scripts/lib/vendor/receipt-ajv.generated.LICENSE "$target/receipt-ajv.generated.LICENSE"
fi
