/**
 * dice_engine_integrate.cpp — Per-body integration, table/floor collision,
 * and sleep-state bookkeeping.
 */

#include "../dice_physics_engine.hpp"

#include <algorithm>
#include <cmath>

namespace dice_physics {

void DicePhysicsEngine::wake(RigidBody& b) {
    b.sleeping = false;
    b.sleepTimer = 0.0f;
}

void DicePhysicsEngine::integrate(RigidBody& b, float dt) {
    if (b.kinematic) return;
    b.velocity.y += gravity_ * dt;
    if (!noDrag_ && b.dragFactor > 0.0f) {
        const float speedSq = b.velocity.lengthSq();
        if (speedSq > 1e-6f) {
            b.velocity -= b.velocity * (b.dragFactor * speedSq * dt);
        }
    }
    b.velocity = b.velocity * std::exp(-LINEAR_DAMPING * dt);
    b.angularVelocity = b.angularVelocity * std::exp(-ANGULAR_DAMPING * dt);
    const float lin = b.velocity.length();
    if (lin > MAX_LINEAR_SPEED) b.velocity = b.velocity * (MAX_LINEAR_SPEED / lin);
    const float ang = b.angularVelocity.length();
    if (ang > MAX_ANGULAR_SPEED) b.angularVelocity = b.angularVelocity * (MAX_ANGULAR_SPEED / ang);
    b.position += b.velocity * dt;
    b.rotation = b.rotation.integrate(b.angularVelocity, dt);
}

/**
 * Clip a substep's linear motion at the first static surface it would have
 * crossed.
 *
 * generateContacts only ever sees the pose a substep *ends* at. A body that
 * begins clear of a ramp and ends clear on the far side produces no manifold
 * at either end, and the speculative widening in `speculativeFor` does not
 * help: it grows the contact search around a single discrete pose, not along
 * the path between two. Above CCD_MOTION_FRACTION of the body's sweep proxy
 * the path is swept instead, and the body is parked just short of first touch
 * so the discrete pass that follows has a pose in contact range to solve.
 *
 * Scope is deliberately die-vs-static (tower ramps, table lip, tray walls):
 * statics never move, so `from -> position` is the whole relative motion and
 * one sweep per collider is exact. Die-die CCD would need both paths swept
 * against each other and is not attempted here.
 *
 * Velocity and rotation are left alone — only the position is shortened. The
 * body arrives at the surface with the speed it had, which is what the
 * contact solver needs to compute the right impulse on the next substep.
 */
void DicePhysicsEngine::sweepClipAgainstStatics(RigidBody& b, const Vec3& from) {
    if (b.kinematic || statics_.empty()) return;

    const Vec3 motion = b.position - from;
    const float dist = motion.length();
    const float proxy = b.sweepRadius > 0.0f ? b.sweepRadius : b.radius;
    if (proxy <= 0.0f || dist <= CCD_MOTION_FRACTION * proxy) return;

    float earliest = 1.0f;
    bool hit = false;
    for (const auto& s : statics_) {
        Vec3 halfExtents;
        switch (s.shape) {
            case StaticShapeType::Box:
                halfExtents = s.halfExtents;
                break;
            case StaticShapeType::ConvexHull:
                if (s.hull.verts.empty()) continue;
                // The hull's own AABB, which contains it: a sweep against the
                // enclosing box can stop a body early but never lets one
                // through, and a hull static is a rarity next to the boxes
                // the props are actually built from.
                halfExtents = (s.hull.aabbMax - s.hull.aabbMin) * 0.5f;
                break;
            default:
                // Planes are half-spaces (nothing to tunnel into) and open
                // cylinders are already solved as radial planes.
                continue;
        }

        // Cheap reject: the swept proxy's bounding sphere against the
        // collider's, before paying for the slab test.
        const Vec3 midpoint = from + motion * 0.5f;
        const float reach = dist * 0.5f + proxy + halfExtents.length();
        if ((s.center - midpoint).lengthSq() > reach * reach) continue;

        float t = 1.0f;
        if (sweepSphereAgainstObb(from, b.position, proxy, s.center, s.rotation, halfExtents, t) &&
            t < earliest) {
            earliest = t;
            hit = true;
        }
    }
    if (!hit) return;

    const float backoff = std::min(CCD_CONTACT_OFFSET / dist, earliest);
    b.position = from + motion * (earliest - backoff);
}

void DicePhysicsEngine::checkSleep(RigidBody& b, float dt) const {
    if (b.kinematic) return;
    float speed = b.velocity.length() + b.angularVelocity.length() * b.radius;
    if (speed < SLEEP_SPEED_THRESHOLD) {
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

} // namespace dice_physics
