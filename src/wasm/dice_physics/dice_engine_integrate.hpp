/**
 * dice_engine_integrate.hpp — Per-body integration, table/floor collision,
 * and sleep-state bookkeeping.
 *
 * Part of the dice_physics_engine module split; included by
 * dice_physics_engine.hpp after the class declaration.
 */

#pragma once

#include <algorithm>
#include <cmath>

namespace dice_physics {

inline void DicePhysicsEngine::wake(RigidBody& b) {
    b.sleeping = false;
    b.sleepTimer = 0.0f;
}

inline void DicePhysicsEngine::integrate(RigidBody& b, float dt) {
    if (b.kinematic) return;
    b.velocity.y += gravity_ * dt;
    if (!noDrag_ && b.dragFactor > 0.0f) {
        const float speedSq = b.velocity.lengthSq();
        if (speedSq > 1e-6f) {
            b.velocity -= b.velocity * (b.dragFactor * speedSq * dt);
        }
    }
    const float linDamp = 1.0f - 0.05f * dt;
    b.velocity = b.velocity * linDamp;
    const float angDamp = 1.0f - 0.10f * dt;
    b.angularVelocity = b.angularVelocity * angDamp;
    b.position += b.velocity * dt;
    b.rotation = b.rotation.integrate(b.angularVelocity, dt);
}

inline void DicePhysicsEngine::resolveTableCollision(RigidBody& b, float dt) {
    (void)dt;
    if (b.kinematic) return;
    const float floorY = tableY_ + b.radius;

    if (b.useHull && !b.hull.verts.empty()) {
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
                    float denom = b.invMass + Vec3::dot(Vec3::cross(r, tableN), b.applyInvInertiaWorld(Vec3::cross(r, tableN)));
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
                events_.push_back(makeEvent(
                    b,
                    -1,
                    impactSpeed,
                    preImpactLinearSpeedSq,
                    preImpactAngularSpeedSq,
                    0,
                    TABLE_MATERIAL_TAG
                ));
            }
        }
    } else {
        if (b.position.y < floorY) {
            const float impactSpeed = std::max(0.0f, -b.velocity.y);
            const float preImpactLinearSpeedSq = b.velocity.lengthSq();
            const float preImpactAngularSpeedSq = b.angularVelocity.lengthSq();
            b.position.y = floorY;
            if (b.velocity.y < 0.0f) {
                b.velocity.y = -b.velocity.y * b.restitution;
                const float rollFric = std::max(0.0f, 1.0f - b.rollingFriction);
                b.velocity.x *= rollFric;
                b.velocity.z *= rollFric;
                b.angularVelocity = b.angularVelocity * rollFric;
            }
            if (impactSpeed > 1.0f &&
                events_.size() < static_cast<size_t>(MAX_EVENTS_PER_STEP)) {
                events_.push_back(makeEvent(
                    b,
                    -1,
                    impactSpeed,
                    preImpactLinearSpeedSq,
                    preImpactAngularSpeedSq,
                    0,
                    TABLE_MATERIAL_TAG
                ));
            }
        }
    }

    const float wx = tableHalfW_ - b.radius;
    const float wz = tableHalfD_ - b.radius;
    if (b.position.x >  wx) { b.position.x =  wx; b.velocity.x = -b.velocity.x * b.restitution; }
    if (b.position.x < -wx) { b.position.x = -wx; b.velocity.x = -b.velocity.x * b.restitution; }
    if (b.position.z >  wz) { b.position.z =  wz; b.velocity.z = -b.velocity.z * b.restitution; }
    if (b.position.z < -wz) { b.position.z = -wz; b.velocity.z = -b.velocity.z * b.restitution; }
}

inline void DicePhysicsEngine::checkSleep(RigidBody& b, float dt) const {
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

} // namespace dice_physics
