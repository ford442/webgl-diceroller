#!/usr/bin/env bash
# generate-clangd-db.sh — Merge the native and Emscripten compile_commands.json
# into one database so clangd resolves __EMSCRIPTEN__ / __wasm_simd128__
# branches on the engine sources, while still covering solver_tests.cpp
# (native-only).
#
# Native half: src/wasm/build-native/compile_commands.json, written by
#   build_solver_test.sh (npm run test:solver).
# Emscripten half: configured here via `emcmake cmake` into
#   src/wasm/build-emcc, using this repo's CMakeLists.txt — only runs if an
#   EMSDK is on PATH (or checked out at /root/emsdk, same convention as
#   build.sh). Without one, this script still produces a usable (native-only)
#   merged db instead of failing, so clangd keeps working; it just won't see
#   emcc's defines until a real EMSDK is available.
#
# Usage:
#   src/wasm/generate-clangd-db.sh
#
# Output: src/wasm/compile_commands.json (gitignored; regenerate any time
# engine_sources.txt or the emcc flags change). .clangd points here.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_DB="${SCRIPT_DIR}/build-native/compile_commands.json"
EMCC_BUILD_DIR="${SCRIPT_DIR}/build-emcc"
EMCC_DB="${EMCC_BUILD_DIR}/compile_commands.json"
OUT_DB="${SCRIPT_DIR}/compile_commands.json"

if [[ ! -f "${NATIVE_DB}" ]]; then
    echo "[generate-clangd-db] ${NATIVE_DB} not found; running build_solver_test.sh first..."
    "${SCRIPT_DIR}/build_solver_test.sh" >/dev/null
fi

if ! command -v emcmake >/dev/null 2>&1 && [ -f /root/emsdk/emsdk_env.sh ]; then
    # shellcheck source=/dev/null
    source /root/emsdk/emsdk_env.sh
fi

if command -v emcmake >/dev/null 2>&1; then
    echo "[generate-clangd-db] EMSDK found; configuring ${EMCC_BUILD_DIR} for emcc compile_commands..."
    emcmake cmake -S "${SCRIPT_DIR}" -B "${EMCC_BUILD_DIR}" -DCMAKE_BUILD_TYPE=Release >/dev/null
else
    echo "[generate-clangd-db] No EMSDK on PATH (and none at /root/emsdk) — skipping the" \
         "emcc half. Engine sources will fall back to the native compile command," \
         "meaning __EMSCRIPTEN__/__wasm_simd128__ branches stay greyed out in clangd" \
         "until this is re-run with an EMSDK available."
fi

node - "${NATIVE_DB}" "${EMCC_DB}" "${OUT_DB}" <<'NODE'
const fs = require('fs');
const [nativePath, emccPath, outPath] = process.argv.slice(2);

const readDb = (p) => {
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, 'utf8'));
};

const native = readDb(nativePath);
const emcc = readDb(emccPath);

// Prefer the emcc entry for any file it covers (so engine sources parse with
// __EMSCRIPTEN__/__wasm_simd128__ defined); fall back to native for files
// only compiled natively (solver_tests.cpp). CMakeLists.txt declares the
// SIMD `dice_physics` target before the scalar `dice_physics_scalar` target,
// so within the emcc db the first entry per file is the SIMD one — keep it.
const merged = new Map();
for (const entry of native) merged.set(entry.file, entry);
const seenEmcc = new Set();
for (const entry of emcc) {
    if (seenEmcc.has(entry.file)) continue;
    seenEmcc.add(entry.file);
    merged.set(entry.file, entry);
}

const out = [...merged.values()];
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`[generate-clangd-db] Wrote ${outPath} (${out.length} entries: ${native.length} native, ${emcc.length} emcc).`);
NODE
