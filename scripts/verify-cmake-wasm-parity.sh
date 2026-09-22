#!/usr/bin/env bash
# verify-cmake-wasm-parity.sh — Assert the CMake build produces the same
# dice_physics.wasm as build.sh.
#
# scripts/verify-emcc-flags-sync.sh already asserts that CMakeLists.txt and the
# shell scripts agree on the *flag strings*. That is a text comparison: it
# cannot catch CMake injecting flags of its own (-DNDEBUG via
# CMAKE_CXX_FLAGS_RELEASE was the real case), applying codegen flags at the
# wrong stage, or compiling a different set of translation units. This script
# closes that gap by building both ways and comparing the binaries.
#
# What "the same build" means here
# --------------------------------
# Byte-identity is checked first and is the happy path. It is NOT, however,
# achievable in general: build.sh compiles and links in one em++ invocation,
# while CMake compiles each translation unit separately and then LTO-links the
# objects. That changes the order in which symbols get resolved, so the two
# binaries can carry the same code under different function/import numbering.
# Measured on EMSDK 3.1.61 (CI run 35599739657): identical total size (150765
# bytes SIMD, 143090 scalar), identical size for *every* section, and differing
# content in import/function/export/element/code/data -- the fingerprint of
# renumbering, not of different codegen.
#
# So when the bytes differ this script neither gives up nor waves it through.
# It requires BOTH of:
#
#   1. Structural identity -- wasm-section-diff.mjs --verdict: same section
#      list in the same order, same size for every section, same total size.
#      Flag drift cannot survive this: -DNDEBUG, a dropped -msimd128 or a
#      different -O level all move section sizes.
#   2. Behavioural identity -- emsdk-variant-probe.mjs against both artifacts
#      must produce the same physics fingerprint (30 stepped frames of
#      serializeState, plus getFaceValues and a seeded randomFloat draw).
#      That is the property that actually matters: renumbered symbols cannot
#      change it, a real codegen difference would.
#
# If either fails, so does the job. Byte-identity is still reported when it
# holds, so a toolchain that achieves it becomes visible rather than masked.
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

read -r -a PROFILES <<< "${DICE_PARITY_PROFILES:-simd scalar}"
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

# The probe loads dice_physics.js, which resolves dice_physics.wasm next to it,
# so the reference copy needs both files rather than just the binary.
profile_src_dir() {
    case "$1" in
        simd)   printf '%s' "${REPO_ROOT}/public/wasm" ;;
        scalar) printf '%s' "${REPO_ROOT}/public/wasm-scalar" ;;
        *) echo "FAIL: unknown profile '$1' (expected simd or scalar)" >&2; exit 2 ;;
    esac
}

# --- 1. build.sh (source of truth) ------------------------------------------
# --reuse-existing has to check every selected profile, not just the SIMD one:
# with DICE_PARITY_PROFILES=scalar and only public/wasm/ populated, keying on
# the SIMD artifact alone skipped build.sh and then died on the missing scalar
# reference.
have_all_references=1
for profile in "${PROFILES[@]}"; do
    src="$(profile_src_dir "${profile}")"
    for f in dice_physics.wasm dice_physics.js; do
        [[ -f "${src}/${f}" ]] || have_all_references=0
    done
done

if [[ "${REUSE_EXISTING}" -eq 1 && "${have_all_references}" -eq 1 ]]; then
    echo "[cmake-parity] --reuse-existing: reusing the artifacts already present for ${PROFILES[*]}."
else
    if [[ "${REUSE_EXISTING}" -eq 1 ]]; then
        echo "[cmake-parity] --reuse-existing requested, but some ${PROFILES[*]} artifact is missing — building."
    fi
    echo "[cmake-parity] Building reference artifacts with build.sh..."
    bash "${WASM_DIR}/build.sh"
fi

SCRATCH="$(mktemp -d)"
cleanup() { rm -rf "${SCRATCH}"; }
trap cleanup EXIT

profile_cmake_dir() {
    case "$1" in
        simd)   printf '%s' "${SCRATCH}/cmake-out/wasm" ;;
        scalar) printf '%s' "${SCRATCH}/cmake-out/wasm-scalar" ;;
    esac
}

for profile in "${PROFILES[@]}"; do
    src="$(profile_src_dir "${profile}")"
    for f in dice_physics.wasm dice_physics.js; do
        [[ -f "${src}/${f}" ]] || { echo "FAIL: ${src}/${f} missing after build.sh" >&2; exit 1; }
    done
    mkdir -p "${SCRATCH}/reference/${profile}"
    cp "${src}/dice_physics.wasm" "${src}/dice_physics.js" "${SCRATCH}/reference/${profile}/"
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

# Print the compile line CMake actually used for one TU of a given target. The
# database holds an entry per (target, TU), so select on the target's object
# directory -- keying on the filename alone returns whichever target CMake
# declared first, which reported the SIMD line while diagnosing the scalar
# profile.
print_cmake_compile_line() {
    local target="$1"
    node - "${CMAKE_BUILD}/compile_commands.json" "${target}" <<'NODE' || true
const fs = require('fs');
const [dbPath, target] = process.argv.slice(2);
let db;
try {
    db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
} catch {
    process.exit(0);
}
const needle = `CMakeFiles/${target}.dir/`;
const line = (e) => (e.arguments ? e.arguments.join(' ') : e.command || '');
const entry =
    db.find((e) => line(e).includes(needle) && /dice_engine_step\.cpp/.test(e.file)) ??
    db.find((e) => line(e).includes(needle));
if (entry) console.log('    ' + line(entry));
else console.log(`    (no compile_commands entry for target ${target})`);
NODE
}

# Run the behaviour probe against one artifact directory and print its
# fingerprint on stdout. Captures stdout only: folding stderr in with 2>&1 would
# put any node warning (an ExperimentalWarning, a deprecation) into the
# fingerprint, so one side emitting a warning the other did not would read as a
# physics difference. Diagnostics land in ${SCRATCH}/probe.err.
probe() {
    node "${SCRIPT_DIR}/emsdk-variant-probe.mjs" "$1" 2>"${SCRATCH}/probe.err"
}

# --- 3. Compare --------------------------------------------------------------
FAILED=0
for profile in "${PROFILES[@]}"; do
    cmake_dir="$(profile_cmake_dir "${profile}")"
    ref_dir="${SCRATCH}/reference/${profile}"
    cmake_wasm="${cmake_dir}/dice_physics.wasm"
    ref_wasm="${ref_dir}/dice_physics.wasm"
    case "${profile}" in
        simd)   target="dice_physics"; flag_profile="release" ;;
        scalar) target="dice_physics_scalar"; flag_profile="release-scalar" ;;
    esac

    if [[ ! -f "${cmake_wasm}" ]]; then
        echo "FAIL: CMake did not produce ${cmake_wasm}" >&2
        FAILED=1
        continue
    fi

    if cmp -s "${ref_wasm}" "${cmake_wasm}"; then
        echo "ok: ${profile} dice_physics.wasm is byte-identical ($(wc -c < "${ref_wasm}" | tr -d ' ') bytes, build.sh == CMake)"
        continue
    fi

    echo ""
    echo "[cmake-parity] ${profile}: bytes differ — checking structural + behavioural equivalence."
    echo "  build.sh: $(wc -c < "${ref_wasm}" | tr -d ' ') bytes  sha256=$(sha256sum "${ref_wasm}" | cut -d' ' -f1)"
    echo "  cmake   : $(wc -c < "${cmake_wasm}" | tr -d ' ') bytes  sha256=$(sha256sum "${cmake_wasm}" | cut -d' ' -f1)"
    echo "  first differing byte: $(cmp "${ref_wasm}" "${cmake_wasm}" 2>&1 || true)"

    structural_ok=1
    if ! node "${SCRIPT_DIR}/wasm-section-diff.mjs" "${ref_wasm}" "${cmake_wasm}" --verdict; then
        structural_ok=0
    fi

    behavioural_ok=1
    ref_fp=""
    cmake_fp=""
    if ! ref_fp="$(probe "${ref_dir}")"; then
        echo "  probe FAILED on build.sh's artifact:" >&2
        sed 's/^/    /' "${SCRATCH}/probe.err" >&2
        behavioural_ok=0
    elif ! cmake_fp="$(probe "${cmake_dir}")"; then
        echo "  probe FAILED on CMake's artifact:" >&2
        sed 's/^/    /' "${SCRATCH}/probe.err" >&2
        behavioural_ok=0
    elif [[ "${ref_fp}" != "${cmake_fp}" ]]; then
        echo "  physics fingerprints DIFFER:" >&2
        echo "    build.sh: ${ref_fp:0:140}..." >&2
        echo "    cmake   : ${cmake_fp:0:140}..." >&2
        behavioural_ok=0
    else
        echo "  ok: physics fingerprint identical (${#ref_fp} chars, serializeState + getFaceValues + seeded draw)"
    fi

    if [[ "${structural_ok}" -eq 1 && "${behavioural_ok}" -eq 1 ]]; then
        echo "ok: ${profile} dice_physics.wasm is equivalent (not byte-identical: symbol renumbering from"
        echo "    CMake's per-TU compile + LTO link vs build.sh's single invocation; every section has the"
        echo "    same size and the physics fingerprint matches — see this script's header)."
        continue
    fi

    FAILED=1
    echo "" >&2
    echo "MISMATCH: ${profile} dice_physics.wasm is NOT equivalent between build.sh and CMake" >&2
    [[ "${structural_ok}" -eq 0 ]] && echo "  - structural check failed (a section size or the section list differs)" >&2
    [[ "${behavioural_ok}" -eq 0 ]] && echo "  - behavioural check failed (physics fingerprint differs or would not load)" >&2
    echo "" >&2
    echo "  Compile line CMake used for ${target}:" >&2
    print_cmake_compile_line "${target}" >&2
    echo "  Compile line emcc_flags.sh prints for ${flag_profile}:" >&2
    echo "    $(bash "${WASM_DIR}/emcc_flags.sh" --print-compile-line "${flag_profile}")" >&2
done

if [[ "${FAILED}" -ne 0 ]]; then
    echo "" >&2
    cat >&2 <<'MSG'
The CMake project and build.sh are producing different binaries, and the
difference is NOT explained by symbol renumbering. build.sh is the source of
truth and ships; CMake is what clangd and IDE tooling see, so a divergence means
the editor is type-checking something the browser never runs.

Likely causes, in rough order:
  - CMake injecting per-config flags (CMAKE_CXX_FLAGS_<CONFIG>) that build.sh
    never passes. CMakeLists.txt clears these; check nothing re-added them.
  - A codegen flag reaching only the linker (see the --print-compile-line note
    in emcc_flags.sh) or only the compiler.
  - engine_sources.txt read differently by the two (blank/comment handling).
  - A section size moved: compare the section diff above against a known-good
    run. `code` growing or shrinking means real codegen changed.

Set DICE_CMAKE_PARITY_STRICT=0 to downgrade this to a report while diagnosing.
MSG
    if [[ "${STRICT}" == "0" ]]; then
        echo "[cmake-parity] DICE_CMAKE_PARITY_STRICT=0 — reporting mismatch but exiting 0." >&2
        exit 0
    fi
    exit 1
fi

echo "[cmake-parity] All profiles equivalent."
