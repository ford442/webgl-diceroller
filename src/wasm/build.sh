#!/usr/bin/env bash
# build.sh — Compile dice_physics.cpp to WebAssembly using Emscripten.
#
# Prerequisites:
#   1. Install the Emscripten SDK: https://emscripten.org/docs/getting_started/downloads.html
#   2. Activate it in your shell:  source /path/to/emsdk/emsdk_env.sh
#
# Usage (run from repository root or this directory):
#   cd src/wasm && ./build.sh              # SIMD → public/wasm/ AND scalar → public/wasm-scalar/
#   cd src/wasm && ./build.sh --debug      # debug build → public/wasm/
#   cd src/wasm && ./build.sh --scalar     # scalar only → public/wasm-scalar/
#   cd src/wasm && ./build.sh --simd-only  # SIMD only → public/wasm/
#   npm run build:wasm
#   npm run build:wasm:debug
#
# Output:
#   public/wasm/dice_physics.{js,wasm} + build-info.json
#   public/wasm-scalar/dice_physics.{js,wasm} + build-info.json  (release default)

set -euo pipefail

MODE=both
while [[ $# -gt 0 ]]; do
    case "$1" in
        --debug)
            MODE=debug
            shift
            ;;
        --scalar)
            MODE=scalar
            shift
            ;;
        --simd-only)
            MODE=simd
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
if ! command -v em++ >/dev/null 2>&1 && [ -f /root/emsdk/emsdk_env.sh ]; then
    # shellcheck source=/dev/null
    source /root/emsdk/emsdk_env.sh
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# shellcheck source=emcc_flags.inc.sh
source "${SCRIPT_DIR}/emcc_flags.inc.sh"

write_build_info() {
    local out_dir="$1"
    local profile="$2"

    local emcc_full_version emcc_version git_sha built_at js_bytes wasm_bytes
    emcc_full_version="$(em++ --version 2>/dev/null | head -n1 || echo unknown)"
    emcc_version="$(echo "${emcc_full_version}" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || echo unknown)"
    git_sha="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
    built_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    js_bytes="$(wc -c < "${out_dir}/dice_physics.js" | tr -d ' ')"
    wasm_bytes="$(wc -c < "${out_dir}/dice_physics.wasm" | tr -d ' ')"

    local simd_json="false"
    local saw_simd=0
    local saw_scalar_sat=0
    local initial_memory="${EMCC_INITIAL_MEMORY:-}"
    local i
    for ((i = 0; i < ${#EMCC_FLAGS[@]}; i++)); do
        case "${EMCC_FLAGS[$i]}" in
            -msimd128) saw_simd=1 ;;
            -DDICE_FORCE_SCALAR_SAT) saw_scalar_sat=1 ;;
            -s\ INITIAL_MEMORY=*) initial_memory="${EMCC_FLAGS[$i]#*INITIAL_MEMORY=}" ;;
            INITIAL_MEMORY=*) initial_memory="${EMCC_FLAGS[$i]#INITIAL_MEMORY=}" ;;
            -sINITIAL_MEMORY=*) initial_memory="${EMCC_FLAGS[$i]#*INITIAL_MEMORY=}" ;;
        esac
        if [[ "${EMCC_FLAGS[$i]}" == "-s" && $((i + 1)) -lt ${#EMCC_FLAGS[@]} ]]; then
            if [[ "${EMCC_FLAGS[$((i + 1))]}" == INITIAL_MEMORY=* ]]; then
                initial_memory="${EMCC_FLAGS[$((i + 1))]#INITIAL_MEMORY=}"
            fi
        fi
    done
    if [[ "${saw_simd}" -eq 1 && "${saw_scalar_sat}" -eq 0 ]]; then
        simd_json="true"
    fi

    local flags_json="["
    for ((i = 0; i < ${#EMCC_FLAGS[@]}; i++)); do
        if [[ $i -gt 0 ]]; then flags_json+=","; fi
        local esc="${EMCC_FLAGS[$i]//\\/\\\\}"
        esc="${esc//\"/\\\"}"
        flags_json+="\"${esc}\""
    done
    flags_json+="]"

    cat > "${out_dir}/build-info.json" <<EOF
{
  "profile": "${profile}",
  "simd": ${simd_json},
  "initial_memory": "${initial_memory}",
  "emcc_version": "${emcc_version}",
  "emcc_full_version": $(printf '%s' "${emcc_full_version}" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))'),
  "flags": ${flags_json},
  "git_sha": "${git_sha}",
  "built_at": "${built_at}",
  "artifacts": {
    "js_bytes": ${js_bytes},
    "wasm_bytes": ${wasm_bytes}
  }
}
EOF
}

compile_profile() {
    local profile="$1"
    local out_dir="$2"
    emcc_build_flags "${profile}"
    mkdir -p "${out_dir}"
    echo "[build:wasm] Profile: ${profile}"
    echo "[build:wasm] Compiling dice_physics.cpp → ${out_dir}/dice_physics.{js,wasm}"
    em++ "${SCRIPT_DIR}/dice_physics.cpp" \
        "${EMCC_FLAGS[@]}" \
        -o "${out_dir}/dice_physics.js"
    write_build_info "${out_dir}" "${profile}"
    echo "[build:wasm] Done.  Output:"
    ls -lh "${out_dir}/dice_physics.js" "${out_dir}/dice_physics.wasm" "${out_dir}/build-info.json"
}

case "${MODE}" in
    both)
        compile_profile release "${REPO_ROOT}/public/wasm"
        compile_profile release-scalar "${REPO_ROOT}/public/wasm-scalar"
        ;;
    simd)
        compile_profile release "${REPO_ROOT}/public/wasm"
        ;;
    scalar)
        compile_profile release-scalar "${REPO_ROOT}/public/wasm-scalar"
        ;;
    debug)
        compile_profile debug "${REPO_ROOT}/public/wasm"
        ;;
esac
