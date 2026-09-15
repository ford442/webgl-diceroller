# emcc_flags.inc.sh — Single source of truth for Emscripten compile/link flags.
# Sourced by build.sh, build_colab.sh, and emcc_flags.sh (--print-link-line for CMake).
#
# Determinism: do not add -ffast-math or PRECISE_F32=0 — seeded replay is IEEE-754.
# -s STACK_SIZE=262144 — EMSDK 3.1.61 default stack is small; manifold SI + SAT
#   recursion/temps need headroom. Do not drop without a stack-highwater check.
# -s WASM_BIGINT=1 — lets Embind bind uint64_t/int64_t (seedRNG) directly as a
#   JS BigInt instead of needing a narrowing uint32_t shim at the binding.
#   Supported since EMSDK ~1.39; do not drop without re-narrowing seedRNG.
# --closure 1 and -s STRICT=1 are intentionally unset: Embind + EXPORT_ES6 glue
#   on 3.1.61 still trips both. Re-evaluate when upgrading EMSDK.
# -fno-rtti is omitted: Embind on EMSDK 3.1.61 still requires RTTI.
# -fno-exceptions is omitted: Embind error paths can throw; DISABLE_EXCEPTION_CATCHING=1
# still strips catch tables in release.

EMCC_INITIAL_MEMORY="16MB"

EMCC_COMMON=(
    --bind
    -std=c++17
    -s WASM=1
    -s ALLOW_MEMORY_GROWTH=1
    -s MAXIMUM_MEMORY=64MB
    -s INITIAL_MEMORY=16MB
    -s MALLOC=emmalloc
    -s DISABLE_EXCEPTION_CATCHING=1
    -s SUPPORT_LONGJMP=0
    -s MODULARIZE=1
    -s EXPORT_ES6=1
    -s "EXPORT_NAME=DicePhysicsModule"
    -s ENVIRONMENT=web,worker,node
    -s FILESYSTEM=0
    -s ABORTING_MALLOC=0
    -s WASM_BIGINT=1
    -s STACK_SIZE=262144
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
