# emcc_flags.inc.sh — Single source of truth for Emscripten compile/link flags.
# Sourced by build.sh, build_colab.sh, and emcc_flags.sh (--print-link-line for CMake).

EMCC_COMMON=(
    --bind
    -std=c++17
    -s WASM=1
    -s ALLOW_MEMORY_GROWTH=1
    -s MAXIMUM_MEMORY=64MB
    -s MODULARIZE=1
    -s EXPORT_ES6=1
    -s "EXPORT_NAME=DicePhysicsModule"
    -s ENVIRONMENT=web,worker,node
    -s FILESYSTEM=0
    -s ABORTING_MALLOC=0
)

EMCC_RELEASE=(
    -O3
    -flto
    -msimd128
    -s ASSERTIONS=0
)

EMCC_RELEASE_SCALAR=(
    -O3
    -flto
    -DDICE_FORCE_SCALAR_SAT
    -s ASSERTIONS=0
)

EMCC_DEBUG=(
    -O0
    -g
    -s ASSERTIONS=2
    -s SAFE_HEAP=1
)

# Build the full flag array for a profile: release | debug | release-scalar
emcc_build_flags() {
    local profile="${1:-release}"
    EMCC_FLAGS=("${EMCC_COMMON[@]}")
    case "${profile}" in
        release)
            if [ "${WASM_SIMD:-1}" = "0" ]; then
                EMCC_FLAGS+=("${EMCC_RELEASE_SCALAR[@]}")
            else
                EMCC_FLAGS+=("${EMCC_RELEASE[@]}")
            fi
            ;;
        release-scalar)
            EMCC_FLAGS+=("${EMCC_RELEASE_SCALAR[@]}")
            ;;
        debug)
            EMCC_FLAGS+=("${EMCC_DEBUG[@]}")
            ;;
        *)
            echo "emcc_build_flags: unknown profile '${profile}' (expected release, release-scalar, or debug)" >&2
            return 1
            ;;
    esac
}
