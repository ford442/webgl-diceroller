#!/usr/bin/env bash
# build_colab.sh — Compile dice_physics.cpp to WebAssembly (Google Colab emsdk path).
#
# Usage:
#   npm run build:wasm_colab
#
# Output:
#   public/wasm/dice_physics.js    — Emscripten module loader (ES module)
#   public/wasm/dice_physics.wasm  — Compiled WASM binary
#   public/wasm/build-info.json    — Build metadata

set -euo pipefail

# shellcheck source=/dev/null
source /content/build_space/emsdk/emsdk_env.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/build.sh" "$@"
