/**
 * dice_engine_step.hpp — DicePhysicsEngine::step, transform/event buffer
 * builders, serialization, and fuzz/invariant test helpers.
 *
 * Part of the dice_physics_engine module split; included by
 * dice_physics_engine.hpp after the class declaration.
 */

#pragma once

#include <algorithm>
#include <cmath>
#include <cstring>
#include <set>

namespace dice_physics {

inline void DicePhysicsEngine::step(float dt) {
    lastStepStats_ = {};
    const int SUB_STEPS = 4;
    const float subDt = dt / static_cast<float>(SUB_STEPS);

    for (int s = 0; s < SUB_STEPS; ++s) {
        StepStats subStats{};
        for (auto& b : bodies_) {
            if (b.sleeping) continue;
            integrate(b, subDt);
        }
        resolveDieCollisions(subDt, subStats);
        lastStepStats_.pairCandidates += subStats.pairCandidates;
        lastStepStats_.sphereTests += subStats.sphereTests;
        lastStepStats_.satTests += subStats.satTests;
        lastStepStats_.contacts += subStats.contacts;
        for (auto& b : bodies_) {
            if (b.sleeping) continue;
            resolveContainerCollisions(b, subDt);
            resolveStaticCollisions(b, subDt);
            resolveTableCollision(b, subDt);
            checkSleep(b, subDt);
        }
    }
}

inline int DicePhysicsEngine::getDieCount() const { return static_cast<int>(bodies_.size()); }

inline const StepStats& DicePhysicsEngine::getLastStepStats() const { return lastStepStats_; }

inline void DicePhysicsEngine::setBroadphaseForTesting(bool enabled) { useBroadphase_ = enabled; }

inline std::vector<std::pair<size_t, size_t>> DicePhysicsEngine::collectDiePairsForTesting(bool useBroadphase) {
    const bool saved = useBroadphase_;
    useBroadphase_ = useBroadphase;
    std::set<std::pair<size_t, size_t>> pairSet;
    forEachDiePair([&](size_t i, size_t j) { pairSet.insert({i, j}); });
    useBroadphase_ = saved;
    return {pairSet.begin(), pairSet.end()};
}

inline bool DicePhysicsEngine::areAllSettled() const {
    if (bodies_.empty()) return false;
    for (const auto& b : bodies_) {
        if (b.kinematic) continue;
        if (!b.sleeping) return false;
    }
    return true;
}

inline const std::vector<float>& DicePhysicsEngine::buildTransformBuffer() {
    transformBuffer_.clear();
    transformBuffer_.reserve(bodies_.size() * 7);
    for (const auto& b : bodies_) {
        transformBuffer_.push_back(b.position.x);
        transformBuffer_.push_back(b.position.y);
        transformBuffer_.push_back(b.position.z);
        transformBuffer_.push_back(b.rotation.x);
        transformBuffer_.push_back(b.rotation.y);
        transformBuffer_.push_back(b.rotation.z);
        transformBuffer_.push_back(b.rotation.w);
    }
    return transformBuffer_;
}

inline const std::vector<float>& DicePhysicsEngine::buildDieIdBuffer() {
    idBuffer_.clear();
    idBuffer_.reserve(bodies_.size());
    for (const auto& b : bodies_) {
        idBuffer_.push_back(static_cast<float>(b.id));
    }
    return idBuffer_;
}

inline const std::vector<float>& DicePhysicsEngine::buildCollisionEventBuffer() {
    eventBuffer_.clear();
    eventBuffer_.reserve(events_.size() * 9);
    for (const auto& e : events_) {
        eventBuffer_.push_back(static_cast<float>(e.idA));
        eventBuffer_.push_back(static_cast<float>(e.idB));
        eventBuffer_.push_back(e.impactSpeed);
        eventBuffer_.push_back(e.mass);
        eventBuffer_.push_back(e.inertiaScalar);
        eventBuffer_.push_back(e.linearSpeedSq);
        eventBuffer_.push_back(e.angularSpeedSq);
        eventBuffer_.push_back(static_cast<float>(e.staticColliderId));
        eventBuffer_.push_back(static_cast<float>(e.materialTag));
    }
    events_.clear();
    return eventBuffer_;
}

inline void DicePhysicsEngine::seedRNG(uint64_t s) { rng_.seed(s); }
inline float DicePhysicsEngine::randomFloat() { return rng_.nextFloat(); }

inline std::vector<uint8_t> DicePhysicsEngine::serializeState() const {
    std::vector<uint8_t> out;
    auto append = [&](const void* ptr, size_t len) {
        const uint8_t* p = static_cast<const uint8_t*>(ptr);
        out.insert(out.end(), p, p + len);
    };
    uint32_t version = 1;
    uint32_t count = static_cast<uint32_t>(bodies_.size());
    append(&version, sizeof(version));
    append(&count, sizeof(count));
    for (const auto& b : bodies_) {
        append(&b.id, sizeof(b.id));
        append(&b.sides, sizeof(b.sides));
        append(&b.position, sizeof(b.position));
        append(&b.velocity, sizeof(b.velocity));
        append(&b.rotation, sizeof(b.rotation));
        append(&b.angularVelocity, sizeof(b.angularVelocity));
        append(&b.sleeping, sizeof(b.sleeping));
        append(&b.sleepTimer, sizeof(b.sleepTimer));
        append(&b.useHull, sizeof(b.useHull));
    }
    return out;
}

inline void DicePhysicsEngine::deserializeState(const std::vector<uint8_t>& data) {
    if (data.size() < 8) return;
    size_t off = 0;
    auto read = [&](void* ptr, size_t len) {
        if (off + len > data.size()) return false;
        std::memcpy(ptr, data.data() + off, len);
        off += len;
        return true;
    };
    uint32_t version = 0, count = 0;
    if (!read(&version, sizeof(version))) return;
    if (version != 1) return;
    if (!read(&count, sizeof(count))) return;
    bodies_.clear(); bodies_.reserve(count);
    for (uint32_t i = 0; i < count; ++i) {
        RigidBody b;
        if (!read(&b.id, sizeof(b.id))) break;
        if (!read(&b.sides, sizeof(b.sides))) break;
        if (!read(&b.position, sizeof(b.position))) break;
        if (!read(&b.velocity, sizeof(b.velocity))) break;
        if (!read(&b.rotation, sizeof(b.rotation))) break;
        if (!read(&b.angularVelocity, sizeof(b.angularVelocity))) break;
        if (!read(&b.sleeping, sizeof(b.sleeping))) break;
        if (!read(&b.sleepTimer, sizeof(b.sleepTimer))) break;
        if (!read(&b.useHull, sizeof(b.useHull))) break;
        b.radius = radiusForSides(b.sides);
        b.mass = 5.0f;
        b.invMass = 1.0f / b.mass;
        b.computeInertiaFromHull();
        bodies_.push_back(b);
    }
    nextId_ = 0;
    for (const auto& b : bodies_) nextId_ = std::max(nextId_, b.id + 1);
}

inline bool DicePhysicsEngine::allBodyStatesFinite() const {
    for (const auto& b : bodies_) {
        auto bad = [](float v) { return !std::isfinite(v); };
        if (bad(b.position.x) || bad(b.position.y) || bad(b.position.z)) return false;
        if (bad(b.velocity.x) || bad(b.velocity.y) || bad(b.velocity.z)) return false;
        if (bad(b.angularVelocity.x) || bad(b.angularVelocity.y) || bad(b.angularVelocity.z)) return false;
        if (bad(b.rotation.x) || bad(b.rotation.y) || bad(b.rotation.z) || bad(b.rotation.w)) return false;
    }
    return true;
}

inline bool DicePhysicsEngine::allRotationsUnitLength(float eps) const {
    for (const auto& b : bodies_) {
        float lenSq = b.rotation.x*b.rotation.x + b.rotation.y*b.rotation.y
                      + b.rotation.z*b.rotation.z + b.rotation.w*b.rotation.w;
        if (std::abs(lenSq - 1.0f) > eps) return false;
    }
    return true;
}

inline bool DicePhysicsEngine::allBodyStatesInWorldBounds(float margin) const {
    for (const auto& b : bodies_) {
        const float wx = tableHalfW_ + b.radius + margin;
        const float wz = tableHalfD_ + b.radius + margin;
        const float minY = tableY_ - margin;
        // Throws from the spawn box can arc well above the table lip.
        const float maxY = tableY_ + 80.0f + margin;
        if (b.position.x < -wx || b.position.x > wx) return false;
        if (b.position.z < -wz || b.position.z > wz) return false;
        if (b.position.y < minY || b.position.y > maxY) return false;
    }
    return true;
}

inline float DicePhysicsEngine::totalKineticEnergy() const {
    float total = 0.0f;
    for (const auto& b : bodies_) {
        if (b.kinematic) continue;
        total += 0.5f * b.mass * b.velocity.lengthSq()
              + 0.5f * inertiaScalar(b) * b.angularVelocity.lengthSq();
    }
    return total;
}

inline bool DicePhysicsEngine::getDiePosition(int id, float& x, float& y, float& z) const {
    for (const auto& b : bodies_) {
        if (b.id != id) continue;
        x = b.position.x;
        y = b.position.y;
        z = b.position.z;
        return true;
    }
    return false;
}

} // namespace dice_physics
