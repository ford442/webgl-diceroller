/**
 * dice_engine_dynamics.cpp — Dynamic (non-die) rigid-body props: lifecycle,
 * integration, collision against dice/statics/table/container, and the
 * dynamic×die / dynamic×dynamic contact solver.
 *
 * Dynamic props live in their own `dynamics_` vector, separate from dice's
 * `bodies_`. This mirrors the static-collider lifecycle (caller-supplied id,
 * capacity-checked vector) while participating in the solver like a die
 * (integrated, collides, sleeps). The small MAX_DYNAMICS cap means all
 * dynamic-involving pairs are brute-forced rather than broadphased.
 */

#include "../dice_physics_engine.hpp"

#include <algorithm>
#include <cmath>

namespace dice_physics {

namespace {

// Single-iteration impulse + friction + positional-correction resolution for
// a contact between two heterogeneous bodies (RigidBody and/or DynamicBody).
// Both types expose an identical surface (position/velocity/angularVelocity/
// rotation/invMass/kinematic/friction/restitution/applyInvInertiaWorld), so
// this is a template rather than four hand-copied solvers. Unlike the
// multi-iteration die-die solver (resolveDieCollisions), dynamic-involving
// pairs are few enough per step that a single pass is sufficient.
template <typename BodyA, typename BodyB>
void resolveGenericContact(BodyA& a, BodyB& b, const Contact& c) {
    const float POSITION_SLOP = 0.001f;

    Vec3 rA = c.point - a.position;
    Vec3 rB = c.point - b.position;
    Vec3 relVel = (b.velocity + Vec3::cross(b.angularVelocity, rB))
                - (a.velocity + Vec3::cross(a.angularVelocity, rA));
    float velN = Vec3::dot(relVel, c.normal);

    const float invMassA = a.kinematic ? 0.0f : a.invMass;
    const float invMassB = b.kinematic ? 0.0f : b.invMass;
    float denom = invMassA + invMassB;
    Vec3 raCrossN = Vec3::cross(rA, c.normal);
    Vec3 rbCrossN = Vec3::cross(rB, c.normal);
    if (!a.kinematic) denom += Vec3::dot(raCrossN, a.applyInvInertiaWorld(raCrossN));
    if (!b.kinematic) denom += Vec3::dot(rbCrossN, b.applyInvInertiaWorld(rbCrossN));

    if (denom > 1e-6f && velN <= 0.0f) {
        float rest = std::min(a.restitution, b.restitution);
        float j = std::max(-(1.0f + rest) * velN / denom, 0.0f);
        Vec3 impulse = c.normal * j;
        if (!a.kinematic) {
            a.velocity -= impulse * invMassA;
            a.angularVelocity -= a.applyInvInertiaWorld(Vec3::cross(rA, impulse));
        }
        if (!b.kinematic) {
            b.velocity += impulse * invMassB;
            b.angularVelocity += b.applyInvInertiaWorld(Vec3::cross(rB, impulse));
        }

        relVel = (b.velocity + Vec3::cross(b.angularVelocity, rB))
               - (a.velocity + Vec3::cross(a.angularVelocity, rA));
        Vec3 tangent = relVel - c.normal * Vec3::dot(relVel, c.normal);
        float tLenSq = tangent.lengthSq();
        if (tLenSq > 1e-8f) {
            tangent = tangent / std::sqrt(tLenSq);
            float velT = Vec3::dot(relVel, tangent);
            float mu = std::sqrt(a.friction * b.friction);
            float maxFriction = j * mu;
            float jt = std::clamp(-velT / denom, -maxFriction, maxFriction);
            Vec3 fImpulse = tangent * jt;
            if (!a.kinematic) {
                a.velocity -= fImpulse * invMassA;
                a.angularVelocity -= a.applyInvInertiaWorld(Vec3::cross(rA, fImpulse));
            }
            if (!b.kinematic) {
                b.velocity += fImpulse * invMassB;
                b.angularVelocity += b.applyInvInertiaWorld(Vec3::cross(rB, fImpulse));
            }
        }
    }

    if (c.penetration > POSITION_SLOP) {
        const float invSum = invMassA + invMassB;
        if (invSum > 1e-6f) {
            float corrMag = (c.penetration - POSITION_SLOP) * 0.6f / invSum;
            Vec3 corr = c.normal * corrMag;
            if (!a.kinematic) a.position -= corr * invMassA;
            if (!b.kinematic) b.position += corr * invMassB;
        }
    }
}

} // namespace

// ---------------------------------------------------------------------------
// Shared helpers (mirrors of the RigidBody-typed ones in
// dice_engine_collision_static.cpp / dice_engine_integrate.cpp, duplicated
// rather than templated to keep the well-tested die code paths untouched).
// ---------------------------------------------------------------------------

float DicePhysicsEngine::inertiaScalar(const DynamicBody& b) {
    if (b.hull.verts.empty()) {
        return 0.4f * b.mass * b.radius * b.radius;
    }
    Vec3 dim = b.hull.aabbMax - b.hull.aabbMin;
    float ix = (1.0f / 12.0f) * b.mass * (dim.y * dim.y + dim.z * dim.z);
    float iy = (1.0f / 12.0f) * b.mass * (dim.x * dim.x + dim.z * dim.z);
    float iz = (1.0f / 12.0f) * b.mass * (dim.x * dim.x + dim.y * dim.y);
    return (ix + iy + iz) / 3.0f;
}

CollisionEvent DicePhysicsEngine::makeEvent(
    const DynamicBody& primary,
    int otherId,
    float impactSpeed,
    float linearSpeedSq,
    float angularSpeedSq,
    int staticColliderId,
    int materialTag
) {
    return {
        dynamicEventOtherId(primary.userId),
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

int DicePhysicsEngine::dynamicEventOtherId(int userId) {
    return DYNAMIC_EVENT_ID_BASE - userId;
}

void DicePhysicsEngine::wake(DynamicBody& b) {
    b.sleeping = false;
    b.sleepTimer = 0.0f;
}

void DicePhysicsEngine::integrateDynamic(DynamicBody& b, float dt) {
    if (b.kinematic) return;
    b.velocity.y += gravity_ * dt;
    const float linDamp = 1.0f - 0.05f * dt;
    b.velocity = b.velocity * linDamp;
    const float angDamp = 1.0f - 0.10f * dt;
    b.angularVelocity = b.angularVelocity * angDamp;
    b.position += b.velocity * dt;
    b.rotation = b.rotation.integrate(b.angularVelocity, dt);
}

void DicePhysicsEngine::checkSleepDynamic(DynamicBody& b, float dt) const {
    if (b.kinematic) return;
    const float SPEED_THRESHOLD = 0.05f;
    const float SLEEP_DELAY = 0.5f;
    float speed = b.velocity.length() + b.angularVelocity.length() * b.radius;
    if (speed < SPEED_THRESHOLD) {
        b.sleepTimer += dt;
        if (b.sleepTimer >= SLEEP_DELAY) {
            b.sleeping = true;
            b.velocity = {};
            b.angularVelocity = {};
        }
    } else {
        b.sleepTimer = 0.0f;
    }
}

// ---------------------------------------------------------------------------
// Dynamic vs static / container / table (mirrors of the RigidBody paths;
// dynamic props always have a hull, so the useHull branch dice need is
// unnecessary here).
// ---------------------------------------------------------------------------

void DicePhysicsEngine::resolveDynamicStaticPlane(DynamicBody& b, const Vec3& n, float d, const StaticBody& s) {
    if (b.kinematic) return;

    float maxPen = 0.0f;
    Vec3 deepest = b.position;
    for (const auto& v : b.hull.verts) {
        Vec3 wv = b.rotation.rotate(v) + b.position;
        const float signedDist = Vec3::dot(n, wv) - d;
        if (signedDist < 0.0f) {
            const float pen = -signedDist;
            if (pen > maxPen) { maxPen = pen; deepest = wv; }
        }
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
                Vec3::cross(r, n), b.applyInvInertiaWorld(Vec3::cross(r, n)));
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
            b, staticEventOtherId(s.userId), impactSpeed,
            preImpactLinearSpeedSq, preImpactAngularSpeedSq,
            s.userId, s.materialTag));
    }
}

void DicePhysicsEngine::resolveDynamicStaticHull(DynamicBody& b, const StaticBody& s) {
    if (b.kinematic || b.hull.verts.empty() || s.hull.verts.empty()) return;

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
                Vec3::cross(r, normal), b.applyInvInertiaWorld(Vec3::cross(r, normal)));
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
            b, staticEventOtherId(s.userId), impactSpeed,
            preImpactLinearSpeedSq, preImpactAngularSpeedSq,
            s.userId, s.materialTag));
    }
}

void DicePhysicsEngine::resolveDynamicStaticOpenCylinder(DynamicBody& b, const StaticBody& s) {
    const int segs = s.cylinderSegments;
    const float r = s.cylinderRadius;
    const Vec3 center = s.center;

    for (int i = 0; i < segs; ++i) {
        const float angle = (6.28318530718f * static_cast<float>(i)) / static_cast<float>(segs);
        Vec3 outward{std::cos(angle), 0.0f, std::sin(angle)};
        Vec3 inward = outward * -1.0f;
        Vec3 edgePoint = center + outward * r;
        const float d = Vec3::dot(inward, edgePoint);
        resolveDynamicStaticPlane(b, inward, d, s);
    }

    if (s.cylinderClosedBottom) {
        Vec3 up{0, 1, 0};
        const float d = center.y - s.cylinderHalfHeight;
        resolveDynamicStaticPlane(b, up, d, s);
    }
}

void DicePhysicsEngine::resolveDynamicStaticCollisions(DynamicBody& b) {
    for (const auto& s : statics_) {
        switch (s.shape) {
            case StaticShapeType::Plane:
                resolveDynamicStaticPlane(b, s.planeNormal, s.planeDist, s);
                break;
            case StaticShapeType::Box:
            case StaticShapeType::ConvexHull:
                resolveDynamicStaticHull(b, s);
                break;
            case StaticShapeType::OpenCylinder:
                resolveDynamicStaticOpenCylinder(b, s);
                break;
        }
    }
}

void DicePhysicsEngine::resolveDynamicContainerCollisions(DynamicBody& b) {
    if (!containerActive_ || b.kinematic || containerPlanes_.empty()) return;

    for (size_t pi = 0; pi < containerPlanes_.size(); ++pi) {
        const ContainerPlane& plane = containerPlanes_[pi];
        const Vec3& n = plane.normal;
        const float d = plane.dist;
        const int otherId = CONTAINER_EVENT_ID_BASE - static_cast<int>(pi);

        float maxPen = 0.0f;
        Vec3 deepest = b.position;
        for (const auto& v : b.hull.verts) {
            Vec3 wv = b.rotation.rotate(v) + b.position;
            const float signedDist = Vec3::dot(n, wv) - d;
            if (signedDist < 0.0f) {
                const float pen = -signedDist;
                if (pen > maxPen) { maxPen = pen; deepest = wv; }
            }
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
                    Vec3::cross(r, n), b.applyInvInertiaWorld(Vec3::cross(r, n)));
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
            events_.push_back(makeEvent(b, otherId, impactSpeed,
                preImpactLinearSpeedSq, preImpactAngularSpeedSq, 0, 4));
        }
    }
}

void DicePhysicsEngine::resolveDynamicTableCollision(DynamicBody& b) {
    if (b.kinematic) return;

    Vec3 tableN = {0, 1, 0};
    float minProj = 1e20f;
    Vec3 deepest;
    for (const auto& v : b.hull.verts) {
        Vec3 wv = b.rotation.rotate(v) + b.position;
        float proj = wv.y - tableY_;
        if (proj < minProj) { minProj = proj; deepest = wv; }
    }
    if (minProj < 0.0f) {
        const float impactSpeed = std::max(0.0f, -b.velocity.y);
        const float preImpactLinearSpeedSq = b.velocity.lengthSq();
        const float preImpactAngularSpeedSq = b.angularVelocity.lengthSq();
        b.position.y -= minProj;
        if (b.velocity.y < 0.0f) {
            b.velocity.y = -b.velocity.y * b.restitution;
            Vec3 r = deepest - b.position;
            Vec3 velAtContact = b.velocity + Vec3::cross(b.angularVelocity, r);
            float velN = Vec3::dot(velAtContact, tableN);
            if (velN < 0.0f) {
                float denom = b.invMass + Vec3::dot(
                    Vec3::cross(r, tableN), b.applyInvInertiaWorld(Vec3::cross(r, tableN)));
                if (denom > 1e-6f) {
                    float j = -(1.0f + b.restitution) * velN / denom;
                    Vec3 impulse = tableN * j;
                    b.velocity += impulse * b.invMass;
                    b.angularVelocity += b.applyInvInertiaWorld(Vec3::cross(r, impulse));
                }
            }
            const float rollFric = std::max(0.0f, 1.0f - b.rollingFriction);
            b.velocity.x *= rollFric;
            b.velocity.z *= rollFric;
            b.angularVelocity = b.angularVelocity * rollFric;
        }
        if (std::abs(minProj) > 0.01f && impactSpeed > 1.0f &&
            events_.size() < static_cast<size_t>(MAX_EVENTS_PER_STEP)) {
            events_.push_back(makeEvent(b, -1, impactSpeed,
                preImpactLinearSpeedSq, preImpactAngularSpeedSq, 0, TABLE_MATERIAL_TAG));
        }
    }

    const float wx = tableHalfW_ - b.radius;
    const float wz = tableHalfD_ - b.radius;
    if (b.position.x >  wx) { b.position.x =  wx; b.velocity.x = -b.velocity.x * b.restitution; }
    if (b.position.x < -wx) { b.position.x = -wx; b.velocity.x = -b.velocity.x * b.restitution; }
    if (b.position.z >  wz) { b.position.z =  wz; b.velocity.z = -b.velocity.z * b.restitution; }
    if (b.position.z < -wz) { b.position.z = -wz; b.velocity.z = -b.velocity.z * b.restitution; }
}

// ---------------------------------------------------------------------------
// Dynamic × die and dynamic × dynamic contacts (brute force; MAX_DYNAMICS
// is small enough that this is trivial). Narrowphase reuses satTest() as-is
// since it only depends on hull + pose, not on the owning struct type.
// ---------------------------------------------------------------------------

void DicePhysicsEngine::resolveDieDynamicContacts(StepStats& stats) {
    for (auto& prop : dynamics_) {
        for (auto& die : bodies_) {
            stats.pairCandidates++;
            if (die.kinematic && prop.kinematic) continue;
            if (die.sleeping && prop.sleeping) continue;

            Vec3 delta = prop.position - die.position;
            const float distSq = delta.lengthSq();
            const float combinedR = die.radius + prop.radius;
            if (distSq >= combinedR * combinedR) continue;
            stats.sphereTests++;

            Contact c;
            bool hit;
            if (die.useHull && !die.hull.verts.empty()) {
                stats.satTests++;
                hit = satTest(die.hull, die.position, die.rotation,
                              prop.hull, prop.position, prop.rotation,
                              c.normal, c.penetration, c.point);
            } else {
                const float dist = std::sqrt(distSq);
                c.normal = dist > 1e-4f ? (delta / dist) : Vec3{1, 0, 0};
                c.penetration = combinedR - dist;
                c.point = die.position + c.normal * die.radius;
                hit = c.penetration > 0.0f;
            }
            if (!hit) continue;

            wake(die);
            wake(prop);

            Vec3 relVel = prop.velocity - die.velocity;
            float speed = std::abs(Vec3::dot(relVel, c.normal));
            if (speed > 0.5f && events_.size() < static_cast<size_t>(MAX_EVENTS_PER_STEP)) {
                const float energyDie = 0.5f * die.mass * die.velocity.lengthSq()
                    + 0.5f * inertiaScalar(die) * die.angularVelocity.lengthSq();
                const float energyProp = 0.5f * prop.mass * prop.velocity.lengthSq()
                    + 0.5f * inertiaScalar(prop) * prop.angularVelocity.lengthSq();
                if (energyDie >= energyProp) {
                    events_.push_back(makeEvent(die, dynamicEventOtherId(prop.userId), speed));
                } else {
                    events_.push_back(makeEvent(prop, die.id, speed));
                }
            }

            resolveGenericContact(die, prop, c);
            stats.contacts++;
        }
    }
}

void DicePhysicsEngine::resolveDynamicDynamicContacts(StepStats& stats) {
    for (size_t i = 0; i < dynamics_.size(); ++i) {
        for (size_t j = i + 1; j < dynamics_.size(); ++j) {
            auto& a = dynamics_[i];
            auto& b = dynamics_[j];
            stats.pairCandidates++;
            if (a.kinematic && b.kinematic) continue;
            if (a.sleeping && b.sleeping) continue;

            Vec3 delta = b.position - a.position;
            const float distSq = delta.lengthSq();
            const float combinedR = a.radius + b.radius;
            if (distSq >= combinedR * combinedR) continue;
            stats.sphereTests++;

            Contact c;
            stats.satTests++;
            if (!satTest(a.hull, a.position, a.rotation, b.hull, b.position, b.rotation,
                         c.normal, c.penetration, c.point)) {
                continue;
            }

            wake(a);
            wake(b);

            Vec3 relVel = b.velocity - a.velocity;
            float speed = std::abs(Vec3::dot(relVel, c.normal));
            if (speed > 0.5f && events_.size() < static_cast<size_t>(MAX_EVENTS_PER_STEP)) {
                const float energyA = 0.5f * a.mass * a.velocity.lengthSq()
                    + 0.5f * inertiaScalar(a) * a.angularVelocity.lengthSq();
                const float energyB = 0.5f * b.mass * b.velocity.lengthSq()
                    + 0.5f * inertiaScalar(b) * b.angularVelocity.lengthSq();
                events_.push_back(energyA >= energyB
                    ? makeEvent(a, dynamicEventOtherId(b.userId), speed)
                    : makeEvent(b, dynamicEventOtherId(a.userId), speed));
            }

            resolveGenericContact(a, b, c);
            stats.contacts++;
        }
    }
}

void DicePhysicsEngine::stepDynamics(float dt, StepStats& stats) {
    for (auto& d : dynamics_) {
        if (d.sleeping) continue;
        integrateDynamic(d, dt);
    }
    resolveDieDynamicContacts(stats);
    resolveDynamicDynamicContacts(stats);
    for (auto& d : dynamics_) {
        if (d.sleeping) continue;
        resolveDynamicContainerCollisions(d);
        resolveDynamicStaticCollisions(d);
        resolveDynamicTableCollision(d);
        checkSleepDynamic(d, dt);
    }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

void DicePhysicsEngine::clearDynamics() {
    dynamics_.clear();
    dynamicCapacityDroppedCount_ = 0;
}

bool DicePhysicsEngine::removeDynamic(int userId) {
    const size_t before = dynamics_.size();
    dynamics_.erase(
        std::remove_if(dynamics_.begin(), dynamics_.end(),
            [userId](const DynamicBody& d) { return d.userId == userId; }),
        dynamics_.end());
    return dynamics_.size() < before;
}

void DicePhysicsEngine::setDynamicKinematic(int userId, bool kinematic) {
    for (auto& d : dynamics_) {
        if (d.userId != userId) continue;
        d.kinematic = kinematic;
        if (kinematic) {
            d.velocity = {};
            d.angularVelocity = {};
            d.sleeping = false;
            d.sleepTimer = 0.0f;
        } else {
            wake(d);
        }
        break;
    }
}

void DicePhysicsEngine::setDynamicTransform(int userId, float px, float py, float pz,
                                            float qx, float qy, float qz, float qw) {
    for (auto& d : dynamics_) {
        if (d.userId != userId) continue;
        d.position = {px, py, pz};
        d.rotation = Quat{qx, qy, qz, qw}.normalized();
        d.velocity = {};
        d.angularVelocity = {};
        wake(d);
        break;
    }
}

void DicePhysicsEngine::setDynamicVelocity(int userId, float lvx, float lvy, float lvz,
                                           float avx, float avy, float avz) {
    for (auto& d : dynamics_) {
        if (d.userId != userId) continue;
        d.velocity = {lvx, lvy, lvz};
        d.angularVelocity = {avx, avy, avz};
        wake(d);
        break;
    }
}

void DicePhysicsEngine::applyDynamicImpulse(int userId, float fx, float fy, float fz) {
    for (auto& d : dynamics_) {
        if (d.userId != userId) continue;
        d.velocity += Vec3{fx, fy, fz} * d.invMass;
        wake(d);
        break;
    }
}

void DicePhysicsEngine::applyDynamicTorqueImpulse(int userId, float tx, float ty, float tz) {
    for (auto& d : dynamics_) {
        if (d.userId != userId) continue;
        d.angularVelocity += d.applyInvInertiaWorld(Vec3{tx, ty, tz});
        wake(d);
        break;
    }
}

int DicePhysicsEngine::addDynamicBox(int userId, float mass,
                                     float cx, float cy, float cz,
                                     float hx, float hy, float hz,
                                     float qx, float qy, float qz, float qw,
                                     int materialTag) {
    if (dynamics_.size() >= static_cast<size_t>(MAX_DYNAMICS)) {
        ++dynamicCapacityDroppedCount_;
        return -1;
    }
    if (userId < 0) return -1;
    for (const auto& d : dynamics_) if (d.userId == userId) return -1;
    if (mass <= 0.0f || hx <= 0.0f || hy <= 0.0f || hz <= 0.0f) return -1;

    DynamicBody body;
    body.userId = userId;
    body.shape = DynamicShapeType::Box;
    body.materialTag = static_cast<uint8_t>(std::clamp(materialTag, 0, 255));
    body.position = {cx, cy, cz};
    body.rotation = Quat{qx, qy, qz, qw}.normalized();
    body.halfExtents = {hx, hy, hz};
    body.mass = mass;
    body.invMass = 1.0f / mass;
    body.radius = Vec3{hx, hy, hz}.length();
    body.hull.build({
        {-hx, -hy, -hz}, { hx, -hy, -hz}, { hx,  hy, -hz}, {-hx,  hy, -hz},
        {-hx, -hy,  hz}, { hx, -hy,  hz}, { hx,  hy,  hz}, {-hx,  hy,  hz},
    });
    body.computeInertiaFromHull();
    dynamics_.push_back(body);
    return userId;
}

int DicePhysicsEngine::addDynamicHull(int userId, float mass,
                                      float cx, float cy, float cz,
                                      float qx, float qy, float qz, float qw,
                                      const std::vector<float>& flatVerts,
                                      int materialTag) {
    if (dynamics_.size() >= static_cast<size_t>(MAX_DYNAMICS)) {
        ++dynamicCapacityDroppedCount_;
        return -1;
    }
    if (userId < 0) return -1;
    for (const auto& d : dynamics_) if (d.userId == userId) return -1;
    if (mass <= 0.0f) return -1;
    if (flatVerts.size() % 3 != 0) return -1;
    if (flatVerts.size() / 3 > MAX_VERTICES_PER_HULL) return -1;

    std::vector<Vec3> verts;
    verts.reserve(flatVerts.size() / 3);
    for (size_t i = 0; i < flatVerts.size(); i += 3) {
        verts.push_back({flatVerts[i], flatVerts[i + 1], flatVerts[i + 2]});
    }
    if (verts.empty()) return -1;

    DynamicBody body;
    body.userId = userId;
    body.shape = DynamicShapeType::Hull;
    body.materialTag = static_cast<uint8_t>(std::clamp(materialTag, 0, 255));
    body.position = {cx, cy, cz};
    body.rotation = Quat{qx, qy, qz, qw}.normalized();
    body.mass = mass;
    body.invMass = 1.0f / mass;
    body.hull.build(verts);
    if (body.hull.verts.empty()) return -1;
    body.radius = std::max((body.hull.aabbMax - body.hull.aabbMin).length() * 0.5f, 0.05f);
    body.computeInertiaFromHull();
    dynamics_.push_back(body);
    return userId;
}

int DicePhysicsEngine::getDynamicCount() const { return static_cast<int>(dynamics_.size()); }

uint32_t DicePhysicsEngine::getDynamicCapacityDroppedCount() const { return dynamicCapacityDroppedCount_; }

const std::vector<float>& DicePhysicsEngine::buildDynamicTransformBuffer() {
    dynamicTransformBuffer_.clear();
    dynamicTransformBuffer_.reserve(dynamics_.size() * 7);
    for (const auto& d : dynamics_) {
        dynamicTransformBuffer_.push_back(d.position.x);
        dynamicTransformBuffer_.push_back(d.position.y);
        dynamicTransformBuffer_.push_back(d.position.z);
        dynamicTransformBuffer_.push_back(d.rotation.x);
        dynamicTransformBuffer_.push_back(d.rotation.y);
        dynamicTransformBuffer_.push_back(d.rotation.z);
        dynamicTransformBuffer_.push_back(d.rotation.w);
    }
    return dynamicTransformBuffer_;
}

const std::vector<float>& DicePhysicsEngine::buildDynamicIdBuffer() {
    dynamicIdBuffer_.clear();
    dynamicIdBuffer_.reserve(dynamics_.size());
    for (const auto& d : dynamics_) {
        dynamicIdBuffer_.push_back(static_cast<float>(d.userId));
    }
    return dynamicIdBuffer_;
}

} // namespace dice_physics
