#!/bin/bash
# Stalker Golem BrainLayer ingestion and digest contract.
#
# Subcommands:
#   ingest-run <stream-dir> [--dry-run]
#   queue-run <stream-dir> <reason>
#   digest <stalker-root> <YYYY-MM-DD> [--dry-run]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/stream-helpers.sh
source "$SCRIPT_DIR/../lib/stream-helpers.sh"

AGENT_TAG="${STALKER_AGENT_TAG:-stalker-golem-codex-trackB}"
PROJECT="${STALKER_BRAINLAYER_PROJECT:-golems}"
DEFAULT_IMPORTANCE="${STALKER_BRAINLAYER_IMPORTANCE:-7}"

# shellcheck source=brain-delivery/store.sh
source "$SCRIPT_DIR/brain-delivery/store.sh"
# shellcheck source=brain-delivery/runs.sh
source "$SCRIPT_DIR/brain-delivery/runs.sh"
# shellcheck source=brain-delivery/digest.sh
source "$SCRIPT_DIR/brain-delivery/digest.sh"

usage() {
    cat >&2 <<'USAGE'
Usage:
  stalker-brainlayer.sh ingest-run <stream-dir> [--dry-run]
  stalker-brainlayer.sh queue-run <stream-dir> <reason>
  stalker-brainlayer.sh digest <stalker-root> <YYYY-MM-DD> [--dry-run]
USAGE
}

is_dry_run_env() {
    [ "${STALKER_BRAINLAYER_DRY_RUN:-${STALKER_BRAIN_STORE_DRY_RUN:-0}}" = "1" ]
}
build_brain_payloads() {
    local stream_dir="$1"
    python3 - "$stream_dir" "$AGENT_TAG" "$PROJECT" "$DEFAULT_IMPORTANCE" < "$SCRIPT_DIR/brain-delivery/payloads.py"
}

main() {
    [ "$#" -ge 1 ] || { usage; exit 2; }
    local command="$1"
    shift

    case "$command" in
        ingest-run)
            [ "$#" -ge 1 ] || { usage; exit 2; }
            local stream_dir="$1"
            shift
            local dry_run=0
            is_dry_run_env && dry_run=1
            while [ "$#" -gt 0 ]; do
                case "$1" in
                    --dry-run) dry_run=1 ;;
                    *) echo "Unknown ingest-run option: $1" >&2; usage; exit 2 ;;
                esac
                shift
            done
            ingest_run "$stream_dir" "$dry_run"
            ;;
        queue-run)
            [ "$#" -eq 2 ] || { usage; exit 2; }
            queue_unfinished_run "$1" "$2"
            ;;
        digest)
            [ "$#" -ge 2 ] || { usage; exit 2; }
            local stalker_root="$1"
            local digest_date="$2"
            shift 2
            while [ "$#" -gt 0 ]; do
                case "$1" in
                    --dry-run) ;;
                    *) echo "Unknown digest option: $1" >&2; usage; exit 2 ;;
                esac
                shift
            done
            print_digest "$stalker_root" "$digest_date"
            ;;
        *)
            echo "Unknown command: $command" >&2
            usage
            exit 2
            ;;
    esac
}

main "$@"
