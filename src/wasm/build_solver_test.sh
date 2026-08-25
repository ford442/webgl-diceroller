#!/usr/bin/env bash
# build_solver_test.sh — Compile and run native DicePhysicsEngine tests.
#
# Usage (from repo root):
#   npm run test:solver
#   FUZZ_SEEDS=500 npm run test:solver

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BUILD_DIR="${SCRIPT_DIR}/build-native"
BIN="${BUILD_DIR}/solver_tests"

CXX="${CXX:-g++}"
if ! command -v "${CXX}" >/dev/null 2>&1; then
    CXX=clang++
fi

CXXFLAGS=(-std=c++17 -O2 -Wall -Wextra -Wpedantic -I"${SCRIPT_DIR}")

# DicePhysicsEngine member functions live in separate .cpp translation units
# (see docs/WASM_ENGINE.md); solver_tests.cpp only needs the class declaration.
ENGINE_SOURCES=(
    "${SCRIPT_DIR}/dice_physics/dice_engine_lifecycle.cpp"
    "${SCRIPT_DIR}/dice_physics/dice_engine_step.cpp"
    "${SCRIPT_DIR}/dice_physics/dice_engine_collision_static.cpp"
    "${SCRIPT_DIR}/dice_physics/dice_engine_collision_dynamic.cpp"
    "${SCRIPT_DIR}/dice_physics/dice_engine_integrate.cpp"
    "${SCRIPT_DIR}/dice_physics/dice_engine_face_value.cpp"
)
ALL_SOURCES=("${SCRIPT_DIR}/solver_tests.cpp" "${ENGINE_SOURCES[@]}")

mkdir -p "${BUILD_DIR}"

echo "[test:solver] Compiling native solver tests with ${CXX}..."
"${CXX}" "${CXXFLAGS[@]}" "${ALL_SOURCES[@]}" -o "${BIN}"

# compile_commands.json for clangd (native C++ only — not the Emscripten
# target). Written unconditionally, one entry per translation unit, so
# clangd/agents get accurate include paths without requiring bear/compiledb.
echo "[test:solver] Writing ${BUILD_DIR}/compile_commands.json..."
{
    echo "["
    first=1
    for src in "${ALL_SOURCES[@]}"; do
        if [[ ${first} -eq 0 ]]; then echo ","; fi
        first=0
        printf '  {\n'
        printf '    "directory": "%s",\n' "${SCRIPT_DIR}"
        printf '    "file": "%s",\n' "${src}"
        printf '    "arguments": ['
        args=("${CXX}" "${CXXFLAGS[@]}" "${src}" -c -o "${src}.o")
        arg_first=1
        for arg in "${args[@]}"; do
            if [[ ${arg_first} -eq 0 ]]; then printf ', '; fi
            arg_first=0
            esc="${arg//\\/\\\\}"
            esc="${esc//\"/\\\"}"
            printf '"%s"' "${esc}"
        done
        printf ']\n'
        printf '  }'
    done
    echo ""
    echo "]"
} > "${BUILD_DIR}/compile_commands.json"

echo "[test:solver] Running unit + fuzz tests..."
(cd "${REPO_ROOT}" && "${BIN}")

if [ -f "${REPO_ROOT}/public/wasm/dice_physics.wasm" ]; then
    echo "[test:solver] WASM artifacts found — running native↔WASM parity check..."
    node "${REPO_ROOT}/scripts/compare-solver-wasm.mjs" "${BIN}"
else
    echo "[test:solver] Skipping WASM parity (public/wasm/dice_physics.wasm not present)."
fi

if [ "${BENCH_SOLVER:-}" = "1" ]; then
    echo "[test:solver] Running step-time benchmarks (native, scalar path)..."
    for N in 10 50 100 200; do
        "${BIN}" --bench --dice="${N}" --steps=600 --warmup=60
    done
fi

echo "[test:solver] All solver tests passed."
