cmake_minimum_required(VERSION 3.13)
project(DicePhysics CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Always emit compile_commands.json (clangd / IDE tooling). The native
# solver-test build (build_solver_test.sh) writes its own — this covers the
# Emscripten target when configured through CMake instead.
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# ---------------------------------------------------------------------------
# NOTE: build.sh is the CI / source-of-truth build. This CMake project is a
# convenience for local IDE / clangd / advanced use; it is not run in CI.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Source files — dice_physics.cpp (Embind bindings) + the DicePhysicsEngine
# member-function translation units. Keep this list in sync with the
# ENGINE_SOURCES arrays in build.sh and build_solver_test.sh.
# ---------------------------------------------------------------------------
set(ENGINE_SOURCES
    dice_physics/dice_engine_lifecycle.cpp
    dice_physics/dice_engine_step.cpp
    dice_physics/dice_engine_collision_static.cpp
    dice_physics/dice_engine_collision_dynamic.cpp
    dice_physics/dice_engine_integrate.cpp
    dice_physics/dice_engine_face_value.cpp
)

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

set_target_properties(dice_physics PROPERTIES
    SUFFIX ".js"
    LINK_FLAGS "${EM_LINK_FLAGS}"
)

# ---------------------------------------------------------------------------
# Output location
# Place generated .js and .wasm next to each other so Emscripten's loader
# can resolve the binary with a relative URL. Matches build.sh's SIMD output.
# ---------------------------------------------------------------------------
set_target_properties(dice_physics PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/../../public/wasm"
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

    set_target_properties(dice_physics_scalar PROPERTIES
        OUTPUT_NAME "dice_physics"
        SUFFIX ".js"
        LINK_FLAGS "${EM_LINK_FLAGS_SCALAR}"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/../../public/wasm-scalar"
    )
endif()
