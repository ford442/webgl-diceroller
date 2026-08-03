/**
 * dice_types.hpp — Rigid body, contact, event, and static collider structures.
 *
 * Part of the dice_physics_engine module split; included by
 * dice_physics_engine.hpp.
 */

#pragma once

#include <cstdint>

#include "dice_math.hpp"

namespace dice_physics {

// ---------------------------------------------------------------------------
// Rigid body
// ---------------------------------------------------------------------------

struct RigidBody {
    int   id     = -1;
    int   sides  = 6;

    Vec3  position;
    Vec3  velocity;
    Quat  rotation;
    Vec3  angularVelocity;

    PolyHull hull;
    bool  useHull    = false;
    float radius     = 0.9f;
    float mass       = 5.0f;
    float invMass    = 0.2f;

    Vec3  invInertia = {0, 0, 0};

    float restitution = 0.2f;
    float friction    = 0.6f;
    float rollingFriction = 0.1f;
    float dragFactor = 0.0f;

    bool  sleeping    = false;
    float sleepTimer  = 0.0f;
    bool  kinematic   = false;

    void computeInertiaFromHull() {
        if (!useHull || hull.verts.empty()) {
            float i = 0.4f * mass * radius * radius;
            invInertia = {1.0f/i, 1.0f/i, 1.0f/i};
            return;
        }
        Vec3 dim = hull.aabbMax - hull.aabbMin;
        float ix = (1.0f / 12.0f) * mass * (dim.y*dim.y + dim.z*dim.z);
        float iy = (1.0f / 12.0f) * mass * (dim.x*dim.x + dim.z*dim.z);
        float iz = (1.0f / 12.0f) * mass * (dim.x*dim.x + dim.y*dim.y);
        invInertia = {1.0f/ix, 1.0f/iy, 1.0f/iz};
    }

    Vec3 applyInvInertiaWorld(const Vec3& v) const {
        Vec3 local = rotation.conjugate().rotate(v);
        local.x *= invInertia.x;
        local.y *= invInertia.y;
        local.z *= invInertia.z;
        return rotation.rotate(local);
    }
};

// ---------------------------------------------------------------------------
// Contact & event structures
// ---------------------------------------------------------------------------

struct Contact {
    int a = -1, b = -1;
    Vec3 normal;
    Vec3 point;
    float penetration = 0.0f;
    float normalImpulse = 0.0f;
    float frictionImpulse = 0.0f;
};

struct CollisionEvent {
    int idA = -1, idB = -1;
    float impactSpeed = 0.0f;
    float mass = 0.0f;
    float inertiaScalar = 0.0f;
    float linearSpeedSq = 0.0f;
    float angularSpeedSq = 0.0f;
    int staticColliderId = 0;
    int materialTag = 0;
};

struct StepStats {
    uint32_t pairCandidates = 0;
    uint32_t sphereTests = 0;
    uint32_t satTests = 0;
    uint32_t contacts = 0;
};

enum class StaticShapeType : uint8_t {
    Box = 0,
    Plane = 1,
    ConvexHull = 2,
    OpenCylinder = 3,
};

struct StaticBody {
    int userId = -1;
    StaticShapeType shape = StaticShapeType::Box;
    uint8_t materialTag = 0;
    Vec3 center{};
    Quat rotation{};
    float friction = 0.6f;
    float restitution = 0.2f;
    float rollingFriction = 0.1f;
    Vec3 halfExtents{};
    PolyHull hull;
    Vec3 planeNormal{};
    float planeDist = 0.0f;
    float cylinderRadius = 0.0f;
    float cylinderHalfHeight = 0.0f;
    int cylinderSegments = 8;
    bool cylinderClosedBottom = false;
};

} // namespace dice_physics
