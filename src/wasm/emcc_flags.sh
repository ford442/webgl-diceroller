#!/usr/bin/env bash
# emcc_flags.sh — Profile selector and CMake flag printer.
#
# Usage:
#   source emcc_flags.sh && emcc_build_flags release
#   ./emcc_flags.sh --print-link-line release
#   ./emcc_flags.sh --print-link-line debug
#   ./emcc_flags.sh --print-compile-line release

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=emcc_flags.inc.sh
source "${SCRIPT_DIR}/emcc_flags.inc.sh"

# Print a space-separated single line from the elements of EMCC_FLAGS.
emcc_print_line() {
    local flags=("$@")
    [ ${#flags[@]} -eq 0 ] && { printf '\n'; return 0; }
    printf '%s' "${flags[0]}"
    local i
    for ((i = 1; i < ${#flags[@]}; i++)); do
        printf ' %s' "${flags[$i]}"
    done
    printf '\n'
}

if [[ "${1:-}" == "--print-link-line" ]]; then
    profile="${2:-release}"
    emcc_build_flags "${profile}"
    # Join for CMake LINK_FLAGS (space-separated single line)
    emcc_print_line "${EMCC_FLAGS[@]}"
    exit 0
fi

if [[ "${1:-}" == "--print-compile-line" ]]; then
    # Codegen flags for CMake COMPILE_OPTIONS. Two kinds of flag are dropped
    # because they are emcc *linker* inputs and emcc warns on every translation
    # unit when they appear on a compile command:
    #   -s KEY=VALUE  linker settings.
    #   --bind        shorthand for -lembind, a link-time library. build.sh
    #                 compiles and links in one invocation so it needs --bind
    #                 on that single command line; a per-TU compile does not,
    #                 and emitting it produced
    #                 "linker flag ignored during compilation: '--bind'"
    #                 (plus "-lembind: 'linker' input unused") once per TU.
    #                 Embind itself only needs <emscripten/bind.h> at compile
    #                 time; -lembind is what the *link* step consumes, and the
    #                 link line (--print-link-line) still carries it.
    # Everything else (-O3, -flto, -msimd128, -DDICE_FORCE_SCALAR_SAT,
    # -std=c++17, -g) must reach the compiler: -msimd128 is what defines
    # __wasm_simd128__ and -D... selects the scalar SAT path, so passing these
    # at link time only silently yields a non-SIMD build identical to the
    # scalar one.
    profile="${2:-release}"
    emcc_build_flags "${profile}"
    COMPILE_FLAGS=()
    skip_next=0
    for flag in "${EMCC_FLAGS[@]}"; do
        if [ "${skip_next}" = "1" ]; then skip_next=0; continue; fi
        if [ "${flag}" = "-s" ]; then skip_next=1; continue; fi
        if [ "${flag}" = "--bind" ]; then continue; fi
        COMPILE_FLAGS+=("${flag}")
    done
    emcc_print_line "${COMPILE_FLAGS[@]}"
    exit 0
fi
