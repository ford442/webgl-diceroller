#!/usr/bin/env bash
# verify-cmake-wasm-parity.sh — Assert the CMake build produces the same
# dice_physics.wasm as build.sh.
#
# scripts/verify-emcc-flags-sync.sh already asserts that CMakeLists.txt and the
# shell scripts agree on the *flag strings*. That is a text comparison: it
# cannot catch CMake injecting flags of its own (-DNDEBUG via
# CMAKE_CXX_FLAGS_RELEASE was the real case), applying codegen flags at the
# wrong stage, or compiling a different set of translation units. This script
# closes that gap by building both ways and byte-diffing the binaries.
#
# Requires an EMSDK (same discovery convention as build.sh: on PATH, or
# activated from /root/emsdk).
#
# Usage (from repo root):
#   bash scripts/verify-cmake-wasm-parity.sh
#   npm run verify:cmake-wasm
#
# Flags / env:
#   --reuse-existing            skip the build.sh step if public/wasm/... exists
#   DICE_PARITY_PROFILES=...    space-separated subset of "simd scalar"
#   DICE_CMAKE_PARITY_STRICT=0  report a mismatch but exit 0 (diagnosis only;
#                               CI leaves this at the default of 1)
#
# Side effects: runs build.sh, so public/wasm/ and public/wasm-scalar/ end up
# holding build.sh's artifacts — the source-of-truth build, which is what every
# other consumer expects there. The CMake outputs go to a scratch dir and are
# never written into public/.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WASM_DIR="${REPO_ROOT}/src/wasm"

REUSE_EXISTING=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --reuse-existing) REUSE_EXISTING=1; shift ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

PROFILES=(${DICE_PARITY_PROFILES:-simd scalar})
STRICT="${DICE_CMAKE_PARITY_STRICT:-1}"

if ! command -v emcmake >/dev/null 2>&1 && [ -f /root/emsdk/emsdk_env.sh ]; then
    # shellcheck source=/dev/null
    source /root/emsdk/emsdk_env.sh
fi
if ! command -v emcmake >/dev/null 2>&1; then
    echo "FAIL: emcmake not on PATH (and no /root/emsdk). This check needs an EMSDK." >&2
    exit 1
fi

echo "[cmake-parity] emcc: $(em++ --version | head -n1)"
echo "[cmake-parity] cmake: $(cmake --version | head -n1)"
echo "[cmake-parity] profiles: ${PROFILES[*]}"

# --- 1. build.sh (source of truth) ------------------------------------------
if [[ "${REUSE_EXISTING}" -eq 1 && -f "${REPO_ROOT}/public/wasm/dice_physics.wasm" ]]; then
    echo "[cmake-parity] --reuse-existing: keeping the public/wasm artifacts already present."
else
    echo "[cmake-parity] Building reference artifacts with build.sh..."
    bash "${WASM_DIR}/build.sh"
fi

SCRATCH="$(mktemp -d)"
cleanup() { rm -rf "${SCRATCH}"; }
trap cleanup EXIT

REF_DIR="${SCRATCH}/reference"
mkdir -p "${REF_DIR}"
for profile in "${PROFILES[@]}"; do
    case "${profile}" in
        simd)   src="${REPO_ROOT}/public/wasm/dice_physics.wasm" ;;
        scalar) src="${REPO_ROOT}/public/wasm-scalar/dice_physics.wasm" ;;
        *) echo "FAIL: unknown profile '${profile}' (expected simd or scalar)" >&2; exit 2 ;;
    esac
    [[ -f "${src}" ]] || { echo "FAIL: ${src} missing after build.sh" >&2; exit 1; }
    cp "${src}" "${REF_DIR}/${profile}.wasm"
done

# --- 2. CMake (cross-check) --------------------------------------------------
CMAKE_OUT="${SCRATCH}/cmake-out"
CMAKE_BUILD="${SCRATCH}/build-emcc"
echo "[cmake-parity] Configuring CMake (Release) -> ${CMAKE_BUILD}"
emcmake cmake \
    -S "${WASM_DIR}" \
    -B "${CMAKE_BUILD}" \
    -DCMAKE_BUILD_TYPE=Release \
    -DDICE_WASM_OUTPUT_ROOT="${CMAKE_OUT}"

# Both targets, single-threaded: emcc's LTO link is the wall-clock cost here and
# parallelising it just contends for the same cores.
CMAKE_TARGETS=()
for profile in "${PROFILES[@]}"; do
    case "${profile}" in
        simd)   CMAKE_TARGETS+=(dice_physics) ;;
        scalar) CMAKE_TARGETS+=(dice_physics_scalar) ;;
    esac
done
echo "[cmake-parity] Building CMake targets: ${CMAKE_TARGETS[*]}"
cmake --build "${CMAKE_BUILD}" --target "${CMAKE_TARGETS[@]}"

# --- 3. Byte-diff ------------------------------------------------------------
MISMATCH=0
for profile in "${PROFILES[@]}"; do
    case "${profile}" in
        simd)   cmake_wasm="${CMAKE_OUT}/wasm/dice_physics.wasm" ;;
        scalar) cmake_wasm="${CMAKE_OUT}/wasm-scalar/dice_physics.wasm" ;;
    esac
    ref_wasm="${REF_DIR}/${profile}.wasm"

    if [[ ! -f "${cmake_wasm}" ]]; then
        echo "FAIL: CMake did not produce ${cmake_wasm}" >&2
        MISMATCH=1
        continue
    fi

    if cmp -s "${ref_wasm}" "${cmake_wasm}"; then
        echo "ok: ${profile} dice_physics.wasm is byte-identical ($(wc -c < "${ref_wasm}" | tr -d ' ') bytes, build.sh == CMake)"
        continue
    fi

    MISMATCH=1
    echo ""
    echo "MISMATCH: ${profile} dice_physics.wasm differs between build.sh and CMake" >&2
    echo "  build.sh: $(wc -c < "${ref_wasm}" | tr -d ' ') bytes  sha256=$(sha256sum "${ref_wasm}" | cut -d' ' -f1)" >&2
    echo "  cmake   : $(wc -c < "${cmake_wasm}" | tr -d ' ') bytes  sha256=$(sha256sum "${cmake_wasm}" | cut -d' ' -f1)" >&2
    echo "  first differing byte: $(cmp "${ref_wasm}" "${cmake_wasm}" 2>&1 || true)" >&2
    node "${SCRIPT_DIR}/wasm-section-diff.mjs" "${ref_wasm}" "${cmake_wasm}" >&2 || true
    echo "" >&2
    echo "  Compile line CMake used (from its compile_commands.json):" >&2
    node - "${CMAKE_BUILD}/compile_commands.json" >&2 <<'NODE' || true
const fs = require('fs');
const db = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const entry = db.find((e) => /dice_engine_step\.cpp$/.test(e.file)) ?? db[0];
if (!entry) process.exit(0);
console.log('    ' + (entry.arguments ? entry.arguments.join(' ') : entry.command));
NODE
    echo "" >&2
    echo "  Compile line emcc_flags.sh prints for this profile:" >&2
    if [[ "${profile}" == "simd" ]]; then
        echo "    $(bash "${WASM_DIR}/emcc_flags.sh" --print-compile-line release)" >&2
    else
        echo "    $(bash "${WASM_DIR}/emcc_flags.sh" --print-compile-line release-scalar)" >&2
    fi
done

if [[ "${MISMATCH}" -ne 0 ]]; then
    echo "" >&2
    cat >&2 <<'MSG'
The CMake project and build.sh are producing different binaries. build.sh is the
source of truth and ships; CMake is what clangd and IDE tooling see, so a
divergence means the editor is type-checking something the browser never runs.

Likely causes, in rough order:
  - CMake injecting per-config flags (CMAKE_CXX_FLAGS_<CONFIG>) that build.sh
    never passes. CMakeLists.txt clears these; check nothing re-added them.
  - A codegen flag reaching only the linker (see the --print-compile-line note
    in emcc_flags.sh) or only the compiler.
  - Absolute build paths leaking into the binary. build.sh compiles from
    src/wasm/; CMake compiles from its own build dir. If the section diff above
    names only a custom section ("name", "producers"), that is the cause and
    -ffile-prefix-map belongs in emcc_flags.inc.sh. If `code` differs, it is not
    a path issue.
  - engine_sources.txt read differently by the two (blank/comment handling).

Set DICE_CMAKE_PARITY_STRICT=0 to downgrade this to a warning while diagnosing.
MSG
    if [[ "${STRICT}" == "0" ]]; then
        echo "[cmake-parity] DICE_CMAKE_PARITY_STRICT=0 — reporting mismatch but exiting 0." >&2
        exit 0
    fi
    exit 1
fi

echo "[cmake-parity] All profiles byte-identical."
