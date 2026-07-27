#!/usr/bin/env bash
# verify-emcc-flags-sync.sh — Assert CMake and shell scripts share the same emcc flags.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WASM_DIR="${SCRIPT_DIR}/../src/wasm"

SHELL_FLAGS="$("${WASM_DIR}/emcc_flags.sh" --print-link-line release)"
CMAKE_FLAGS="$(bash "${WASM_DIR}/emcc_flags.sh" --print-link-line release)"

if [[ "${SHELL_FLAGS}" != "${CMAKE_FLAGS}" ]]; then
    echo "FAIL: emcc release flags mismatch between shell and CMake printer" >&2
    echo "shell: ${SHELL_FLAGS}" >&2
    echo "cmake: ${CMAKE_FLAGS}" >&2
    exit 1
fi

echo "ok: emcc release flags in sync (shell == CMake printer)"
