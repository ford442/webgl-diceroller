/**
 * dice_engine_collision_static.cpp — Static-collider and container-plane
 * collision resolution, plus small shared helpers (event construction,
 * material lookup, per-die radius/inertia scalars).
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

void DicePhysicsEngine::resolveStaticPlane(RigidBody& b, const Vec3& n, float d, const StaticBody& s) {
    if (b.kinematic) return;

    float maxPen = 0.0f;
    Vec3 deepest = b.position;

    auto testPoint = [&](const Vec3& wv) {
        const float signedDist = Vec3::dot(n, wv) - d;
        if (signedDist < 0.0f) {
            const float pen = -signedDist;
            if (pen > maxPen) {
                maxPen = pen;
                deepest = wv;
            }
        }
    };

    if (b.useHull && !b.hull.verts.empty()) {
        for (const auto& v : b.hull.verts) {
            testPoint(b.rotation.rotate(v) + b.position);
        }
    } else {
        testPoint(b.position - n * b.radius);
    }

    if (maxPen <= 0.0f) return;

    wake(b);
    const float impactSpeed = std::max(0.0f, -Vec3::dot(b.velocity, n));
    const float preImpactLinearSpeedSq = b.velocity.lengthSq();
    const float preImpactAngularSpeedSq = b.angularVelocity.lengthSq();

    b.position += n * maxPen;

    if (Vec3::dot(b.velocity, n) < 0.0f) {
        b.velocity -= n * (Vec3::dot(b.velocity, n) * (1.0f + s.restitution));
        Vec3 r = deepest - b.position;
        Vec3 velAtContact = b.velocity + Vec3::cross(b.angularVelocity, r);
        float velN = Vec3::dot(velAtContact, n);
        if (velN < 0.0f) {
            float denom = b.invMass + Vec3::dot(
                Vec3::cross(r, n),
                b.applyInvInertiaWorld(Vec3::cross(r, n))
            );
            if (denom > 1e-6f) {
                float j = -(1.0f + s.restitution) * velN / denom;
                Vec3 impulse = n * j;
                b.velocity += impulse * b.invMass;
                b.angularVelocity += b.applyInvInertiaWorld(Vec3::cross(r, impulse));
            }
        }
        const float rollFric = std::max(0.0f, 1.0f - s.rollingFriction);
        b.velocity.x *= rollFric;
        b.velocity.y *= rollFric;
        b.velocity.z *= rollFric;
        b.angularVelocity = b.angularVelocity * rollFric;
    }

    if (maxPen > 0.01f && impactSpeed > 1.0f &&
        events_.size() < static_cast<size_t>(MAX_EVENTS_PER_STEP)) {
        events_.push_back(makeEvent(
            b,
            staticEventOtherId(s.userId),
            impactSpeed,
            preImpactLinearSpeedSq,
            preImpactAngularSpeedSq,
            s.userId,
            s.materialTag
        ));
    }
}

void DicePhysicsEngine::resolveStaticHull(RigidBody& b, const StaticBody& s) {
    if (b.kinematic || !b.useHull || b.hull.verts.empty() || s.hull.verts.empty()) return;

    Vec3 normal, contact;
    float pen = 0.0f;
    if (!satTest(b.hull, b.position, b.rotation, s.hull, s.center, s.rotation,
                 normal, pen, contact)) {
        return;
    }
    if (pen <= 1e-6f) return;

    wake(b);
    const float impactSpeed = std::max(0.0f, -Vec3::dot(b.velocity, normal));
    const float preImpactLinearSpeedSq = b.velocity.lengthSq();
    const float preImpactAngularSpeedSq = b.angularVelocity.lengthSq();

    b.position -= normal * pen;

    if (Vec3::dot(b.velocity, normal) < 0.0f) {
        b.velocity -= normal * (Vec3::dot(b.velocity, normal) * (1.0f + s.restitution));
        Vec3 r = contact - b.position;
        Vec3 velAtContact = b.velocity + Vec3::cross(b.angularVelocity, r);
        float velN = Vec3::dot(velAtContact, normal);
        if (velN < 0.0f) {
            float denom = b.invMass + Vec3::dot(
                Vec3::cross(r, normal),
                b.applyInvInertiaWorld(Vec3::cross(r, normal))
            );
            if (denom > 1e-6f) {
                float j = -(1.0f + s.restitution) * velN / denom;
                Vec3 impulse = normal * j;
                b.velocity += impulse * b.invMass;
                b.angularVelocity += b.applyInvInertiaWorld(Vec3::cross(r, impulse));
            }
        }
        const float rollFric = std::max(0.0f, 1.0f - s.rollingFriction);
        b.velocity.x *= rollFric;
        b.velocity.y *= rollFric;
        b.velocity.z *= rollFric;
        b.angularVelocity = b.angularVelocity * rollFric;
    }

    if (pen > 0.01f && impactSpeed > 1.0f &&
        events_.size() < static_cast<size_t>(MAX_EVENTS_PER_STEP)) {
        events_.push_back(makeEvent(
            b,
            staticEventOtherId(s.userId),
            impactSpeed,
            preImpactLinearSpeedSq,
            preImpactAngularSpeedSq,
            s.userId,
            s.materialTag
        ));
    }
}

void DicePhysicsEngine::resolveStaticOpenCylinder(RigidBody& b, const StaticBody& s) {
    const int segs = s.cylinderSegments;
    const float r = s.cylinderRadius;
    const Vec3 center = s.center;

    for (int i = 0; i < segs; ++i) {
        const float angle = (6.28318530718f * static_cast<float>(i)) / static_cast<float>(segs);
        Vec3 outward{std::cos(angle), 0.0f, std::sin(angle)};
        Vec3 inward = outward * -1.0f;
        Vec3 edgePoint = center + outward * r;
        const float d = Vec3::dot(inward, edgePoint);
        resolveStaticPlane(b, inward, d, s);
    }

    if (s.cylinderClosedBottom) {
        Vec3 up{0, 1, 0};
        const float d = center.y - s.cylinderHalfHeight;
        resolveStaticPlane(b, up, d, s);
    }
}

void DicePhysicsEngine::resolveStaticCollisions(RigidBody& b, float /*dt*/) {
    for (const auto& s : statics_) {
        switch (s.shape) {
            case StaticShapeType::Plane:
                resolveStaticPlane(b, s.planeNormal, s.planeDist, s);
                break;
            case StaticShapeType::Box:
            case StaticShapeType::ConvexHull:
                resolveStaticHull(b, s);
                break;
            case StaticShapeType::OpenCylinder:
                resolveStaticOpenCylinder(b, s);
                break;
        }
    }
}

void DicePhysicsEngine::resolveContainerCollisions(RigidBody& b, float /*dt*/) {
    if (!containerActive_ || b.kinematic || containerPlanes_.empty()) return;

    for (size_t pi = 0; pi < containerPlanes_.size(); ++pi) {
        const ContainerPlane& plane = containerPlanes_[pi];
        const Vec3& n = plane.normal;
        const float d = plane.dist;
        const int otherId = CONTAINER_EVENT_ID_BASE - static_cast<int>(pi);

        float maxPen = 0.0f;
        Vec3 deepest = b.position;

        auto testPoint = [&](const Vec3& wv) {
            const float signedDist = Vec3::dot(n, wv) - d;
            if (signedDist < 0.0f) {
                const float pen = -signedDist;
                if (pen > maxPen) {
                    maxPen = pen;
                    deepest = wv;
                }
            }
        };

        if (b.useHull && !b.hull.verts.empty()) {
            for (const auto& v : b.hull.verts) {
                testPoint(b.rotation.rotate(v) + b.position);
            }
        } else {
            testPoint(b.position - n * b.radius);
        }

        if (maxPen <= 0.0f) continue;

        wake(b);
        const float impactSpeed = std::max(0.0f, -Vec3::dot(b.velocity, n));
        const float preImpactLinearSpeedSq = b.velocity.lengthSq();
        const float preImpactAngularSpeedSq = b.angularVelocity.lengthSq();

        b.position += n * maxPen;

        if (Vec3::dot(b.velocity, n) < 0.0f) {
            b.velocity -= n * (Vec3::dot(b.velocity, n) * (1.0f + b.restitution));
            Vec3 r = deepest - b.position;
            Vec3 velAtContact = b.velocity + Vec3::cross(b.angularVelocity, r);
            float velN = Vec3::dot(velAtContact, n);
            if (velN < 0.0f) {
                float denom = b.invMass + Vec3::dot(
                    Vec3::cross(r, n),
                    b.applyInvInertiaWorld(Vec3::cross(r, n))
                );
                if (denom > 1e-6f) {
                    float j = -(1.0f + b.restitution) * velN / denom;
                    Vec3 impulse = n * j;
                    b.velocity += impulse * b.invMass;
                    b.angularVelocity += b.applyInvInertiaWorld(Vec3::cross(r, impulse));
                }
            }
            const float rollFric = std::max(0.0f, 1.0f - b.rollingFriction);
            b.velocity.x *= rollFric;
            b.velocity.y *= rollFric;
            b.velocity.z *= rollFric;
            b.angularVelocity = b.angularVelocity * rollFric;
        }

        if (maxPen > 0.01f && impactSpeed > 1.0f &&
            events_.size() < static_cast<size_t>(MAX_EVENTS_PER_STEP)) {
            events_.push_back(makeEvent(
                b,
                otherId,
                impactSpeed,
                preImpactLinearSpeedSq,
                preImpactAngularSpeedSq,
                0,
                4
            ));
        }
    }
}

} // namespace dice_physics
