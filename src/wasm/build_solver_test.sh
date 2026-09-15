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
# The source list itself lives in engine_sources.txt (single source of truth
# shared with build.sh and CMakeLists.txt).
ENGINE_SOURCES=()
while IFS= read -r rel; do
    [[ -z "${rel}" || "${rel}" == \#* ]] && continue
    ENGINE_SOURCES+=("${SCRIPT_DIR}/${rel}")
done < "${SCRIPT_DIR}/engine_sources.txt"
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

# Guard the clangd contract (see .clangd -> CompilationDatabase: build-native):
# the database must exist, parse as JSON, and carry one entry per translation
# unit we just compiled. Runs in CI via `npm run test:solver`.
echo "[test:solver] Verifying compile_commands.json..."
node - "${BUILD_DIR}/compile_commands.json" "${#ALL_SOURCES[@]}" <<'NODE'
const fs = require('fs');
const [dbPath, expectedCount] = process.argv.slice(2);
const fail = (msg) => {
    console.error(`[test:solver] compile_commands.json check failed: ${msg}`);
    process.exit(1);
};
if (!fs.existsSync(dbPath)) fail(`${dbPath} was not generated`);
let db;
try {
    db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
} catch (err) {
    fail(`${dbPath} is not valid JSON (${err.message})`);
}
if (!Array.isArray(db)) fail('expected a top-level JSON array');
if (db.length !== Number(expectedCount)) {
    fail(`expected ${expectedCount} entries (one per translation unit), got ${db.length}`);
}
for (const entry of db) {
    for (const key of ['directory', 'file', 'arguments']) {
        if (!(key in entry)) fail(`entry missing "${key}": ${JSON.stringify(entry)}`);
    }
    if (!Array.isArray(entry.arguments) || entry.arguments.length === 0) {
        fail(`entry has empty "arguments": ${entry.file}`);
    }
    if (!fs.existsSync(entry.file)) fail(`entry references missing file: ${entry.file}`);
}
console.log(`[test:solver] compile_commands.json ok (${db.length} translation units).`);
NODE

echo "[test:solver] Running unit + fuzz tests..."
(cd "${REPO_ROOT}" && "${BIN}")

echo "[test:solver] Checking golden traces..."
node "${REPO_ROOT}/scripts/compare-solver-golden.mjs" "${BIN}"

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
    # Informational: die + dynamics broadphase cost at MAX_DYNAMICS (256).
    # --dice=48 (not 50) deliberately avoids colliding with the dice-only
    # "50" budget key in scripts/solver-bench-baselines.json -- this line
    # isn't gated on a threshold (compare-solver-bench.mjs is warn-only and
    # skips rows with no baseline entry for their dice count); it exists so
    # a regression back toward brute-force die-dynamic / dynamic-dynamic
    # pairing (dropped in favor of the shared uniform grid, see
    # docs/WASM_ENGINE.md Phase 8) is visible in CI output.
    "${BIN}" --bench --dice=48 --dynamics=256 --steps=600 --warmup=60
fi

echo "[test:solver] All solver tests passed."
