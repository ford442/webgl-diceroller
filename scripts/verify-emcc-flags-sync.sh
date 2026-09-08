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

# Codegen flags (-msimd128, -DDICE_FORCE_SCALAR_SAT) only take effect on the
# *compile* command. When CMake applied them as LINK_FLAGS alone, both targets
# built without SIMD and emitted byte-identical binaries. Require CMake to feed
# the compile line to target_compile_options for both targets.
if ! grep -q -- '--print-compile-line' "${CMAKE}"; then
    fail "CMakeLists.txt must invoke emcc_flags.sh --print-compile-line (codegen flags need compile options, not just LINK_FLAGS)"
fi
if ! grep -q 'target_compile_options(dice_physics ' "${CMAKE}"; then
    fail "CMakeLists.txt must set target_compile_options on dice_physics (SIMD target)"
fi
if ! grep -q 'target_compile_options(dice_physics_scalar ' "${CMAKE}"; then
    fail "CMakeLists.txt must set target_compile_options on dice_physics_scalar"
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

# --- compile lines: codegen flags present, linker -s settings stripped ---
COMPILE_RELEASE="$("${WASM_DIR}/emcc_flags.sh" --print-compile-line release)"
COMPILE_SCALAR="$("${WASM_DIR}/emcc_flags.sh" --print-compile-line release-scalar)"

assert_contains "${COMPILE_RELEASE}" "-msimd128" "release compile line"
assert_absent "${COMPILE_RELEASE}" "DICE_FORCE_SCALAR_SAT" "release compile line"
assert_absent "${COMPILE_RELEASE}" "-s " "release compile line"

assert_contains "${COMPILE_SCALAR}" "DICE_FORCE_SCALAR_SAT" "scalar compile line"
assert_absent "${COMPILE_SCALAR}" "-msimd128" "scalar compile line"
assert_absent "${COMPILE_SCALAR}" "-s " "scalar compile line"

# The two profiles must differ, or the SIMD build is silently a scalar build.
if [[ "${COMPILE_RELEASE}" == "${COMPILE_SCALAR}" ]]; then
    fail "release and scalar compile lines are identical — SIMD target would build as scalar"
fi

assert_contains "${DEBUG_FLAGS}" "ASSERTIONS=2" "debug flags"
assert_absent "${DEBUG_FLAGS}" "-msimd128" "debug flags"
assert_absent "${DEBUG_FLAGS}" "-flto" "debug flags"

echo "ok: emcc release flags in sync (shell == CMake printer)"
echo "ok: required size/determinism flags present; -ffast-math absent"
echo "ok: release has -msimd128; scalar does not"
echo "ok: compile lines carry codegen flags and differ between SIMD and scalar"
