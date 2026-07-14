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

mkdir -p "${BUILD_DIR}"

echo "[test:solver] Compiling native solver tests with ${CXX}..."
"${CXX}" -std=c++17 -O2 -Wall -Wextra -Wpedantic \
    -I"${SCRIPT_DIR}" \
    "${SCRIPT_DIR}/solver_tests.cpp" \
    -o "${BIN}"

echo "[test:solver] Running unit + fuzz tests..."
(cd "${REPO_ROOT}" && "${BIN}")

if [ -f "${REPO_ROOT}/public/wasm/dice_physics.wasm" ]; then
    echo "[test:solver] WASM artifacts found — running native↔WASM parity check..."
    node "${REPO_ROOT}/scripts/compare-solver-wasm.mjs" "${BIN}"
else
    echo "[test:solver] Skipping WASM parity (public/wasm/dice_physics.wasm not present)."
fi

echo "[test:solver] All solver tests passed."
