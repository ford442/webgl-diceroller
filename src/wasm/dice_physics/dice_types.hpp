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

struct FaceEntry {
    Vec3 normal;
    int value = 0;
};

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
    // Orientation-independent sweep proxy for the swept-contact path (see
    // CCD_MOTION_FRACTION). Kept alongside `radius` rather than derived on
    // demand because the hull's face loop is O(faces x verts) and the sweep
    // runs per substep; refreshed by computeInertiaFromHull, the one hook
    // every hull assignment already goes through.
    float sweepRadius = 0.0f;
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

    std::vector<Vec3> worldVerts;
    std::vector<Vec3> worldFaceNormals;
    std::vector<Vec3> worldEdgeDirs;

    std::vector<FaceEntry> faceTable;

    // Pipping bias direction at ratio 1, in the die's local frame: the "1"
    // face's normal scaled by the die's local height. Real dice lose more
    // material to the 6 pips than to the 1, so the centre of mass sits toward
    // the 1 face; the engine scales this by massBiasRatio_ and applies the
    // resulting gravity torque every substep. Zero until a face table with a
    // value-1 entry is attached; refreshed by setDieFaceTable and setDieHull.
    Vec3  comAxis{};

    void refreshComAxis() {
        comAxis = {};
        for (const FaceEntry& face : faceTable) {
            if (face.value != 1) continue;
            const float height = (useHull && !hull.verts.empty())
                ? hull.aabbMax.y - hull.aabbMin.y
                : 2.0f * radius;
            comAxis = face.normal * height;
            return;
        }
    }

    void computeInertiaFromHull() {
        const float sphereI = std::max(0.4f * mass * radius * radius, 1e-8f);
        const auto sphereInv = Vec3{1.0f / sphereI, 1.0f / sphereI, 1.0f / sphereI};

        // A hull-less die is already a sphere, so its bounding radius *is* its
        // inscribed one.
        const float inscribed = useHull ? hull.inscribedRadius() : radius;
        sweepRadius = inscribed > 0.0f ? std::min(inscribed, radius) : radius;

        if (!useHull || hull.verts.empty()) {
            invInertia = sphereInv;
            return;
        }
        Vec3 dim = hull.aabbMax - hull.aabbMin;
        float ix = (1.0f / 12.0f) * mass * (dim.y*dim.y + dim.z*dim.z);
        float iy = (1.0f / 12.0f) * mass * (dim.x*dim.x + dim.z*dim.z);
        float iz = (1.0f / 12.0f) * mass * (dim.x*dim.x + dim.y*dim.y);
        const float minI = 1e-8f;
        if (ix < minI || iy < minI || iz < minI) {
            invInertia = sphereInv;
            return;
        }
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
    // World-space bounding sphere for the contact broadphase (Box and
    // ConvexHull). A hull's vertices need not be centred on its origin, so
    // the sphere is centred on its posed AABB midpoint rather than `center`.
    Vec3 boundCenter{};
    float boundRadius = 0.0f;
};

// ---------------------------------------------------------------------------
// Dynamic (non-die) rigid-body props — knockable clutter (boxes/hulls with
// mass), distinct from dice: caller-supplied id (like StaticBody), small
// capacity (MAX_DYNAMICS), no face-value/settlement concerns.
// ---------------------------------------------------------------------------

enum class DynamicShapeType : uint8_t {
    Box = 0,
    Hull = 1,
};

struct DynamicBody {
    int userId = -1;
    DynamicShapeType shape = DynamicShapeType::Box;
    uint8_t materialTag = 0;

    Vec3 position;
    Vec3 velocity;
    Quat rotation;
    Vec3 angularVelocity;

    PolyHull hull;
    Vec3 halfExtents{}; // Box only; kept so a snapshot can rebuild the hull.
    float radius = 1.0f;

    float mass    = 1.0f;
    float invMass = 1.0f;
    Vec3  invInertia{0, 0, 0};

    float friction = 0.6f;
    float restitution = 0.2f;
    float rollingFriction = 0.1f;

    bool  sleeping   = false;
    float sleepTimer = 0.0f;
    bool  kinematic  = false;

    std::vector<Vec3> worldVerts;
    std::vector<Vec3> worldFaceNormals;
    std::vector<Vec3> worldEdgeDirs;

    void computeInertiaFromHull() {
        const float sphereI = std::max(0.4f * mass * radius * radius, 1e-8f);
        const Vec3 sphereInv{1.0f / sphereI, 1.0f / sphereI, 1.0f / sphereI};
        if (hull.verts.empty()) {
            invInertia = sphereInv;
            return;
        }
        Vec3 dim = hull.aabbMax - hull.aabbMin;
        float ix = (1.0f / 12.0f) * mass * (dim.y * dim.y + dim.z * dim.z);
        float iy = (1.0f / 12.0f) * mass * (dim.x * dim.x + dim.z * dim.z);
        float iz = (1.0f / 12.0f) * mass * (dim.x * dim.x + dim.y * dim.y);
        const float minI = 1e-8f;
        if (ix < minI || iy < minI || iz < minI) {
            invInertia = sphereInv;
            return;
        }
        invInertia = {1.0f / ix, 1.0f / iy, 1.0f / iz};
    }

    Vec3 applyInvInertiaWorld(const Vec3& v) const {
        Vec3 local = rotation.conjugate().rotate(v);
        local.x *= invInertia.x;
        local.y *= invInertia.y;
        local.z *= invInertia.z;
        return rotation.rotate(local);
    }
};

} // namespace dice_physics
