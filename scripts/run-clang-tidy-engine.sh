#!/usr/bin/env bash
# run-clang-tidy-engine.sh — clang-tidy over the DicePhysicsEngine sources.
#
# Scope: the translation units listed in src/wasm/engine_sources.txt, analysed
# against the native compile_commands.json that build_solver_test.sh writes.
# Checks live in src/wasm/.clang-tidy (which also documents what is excluded
# and why).
#
# Not analysed: src/wasm/third_party/doctest.h (vendored) and
# src/wasm/dice_physics.cpp (needs emscripten headers the native database has
# no path for). See src/wasm/.clang-tidy.
#
# Usage (from repo root):
#   npm run lint:cpp
#   CLANG_TIDY=clang-tidy-18 npm run lint:cpp
#
# Exits non-zero on any finding (.clang-tidy sets WarningsAsErrors: '*').

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WASM_DIR="${REPO_ROOT}/src/wasm"
DB_DIR="${WASM_DIR}/build-native"

CLANG_TIDY="${CLANG_TIDY:-clang-tidy}"
if ! command -v "${CLANG_TIDY}" >/dev/null 2>&1; then
    echo "FAIL: ${CLANG_TIDY} not found. Install clang-tidy or set CLANG_TIDY=<binary>." >&2
    exit 1
fi

# The database is a build_solver_test.sh side effect. Building it here rather
# than erroring keeps `npm run lint:cpp` usable from a clean checkout; when the
# solver tests already ran (as in CI, where this follows test:solver), the file
# is there and this is a no-op.
if [[ ! -f "${DB_DIR}/compile_commands.json" ]]; then
    echo "[lint:cpp] ${DB_DIR}/compile_commands.json not found; running build_solver_test.sh..."
    bash "${WASM_DIR}/build_solver_test.sh" >/dev/null
fi

SOURCES=()
while IFS= read -r rel; do
    [[ -z "${rel}" || "${rel}" == \#* ]] && continue
    SOURCES+=("${WASM_DIR}/${rel}")
done < "${WASM_DIR}/engine_sources.txt"

if [[ ${#SOURCES[@]} -eq 0 ]]; then
    echo "FAIL: engine_sources.txt listed no translation units." >&2
    exit 1
fi

echo "[lint:cpp] $("${CLANG_TIDY}" --version | grep -m1 -i 'version' | sed 's/^ *//')"
echo "[lint:cpp] Analysing ${#SOURCES[@]} translation units from engine_sources.txt..."

FAILED=()
for src in "${SOURCES[@]}"; do
    rel="${src#"${WASM_DIR}/"}"
    printf '[lint:cpp]   %s ... ' "${rel}"
    if output="$("${CLANG_TIDY}" -p "${DB_DIR}" --quiet "${src}" 2>&1)"; then
        echo "ok"
    else
        echo "FAILED"
        printf '%s\n' "${output}"
        FAILED+=("${rel}")
    fi
done

if [[ ${#FAILED[@]} -gt 0 ]]; then
    echo "" >&2
    echo "FAIL: clang-tidy reported findings in ${#FAILED[@]} translation unit(s):" >&2
    printf '  %s\n' "${FAILED[@]}" >&2
    echo "" >&2
    echo "Fix them, or -- if a check is wrong for this codebase -- disable it in" >&2
    echo "src/wasm/.clang-tidy with a comment saying why, next to the others." >&2
    exit 1
fi

echo "[lint:cpp] clean (${#SOURCES[@]} translation units)."
