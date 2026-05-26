#!/usr/bin/env bash
# build.sh — Compile dice_physics.cpp to WebAssembly using Emscripten.
#
# Prerequisites:
#   1. Install the Emscripten SDK: https://emscripten.org/docs/getting_started/downloads.html
#   2. Activate it in your shell:  source /path/to/emsdk/emsdk_env.sh
#
# Usage (run from repository root or this directory):
#   cd src/wasm && ./build.sh
#   # or use the npm script:
#   npm run build:wasm
#
# Output:
#   public/wasm/dice_physics.js    — Emscripten module loader (ES module)
#   public/wasm/dice_physics.wasm  — Compiled WASM binary

source /content/buil*/emsdk/emsdk_env.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
OUT_DIR="${REPO_ROOT}/public/wasm"

mkdir -p "${OUT_DIR}"

echo "[build:wasm] Compiling dice_physics.cpp → ${OUT_DIR}/dice_physics.{js,wasm}"

emcc "${SCRIPT_DIR}/dice_physics.cpp" \
    --bind \
    -O3 \
    -s WASM=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s MODULARIZE=1 \
    -s "EXPORT_NAME=DicePhysicsModule" \
    -std=c++17 \
    -o "${OUT_DIR}/dice_physics.js"

echo "[build:wasm] Done.  Output:"
ls -lh "${OUT_DIR}/dice_physics.js" "${OUT_DIR}/dice_physics.wasm"
