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
#include <iomanip>
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

/** Regular icosahedron, circumradius 1 — the d20 shape the tower drops. */
PolyHull makeD20Hull() {
    const float phi = 1.6180339887f;
    std::vector<Vec3> verts = {
        {0, 1, phi},  {0, -1, phi},  {0, 1, -phi},  {0, -1, -phi},
        {1, phi, 0},  {-1, phi, 0},  {1, -phi, 0},  {-1, -phi, 0},
        {phi, 0, 1},  {-phi, 0, 1},  {phi, 0, -1},  {-phi, 0, -1},
    };
    const float inv = 1.0f / std::sqrt(1.0f + phi * phi);
    for (auto& v : verts) v = v * inv;
    PolyHull hull;
    hull.build(verts);
    return hull;
}

/**
 * The dice tower's static colliders, world-posed, mirroring
 * src/environment/DiceTower.js: shaft walls, three alternating ramps, and the
 * catch tray. Rebuilt here rather than loaded so the chute regression does not
 * depend on Three.js, a GL context, or the rest of the tavern.
 *
 * Returns the tray floor's world Y — the height below which a die has left the
 * tower through the bottom rather than out of it.
 */
struct TowerFixture {
    float hopperY = 0.0f;
    float hopperHalfWidth = 0.0f;
    float hopperHalfDepth = 0.0f;
    float trayFloorY = 0.0f;
    float footprintHalfX = 0.0f;
    Vec3 origin{};
};

TowerFixture addDiceTowerStatics(DicePhysicsEngine& engine, const Vec3& origin) {
    const float W = 6.0f, D = 6.0f, H = 15.0f, T = 0.5f;
    const float frontH = H / 3.0f;
    const float rampThick = 0.2f;
    const float rampW = W - T * 2.0f - 0.1f;
    const float rampLen = D * 0.9f;
    const float trayDepth = 8.0f, trayHeight = 2.0f;
    const float trayZ = D / 2.0f + trayDepth / 2.0f - T;

    int userId = 1;
    auto box = [&](float cx, float cy, float cz, float hx, float hy, float hz, float rotX) {
        const float qx = std::sin(rotX * 0.5f);
        const float qw = std::cos(rotX * 0.5f);
        engine.addStaticBox(userId++, origin.x + cx, origin.y + cy, origin.z + cz,
            hx, hy, hz, qx, 0.0f, 0.0f, qw, 2);
    };

    box(0, H / 2, -D / 2 + T / 2, W / 2, H / 2, T / 2, 0);              // back wall
    box(-W / 2 + T / 2, H / 2, 0, T / 2, H / 2, D / 2, 0);              // left wall
    box(W / 2 - T / 2, H / 2, 0, T / 2, H / 2, D / 2, 0);               // right wall
    box(0, H - frontH / 2, D / 2 - T / 2, W / 2, frontH / 2, T / 2, 0); // front (upper third)
    box(0, 11, -0.5f, rampW / 2, rampThick / 2, rampLen / 2, 0.6f);
    box(0, 7, 0.5f, rampW / 2, rampThick / 2, rampLen / 2, -0.6f);
    box(0, 3, -0.5f, rampW / 2, rampThick / 2, (rampLen + 1.0f) / 2, 0.6f);
    box(0, T / 2, trayZ, W / 2, T / 2, trayDepth / 2, 0);                              // tray floor
    box(-W / 2 + T / 2, trayHeight / 2, trayZ, T / 2, trayHeight / 2, trayDepth / 2, 0);
    box(W / 2 - T / 2, trayHeight / 2, trayZ, T / 2, trayHeight / 2, trayDepth / 2, 0);
    box(0, trayHeight / 2, trayZ + trayDepth / 2 - T / 2, W / 2, trayHeight / 2, T / 2, 0);

    TowerFixture fixture;
    fixture.origin = origin;
    fixture.hopperY = H - 1.0f;
    fixture.hopperHalfWidth = (rampW / 2.0f) * 0.6f;
    fixture.hopperHalfDepth = D / 2.0f - 1.0f;
    fixture.trayFloorY = origin.y + T;
    fixture.footprintHalfX = W / 2.0f;
    return fixture;
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

TEST_CASE("inertiaWorldMat3 matches the quaternion double-rotate it replaces") {
    // BodyView::applyInvInertiaWorld used to do
    // rot.rotate(invInertiaLocal-scaled rot.conjugate().rotate(v)) on every
    // call; it now does inertiaWorldMat3(rot, invInertiaLocal).mul(v) once
    // per BodyView construction. Same math, different FP operation order
    // (hence the SOLVER_REVISION bump), so this checks the two formulas
    // agree within float tolerance across many rotations/vectors/inertias
    // rather than assuming the algebra transcribed correctly.
    auto oldFormula = [](const Quat& rot, const Vec3& invInertiaLocal, const Vec3& v) {
        Vec3 local = rot.conjugate().rotate(v);
        local.x *= invInertiaLocal.x;
        local.y *= invInertiaLocal.y;
        local.z *= invInertiaLocal.z;
        return rot.rotate(local);
    };

    DeterministicRNG rng;
    rng.seed(0xB0D7710Aull);
    for (int i = 0; i < 5000; ++i) {
        Quat rot{
            rng.nextFloat() * 2.0f - 1.0f,
            rng.nextFloat() * 2.0f - 1.0f,
            rng.nextFloat() * 2.0f - 1.0f,
            rng.nextFloat() * 2.0f - 1.0f,
        };
        rot = rot.normalized();
        Vec3 invInertia{
            rng.nextFloat() * 5.0f,
            rng.nextFloat() * 5.0f,
            rng.nextFloat() * 5.0f,
        };
        Vec3 v{
            rng.nextFloat() * 20.0f - 10.0f,
            rng.nextFloat() * 20.0f - 10.0f,
            rng.nextFloat() * 20.0f - 10.0f,
        };

        Vec3 want = oldFormula(rot, invInertia, v);
        Vec3 got = inertiaWorldMat3(rot, invInertia).mul(v);

        CHECK(got.x == doctest::Approx(want.x).epsilon(1e-4));
        CHECK(got.y == doctest::Approx(want.y).epsilon(1e-4));
        CHECK(got.z == doctest::Approx(want.z).epsilon(1e-4));
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

TEST_CASE("Dynamic box: a thrown die knocks it") {
    DicePhysicsEngine engine;
    engine.init(-15.0f, -2.75f, 18.0f, 18.0f);
    PolyHull cube = makeUnitCubeHull();
    auto cubeFlat = flattenHull(cube);

    // Resting box a couple units away from the die's spawn point.
    CHECK(engine.addDynamicBox(1, 0.3f, 2.0f, -2.75f + 0.4f, 0.0f,
        0.4f, 0.4f, 0.4f, 0.0f, 0.0f, 0.0f, 1.0f, 3 /* metal */) == 1);

    const int id = engine.addDie(6, -2.0f, -1.5f, 0.0f);
    engine.setDieHull(id, cubeFlat);
    engine.applyImpulse(id, 60.0f, 2.0f, 0.0f);

    float boxStartX = 2.0f;
    bool moved = false;
    for (int frame = 0; frame < 240; ++frame) {
        engine.step(1.0f / 60.0f);
        CHECK(engine.allBodyStatesFinite());
        if (std::abs(engine.buildDynamicTransformBuffer()[0] - boxStartX) > 0.2f) {
            moved = true;
        }
    }
    CHECK(moved);
    CHECK(engine.getDynamicCapacityDroppedCount() == 0);
}

TEST_CASE("Dynamic box: settles under gravity on a static collider") {
    DicePhysicsEngine engine;
    engine.init(-15.0f, -2.75f, 18.0f, 18.0f);

    CHECK(engine.addStaticBox(1, 0.0f, 0.0f, 0.0f, 3.0f, 0.2f, 3.0f,
        0.0f, 0.0f, 0.0f, 1.0f, 2 /* wood */) == 1);
    CHECK(engine.addDynamicBox(2, 0.3f, 0.0f, 3.0f, 0.0f,
        0.3f, 0.3f, 0.3f, 0.0f, 0.0f, 0.0f, 1.0f, 0) == 2);

    for (int frame = 0; frame < 300; ++frame) {
        engine.step(1.0f / 60.0f);
        CHECK(engine.allBodyStatesFinite());
    }
    const auto& xf = engine.buildDynamicTransformBuffer();
    REQUIRE(xf.size() == 7);
    CHECK(xf[1] > 0.15f);
    CHECK(xf[1] < 1.2f);
}

TEST_CASE("Dynamic box serialize round-trip preserves state") {
    DicePhysicsEngine engine;
    engine.init(-15.0f, -2.75f, 18.0f, 18.0f);
    int id = engine.addDynamicBox(1, 0.5f, 0.0f, 4.0f, 0.0f,
        0.3f, 0.3f, 0.3f, 0.0f, 0.0f, 0.0f, 1.0f, 3);
    REQUIRE(id == 1);
    engine.applyDynamicImpulse(id, 3.0f, 1.0f, -2.0f);
    engine.applyDynamicTorqueImpulse(id, 0.0f, 4.0f, 0.0f);
    for (int i = 0; i < 30; ++i) engine.step(1.0f / 60.0f);

    auto bytes = engine.serializeState();
    DicePhysicsEngine restored;
    restored.init(-15.0f, -2.75f, 18.0f, 18.0f);
    restored.deserializeState(bytes);
    CHECK(bytes == restored.serializeState());
    CHECK(restored.getDynamicCount() == 1);

    for (int i = 0; i < 30; ++i) {
        engine.step(1.0f / 60.0f);
        restored.step(1.0f / 60.0f);
    }
    CHECK(engine.serializeState() == restored.serializeState());
}

TEST_CASE("Dynamic box capacity: exceeding MAX_DYNAMICS reports drops") {
    DicePhysicsEngine engine;
    engine.init(-15.0f, -2.75f, 18.0f, 18.0f);
    int accepted = 0;
    for (int i = 0; i < DicePhysicsEngine::MAX_DYNAMICS + 8; ++i) {
        int id = engine.addDynamicBox(i, 0.2f, static_cast<float>(i) * 0.1f, 2.0f, 0.0f,
            0.1f, 0.1f, 0.1f, 0.0f, 0.0f, 0.0f, 1.0f, 0);
        if (id >= 0) accepted++;
    }
    CHECK(accepted == DicePhysicsEngine::MAX_DYNAMICS);
    CHECK(engine.getDynamicCapacityDroppedCount() == 8);
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

TEST_CASE("Empty engine is not settled") {
    DicePhysicsEngine engine;
    engine.init(-15.0f, -2.75f, 18.0f, 18.0f);
    CHECK_FALSE(engine.hasDice());
    CHECK_FALSE(engine.areAllSettled());
}

TEST_CASE("Golden traces: seed and parity hashes are stable") {
    DicePhysicsEngine a, b;
    const uint64_t seed = 0xDEADBEEFCAFEBABEULL;
    runDeterministicScenario(a, seed);
    runDeterministicScenario(b, seed);
    CHECK(a.hashSerializedState() == b.hashSerializedState());

    DicePhysicsEngine p1, p2;
    auto runParity = [](DicePhysicsEngine& engine) {
        engine.init(-15.0f, -2.75f, 18.0f, 18.0f);
        int id0 = engine.addDie(6, 0, 4, 0);
        int id1 = engine.addDie(20, 1.5f, 5, -1.0f);
        engine.applyImpulse(id0, 5, 2, -3);
        engine.applyTorqueImpulse(id1, 0, 10, 0);
        for (int i = 0; i < 30; ++i) engine.step(1.0f / 60.0f);
    };
    runParity(p1);
    runParity(p2);
    CHECK(p1.hashSerializedState() == p2.hashSerializedState());
    // Hashes below are SOLVER_REVISION-pinned; regenerate with
    // `solver_tests --dump-golden` (see scripts/compare-solver-golden.mjs and
    // tests/fixtures/solver-golden.json) whenever SOLVER_REVISION bumps.
    CHECK(p1.hashSerializedState() == 0x9a82c5d0872fd75fULL);
    CHECK(a.hashSerializedState() == 0xc3127461c4a976f0ULL);
}

TEST_CASE("Determinism: same seed yields identical serialize output") {
    DicePhysicsEngine a, b;
    const uint64_t seed = 0xDEADBEEFCAFEBABEULL;
    runDeterministicScenario(a, seed);
    runDeterministicScenario(b, seed);
    CHECK(a.serializeState() == b.serializeState());
}

TEST_CASE("Stack of 10 d6 is stable for 10 simulated seconds") {
    DicePhysicsEngine engine;
    engine.init(-15.0f, -2.75f, 18.0f, 18.0f);
    PolyHull cube = makeUnitCubeHull();
    auto cubeFlat = flattenHull(cube);
    int ids[10];
    for (int i = 0; i < 10; ++i) {
        const float y = -2.75f + 0.50f + static_cast<float>(i) * 1.02f;
        ids[i] = engine.addDie(6, 0.0f, y, 0.0f);
        engine.setDieHull(ids[i], cubeFlat);
    }
    for (int frame = 0; frame < 600; ++frame) {
        engine.step(1.0f / 60.0f);
        CHECK(engine.allBodyStatesFinite());
        CHECK(engine.maxTablePenetration() < 0.50f);
        CHECK(engine.allBodyStatesInWorldBounds(20.0f));
    }
    CHECK(engine.areAllSettled());
    for (int i = 0; i < 10; ++i) {
        float x = 0, y = 0, z = 0;
        CHECK(engine.getDiePosition(ids[i], x, y, z));
        CHECK(y > -2.6f);
        CHECK(y < 12.0f);
    }
    CHECK(engine.totalKineticEnergy() < 8.0f);
}

TEST_CASE("Speculative contacts: thin wall is not tunneled at high speed") {
    PolyHull cube = makeUnitCubeHull();
    auto cubeFlat = flattenHull(cube);
    const float speeds[] = {10.0f, 25.0f, 40.0f, 80.0f};
    for (float speed : speeds) {
        DicePhysicsEngine engine;
        engine.init(-15.0f, -2.75f, 18.0f, 18.0f);
        CHECK(engine.addStaticBox(1, 2.0f, -1.5f, 0.0f, 0.05f, 1.5f, 2.0f,
            0.0f, 0.0f, 0.0f, 1.0f, 2) == 1);
        const int id = engine.addDie(6, -2.0f, -1.0f, 0.0f);
        engine.setDieHull(id, cubeFlat);
        engine.setDieVelocity(id, speed, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f);
        float maxX = -1e9f;
        for (int frame = 0; frame < 240; ++frame) {
            engine.step(1.0f / 60.0f);
            float x = 0, y = 0, z = 0;
            CHECK(engine.getDiePosition(id, x, y, z));
            maxX = std::max(maxX, x);
            CHECK(x < 2.4f);
        }
        CHECK(maxX < 2.15f);
    }
}

TEST_CASE("Sweep proxy: inscribed radius is the largest sphere the hull contains") {
    // A unit cube's inscribed sphere is its half-extent, not its (larger)
    // vertex distance -- sweeping the vertex distance would stop dice short of
    // every surface they approach.
    CHECK(makeUnitCubeHull().inscribedRadius() == doctest::Approx(0.5f));
    // Regular icosahedron of circumradius 1: r_in = phi^2 / (sqrt(3) * r_circ).
    CHECK(makeD20Hull().inscribedRadius() == doctest::Approx(0.7947f).epsilon(0.001f));
    // No faces to measure -> 0, and callers fall back to the bounding radius.
    CHECK(PolyHull{}.inscribedRadius() == doctest::Approx(0.0f));
}

TEST_CASE("Sweep: a segment starting inside the grown box reports no entry") {
    // Starting strictly inside is the discrete solver's case. Clipping to it
    // would freeze anything already resting on a collider.
    float t = -1.0f;
    CHECK_FALSE(sweepSphereAgainstObb({0.0f, 0.0f, 0.0f}, {3.0f, 0.0f, 0.0f}, 0.5f,
        {0.0f, 0.0f, 0.0f}, Quat{0, 0, 0, 1}, {1.0f, 1.0f, 1.0f}, t));

    // But a body sitting exactly ON the grown face and heading through is a
    // real crossing, not an interior start, and must still be reported — a die
    // teleported onto a face (as a seeded drop can do) has had no prior
    // discrete pass to catch it. Grown half-extent here is 1.5.
    t = -1.0f;
    CHECK(sweepSphereAgainstObb({-1.5f, 0.0f, 0.0f}, {4.0f, 0.0f, 0.0f}, 0.5f,
        {0.0f, 0.0f, 0.0f}, Quat{0, 0, 0, 1}, {1.0f, 1.0f, 1.0f}, t));
    CHECK(t == doctest::Approx(0.0f));

    // Crossing from outside does report the entry time.
    CHECK(sweepSphereAgainstObb({-4.0f, 0.0f, 0.0f}, {4.0f, 0.0f, 0.0f}, 0.5f,
        {0.0f, 0.0f, 0.0f}, Quat{0, 0, 0, 1}, {1.0f, 1.0f, 1.0f}, t));
    // Grown half-extent is 1.5, so first touch is 2.5 into an 8-long segment.
    CHECK(t == doctest::Approx(2.5f / 8.0f));

    // A miss stays a miss.
    CHECK_FALSE(sweepSphereAgainstObb({-4.0f, 9.0f, 0.0f}, {4.0f, 9.0f, 0.0f}, 0.5f,
        {0.0f, 0.0f, 0.0f}, Quat{0, 0, 0, 1}, {1.0f, 1.0f, 1.0f}, t));
}

TEST_CASE("Swept contacts: an off-origin convex hull is swept where it actually is") {
    // A hull whose local AABB is not centred on its own origin: sweeping the
    // enclosing box at s.center would put the proxy somewhere the geometry
    // is not, leaving part of the hull unswept. Box spans local x 2..4.
    PolyHull offset;
    offset.build({
        {2.0f, -1.0f, -1.0f}, {4.0f, -1.0f, -1.0f}, {4.0f, 1.0f, -1.0f}, {2.0f, 1.0f, -1.0f},
        {2.0f, -1.0f, 1.0f},  {4.0f, -1.0f, 1.0f},  {4.0f, 1.0f, 1.0f},  {2.0f, 1.0f, 1.0f},
    });
    CHECK(offset.aabbMin.x == doctest::Approx(2.0f));
    CHECK(offset.aabbMax.x == doctest::Approx(4.0f));

    DicePhysicsEngine engine;
    engine.init(-15.0f, -2.75f, 18.0f, 18.0f);
    std::vector<float> flat;
    for (const auto& v : offset.verts) { flat.push_back(v.x); flat.push_back(v.y); flat.push_back(v.z); }
    CHECK(engine.addStaticConvexHull(1, 0.0f, -1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f, flat, 2) == 1);

    PolyHull cube = makeUnitCubeHull();
    auto cubeFlat = flattenHull(cube);
    const int id = engine.addDie(6, -4.0f, -1.0f, 0.0f);
    engine.setDieHull(id, cubeFlat);
    engine.setDieVelocity(id, 80.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f);

    for (int frame = 0; frame < 20; ++frame) {
        engine.step(0.1f);
        float x = 0, y = 0, z = 0;
        CHECK(engine.getDiePosition(id, x, y, z));
        // The hull occupies x in [2, 4]; the die must not end up past it.
        CHECK(x < 4.5f);
    }
}

TEST_CASE("Swept contacts: a thin wall holds at substeps discrete SAT cannot see") {
    // Without the sweep this tunnels for most launch positions once the
    // substep exceeds roughly 2x the speculative window (dt >= 0.1s, i.e. a
    // sub-10fps caller): the die is clear of the wall at both ends of the
    // substep, so no manifold is ever generated. The app steps at a fixed
    // 1/60 and never reaches this, but `step(dt)` takes whatever it is given
    // -- rollHeadless and the native harnesses included.
    PolyHull cube = makeUnitCubeHull();
    auto cubeFlat = flattenHull(cube);
    const float dts[] = {1.0f / 60.0f, 1.0f / 15.0f, 0.1f, 0.2f};
    for (float dt : dts) {
        for (int k = 0; k < 40; ++k) {
            const float startX = -6.0f + static_cast<float>(k) * 0.1f;
            DicePhysicsEngine engine;
            engine.init(-15.0f, -2.75f, 18.0f, 18.0f);
            // Tall and wide enough that going around it is not an option, so
            // crossing the plane can only mean going through it.
            CHECK(engine.addStaticBox(1, 2.0f, 2.0f, 0.0f, 0.02f, 6.0f, 17.0f,
                0.0f, 0.0f, 0.0f, 1.0f, 2) == 1);
            const int id = engine.addDie(6, startX, -1.0f, 0.0f);
            engine.setDieHull(id, cubeFlat);
            engine.setDieVelocity(id, 80.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f);
            for (int frame = 0; frame < 30; ++frame) {
                engine.step(dt);
                float x = 0, y = 0, z = 0;
                CHECK(engine.getDiePosition(id, x, y, z));
                CHECK(x < 2.5f);
            }
        }
    }
}

TEST_CASE("Dice tower: a hopper drop never leaves the chute through a ramp") {
    // The acceptance case for a seeded tower dump: a d20 posed at the hopper
    // mouth with a small downward kick has to stay inside the tower. Dropping
    // below the tray floor, or outside the shaft's footprint, means it passed
    // through a ramp or a wall.
    PolyHull d20 = makeD20Hull();
    auto d20Flat = flattenHull(d20);
    const Vec3 towerOrigin{0.0f, -3.0f, -14.0f};

    for (int trial = 0; trial < 8; ++trial) {
        DicePhysicsEngine engine;
        engine.init(-15.0f, -2.75f, 18.0f, 18.0f);
        const TowerFixture tower = addDiceTowerStatics(engine, towerOrigin);
        engine.seedRNG(0xD1CE7000ULL + static_cast<uint64_t>(trial));

        // Same scatter shape as computeSeededHopperDropParams.
        const float lx = (engine.randomFloat() - 0.5f) * 2.0f * tower.hopperHalfWidth;
        const float lz = (engine.randomFloat() - 0.5f) * 2.0f * tower.hopperHalfDepth;
        const int id = engine.addDie(20, towerOrigin.x + lx,
            towerOrigin.y + tower.hopperY, towerOrigin.z + lz);
        engine.setDieHull(id, d20Flat);
        engine.setDieVelocity(id, 0.0f, -1.5f, 0.0f, 1.0f, 2.0f, 3.0f);

        for (int frame = 0; frame < 600; ++frame) {
            engine.step(1.0f / 60.0f);
            CHECK(engine.allBodyStatesFinite());
            float x = 0, y = 0, z = 0;
            CHECK(engine.getDiePosition(id, x, y, z));
            // Below the tray floor => it went through the ramps and the floor.
            CHECK(y > tower.trayFloorY - 0.5f);
            // Outside the shaft in X => it went through a side wall.
            CHECK(std::abs(x - towerOrigin.x) < tower.footprintHalfX);
        }
    }
}

TEST_CASE("Fuzz: table non-penetration stays bounded") {
    const char* env = std::getenv("FUZZ_SEEDS");
    int seedCount = env ? std::atoi(env) : 50;
    seedCount = std::min(seedCount, 200);
    DeterministicRNG master;
    master.seed(0xC0FFEEULL);
    PolyHull cube = makeUnitCubeHull();
    auto cubeFlat = flattenHull(cube);
    for (int run = 0; run < seedCount; ++run) {
        DicePhysicsEngine engine;
        engine.init(-15.0f, -2.75f, 18.0f, 18.0f);
        const int n = 1 + static_cast<int>(master.next() % 6);
        for (int d = 0; d < n; ++d) {
            int id = engine.addDie(6, master.nextFloat() * 4.0f - 2.0f,
                2.0f + master.nextFloat() * 3.0f,
                master.nextFloat() * 4.0f - 2.0f);
            engine.setDieHull(id, cubeFlat);
            engine.applyImpulse(id,
                (master.nextFloat() - 0.5f) * 40.0f,
                master.nextFloat() * 8.0f,
                (master.nextFloat() - 0.5f) * 40.0f);
        }
        for (int frame = 0; frame < 180; ++frame) {
            engine.step(1.0f / 60.0f);
            CHECK(engine.allBodyStatesFinite());
            CHECK(engine.maxTablePenetration() < 0.35f);
        }
    }
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

    // reset() also clears the static registry (bodies_, contacts_, events_,
    // statics_, nextId_) and must reset the drop counter along with it, or a
    // subsequent registration pass inherits a stale nonzero count.
    for (int i = 1; i <= OVER_CAP; ++i) {
        engine.addStaticBox(i, static_cast<float>(i) * 4.0f, -1.5f, 0.0f, 1.5f, 1.5f, 1.5f,
            0.0f, 0.0f, 0.0f, 1.0f, 2);
    }
    CHECK(engine.getStaticCapacityDroppedCount() == static_cast<uint32_t>(OVER_CAP - 512));
    engine.reset();
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

TEST_CASE("Broadphase grid matches brute force for die-dynamic and dynamic-dynamic pairs") {
    PolyHull cube = makeUnitCubeHull();
    auto cubeFlat = flattenHull(cube);

    auto setupEngine = [&]() {
        DicePhysicsEngine engine;
        engine.init(-15.0f, -2.75f, 18.0f, 18.0f);
        // Dice and dynamic boxes interleaved on a dense grid (spacing well
        // under GRID_CELL_SIZE=2.2) so several bodies straddle a cell
        // boundary and land in more than one grid cell -- exactly the case
        // forEachDieDynamicPair's sort+unique dedup exists for.
        for (int i = 0; i < 10; ++i) {
            const float x = static_cast<float>((i % 5) - 2) * 0.9f;
            const float y = 2.5f + static_cast<float>(i) * 0.08f;
            const float z = static_cast<float>((i / 5) % 2) * 0.9f;
            const int id = engine.addDie(6, x, y, z);
            engine.setDieHull(id, cubeFlat);
            engine.applyImpulse(id, 3.0f, 1.0f, -1.5f);
            engine.applyTorqueImpulse(id, 5.0f, 0.0f, 4.0f);
        }
        for (int i = 0; i < 16; ++i) {
            const float x = static_cast<float>((i % 4) - 2) * 0.85f + 0.3f;
            const float y = 1.0f + static_cast<float>(i) * 0.07f;
            const float z = static_cast<float>((i / 4) % 4 - 2) * 0.85f;
            CHECK(engine.addDynamicBox(1000 + i, 0.25f, x, y, z,
                0.2f, 0.2f, 0.2f, 0.0f, 0.0f, 0.0f, 1.0f, 0) == 1000 + i);
        }
        return engine;
    };

    DicePhysicsEngine pairEngine = setupEngine();
    const auto gridDieDyn = pairEngine.collectDieDynamicPairsForTesting(true);
    const auto bruteDieDyn = pairEngine.collectDieDynamicPairsForTesting(false);
    CHECK(gridDieDyn.size() == bruteDieDyn.size());
    CHECK(std::equal(gridDieDyn.begin(), gridDieDyn.end(), bruteDieDyn.begin()));

    const auto gridDynDyn = pairEngine.collectDynamicPairsForTesting(true);
    const auto bruteDynDyn = pairEngine.collectDynamicPairsForTesting(false);
    CHECK(gridDynDyn.size() == bruteDynDyn.size());
    CHECK(std::equal(gridDynDyn.begin(), gridDynDyn.end(), bruteDynDyn.begin()));

    // Unlike the die-die grid (20 dice on a regular layout, where grid and
    // brute-force traversal order happen to coincide -- see the test above),
    // this scenario is dense enough that a handful of simultaneous new
    // contacts resolve in a different order between the two paths, and a
    // sequential-impulse solver is order-sensitive: grid and brute diverge
    // into different (both valid) trajectories rather than staying
    // byte-identical. That's expected -- production always runs one path
    // (useBroadphase_ defaults true; setBroadphaseForTesting is test-only),
    // so replay determinism only needs "same code path -> same result",
    // which the pair-set equality above already establishes. What both
    // paths must still do is stay physically valid.
    auto runScenario = [&](bool useBroadphase) {
        DicePhysicsEngine engine = setupEngine();
        engine.setBroadphaseForTesting(useBroadphase);
        for (int frame = 0; frame < 120; ++frame) {
            engine.step(1.0f / 60.0f);
            CHECK(engine.allBodyStatesFinite());
            CHECK(engine.allBodyStatesInWorldBounds(20.0f));
        }
        CHECK(engine.getDynamicCapacityDroppedCount() == 0);
    };
    runScenario(true);
    runScenario(false);
}

TEST_CASE("Fuzz: dynamics-heavy scenarios preserve invariants") {
    // The general dice-only fuzz loop below never adds a DynamicBody, so it
    // never exercises forEachDieDynamicPair / forEachDynamicPair's grid
    // path. Cover it here with random dice + dynamic-box counts/placements
    // (including boundary-straddling positions the handwritten equivalence
    // test above can't randomize into).
    const char* env = std::getenv("FUZZ_SEEDS");
    int seedCount = env ? std::atoi(env) / 10 : 200;
    if (seedCount < 1) seedCount = 200;

    PolyHull cube = makeUnitCubeHull();
    auto cubeFlat = flattenHull(cube);

    DeterministicRNG master;
    master.seed(0xD11CE0FFULL);

    for (int run = 0; run < seedCount; ++run) {
        DicePhysicsEngine engine;
        engine.init(-15.0f, -2.75f, 18.0f, 18.0f);

        const int dieCount = static_cast<int>(master.next() % 8);
        for (int d = 0; d < dieCount; ++d) {
            float x = master.nextFloat() * 8.0f - 4.0f;
            float y = 2.0f + master.nextFloat() * 4.0f;
            float z = master.nextFloat() * 8.0f - 4.0f;
            int id = engine.addDie(6, x, y, z);
            if (id < 0) continue;
            engine.setDieHull(id, cubeFlat);
            engine.applyImpulse(id,
                (master.nextFloat() - 0.5f) * 20.0f,
                master.nextFloat() * 5.0f,
                (master.nextFloat() - 0.5f) * 20.0f);
        }

        const int dynCount = static_cast<int>(master.next() % 20);
        for (int p = 0; p < dynCount; ++p) {
            float x = master.nextFloat() * 8.0f - 4.0f;
            float y = 1.0f + master.nextFloat() * 4.0f;
            float z = master.nextFloat() * 8.0f - 4.0f;
            engine.addDynamicBox(p, 0.2f + master.nextFloat() * 0.3f, x, y, z,
                0.15f, 0.15f, 0.15f, 0.0f, 0.0f, 0.0f, 1.0f, 0);
        }

        for (int frame = 0; frame < 180; ++frame) {
            engine.step(1.0f / 60.0f);
            CHECK(engine.allBodyStatesFinite());
            CHECK(engine.allBodyStatesInWorldBounds(20.0f));
        }
    }
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

        const float maxEnergy = energyBudget * 24.0f + 250000.0f;
        const int maxFrames = 4800;
        bool settled = false;
        int lowEnergyFrames = 0;

        for (int frame = 0; frame < maxFrames; ++frame) {
            engine.step(1.0f / 60.0f);

            CHECK(engine.allBodyStatesFinite());
            CHECK(engine.allRotationsUnitLength());
            CHECK(engine.allBodyStatesInWorldBounds(15.0f));

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

int dumpGolden() {
    auto print = [](const char* name, uint64_t hash, const char* extra) {
        std::cout << "golden_json {\"name\":\"" << name << "\""
                  << extra
                  << ",\"revision\":" << SOLVER_REVISION
                  << ",\"hash\":\"0x" << std::hex << hash << std::dec << "\"}\n";
    };
    DicePhysicsEngine parity;
    parity.init(-15.0f, -2.75f, 18.0f, 18.0f);
    int id0 = parity.addDie(6, 0, 4, 0);
    int id1 = parity.addDie(20, 1.5f, 5, -1.0f);
    parity.applyImpulse(id0, 5, 2, -3);
    parity.applyTorqueImpulse(id1, 0, 10, 0);
    for (int i = 0; i < 30; ++i) parity.step(1.0f / 60.0f);
    print("parity-fixed", parity.hashSerializedState(), ",\"frames\":30");

    DicePhysicsEngine seeded;
    runDeterministicScenario(seeded, 0xDEADBEEFCAFEBABEULL);
    print("seed-deadbeefcafebabe", seeded.hashSerializedState(),
          ",\"seed\":\"0xDEADBEEFCAFEBABE\",\"frames\":240");
    return 0;
}

int runBench(int dieCount, int steps, int warmup, int dynamicsCount) {
    if (dieCount < 1) dieCount = 50;
    if (steps < 1) steps = 600;
    if (warmup < 0) warmup = 60;
    if (dynamicsCount < 0) dynamicsCount = 0;

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

    // Scattered across the same table area as the dice, dense enough to
    // exercise forEachDieDynamicPair / forEachDynamicPair's grid rather than
    // sitting in mostly-empty cells that make the broadphase look free.
    for (int i = 0; i < dynamicsCount; ++i) {
        const float x = static_cast<float>((i % 12) - 6) * 0.5f;
        const float y = 1.0f + static_cast<float>(i) * 0.03f;
        const float z = static_cast<float>((i / 12) % 12 - 6) * 0.5f;
        engine.addDynamicBox(i, 0.3f, x, y, z, 0.2f, 0.2f, 0.2f, 0.0f, 0.0f, 0.0f, 1.0f, 0);
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

    std::cout << "bench dice=" << dieCount << " dynamics=" << dynamicsCount
              << " steps=" << steps
              << " warmup=" << warmup
              << " total_ms=" << totalMs
              << " ms_per_step=" << msPerStep << '\n';
    std::cout << "bench_json {\"profile\":\"native-scalar\",\"dice\":" << dieCount
              << ",\"dynamics\":" << dynamicsCount
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
    if (argc >= 2 && std::strcmp(argv[1], "--dump-golden") == 0) {
        return dumpGolden();
    }
    if (argc >= 3 && std::strcmp(argv[1], "--dump-serialize") == 0) {
        uint64_t seed = std::strtoull(argv[2], nullptr, 0);
        return dumpSerializeHex(seed);
    }
    if (argc >= 2 && std::strcmp(argv[1], "--bench") == 0) {
        int dieCount = 50;
        int steps = 600;
        int warmup = 60;
        int dynamicsCount = 0;
        for (int i = 2; i < argc; ++i) {
            if (std::strncmp(argv[i], "--dice=", 7) == 0) {
                dieCount = std::atoi(argv[i] + 7);
            } else if (std::strncmp(argv[i], "--steps=", 8) == 0) {
                steps = std::atoi(argv[i] + 8);
            } else if (std::strncmp(argv[i], "--warmup=", 9) == 0) {
                warmup = std::atoi(argv[i] + 9);
            } else if (std::strncmp(argv[i], "--dynamics=", 11) == 0) {
                dynamicsCount = std::atoi(argv[i] + 11);
            }
        }
        return runBench(dieCount, steps, warmup, dynamicsCount);
    }
    doctest::Context ctx;
    ctx.applyCommandLine(argc, argv);
    return ctx.run();
}
