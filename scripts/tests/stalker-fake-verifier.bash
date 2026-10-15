# Synthetic completion suites mock the final verifier too; real contract suites cover receipts.
stalker_fake_verifier_node() {
    local target="$1" real_node
    real_node="$(command -v node)"
    printf '#!/bin/bash\nif [[ "$1" == */stalker-run-contract.mjs ]]; then exit "${STALKER_TEST_VERIFY_EXIT:-0}"; fi\nexec %q "$@"\n' "$real_node" > "$target"
    chmod +x "$target"
}
