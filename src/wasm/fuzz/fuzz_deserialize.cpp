/**
 * fuzz_deserialize.cpp — libFuzzer target over DicePhysicsEngine::deserializeState
 * and rewindState.
 *
 * Both parse bytes a multiplayer peer sent (a late joiner's snapshot, a
 * lockstep rollback's), so they must survive any input: no out-of-bounds
 * read, no unbounded allocation, no UB on the bools/enums they read, and the
 * restored world must be steppable.
 *
 *   npm run fuzz:solver            (clang + libFuzzer, see build_fuzz.sh)
 */

#include "../dice_physics_engine.hpp"

#include <cstddef>
#include <cstdint>
#include <vector>

using namespace dice_physics;

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
    DicePhysicsEngine engine;
    engine.init(-15.0f, -2.75f, 18.0f, 18.0f);

    const std::vector<uint8_t> bytes(data, data + size);
    engine.deserializeState(bytes);

    // Whatever came back must round-trip and survive a few ticks.
    const std::vector<uint8_t> again = engine.serializeState();
    DicePhysicsEngine replica;
    replica.init(-15.0f, -2.75f, 18.0f, 18.0f);
    replica.deserializeState(again);

    for (int i = 0; i < 4; ++i) engine.step(1.0f / 120.0f);
    engine.buildTransformBuffer();
    engine.buildFaceValueBuffer();
    engine.buildSleepDiagnostics();

    // A live table rewound to the peer's bytes, then to the engine's own
    // re-serialization of them (the path a rollback takes when they parse).
    DicePhysicsEngine live;
    live.init(-15.0f, -2.75f, 18.0f, 18.0f);
    live.addDie(6, 0.0f, 0.0f, 0.0f);
    live.rewindState(bytes);
    live.rewindState(again);
    for (int i = 0; i < 4; ++i) live.step(1.0f / 120.0f);
    live.buildTransformBuffer();
    return 0;
}
