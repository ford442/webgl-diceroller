#!/usr/bin/env bash
# build_fuzz.sh — Build and run the solver fuzz targets under ASan + UBSan.
#
# Targets (src/wasm/fuzz/):
#   fuzz_deserialize — deserializeState() over bytes a multiplayer peer sent
#   fuzz_colliders   — addStatic* / addDynamic* / container planes, then step
#
# With a clang that ships libFuzzer (compiler-rt), each target runs as a real
# coverage-guided fuzzer for FUZZ_TIME seconds (default 60). Otherwise it
# falls back to standalone_driver.cpp — a seeded mutation loop of
# FUZZ_ITERATIONS inputs (default 20000) — so g++ still exercises the
# sanitizers.
#
# Usage (from repo root):
#   npm run fuzz:solver
#   FUZZ_TIME=600 npm run fuzz:solver
#   FUZZ_STANDALONE=1 CXX=g++ npm run fuzz:solver

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUZZ_DIR="${SCRIPT_DIR}/fuzz"
BUILD_DIR="${SCRIPT_DIR}/build-fuzz"
FUZZ_TIME="${FUZZ_TIME:-60}"
FUZZ_ITERATIONS="${FUZZ_ITERATIONS:-20000}"

CXX="${CXX:-clang++}"
if ! command -v "${CXX}" >/dev/null 2>&1; then
    CXX=g++
fi

# Same language level and FP contract as the shipped engine
# (emcc_flags.inc.sh / build_solver_test.sh), so a finding reproduces there.
CXXFLAGS=(-std=c++20 -O1 -g -fno-omit-frame-pointer -ffp-contract=off
    -fsanitize=address,undefined -fno-sanitize-recover=all -I"${SCRIPT_DIR}")

ENGINE_SOURCES=()
while IFS= read -r rel; do
    [[ -z "${rel}" || "${rel}" == \#* ]] && continue
    ENGINE_SOURCES+=("${SCRIPT_DIR}/${rel}")
done < "${SCRIPT_DIR}/engine_sources.txt"

mkdir -p "${BUILD_DIR}"

use_libfuzzer=0
if [ "${FUZZ_STANDALONE:-0}" != "1" ]; then
    probe="${BUILD_DIR}/probe.cpp"
    echo 'extern "C" int LLVMFuzzerTestOneInput(const unsigned char*, unsigned long) { return 0; }' > "${probe}"
    if "${CXX}" -fsanitize=fuzzer,address "${probe}" -o "${BUILD_DIR}/probe" >/dev/null 2>&1; then
        use_libfuzzer=1
    fi
fi

export ASAN_OPTIONS="${ASAN_OPTIONS:-detect_leaks=1:abort_on_error=1}"
export UBSAN_OPTIONS="${UBSAN_OPTIONS:-print_stacktrace=1:halt_on_error=1}"

# Compile the engine once; every target links the same objects. Under
# libFuzzer the engine carries the coverage instrumentation too, otherwise
# the fuzzer is only guided by the thin harness file.
if [ "${use_libfuzzer}" = "1" ]; then
    CXXFLAGS+=(-fsanitize=fuzzer-no-link)
fi
echo "[fuzz:solver] Compiling engine with ${CXX} (ASan + UBSan)..."
ENGINE_OBJECTS=()
for src in "${ENGINE_SOURCES[@]}"; do
    obj="${BUILD_DIR}/$(basename "${src}" .cpp).o"
    "${CXX}" "${CXXFLAGS[@]}" -c "${src}" -o "${obj}"
    ENGINE_OBJECTS+=("${obj}")
done

"${CXX}" "${CXXFLAGS[@]}" "${FUZZ_DIR}/make_seed_corpus.cpp" "${ENGINE_OBJECTS[@]}" \
    -o "${BUILD_DIR}/make_seed_corpus"

for target in fuzz_deserialize fuzz_colliders; do
    corpus="${BUILD_DIR}/corpus-${target}"
    rm -rf "${corpus}"
    mkdir -p "${corpus}"
    if [ "${target}" = fuzz_deserialize ]; then
        "${BUILD_DIR}/make_seed_corpus" "${corpus}"
    else
        printf '\x00\x01\x02\x03\x04\x05\x06\x07\x08' > "${corpus}/ops.bin"
    fi

    if [ "${use_libfuzzer}" = "1" ]; then
        echo "[fuzz:solver] ${target}: libFuzzer for ${FUZZ_TIME}s..."
        "${CXX}" "${CXXFLAGS[@]}" -fsanitize=fuzzer "${FUZZ_DIR}/${target}.cpp" \
            "${ENGINE_OBJECTS[@]}" -o "${BUILD_DIR}/${target}"
        # rss_limit_mb: an input must not make the engine allocate without bound.
        "${BUILD_DIR}/${target}" -max_total_time="${FUZZ_TIME}" -rss_limit_mb=1024 \
            -max_len=8192 -print_final_stats=1 -artifact_prefix="${BUILD_DIR}/${target}-" "${corpus}"
    else
        echo "[fuzz:solver] ${target}: libFuzzer unavailable for ${CXX}; standalone mutation loop..."
        "${CXX}" "${CXXFLAGS[@]}" "${FUZZ_DIR}/${target}.cpp" "${FUZZ_DIR}/standalone_driver.cpp" \
            "${ENGINE_OBJECTS[@]}" -o "${BUILD_DIR}/${target}_standalone"
        "${BUILD_DIR}/${target}_standalone" --iterations="${FUZZ_ITERATIONS}" "${corpus}"/*
    fi
done

echo "[fuzz:solver] All fuzz targets ran clean."
