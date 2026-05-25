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
# Emscripten link flags
#
# Key options:
#   WASM=1                    — Emit a .wasm binary (not just asm.js)
#   ALLOW_MEMORY_GROWTH=1     — Let the heap grow at runtime
#   MODULARIZE=1              — Wrap output in a factory function
#   EXPORT_NAME               — Name of the factory function
#   --bind                    — Enable Embind (required for class bindings)
#   EXPORTED_RUNTIME_METHODS  — Expose typed_memory_view helpers to JS
#   -O3                       — Full optimisation
# ---------------------------------------------------------------------------
set(EM_FLAGS
    "-s WASM=1"
    "-s ALLOW_MEMORY_GROWTH=1"
    "-s MODULARIZE=1"
    "-s EXPORT_NAME=DicePhysicsModule"
    "-s EXPORTED_RUNTIME_METHODS=['typed_memory_view']"
    "--bind"
    "-O3"
)

string(JOIN " " EM_FLAGS_STR ${EM_FLAGS})

set_target_properties(dice_physics PROPERTIES
    SUFFIX ".js"
    LINK_FLAGS "${EM_FLAGS_STR}"
)

# ---------------------------------------------------------------------------
# Output location
# Place generated .js and .wasm next to each other so Emscripten's loader
# can resolve the binary with a relative URL.
# ---------------------------------------------------------------------------
set_target_properties(dice_physics PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/../../public/wasm"
)
