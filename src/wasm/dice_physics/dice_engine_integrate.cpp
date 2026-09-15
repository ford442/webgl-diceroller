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
