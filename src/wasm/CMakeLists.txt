cmake_minimum_required(VERSION 3.13)
project(DicePhysics CXX)

# NOT set(CMAKE_CXX_STANDARD 17): that makes CMake prepend its own
# -std=gnu++17 ahead of the -std=c++17 emcc_flags.inc.sh already supplies. The
# later flag wins so the effective standard is the same either way, but it is
# one more flag on CMake's compile line that build.sh's never has -- and the
# wasm-toolchain CI job byte-diffs the two builds. emcc_flags.inc.sh owns the
# standard, as it owns every other compile flag here.

# Always emit compile_commands.json (clangd / IDE tooling). The native
# solver-test build (build_solver_test.sh) writes its own — this covers the
# Emscripten target when configured through CMake instead.
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# ---------------------------------------------------------------------------
# NOTE: build.sh remains the source-of-truth build -- it is what produces the
# artifacts CI uploads and the site ships. This CMake project exists for local
# IDE / clangd use AND as a cross-check: the `wasm-toolchain` CI job configures
# it with emcmake and byte-diffs its dice_physics.wasm against build.sh's (see
# scripts/verify-cmake-wasm-parity.sh). Keep the two in sync -- a divergence
# here is a real failure, not an IDE-only inconvenience.
# ---------------------------------------------------------------------------

# emcc_flags.inc.sh owns the optimisation level and every -D. CMake's own
# per-config flags would silently diverge from build.sh -- most visibly
# -DNDEBUG, which CMAKE_CXX_FLAGS_RELEASE adds and build.sh never passes,
# changing libc++ hardening assertions and therefore the emitted code. Clear
# the per-config slots so target_compile_options / LINK_FLAGS (both derived
# from emcc_flags.sh) are the whole story. CMAKE_CXX_FLAGS itself is left
# alone: the Emscripten toolchain file uses it for sysroot plumbing.
foreach(cfg DEBUG RELEASE RELWITHDEBINFO MINSIZEREL)
    set(CMAKE_CXX_FLAGS_${cfg} "")
    set(CMAKE_EXE_LINKER_FLAGS_${cfg} "")
endforeach()

# Where the wasm/ and wasm-scalar/ output dirs live. Defaults to the repo's
# public/ so a plain local configure lands exactly where build.sh puts things.
# scripts/verify-cmake-wasm-parity.sh points it at a scratch dir instead, so
# comparing the two builds never overwrites the artifacts CI uploads.
set(DICE_WASM_OUTPUT_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../public" CACHE PATH
    "Parent directory for the wasm/ and wasm-scalar/ output directories")

# ---------------------------------------------------------------------------
# Source files — dice_physics.cpp (Embind bindings) + the DicePhysicsEngine
# member-function translation units. The list itself lives in
# engine_sources.txt (single source of truth shared with build.sh and
# build_solver_test.sh) — add a new engine .cpp there, not here.
# ---------------------------------------------------------------------------
file(STRINGS "${CMAKE_CURRENT_SOURCE_DIR}/engine_sources.txt" ENGINE_SOURCES_RAW)
set(ENGINE_SOURCES "")
foreach(line IN LISTS ENGINE_SOURCES_RAW)
    string(STRIP "${line}" line)
    if(line STREQUAL "" OR line MATCHES "^#")
        continue()
    endif()
    list(APPEND ENGINE_SOURCES "${line}")
endforeach()

add_executable(dice_physics
    dice_physics.cpp
    ${ENGINE_SOURCES}
)

# ---------------------------------------------------------------------------
# Emscripten link flags — shared with build.sh via emcc_flags.sh
# ---------------------------------------------------------------------------
if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    set(EM_PROFILE "debug")
    message(STATUS
        "dice_physics: Debug configure writes public/wasm/ — same tree build.sh's "
        "release profile uses. Re-run 'cmake -DCMAKE_BUILD_TYPE=Release' (or plain "
        "build.sh) to restore the SIMD release artifact there."
    )
else()
    set(EM_PROFILE "release")
endif()

execute_process(
    COMMAND bash "${CMAKE_CURRENT_SOURCE_DIR}/emcc_flags.sh" --print-link-line "${EM_PROFILE}"
    OUTPUT_VARIABLE EM_LINK_FLAGS
    OUTPUT_STRIP_TRAILING_WHITESPACE
    RESULT_VARIABLE EM_FLAGS_RESULT
)
if(NOT EM_FLAGS_RESULT EQUAL 0)
    message(FATAL_ERROR "emcc_flags.sh --print-link-line failed")
endif()

execute_process(
    COMMAND bash "${CMAKE_CURRENT_SOURCE_DIR}/emcc_flags.sh" --print-compile-line "${EM_PROFILE}"
    OUTPUT_VARIABLE EM_COMPILE_FLAGS
    OUTPUT_STRIP_TRAILING_WHITESPACE
    RESULT_VARIABLE EM_COMPILE_RESULT
)
if(NOT EM_COMPILE_RESULT EQUAL 0)
    message(FATAL_ERROR "emcc_flags.sh --print-compile-line failed")
endif()
separate_arguments(EM_COMPILE_FLAGS_LIST NATIVE_COMMAND "${EM_COMPILE_FLAGS}")

set_target_properties(dice_physics PROPERTIES
    SUFFIX ".js"
    LINK_FLAGS "${EM_LINK_FLAGS}"
)

# Codegen flags must reach the *compiler*, not just the linker: -msimd128 is
# what defines __wasm_simd128__ (see dice_sat.hpp). Setting them only as
# LINK_FLAGS silently produced a non-SIMD binary byte-identical to the scalar
# target.
target_compile_options(dice_physics PRIVATE ${EM_COMPILE_FLAGS_LIST})

# ---------------------------------------------------------------------------
# Output location
# Place generated .js and .wasm next to each other so Emscripten's loader
# can resolve the binary with a relative URL. Matches build.sh's SIMD output.
# ---------------------------------------------------------------------------
set_target_properties(dice_physics PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${DICE_WASM_OUTPUT_ROOT}/wasm"
)

# ---------------------------------------------------------------------------
# Scalar target — mirrors `build.sh --scalar` (public/wasm-scalar/), skipped
# for Debug configures since build.sh's debug profile has no scalar variant.
# ---------------------------------------------------------------------------
if(NOT CMAKE_BUILD_TYPE STREQUAL "Debug")
    add_executable(dice_physics_scalar
        dice_physics.cpp
        ${ENGINE_SOURCES}
    )

    execute_process(
        COMMAND bash "${CMAKE_CURRENT_SOURCE_DIR}/emcc_flags.sh" --print-link-line release-scalar
        OUTPUT_VARIABLE EM_LINK_FLAGS_SCALAR
        OUTPUT_STRIP_TRAILING_WHITESPACE
        RESULT_VARIABLE EM_FLAGS_SCALAR_RESULT
    )
    if(NOT EM_FLAGS_SCALAR_RESULT EQUAL 0)
        message(FATAL_ERROR "emcc_flags.sh --print-link-line release-scalar failed")
    endif()

    execute_process(
        COMMAND bash "${CMAKE_CURRENT_SOURCE_DIR}/emcc_flags.sh" --print-compile-line release-scalar
        OUTPUT_VARIABLE EM_COMPILE_FLAGS_SCALAR
        OUTPUT_STRIP_TRAILING_WHITESPACE
        RESULT_VARIABLE EM_COMPILE_SCALAR_RESULT
    )
    if(NOT EM_COMPILE_SCALAR_RESULT EQUAL 0)
        message(FATAL_ERROR "emcc_flags.sh --print-compile-line release-scalar failed")
    endif()
    separate_arguments(EM_COMPILE_FLAGS_SCALAR_LIST NATIVE_COMMAND "${EM_COMPILE_FLAGS_SCALAR}")

    set_target_properties(dice_physics_scalar PROPERTIES
        OUTPUT_NAME "dice_physics"
        SUFFIX ".js"
        LINK_FLAGS "${EM_LINK_FLAGS_SCALAR}"
        RUNTIME_OUTPUT_DIRECTORY "${DICE_WASM_OUTPUT_ROOT}/wasm-scalar"
    )

    # -DDICE_FORCE_SCALAR_SAT is a preprocessor define — compile-time only.
    target_compile_options(dice_physics_scalar PRIVATE ${EM_COMPILE_FLAGS_SCALAR_LIST})
endif()
