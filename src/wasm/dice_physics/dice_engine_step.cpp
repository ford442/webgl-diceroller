/**
 * dice_engine_step.cpp — DicePhysicsEngine::step, transform/event buffer
 * builders, serialization, and fuzz/invariant test helpers.
 */

#include "../dice_physics_engine.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <set>

namespace dice_physics {

void DicePhysicsEngine::step(float dt) {
    lastStepStats_ = {};
    const int SUB_STEPS = 4;
    const float subDt = dt / static_cast<float>(SUB_STEPS);

    for (int s = 0; s < SUB_STEPS; ++s) {
        StepStats subStats{};
        for (auto& b : bodies_) {
            if (b.sleeping) continue;
            integrate(b, subDt);
        }
        for (auto& d : dynamics_) {
            if (d.sleeping) continue;
            integrateDynamic(d, subDt);
        }
        for (auto& b : bodies_) refreshDieDerived(b);
        for (auto& d : dynamics_) refreshDynamicDerived(d);
        generateContacts(subDt, subStats);
        solveContacts(subDt);
        updateIslandSleep(subDt);
        auto clampToTable = [&](auto& b) {
            if (b.kinematic) return;
            const float wx = tableHalfW_ - 0.02f;
            const float wz = tableHalfD_ - 0.02f;
            if (b.position.x >  wx) { b.position.x =  wx; if (b.velocity.x > 0.0f) b.velocity.x = 0.0f; }
            if (b.position.x < -wx) { b.position.x = -wx; if (b.velocity.x < 0.0f) b.velocity.x = 0.0f; }
            if (b.position.z >  wz) { b.position.z =  wz; if (b.velocity.z > 0.0f) b.velocity.z = 0.0f; }
            if (b.position.z < -wz) { b.position.z = -wz; if (b.velocity.z < 0.0f) b.velocity.z = 0.0f; }
            if (b.position.y < tableY_ - 1.0f) {
                b.position.y = tableY_ + b.radius;
                if (b.velocity.y < 0.0f) b.velocity.y = 0.0f;
            }
            if (b.position.y > tableY_ + 40.0f) {
                b.position.y = tableY_ + 40.0f;
                if (b.velocity.y > 0.0f) b.velocity.y = 0.0f;
            }
        };
        for (auto& b : bodies_) clampToTable(b);
        for (auto& d : dynamics_) clampToTable(d);
        lastStepStats_.pairCandidates += subStats.pairCandidates;
        lastStepStats_.sphereTests += subStats.sphereTests;
        lastStepStats_.satTests += subStats.satTests;
        lastStepStats_.contacts += subStats.contacts;
    }
}

int DicePhysicsEngine::getDieCount() const { return static_cast<int>(bodies_.size()); }

const StepStats& DicePhysicsEngine::getLastStepStats() const { return lastStepStats_; }

uint32_t DicePhysicsEngine::getStaticCapacityDroppedCount() const { return staticCapacityDroppedCount_; }

void DicePhysicsEngine::setBroadphaseForTesting(bool enabled) { useBroadphase_ = enabled; }

std::vector<std::pair<size_t, size_t>> DicePhysicsEngine::collectDiePairsForTesting(bool useBroadphase) {
    const bool saved = useBroadphase_;
    useBroadphase_ = useBroadphase;
    std::set<std::pair<size_t, size_t>> pairSet;
    forEachDiePair([&](size_t i, size_t j) { pairSet.insert({i, j}); });
    useBroadphase_ = saved;
    return {pairSet.begin(), pairSet.end()};
}

std::vector<std::pair<size_t, size_t>> DicePhysicsEngine::collectDieDynamicPairsForTesting(bool useBroadphase) {
    const bool saved = useBroadphase_;
    useBroadphase_ = useBroadphase;
    std::set<std::pair<size_t, size_t>> pairSet;
    forEachDieDynamicPair([&](size_t di, size_t pi) { pairSet.insert({di, pi}); });
    useBroadphase_ = saved;
    return {pairSet.begin(), pairSet.end()};
}

std::vector<std::pair<size_t, size_t>> DicePhysicsEngine::collectDynamicPairsForTesting(bool useBroadphase) {
    const bool saved = useBroadphase_;
    useBroadphase_ = useBroadphase;
    std::set<std::pair<size_t, size_t>> pairSet;
    forEachDynamicPair([&](size_t i, size_t j) { pairSet.insert({i, j}); });
    useBroadphase_ = saved;
    return {pairSet.begin(), pairSet.end()};
}

bool DicePhysicsEngine::areAllSettled() const {
    // Explicit: an empty engine has no roll to finish.
    if (!hasDice()) return false;
    for (const auto& b : bodies_) {
        if (b.kinematic) continue;
        if (!b.sleeping) return false;
    }
    return true;
}

const std::vector<float>& DicePhysicsEngine::buildTransformBuffer() {
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

const std::vector<float>& DicePhysicsEngine::buildDieIdBuffer() {
    idBuffer_.clear();
    idBuffer_.reserve(bodies_.size());
    for (const auto& b : bodies_) {
        idBuffer_.push_back(static_cast<float>(b.id));
    }
    return idBuffer_;
}

const std::vector<float>& DicePhysicsEngine::buildCollisionEventBuffer() {
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

void DicePhysicsEngine::seedRNG(uint64_t s) { rng_.seed(s); }
float DicePhysicsEngine::randomFloat() { return rng_.nextFloat(); }

std::vector<uint8_t> DicePhysicsEngine::serializeState() const {
    std::vector<uint8_t> out;
    auto append = [&](const void* ptr, size_t len) {
        const uint8_t* p = static_cast<const uint8_t*>(ptr);
        out.insert(out.end(), p, p + len);
    };
    uint32_t version = 3;
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

    // Dynamic (non-die) props, added in version 2. Box shapes round-trip
    // fully (halfExtents rebuilds the hull on load); Hull shapes restore
    // kinematic fields only — callers must re-attach hull geometry after
    // deserialize, the same limitation die hulls already have above.
    uint32_t dynCount = static_cast<uint32_t>(dynamics_.size());
    append(&dynCount, sizeof(dynCount));
    for (const auto& d : dynamics_) {
        append(&d.userId, sizeof(d.userId));
        const uint8_t shape = static_cast<uint8_t>(d.shape);
        append(&shape, sizeof(shape));
        append(&d.materialTag, sizeof(d.materialTag));
        append(&d.position, sizeof(d.position));
        append(&d.velocity, sizeof(d.velocity));
        append(&d.rotation, sizeof(d.rotation));
        append(&d.angularVelocity, sizeof(d.angularVelocity));
        append(&d.sleeping, sizeof(d.sleeping));
        append(&d.sleepTimer, sizeof(d.sleepTimer));
        append(&d.kinematic, sizeof(d.kinematic));
        append(&d.mass, sizeof(d.mass));
        append(&d.halfExtents, sizeof(d.halfExtents));
    }

    uint32_t manCount = static_cast<uint32_t>(manifolds_.size());
    append(&manCount, sizeof(manCount));
    for (const auto& m : manifolds_) {
        const uint8_t kind = static_cast<uint8_t>(m.kind);
        append(&kind, sizeof(kind));
        append(&m.idA, sizeof(m.idA));
        append(&m.idB, sizeof(m.idB));
        append(&m.aux, sizeof(m.aux));
        append(&m.normal, sizeof(m.normal));
        append(&m.friction, sizeof(m.friction));
        append(&m.restitution, sizeof(m.restitution));
        const uint8_t pc = static_cast<uint8_t>(m.pointCount);
        append(&pc, sizeof(pc));
        for (uint8_t i = 0; i < pc; ++i) {
            append(&m.points[i].point, sizeof(m.points[i].point));
            append(&m.points[i].separation, sizeof(m.points[i].separation));
            append(&m.points[i].featureId, sizeof(m.points[i].featureId));
            append(&m.points[i].accN, sizeof(m.points[i].accN));
            append(&m.points[i].accT1, sizeof(m.points[i].accT1));
            append(&m.points[i].accT2, sizeof(m.points[i].accT2));
            append(&m.points[i].velBias, sizeof(m.points[i].velBias));
        }
    }
    return out;
}

void DicePhysicsEngine::deserializeState(const std::vector<uint8_t>& data) {
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
    if (version != 1 && version != 2 && version != 3) return;
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

    dynamics_.clear();
    if (version >= 2) {
        uint32_t dynCount = 0;
        if (read(&dynCount, sizeof(dynCount))) {
            dynamics_.reserve(dynCount);
            for (uint32_t i = 0; i < dynCount; ++i) {
                DynamicBody d;
                uint8_t shape = 0;
                Vec3 halfExtents{};
                if (!read(&d.userId, sizeof(d.userId))) break;
                if (!read(&shape, sizeof(shape))) break;
                if (!read(&d.materialTag, sizeof(d.materialTag))) break;
                if (!read(&d.position, sizeof(d.position))) break;
                if (!read(&d.velocity, sizeof(d.velocity))) break;
                if (!read(&d.rotation, sizeof(d.rotation))) break;
                if (!read(&d.angularVelocity, sizeof(d.angularVelocity))) break;
                if (!read(&d.sleeping, sizeof(d.sleeping))) break;
                if (!read(&d.sleepTimer, sizeof(d.sleepTimer))) break;
                if (!read(&d.kinematic, sizeof(d.kinematic))) break;
                if (!read(&d.mass, sizeof(d.mass))) break;
                if (!read(&halfExtents, sizeof(halfExtents))) break;
                d.shape = static_cast<DynamicShapeType>(shape);
                d.halfExtents = halfExtents;
                d.invMass = d.mass > 0.0f ? 1.0f / d.mass : 0.0f;
                if (d.shape == DynamicShapeType::Box) {
                    const float hx = halfExtents.x, hy = halfExtents.y, hz = halfExtents.z;
                    d.hull.build({
                        {-hx, -hy, -hz}, { hx, -hy, -hz}, { hx,  hy, -hz}, {-hx,  hy, -hz},
                        {-hx, -hy,  hz}, { hx, -hy,  hz}, { hx,  hy,  hz}, {-hx,  hy,  hz},
                    });
                    d.radius = Vec3{hx, hy, hz}.length();
                } else {
                    // Hull geometry is not serialized (same gap as die hulls);
                    // caller must re-attach it before this body can collide.
                    d.radius = 1.0f;
                }
                d.computeInertiaFromHull();
                dynamics_.push_back(d);
            }
        }
    }

    manifolds_.clear();
    if (version >= 3) {
        uint32_t manCount = 0;
        if (read(&manCount, sizeof(manCount))) {
            manifolds_.reserve(manCount);
            for (uint32_t i = 0; i < manCount; ++i) {
                ContactManifold m;
                uint8_t kind = 0;
                uint8_t pc = 0;
                if (!read(&kind, sizeof(kind))) break;
                if (!read(&m.idA, sizeof(m.idA))) break;
                if (!read(&m.idB, sizeof(m.idB))) break;
                if (!read(&m.aux, sizeof(m.aux))) break;
                if (!read(&m.normal, sizeof(m.normal))) break;
                if (!read(&m.friction, sizeof(m.friction))) break;
                if (!read(&m.restitution, sizeof(m.restitution))) break;
                if (!read(&pc, sizeof(pc))) break;
                m.kind = static_cast<ManifoldKind>(kind);
                m.pointCount = std::min(static_cast<int>(pc), MAX_MANIFOLD_POINTS);
                tangentBasis(m.normal, m.tangent1, m.tangent2);
                m.stale = false;
                for (int p = 0; p < m.pointCount; ++p) {
                    if (!read(&m.points[p].point, sizeof(m.points[p].point))) break;
                    if (!read(&m.points[p].separation, sizeof(m.points[p].separation))) break;
                    if (!read(&m.points[p].featureId, sizeof(m.points[p].featureId))) break;
                    if (!read(&m.points[p].accN, sizeof(m.points[p].accN))) break;
                    if (!read(&m.points[p].accT1, sizeof(m.points[p].accT1))) break;
                    if (!read(&m.points[p].accT2, sizeof(m.points[p].accT2))) break;
                    if (!read(&m.points[p].velBias, sizeof(m.points[p].velBias))) break;
                }
                m.indexA = -1;
                m.indexB = -1;
                switch (m.kind) {
                    case ManifoldKind::DieDie:
                        for (size_t bi = 0; bi < bodies_.size(); ++bi) {
                            if (bodies_[bi].id == m.idA) m.indexA = static_cast<int>(bi);
                            if (bodies_[bi].id == m.idB) m.indexB = static_cast<int>(bi);
                        }
                        break;
                    case ManifoldKind::DieDynamic:
                        for (size_t bi = 0; bi < bodies_.size(); ++bi) {
                            if (bodies_[bi].id == m.idA) m.indexA = static_cast<int>(bi);
                        }
                        for (size_t di = 0; di < dynamics_.size(); ++di) {
                            if (dynamics_[di].userId == m.idB) m.indexB = static_cast<int>(di);
                        }
                        break;
                    case ManifoldKind::DynamicDynamic:
                        for (size_t di = 0; di < dynamics_.size(); ++di) {
                            if (dynamics_[di].userId == m.idA) m.indexA = static_cast<int>(di);
                            if (dynamics_[di].userId == m.idB) m.indexB = static_cast<int>(di);
                        }
                        break;
                    case ManifoldKind::DieStatic:
                    case ManifoldKind::DieTable:
                    case ManifoldKind::DieWall:
                    case ManifoldKind::DieContainer:
                        for (size_t bi = 0; bi < bodies_.size(); ++bi) {
                            if (bodies_[bi].id == m.idA) m.indexA = static_cast<int>(bi);
                        }
                        break;
                    case ManifoldKind::DynamicStatic:
                    case ManifoldKind::DynamicTable:
                    case ManifoldKind::DynamicWall:
                    case ManifoldKind::DynamicContainer:
                        for (size_t di = 0; di < dynamics_.size(); ++di) {
                            if (dynamics_[di].userId == m.idA) m.indexA = static_cast<int>(di);
                        }
                        break;
                }
                manifolds_.push_back(m);
            }
        }
    }
}

uint64_t DicePhysicsEngine::hashSerializedState() const {
    const auto bytes = serializeState();
    return fnv1a64(bytes.data(), bytes.size());
}

float DicePhysicsEngine::maxTablePenetration() const {
    float maxPen = 0.0f;
    for (const auto& b : bodies_) {
        if (b.useHull && !b.worldVerts.empty()) {
            for (const auto& v : b.worldVerts) {
                maxPen = std::max(maxPen, tableY_ - v.y);
            }
        } else if (b.useHull && !b.hull.verts.empty()) {
            for (const auto& v : b.hull.verts) {
                Vec3 wv = b.rotation.rotate(v) + b.position;
                maxPen = std::max(maxPen, tableY_ - wv.y);
            }
        } else {
            maxPen = std::max(maxPen, (tableY_ + b.radius) - b.position.y);
        }
    }
    return maxPen;
}

bool DicePhysicsEngine::allBodyStatesFinite() const {
    for (const auto& b : bodies_) {
        auto bad = [](float v) { return !std::isfinite(v); };
        if (bad(b.position.x) || bad(b.position.y) || bad(b.position.z)) return false;
        if (bad(b.velocity.x) || bad(b.velocity.y) || bad(b.velocity.z)) return false;
        if (bad(b.angularVelocity.x) || bad(b.angularVelocity.y) || bad(b.angularVelocity.z)) return false;
        if (bad(b.rotation.x) || bad(b.rotation.y) || bad(b.rotation.z) || bad(b.rotation.w)) return false;
    }
    return true;
}

bool DicePhysicsEngine::allRotationsUnitLength(float eps) const {
    for (const auto& b : bodies_) {
        float lenSq = b.rotation.x*b.rotation.x + b.rotation.y*b.rotation.y
                      + b.rotation.z*b.rotation.z + b.rotation.w*b.rotation.w;
        if (std::abs(lenSq - 1.0f) > eps) return false;
    }
    return true;
}

bool DicePhysicsEngine::allBodyStatesInWorldBounds(float margin) const {
    auto inBounds = [&](const Vec3& p, float radius) {
        const float wx = tableHalfW_ + radius + margin;
        const float wz = tableHalfD_ + radius + margin;
        const float minY = tableY_ - margin;
        const float maxY = tableY_ + 80.0f + margin;
        if (p.x < -wx || p.x > wx) return false;
        if (p.z < -wz || p.z > wz) return false;
        if (p.y < minY || p.y > maxY) return false;
        return true;
    };
    for (const auto& b : bodies_) {
        if (!inBounds(b.position, b.radius)) return false;
    }
    for (const auto& d : dynamics_) {
        if (!inBounds(d.position, d.radius)) return false;
    }
    return true;
}

float DicePhysicsEngine::totalKineticEnergy() const {
    float total = 0.0f;
    for (const auto& b : bodies_) {
        if (b.kinematic) continue;
        total += 0.5f * b.mass * b.velocity.lengthSq()
              + 0.5f * inertiaScalar(b) * b.angularVelocity.lengthSq();
    }
    return total;
}

bool DicePhysicsEngine::getDiePosition(int id, float& x, float& y, float& z) const {
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
