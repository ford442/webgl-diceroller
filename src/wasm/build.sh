#!/usr/bin/env bash
# build.sh — Compile dice_physics.cpp to WebAssembly using Emscripten.
#
# Prerequisites:
#   1. Install the Emscripten SDK: https://emscripten.org/docs/getting_started/downloads.html
#   2. Activate it in your shell:  source /path/to/emsdk/emsdk_env.sh
#
# Usage (run from repository root or this directory):
#   cd src/wasm && ./build.sh
#   cd src/wasm && ./build.sh --debug
#   # or use the npm script:
#   npm run build:wasm
#   npm run build:wasm:debug
#
# Output:
#   public/wasm/dice_physics.js    — Emscripten module loader (ES module)
#   public/wasm/dice_physics.wasm  — Compiled WASM binary
#   public/wasm/build-info.json    — Build metadata (emcc version, flags, git sha)

set -euo pipefail

PROFILE=release
OUT_SUBDIR=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --debug)
            PROFILE=debug
            shift
            ;;
        --scalar)
            PROFILE=release-scalar
            OUT_SUBDIR="scalar"
            shift
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

# Local dev convenience: activate an emsdk checked out at /root/emsdk if emcc
# isn't already on PATH (e.g. CI activates its own emsdk via setup-emsdk).
if ! command -v emcc >/dev/null 2>&1 && [ -f /root/emsdk/emsdk_env.sh ]; then
    # shellcheck source=/dev/null
    source /root/emsdk/emsdk_env.sh
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
OUT_DIR="${REPO_ROOT}/public/wasm"
if [ -n "${OUT_SUBDIR}" ]; then
    OUT_DIR="${OUT_DIR}-${OUT_SUBDIR}"
fi

# shellcheck source=emcc_flags.inc.sh
source "${SCRIPT_DIR}/emcc_flags.inc.sh"
emcc_build_flags "${PROFILE}"

mkdir -p "${OUT_DIR}"

echo "[build:wasm] Profile: ${PROFILE}"
echo "[build:wasm] Compiling dice_physics.cpp → ${OUT_DIR}/dice_physics.{js,wasm}"

emcc "${SCRIPT_DIR}/dice_physics.cpp" \
    "${EMCC_FLAGS[@]}" \
    -o "${OUT_DIR}/dice_physics.js"

# ---------------------------------------------------------------------------
# build-info.json — support metadata (gitignored; included in CI wasm artifact)
# ---------------------------------------------------------------------------
EMCC_FULL_VERSION="$(emcc --version 2>/dev/null | head -n1 || echo unknown)"
EMCC_VERSION="$(echo "${EMCC_FULL_VERSION}" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || echo unknown)"
GIT_SHA="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
BUILT_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
JS_BYTES="$(wc -c < "${OUT_DIR}/dice_physics.js" | tr -d ' ')"
WASM_BYTES="$(wc -c < "${OUT_DIR}/dice_physics.wasm" | tr -d ' ')"

# Build JSON flags array
FLAGS_JSON="["
for ((i = 0; i < ${#EMCC_FLAGS[@]}; i++)); do
    if [[ $i -gt 0 ]]; then FLAGS_JSON+=","; fi
    # Escape backslashes and double quotes for JSON
    esc="${EMCC_FLAGS[$i]//\\/\\\\}"
    esc="${esc//\"/\\\"}"
    FLAGS_JSON+="\"${esc}\""
done
FLAGS_JSON+="]"

cat > "${OUT_DIR}/build-info.json" <<EOF
{
  "profile": "${PROFILE}",
  "emcc_version": "${EMCC_VERSION}",
  "emcc_full_version": $(printf '%s' "${EMCC_FULL_VERSION}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))'),
  "flags": ${FLAGS_JSON},
  "git_sha": "${GIT_SHA}",
  "built_at": "${BUILT_AT}",
  "artifacts": {
    "js_bytes": ${JS_BYTES},
    "wasm_bytes": ${WASM_BYTES}
  }
}
EOF

echo "[build:wasm] Done.  Output:"
ls -lh "${OUT_DIR}/dice_physics.js" "${OUT_DIR}/dice_physics.wasm" "${OUT_DIR}/build-info.json"
