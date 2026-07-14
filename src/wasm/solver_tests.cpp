/**
 * solver_tests.cpp — Native unit + fuzz tests for DicePhysicsEngine.
 *
 * Build & run:
 *   npm run test:solver
 */

#define DOCTEST_CONFIG_IMPLEMENT
#include "third_party/doctest.h"

#include "dice_physics_engine.hpp"

#include <cstdlib>
#include <cstring>
#include <iostream>
#include <sstream>
#include <string>

using namespace dice_physics;

namespace {

PolyHull makeUnitCubeHull() {
    PolyHull hull;
    hull.build({
        {-0.5f, -0.5f, -0.5f}, {0.5f, -0.5f, -0.5f},
        {0.5f, 0.5f, -0.5f}, {-0.5f, 0.5f, -0.5f},
        {-0.5f, -0.5f, 0.5f}, {0.5f, -0.5f, 0.5f},
        {0.5f, 0.5f, 0.5f}, {-0.5f, 0.5f, 0.5f},
    });
    return hull;
}

PolyHull makeTetraHull() {
    PolyHull hull;
    hull.build({
        {1.0f, 1.0f, 1.0f},
        {-1.0f, -1.0f, 1.0f},
        {-1.0f, 1.0f, -1.0f},
        {1.0f, -1.0f, -1.0f},
    });
    return hull;
}

std::vector<float> flattenHull(const PolyHull& hull) {
    std::vector<float> flat;
    flat.reserve(hull.verts.size() * 3);
    for (const auto& v : hull.verts) {
        flat.push_back(v.x);
        flat.push_back(v.y);
        flat.push_back(v.z);
    }
    return flat;
}

void runDeterministicScenario(DicePhysicsEngine& engine, uint64_t seed) {
    engine.init(-15.0f, -2.75f, 18.0f, 18.0f);
    engine.seedRNG(seed);

    const int sides[] = {4, 6, 8, 10, 12, 20};
    PolyHull cube = makeUnitCubeHull();
    auto cubeFlat = flattenHull(cube);

    for (int i = 0; i < 6; ++i) {
        float x = engine.randomFloat() * 4.0f - 2.0f;
        float y = 3.0f + engine.randomFloat() * 2.0f;
        float z = engine.randomFloat() * 4.0f - 2.0f;
        int id = engine.addDie(sides[i % 6], x, y, z);
        engine.setDieHull(id, cubeFlat);
        engine.applyImpulse(id,
            (engine.randomFloat() - 0.5f) * 50.0f,
            engine.randomFloat() * 10.0f,
            (engine.randomFloat() - 0.5f) * 50.0f);
        engine.applyTorqueImpulse(id,
            (engine.randomFloat() - 0.5f) * 200.0f,
            (engine.randomFloat() - 0.5f) * 200.0f,
            (engine.randomFloat() - 0.5f) * 200.0f);
    }

    for (int frame = 0; frame < 240; ++frame) {
        engine.step(1.0f / 60.0f);
    }
}

} // namespace

TEST_CASE("SAT overlap: separated cubes") {
    PolyHull a = makeUnitCubeHull();
    PolyHull b = makeUnitCubeHull();
    Vec3 posA{0, 0, 0};
    Vec3 posB{3, 0, 0};
    Quat rot{};
    Vec3 normal, contact;
    float penetration = 0.0f;

    CHECK_FALSE(satTest(a, posA, rot, b, posB, rot, normal, penetration, contact));
}

TEST_CASE("SAT overlap: touching cubes") {
    PolyHull a = makeUnitCubeHull();
    PolyHull b = makeUnitCubeHull();
    Vec3 posA{0, 0, 0};
    Vec3 posB{1, 0, 0};
    Quat rot{};
    Vec3 normal, contact;
    float penetration = 0.0f;

    CHECK(satTest(a, posA, rot, b, posB, rot, normal, penetration, contact));
    CHECK(penetration <= 0.05f);
}

TEST_CASE("SAT overlap: deeply penetrating cubes") {
    PolyHull a = makeUnitCubeHull();
    PolyHull b = makeUnitCubeHull();
    Vec3 posA{0, 0, 0};
    Vec3 posB{0.25f, 0, 0};
    Quat rot{};
    Vec3 normal, contact;
    float penetration = 0.0f;

    CHECK(satTest(a, posA, rot, b, posB, rot, normal, penetration, contact));
    CHECK(penetration > 0.2f);
}

TEST_CASE("SAT overlap: tetrahedra") {
    PolyHull a = makeTetraHull();
    PolyHull b = makeTetraHull();
    Vec3 posA{0, 2, 0};
    Vec3 posB{0, 2, 2.5f};
    Quat rot{};
    Vec3 normal, contact;
    float penetration = 0.0f;

    CHECK_FALSE(satTest(a, posA, rot, b, posB, rot, normal, penetration, contact));

    posB = {0, 2, 1.2f};
    CHECK(satTest(a, posA, rot, b, posB, rot, normal, penetration, contact));
    CHECK(penetration > 0.0f);
}

TEST_CASE("Quaternion integration stays unit length") {
    Quat q{};
    Vec3 omega{3.0f, -2.0f, 1.5f};
    for (int i = 0; i < 600; ++i) {
        q = q.integrate(omega, 1.0f / 60.0f);
        float lenSq = q.x*q.x + q.y*q.y + q.z*q.z + q.w*q.w;
        CHECK(std::abs(lenSq - 1.0f) < 1e-4f);
    }
}

TEST_CASE("PRNG golden sequence") {
    DeterministicRNG rng;
    rng.seed(0x123456789ABCDEF0ULL);
    CHECK(rng.next() == 0xB7FB0288C5EE4339ULL);
    CHECK(rng.next() == 0x42FEF730E71E2254ULL);
    CHECK(rng.next() == 0x835D6BA41BA14966ULL);
    CHECK(rng.nextFloat() == doctest::Approx(0.087864459f).epsilon(1e-6f));
}

TEST_CASE("Serialize round-trip preserves state") {
    DicePhysicsEngine engine;
    engine.init(-15.0f, -2.75f, 18.0f, 18.0f);

    int id0 = engine.addDie(6, 0, 4, 0);
    int id1 = engine.addDie(20, 1.5f, 5, -1.0f);
    engine.applyImpulse(id0, 5, 2, -3);
    engine.applyTorqueImpulse(id1, 0, 10, 0);
    for (int i = 0; i < 30; ++i) engine.step(1.0f / 60.0f);

  // Hull geometry is not part of the snapshot; compare kinematic fields only.
    auto bytes = engine.serializeState();
    DicePhysicsEngine restored;
    restored.init(-15.0f, -2.75f, 18.0f, 18.0f);
    restored.deserializeState(bytes);
    CHECK(bytes == restored.serializeState());

    for (int i = 0; i < 30; ++i) {
        engine.step(1.0f / 60.0f);
        restored.step(1.0f / 60.0f);
    }
    CHECK(engine.serializeState() == restored.serializeState());
}

TEST_CASE("Sleep threshold settles low-energy die") {
    DicePhysicsEngine engine;
    engine.init(-15.0f, -2.75f, 18.0f, 18.0f);
    int id = engine.addDie(6, 0, 0.5f, 0);
    engine.applyImpulse(id, 0.01f, 0, 0.01f);

    bool settled = false;
    for (int i = 0; i < 600; ++i) {
        engine.step(1.0f / 60.0f);
        if (engine.areAllSettled()) {
            settled = true;
            break;
        }
    }
    CHECK(settled);
}

TEST_CASE("Determinism: same seed yields identical serialize output") {
    DicePhysicsEngine a, b;
    const uint64_t seed = 0xDEADBEEFCAFEBABEULL;
    runDeterministicScenario(a, seed);
    runDeterministicScenario(b, seed);
    CHECK(a.serializeState() == b.serializeState());
}

TEST_CASE("Fuzz: random scenarios preserve invariants and settle") {
    const char* env = std::getenv("FUZZ_SEEDS");
    int seedCount = env ? std::atoi(env) : 2000;
    if (seedCount < 1) seedCount = 2000;

    PolyHull cube = makeUnitCubeHull();
    PolyHull tetra = makeTetraHull();
    auto cubeFlat = flattenHull(cube);
    auto tetraFlat = flattenHull(tetra);
    const int sides[] = {4, 6, 8, 10, 12, 20};

    DeterministicRNG master;
    master.seed(0xF005BA11ULL);

    for (int run = 0; run < seedCount; ++run) {
        DicePhysicsEngine engine;
        engine.init(-15.0f, -2.75f, 18.0f, 18.0f);

        const int dieCount = 1 + static_cast<int>(master.next() % 12);
        float energyBudget = 0.0f;

        for (int d = 0; d < dieCount; ++d) {
            float x = master.nextFloat() * 10.0f - 5.0f;
            float y = 2.0f + master.nextFloat() * 6.0f;
            float z = master.nextFloat() * 10.0f - 5.0f;
            int sidesN = sides[master.next() % 6];
            int id = engine.addDie(sidesN, x, y, z);
            if (id < 0) continue;

            if (master.next() & 1u) engine.setDieHull(id, cubeFlat);
            else engine.setDieHull(id, tetraFlat);

            float ix = (master.nextFloat() - 0.5f) * 60.0f;
            float iy = master.nextFloat() * 15.0f;
            float iz = (master.nextFloat() - 0.5f) * 60.0f;
            engine.applyImpulse(id, ix, iy, iz);
            engine.applyTorqueImpulse(id,
                (master.nextFloat() - 0.5f) * 250.0f,
                (master.nextFloat() - 0.5f) * 250.0f,
                (master.nextFloat() - 0.5f) * 250.0f);
            energyBudget += 0.5f * 5.0f * (ix*ix + iy*iy + iz*iz);
        }

        const float maxEnergy = energyBudget * 8.0f + 50000.0f;
        const int maxFrames = 4800;
        bool settled = false;
        int lowEnergyFrames = 0;

        for (int frame = 0; frame < maxFrames; ++frame) {
            engine.step(1.0f / 60.0f);

            CHECK(engine.allBodyStatesFinite());
            CHECK(engine.allRotationsUnitLength());
            CHECK(engine.allBodyStatesInWorldBounds(5.0f));

            const float energy = engine.totalKineticEnergy();
            CHECK(energy <= maxEnergy);

            if (engine.areAllSettled()) {
                settled = true;
                break;
            }
            if (energy < 0.02f) {
                lowEnergyFrames++;
                if (lowEnergyFrames >= 180) {
                    settled = true;
                    break;
                }
            } else {
                lowEnergyFrames = 0;
            }
        }
        CHECK_MESSAGE(settled, "seed run " << run << " did not settle within " << maxFrames << " frames");
    }
}

// ---------------------------------------------------------------------------
// CLI helpers for native ↔ WASM parity (invoked by scripts/compare-solver-wasm.mjs)
// ---------------------------------------------------------------------------

int dumpSerializeHex(uint64_t seed) {
    DicePhysicsEngine engine;
    runDeterministicScenario(engine, seed);
    const auto bytes = engine.serializeState();
    for (uint8_t b : bytes) {
        std::cout << std::hex << (b >> 4) << (b & 0xF);
    }
    std::cout << std::dec << '\n';
    return 0;
}

int main(int argc, char** argv) {
    if (argc >= 3 && std::strcmp(argv[1], "--dump-serialize") == 0) {
        uint64_t seed = std::strtoull(argv[2], nullptr, 0);
        return dumpSerializeHex(seed);
    }
    doctest::Context ctx;
    ctx.applyCommandLine(argc, argv);
    return ctx.run();
}
