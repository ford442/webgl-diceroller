#!/usr/bin/env bash
# emcc_flags.sh — Profile selector and CMake flag printer.
#
# Usage:
#   source emcc_flags.sh && emcc_build_flags release
#   ./emcc_flags.sh --print-link-line release
#   ./emcc_flags.sh --print-link-line debug

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=emcc_flags.inc.sh
source "${SCRIPT_DIR}/emcc_flags.inc.sh"

if [[ "${1:-}" == "--print-link-line" ]]; then
    profile="${2:-release}"
    emcc_build_flags "${profile}"
    # Join for CMake LINK_FLAGS (space-separated single line)
    printf '%s' "${EMCC_FLAGS[0]}"
    for ((i = 1; i < ${#EMCC_FLAGS[@]}; i++)); do
        printf ' %s' "${EMCC_FLAGS[$i]}"
    done
    printf '\n'
    exit 0
fi
