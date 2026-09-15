/**
 * dice_engine_collision_static.cpp — Shared helpers (event construction,
 * material lookup, per-die radius/inertia scalars).
 * Contact generation against statics lives in dice_engine_solver.cpp.
 */

#include "../dice_physics_engine.hpp"

#include <algorithm>
#include <cmath>

namespace dice_physics {

float DicePhysicsEngine::radiusForSides(int sides) {
    switch (sides) {
        case  4: return 0.80f;
        case  6: return 0.90f;
        case  8: return 0.85f;
        case 10: return 0.88f;
        case 12: return 0.93f;
        case 20: return 1.00f;
        default: return 0.90f;
    }
}

float DicePhysicsEngine::inertiaScalar(const RigidBody& b) {
    if (!b.useHull || b.hull.verts.empty()) {
        return 0.4f * b.mass * b.radius * b.radius;
    }
    Vec3 dim = b.hull.aabbMax - b.hull.aabbMin;
    float ix = (1.0f / 12.0f) * b.mass * (dim.y*dim.y + dim.z*dim.z);
    float iy = (1.0f / 12.0f) * b.mass * (dim.x*dim.x + dim.z*dim.z);
    float iz = (1.0f / 12.0f) * b.mass * (dim.x*dim.x + dim.y*dim.y);
    return (ix + iy + iz) / 3.0f;
}

CollisionEvent DicePhysicsEngine::makeEvent(
    const RigidBody& primary,
    int otherId,
    float impactSpeed,
    float linearSpeedSq,
    float angularSpeedSq,
    int staticColliderId,
    int materialTag
) {
    return {
        primary.id,
        otherId,
        impactSpeed,
        primary.mass,
        inertiaScalar(primary),
        linearSpeedSq >= 0.0f ? linearSpeedSq : primary.velocity.lengthSq(),
        angularSpeedSq >= 0.0f ? angularSpeedSq : primary.angularVelocity.lengthSq(),
        staticColliderId,
        materialTag,
    };
}

void DicePhysicsEngine::applyStaticMaterial(StaticBody& s, int tag) {
    s.materialTag = static_cast<uint8_t>(std::clamp(tag, 0, 255));
    switch (s.materialTag) {
        case 1: s.friction = 0.6f; s.restitution = 0.05f; s.rollingFriction = 0.12f; break;
        case 2: s.friction = 0.6f; s.restitution = 0.30f; s.rollingFriction = 0.10f; break;
        case 3: s.friction = 0.45f; s.restitution = 0.50f; s.rollingFriction = 0.08f; break;
        case 4: s.friction = 0.70f; s.restitution = 0.15f; s.rollingFriction = 0.12f; break;
        default: s.friction = 0.6f; s.restitution = 0.20f; s.rollingFriction = 0.10f; break;
    }
}

int DicePhysicsEngine::staticEventOtherId(int userId) {
    return STATIC_EVENT_ID_BASE - userId;
}

} // namespace dice_physics
