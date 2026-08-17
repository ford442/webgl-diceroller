#!/usr/bin/env bash
# verify-emcc-flags-sync.sh — Assert CMake and shell scripts share the same emcc flags.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WASM_DIR="${SCRIPT_DIR}/../src/wasm"
CMAKE="${WASM_DIR}/CMakeLists.txt"
INC="${WASM_DIR}/emcc_flags.inc.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

if ! grep -q 'emcc_flags.sh" --print-link-line "${EM_PROFILE}"' "${CMAKE}" \
    && ! grep -q 'emcc_flags.sh --print-link-line' "${CMAKE}"; then
    fail "CMakeLists.txt must invoke emcc_flags.sh --print-link-line"
fi

# Ignore comments: a documented "do not add -ffast-math" note is not a flag.
if grep -vE '^\s*#' "${INC}" | grep -qE -- '-ffast-math|PRECISE_F32=0'; then
    fail "emcc_flags.inc.sh must not contain -ffast-math or PRECISE_F32=0 (replay is IEEE-754)"
fi

SHELL_FLAGS="$("${WASM_DIR}/emcc_flags.sh" --print-link-line release)"
CMAKE_FLAGS="$(bash "${WASM_DIR}/emcc_flags.sh" --print-link-line release)"
SCALAR_FLAGS="$("${WASM_DIR}/emcc_flags.sh" --print-link-line release-scalar)"
DEBUG_FLAGS="$("${WASM_DIR}/emcc_flags.sh" --print-link-line debug)"

if [[ "${SHELL_FLAGS}" != "${CMAKE_FLAGS}" ]]; then
    echo "FAIL: emcc release flags mismatch between shell and CMake printer" >&2
    echo "shell: ${SHELL_FLAGS}" >&2
    echo "cmake: ${CMAKE_FLAGS}" >&2
    exit 1
fi

assert_contains() {
    local haystack="$1"
    local needle="$2"
    local label="$3"
    if [[ "${haystack}" != *"${needle}"* ]]; then
        fail "${label} missing '${needle}'"
    fi
}

assert_absent() {
    local haystack="$1"
    local needle="$2"
    local label="$3"
    if [[ "${haystack}" == *"${needle}"* ]]; then
        fail "${label} must not contain '${needle}'"
    fi
}

assert_contains "${SHELL_FLAGS}" "DISABLE_EXCEPTION_CATCHING=1" "release flags"
assert_contains "${SHELL_FLAGS}" "SUPPORT_LONGJMP=0" "release flags"
assert_contains "${SHELL_FLAGS}" "INITIAL_MEMORY=" "release flags"
assert_contains "${SHELL_FLAGS}" "MALLOC=emmalloc" "release flags"
assert_contains "${SHELL_FLAGS}" "-msimd128" "release flags"
assert_absent "${SHELL_FLAGS}" "-ffast-math" "release flags"
assert_absent "${SHELL_FLAGS}" "PRECISE_F32=0" "release flags"

assert_contains "${SCALAR_FLAGS}" "DICE_FORCE_SCALAR_SAT" "scalar flags"
assert_absent "${SCALAR_FLAGS}" "-msimd128" "scalar flags"
assert_contains "${SCALAR_FLAGS}" "INITIAL_MEMORY=" "scalar flags"

assert_contains "${DEBUG_FLAGS}" "ASSERTIONS=2" "debug flags"
assert_absent "${DEBUG_FLAGS}" "-msimd128" "debug flags"
assert_absent "${DEBUG_FLAGS}" "-flto" "debug flags"

echo "ok: emcc release flags in sync (shell == CMake printer)"
echo "ok: required size/determinism flags present; -ffast-math absent"
echo "ok: release has -msimd128; scalar does not"
