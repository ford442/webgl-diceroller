/**
 * dice_contacts.hpp — Persistent contact manifolds and sequential-impulse
 * solver constants.
 *
 * Manifolds are keyed by (kind, idA, idB, aux) and up to four feature-id
 * points. Accumulated impulses warm-start the next substep/frame.
 */

#pragma once

#include <cstdint>

#include "dice_math.hpp"

namespace dice_physics {

static constexpr int MAX_MANIFOLD_POINTS = 4;
static constexpr int VELOCITY_ITERATIONS = 16;
static constexpr int POSITION_ITERATIONS = 2;
static constexpr float CONTACT_SLOP = 0.008f;
static constexpr float BAUMGARTE = 0.05f;
static constexpr float RESTITUTION_THRESHOLD = 6.0f;
static constexpr float WARM_START_FACTOR = 0.0f;
static constexpr float MAX_LINEAR_SPEED = 80.0f;
static constexpr float MAX_ANGULAR_SPEED = 80.0f;
static constexpr float LINEAR_DAMPING = 0.05f;
static constexpr float ANGULAR_DAMPING = 0.10f;
static constexpr float SPECULATIVE_SLOP = 0.02f;
static constexpr float SPECULATIVE_MAX = 0.85f;
static constexpr float SLEEP_SPEED_THRESHOLD = 0.15f;
static constexpr float SLEEP_DELAY = 0.5f;

/** Snapshot + solver protocol. Bump when manifolds / impulses change behaviour. */
static constexpr uint32_t SOLVER_REVISION = 3;

enum class ManifoldKind : uint8_t {
    DieDie = 0,
    DieStatic = 1,
    DieTable = 2,
    DieWall = 3,
    DieContainer = 4,
    DieDynamic = 5,
    DynamicDynamic = 6,
    DynamicStatic = 7,
    DynamicTable = 8,
    DynamicWall = 9,
    DynamicContainer = 10,
};

struct ContactPoint {
    Vec3 point{};
    float separation = 0.0f; // negative = penetration
    uint32_t featureId = 0;
    float accN = 0.0f;
    float accT1 = 0.0f;
    float accT2 = 0.0f;
    float velBias = 0.0f;
};

struct ContactManifold {
    ManifoldKind kind = ManifoldKind::DieDie;
    int idA = -1;
    int idB = -1;
    int aux = 0;
    int indexA = -1;
    int indexB = -1;
    Vec3 normal{};
    Vec3 tangent1{};
    Vec3 tangent2{};
    float friction = 0.6f;
    float restitution = 0.2f;
    ContactPoint points[MAX_MANIFOLD_POINTS];
    int pointCount = 0;
    bool stale = true;
};

struct SatHit {
    Vec3 normal{};
    Vec3 contact{};
    float penetration = 0.0f;
    uint32_t featureId = 0;
    bool normalFromA = true;
    bool hit = false;
};

struct WorldAnchor {
    Vec3 position{};
    Vec3 velocity{};
    Vec3 angular{};
    Quat rotation{};
};

struct BodyView {
    Vec3* position = nullptr;
    Vec3* velocity = nullptr;
    Vec3* angularVelocity = nullptr;
    const Quat* rotation = nullptr;
    float invMass = 0.0f;
    Vec3 invInertia{};
    bool kinematic = true;

    Vec3 applyInvInertiaWorld(const Vec3& v) const {
        if (!rotation || kinematic) return {};
        Vec3 local = rotation->conjugate().rotate(v);
        local.x *= invInertia.x;
        local.y *= invInertia.y;
        local.z *= invInertia.z;
        return rotation->rotate(local);
    }

    void applyImpulse(const Vec3& impulse, const Vec3& r) {
        if (kinematic || invMass <= 0.0f || !velocity || !angularVelocity) return;
        *velocity += impulse * invMass;
        *angularVelocity += applyInvInertiaWorld(Vec3::cross(r, impulse));
    }

    Vec3 velocityAt(const Vec3& r) const {
        if (!velocity || !angularVelocity) return {};
        return *velocity + Vec3::cross(*angularVelocity, r);
    }
};

} // namespace dice_physics
