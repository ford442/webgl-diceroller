cmake_minimum_required(VERSION 3.13)
project(DicePhysics CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ---------------------------------------------------------------------------
# Source files
# ---------------------------------------------------------------------------
add_executable(dice_physics
    dice_physics.cpp
)

# ---------------------------------------------------------------------------
# Emscripten link flags — shared with build.sh via emcc_flags.sh
# ---------------------------------------------------------------------------
execute_process(
    COMMAND bash "${CMAKE_CURRENT_SOURCE_DIR}/emcc_flags.sh" --print-link-line release
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
# can resolve the binary with a relative URL.
# ---------------------------------------------------------------------------
set_target_properties(dice_physics PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/../../public/wasm"
)
