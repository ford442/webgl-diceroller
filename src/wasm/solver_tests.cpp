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
#include <chrono>

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

TEST_CASE("Container planes bounce die inside open box") {
    DicePhysicsEngine engine;
    engine.init(-15.0f, -10.0f, 18.0f, 18.0f);
    engine.setContainerActive(true);
    engine.setContainerPlanes({
        0.0f, 1.0f, 0.0f, 0.0f,
        -1.0f, 0.0f, 0.0f, -2.0f,
         1.0f, 0.0f, 0.0f, -2.0f,
        0.0f, 0.0f, -1.0f, -2.0f,
        0.0f, 0.0f,  1.0f, -2.0f,
    });
    const int id = engine.addDie(6, 0.0f, 3.0f, 0.0f);
    engine.setDieVelocity(id, 0.0f, -25.0f, 0.0f, 0.0f, 0.0f, 0.0f);
    for (int i = 0; i < 180; ++i) {
        engine.step(1.0f / 60.0f);
    }
    const auto& xf = engine.buildTransformBuffer();
    REQUIRE(!xf.empty());
    CHECK(xf[1] > 0.05f);
    CHECK(std::abs(xf[0]) < 2.5f);
    CHECK(std::abs(xf[2]) < 2.5f);
}

TEST_CASE("Container inactive ignores planes") {
    DicePhysicsEngine engine;
    engine.init(-15.0f, 0.0f, 18.0f, 18.0f);
    engine.setContainerActive(false);
    engine.setContainerPlanes({0.0f, 1.0f, 0.0f, 0.0f});
    engine.addDie(6, 0.0f, 2.0f, 0.0f);
    for (int i = 0; i < 240; ++i) {
        engine.step(1.0f / 60.0f);
    }
    const auto& xf = engine.buildTransformBuffer();
    REQUIRE(!xf.empty());
    CHECK(xf[1] < 1.5f);
}

TEST_CASE("Degenerate hull inertia stays finite") {
    RigidBody body;
    body.mass = 5.0f;
    body.radius = 0.9f;
    body.useHull = true;
    body.hull.build({{0.0f, 0.0f, 0.0f}, {0.0f, 0.0f, 0.0f}, {0.0f, 0.0f, 0.0f}});
    body.computeInertiaFromHull();
    CHECK(std::isfinite(body.invInertia.x));
    CHECK(std::isfinite(body.invInertia.y));
    CHECK(std::isfinite(body.invInertia.z));
    CHECK(body.invInertia.x > 0.0f);
    CHECK(body.invInertia.y > 0.0f);
    CHECK(body.invInertia.z > 0.0f);
}

namespace {

void uploadD6FaceTable(DicePhysicsEngine& engine, int id) {
    engine.setDieFaceTable(id, {
        0.0f, 1.0f, 0.0f, 1.0f,
        0.0f, 0.0f, 1.0f, 2.0f,
        -1.0f, 0.0f, 0.0f, 3.0f,
        1.0f, 0.0f, 0.0f, 4.0f,
        0.0f, 0.0f, -1.0f, 5.0f,
        0.0f, -1.0f, 0.0f, 6.0f,
    });
}

void uploadD4FaceTable(DicePhysicsEngine& engine, int id) {
    engine.setDieFaceTable(id, {
        0.0f, -0.335f, -0.942f, 3.0f,
        0.817f, -0.334f, 0.471f, 4.0f,
        -0.816f, -0.333f, 0.471f, 1.0f,
        0.0f, 1.0f, 0.0f, 2.0f,
    });
}

void uploadD20FaceTable(DicePhysicsEngine& engine, int id) {
    engine.setDieFaceTable(id, {
        0.111f, 0.745f, 0.658f, 1.0f,
        -0.512f, -0.746f, 0.426f, 2.0f,
        -0.942f, -0.334f, 0.03f, 3.0f,
        0.497f, -0.334f, 0.801f, 4.0f,
        0.624f, -0.746f, 0.232f, 5.0f,
        -0.9f, 0.333f, 0.282f, 6.0f,
        0.0f, -1.0f, 0.0f, 7.0f,
        -0.206f, -0.333f, 0.92f, 8.0f,
        -0.444f, 0.331f, 0.832f, 9.0f,
        0.694f, 0.333f, 0.638f, 10.0f,
        -0.693f, -0.333f, -0.639f, 11.0f,
        0.513f, 0.745f, -0.425f, 12.0f,
        0.0f, 1.0f, 0.0f, 13.0f,
        0.445f, -0.333f, -0.831f, 14.0f,
        0.9f, -0.333f, -0.282f, 15.0f,
        -0.498f, 0.333f, -0.801f, 16.0f,
        0.942f, 0.333f, -0.031f, 17.0f,
        0.206f, 0.334f, -0.92f, 18.0f,
        -0.625f, 0.745f, -0.232f, 19.0f,
        -0.111f, -0.746f, -0.656f, 20.0f,
    });
}

} // namespace

TEST_CASE("Face value: d6 identity reads top face") {
    DicePhysicsEngine engine;
    const int id = engine.addDie(6, 0.0f, 0.0f, 0.0f);
    uploadD6FaceTable(engine, id);
    engine.setDieTransform(id, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    engine.setDieSleepingForTesting(id, true);
    CHECK(engine.getDieFaceValue(id) == 1);
}

TEST_CASE("Face value: d6 upside-down reads bottom face") {
    DicePhysicsEngine engine;
    const int id = engine.addDie(6, 0.0f, 0.0f, 0.0f);
    uploadD6FaceTable(engine, id);
    engine.setDieTransform(id, 0.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f, 0.0f);
    engine.setDieSleepingForTesting(id, true);
    CHECK(engine.getDieFaceValue(id) == 6);
}

TEST_CASE("Face value: d4 uses bottom face at identity") {
    DicePhysicsEngine engine;
    const int id = engine.addDie(4, 0.0f, 0.0f, 0.0f);
    uploadD4FaceTable(engine, id);
    engine.setDieTransform(id, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    engine.setDieSleepingForTesting(id, true);
    CHECK(engine.getDieFaceValue(id) == 3);
}

TEST_CASE("Face value: d20 identity reads top face") {
    DicePhysicsEngine engine;
    const int id = engine.addDie(20, 0.0f, 0.0f, 0.0f);
    uploadD20FaceTable(engine, id);
    engine.setDieTransform(id, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    engine.setDieSleepingForTesting(id, true);
    CHECK(engine.getDieFaceValue(id) == 13);
}

TEST_CASE("Face value: returns zero while die is moving") {
    DicePhysicsEngine engine;
    const int id = engine.addDie(6, 0.0f, 0.0f, 0.0f);
    uploadD6FaceTable(engine, id);
    engine.setDieTransform(id, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    engine.setDieVelocity(id, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f);
    CHECK(engine.getDieFaceValue(id) == 0);
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

TEST_CASE("Static box: die bounces off wall without tunneling") {
    DicePhysicsEngine engine;
    engine.init(-15.0f, -2.75f, 18.0f, 18.0f);
    PolyHull cube = makeUnitCubeHull();
    auto cubeFlat = flattenHull(cube);

    const float wallX = 2.0f;
    const float wallHalfX = 0.25f;
    const float wallHalfY = 1.5f;
    const float wallHalfZ = 2.0f;
    CHECK(engine.addStaticBox(1, wallX, -1.5f, 0.0f, wallHalfX, wallHalfY, wallHalfZ,
        0.0f, 0.0f, 0.0f, 1.0f, 2) == 1);

    const int id = engine.addDie(6, -2.0f, -1.0f, 0.0f);
    engine.setDieHull(id, cubeFlat);
    engine.applyImpulse(id, 80.0f, 2.0f, 0.0f);
    engine.applyTorqueImpulse(id, 5.0f, 0.0f, 8.0f);

    float maxX = -1e9f;
    for (int frame = 0; frame < 360; ++frame) {
        engine.step(1.0f / 60.0f);
        CHECK(engine.allBodyStatesFinite());
        float x = 0.0f;
        float y = 0.0f;
        float z = 0.0f;
        CHECK(engine.getDiePosition(id, x, y, z));
        maxX = std::max(maxX, x);
    }

    const float wallFaceX = wallX - wallHalfX;
    CHECK(maxX < wallFaceX + 0.15f);
    CHECK(maxX > wallFaceX - 1.0f);
    CHECK(engine.areAllSettled());
}

TEST_CASE("Open cylinder: die falls in and settles inside walls") {
    DicePhysicsEngine engine;
    engine.init(-15.0f, -2.75f, 18.0f, 18.0f);
    PolyHull cube = makeUnitCubeHull();
    auto cubeFlat = flattenHull(cube);

    const float cx = 0.0f;
    const float cy = -1.5f;
    const float cz = 0.0f;
    const float radius = 2.0f;
    const float halfHeight = 1.5f;
    CHECK(engine.addStaticOpenCylinder(1, cx, cy, cz, radius, halfHeight, 16, true, 3) == 1);

    const int id = engine.addDie(6, cx, cy + halfHeight - 0.35f, cz);
    engine.setDieHull(id, cubeFlat);
    engine.applyImpulse(id, 4.0f, -1.0f, 2.5f);
    engine.applyTorqueImpulse(id, 20.0f, 0.0f, 15.0f);

    for (int frame = 0; frame < 720; ++frame) {
        engine.step(1.0f / 60.0f);
        CHECK(engine.allBodyStatesFinite());
    }

    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;
    CHECK(engine.getDiePosition(id, x, y, z));

    const float dx = x - cx;
    const float dz = z - cz;
    const float radial = std::sqrt(dx * dx + dz * dz);
    CHECK(radial < radius * 0.92f);
    CHECK(y >= cy - halfHeight + 0.15f);
    CHECK(y <= cy + halfHeight + 1.5f);
    CHECK(engine.areAllSettled());
}

TEST_CASE("Static capacity: raised cap accepts and collides beyond legacy 128") {
    DicePhysicsEngine engine;
    engine.init(-15.0f, -2.75f, 18.0f, 18.0f);

    // A dense table layout (tower + table bounds + jail/tray/bookshelf
    // compounds + clutter) can easily register more than the old
    // MAX_STATICS = 128. Register well past that to prove the raised cap
    // (512) actually accepts them rather than silently dropping past 128.
    // Decoys sit far outside the table's own wall bounds (tableHalfW/D = 18,
    // enforced on dice regardless of static geometry) so they never interact
    // with the die below; only the interleaved target box (registered at
    // index 250, well past the old cap) does.
    const int NUM_STATICS = 300;
    const int targetIndex = 250;
    for (int i = 1; i <= NUM_STATICS; ++i) {
        if (i == targetIndex) {
            CHECK(engine.addStaticBox(i, 0.0f, -1.5f, 0.0f, 1.5f, 1.5f, 1.5f,
                0.0f, 0.0f, 0.0f, 1.0f, 2) == i);
        } else {
            CHECK(engine.addStaticBox(i, 500.0f, -1.5f, 500.0f, 1.5f, 1.5f, 1.5f,
                0.0f, 0.0f, 0.0f, 1.0f, 2) == i);
        }
    }
    CHECK(engine.getStaticCapacityDroppedCount() == 0);

    // A collider registered well past the legacy 128-cap must still collide,
    // not just be accepted into the list.
    PolyHull cube = makeUnitCubeHull();
    auto cubeFlat = flattenHull(cube);
    const int id = engine.addDie(6, 0.0f, 5.0f, 0.0f);
    engine.setDieHull(id, cubeFlat);

    float yAt200 = 0.0f;
    for (int frame = 0; frame < 300; ++frame) {
        engine.step(1.0f / 60.0f);
        CHECK(engine.allBodyStatesFinite());
        if (frame == 199) {
            float x = 0.0f, z = 0.0f;
            CHECK(engine.getDiePosition(id, x, yAt200, z));
        }
    }

    float x = 0.0f, y = 0.0f, z = 0.0f;
    CHECK(engine.getDiePosition(id, x, y, z));
    // Box #250's top face is at y = -1.5 + 1.5 = 0; the die should rest
    // there, well above the table floor (tableY = -2.75), proving box #250
    // (not the table plane fallback) actually caught it. Compare against an
    // earlier checkpoint (rather than asserting areAllSettled(), which a
    // perfectly symmetric plumb-line drop can starve — the resting body's
    // single-point SAT contact keeps a small pitch/roll energy alive without
    // ever translating) to confirm it is resting, not still falling.
    CHECK(y > -1.0f);
    CHECK(y < 2.0f);
    CHECK(std::abs(y - yAt200) < 0.5f);
}

TEST_CASE("Static capacity: exceeding MAX_STATICS reports drops instead of silent failure") {
    DicePhysicsEngine engine;
    engine.init(-15.0f, -2.75f, 18.0f, 18.0f);

    const int OVER_CAP = 520; // MAX_STATICS == 512
    int successes = 0;
    for (int i = 1; i <= OVER_CAP; ++i) {
        const float x = static_cast<float>(i) * 4.0f;
        const int result = engine.addStaticBox(i, x, -1.5f, 0.0f, 1.5f, 1.5f, 1.5f,
            0.0f, 0.0f, 0.0f, 1.0f, 2);
        if (result >= 0) successes++;
    }
    CHECK(successes == 512);
    CHECK(engine.getStaticCapacityDroppedCount() == static_cast<uint32_t>(OVER_CAP - 512));

    // clearStatics() resets the counter for a fresh registration pass
    // (e.g. rebuilding table bounds on layout reroll).
    engine.clearStatics();
    CHECK(engine.getStaticCapacityDroppedCount() == 0);
}

TEST_CASE("Broadphase grid matches brute-force pair set and serialize state") {
    PolyHull cube = makeUnitCubeHull();
    auto cubeFlat = flattenHull(cube);

    auto setupEngine = [&]() {
        DicePhysicsEngine engine;
        engine.init(-15.0f, -2.75f, 18.0f, 18.0f);
        for (int i = 0; i < 20; ++i) {
            const float x = static_cast<float>((i % 5) - 2) * 1.1f;
            const float y = 2.5f + static_cast<float>(i) * 0.08f;
            const float z = static_cast<float>((i / 5) % 4 - 2) * 1.1f;
            const int id = engine.addDie(6, x, y, z);
            engine.setDieHull(id, cubeFlat);
            engine.applyImpulse(id, 4.0f, 1.5f, -2.0f);
            engine.applyTorqueImpulse(id, 8.0f, 0.0f, 6.0f);
        }
        return engine;
    };

    DicePhysicsEngine pairEngine = setupEngine();
    const auto gridPairs = pairEngine.collectDiePairsForTesting(true);
    const auto brutePairs = pairEngine.collectDiePairsForTesting(false);
    CHECK(gridPairs.size() == brutePairs.size());
    CHECK(std::equal(gridPairs.begin(), gridPairs.end(), brutePairs.begin()));

    auto runScenario = [&](bool useBroadphase) {
        DicePhysicsEngine engine = setupEngine();
        engine.setBroadphaseForTesting(useBroadphase);
        for (int frame = 0; frame < 120; ++frame) {
            engine.step(1.0f / 60.0f);
        }
        return engine.serializeState();
    };

    const auto gridState = runScenario(true);
    const auto bruteState = runScenario(false);
    CHECK(gridState.size() == bruteState.size());
    CHECK(std::memcmp(gridState.data(), bruteState.data(), gridState.size()) == 0);
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

int dumpSerializeParityHex() {
    DicePhysicsEngine engine;
    engine.init(-15.0f, -2.75f, 18.0f, 18.0f);
    int id0 = engine.addDie(6, 0, 4, 0);
    int id1 = engine.addDie(20, 1.5f, 5, -1.0f);
    engine.applyImpulse(id0, 5, 2, -3);
    engine.applyTorqueImpulse(id1, 0, 10, 0);
    for (int i = 0; i < 30; ++i) engine.step(1.0f / 60.0f);
    const auto bytes = engine.serializeState();
    for (uint8_t b : bytes) {
        std::cout << std::hex << (b >> 4) << (b & 0xF);
    }
    std::cout << std::dec << '\n';
    return 0;
}

int runBench(int dieCount, int steps, int warmup) {
    if (dieCount < 1) dieCount = 50;
    if (steps < 1) steps = 600;
    if (warmup < 0) warmup = 60;

    PolyHull cube = makeUnitCubeHull();
    auto cubeFlat = flattenHull(cube);

    DicePhysicsEngine engine;
    engine.init(-15.0f, -2.75f, 18.0f, 18.0f);

    for (int i = 0; i < dieCount; ++i) {
        const float x = static_cast<float>((i % 10) - 5) * 0.4f;
        const float y = 3.0f + static_cast<float>(i) * 0.05f;
        const float z = static_cast<float>((i / 10) % 10 - 5) * 0.4f;
        const int id = engine.addDie(6, x, y, z);
        if (id >= 0) engine.setDieHull(id, cubeFlat);
        engine.applyImpulse(id, 5.0f, 2.0f, -3.0f);
        engine.applyTorqueImpulse(id, 10.0f, 0.0f, 5.0f);
    }

    const float dt = 1.0f / 60.0f;
    for (int w = 0; w < warmup; ++w) {
        engine.step(dt);
    }

    const auto t0 = std::chrono::steady_clock::now();
    for (int s = 0; s < steps; ++s) {
        engine.step(dt);
    }
    const auto t1 = std::chrono::steady_clock::now();
    const double totalMs =
        std::chrono::duration<double, std::milli>(t1 - t0).count();
    const double msPerStep = totalMs / static_cast<double>(steps);
    const double usPerStep = msPerStep * 1000.0;

    std::cout << "bench dice=" << dieCount << " steps=" << steps
              << " warmup=" << warmup
              << " total_ms=" << totalMs
              << " ms_per_step=" << msPerStep << '\n';
    std::cout << "bench_json {\"profile\":\"native-scalar\",\"dice\":" << dieCount
              << ",\"steps\":" << steps
              << ",\"warmup\":" << warmup
              << ",\"total_ms\":" << totalMs
              << ",\"ms_per_step\":" << msPerStep
              << ",\"us_per_step\":" << usPerStep << "}\n";
    return 0;
}

int main(int argc, char** argv) {
    if (argc >= 2 && std::strcmp(argv[1], "--dump-serialize-parity") == 0) {
        return dumpSerializeParityHex();
    }
    if (argc >= 3 && std::strcmp(argv[1], "--dump-serialize") == 0) {
        uint64_t seed = std::strtoull(argv[2], nullptr, 0);
        return dumpSerializeHex(seed);
    }
    if (argc >= 2 && std::strcmp(argv[1], "--bench") == 0) {
        int dieCount = 50;
        int steps = 600;
        int warmup = 60;
        for (int i = 2; i < argc; ++i) {
            if (std::strncmp(argv[i], "--dice=", 7) == 0) {
                dieCount = std::atoi(argv[i] + 7);
            } else if (std::strncmp(argv[i], "--steps=", 8) == 0) {
                steps = std::atoi(argv[i] + 8);
            } else if (std::strncmp(argv[i], "--warmup=", 9) == 0) {
                warmup = std::atoi(argv[i] + 9);
            }
        }
        return runBench(dieCount, steps, warmup);
    }
    doctest::Context ctx;
    ctx.applyCommandLine(argc, argv);
    return ctx.run();
}
