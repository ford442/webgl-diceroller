/**
 * dice_engine_collision_dynamic.cpp — Die-vs-die broadphase (uniform grid),
 * narrowphase SAT/sphere contact generation, and the contact solver.
 */

#include "../dice_physics_engine.hpp"

#include <algorithm>
#include <cmath>
#include <set>

namespace dice_physics {

void DicePhysicsEngine::ensureDieGridDimensions() {
    if (gridCols_ > 0) return;
    gridOriginX_ = -tableHalfW_ - GRID_CELL_SIZE;
    gridOriginZ_ = -tableHalfD_ - GRID_CELL_SIZE;
    const float extentX = 2.0f * tableHalfW_ + 2.0f * GRID_CELL_SIZE;
    const float extentZ = 2.0f * tableHalfD_ + 2.0f * GRID_CELL_SIZE;
    gridCols_ = std::max(1, static_cast<int>(std::ceil(extentX / GRID_CELL_SIZE)));
    gridRows_ = std::max(1, static_cast<int>(std::ceil(extentZ / GRID_CELL_SIZE)));
}

int DicePhysicsEngine::bodyCellXMin(float x, float radius) const {
    const float rel = x - radius - gridOriginX_;
    const int c = static_cast<int>(std::floor(rel / GRID_CELL_SIZE));
    return std::clamp(c, 0, gridCols_ - 1);
}

int DicePhysicsEngine::bodyCellXMax(float x, float radius) const {
    const float rel = x + radius - gridOriginX_;
    const int c = static_cast<int>(std::floor(rel / GRID_CELL_SIZE));
    return std::clamp(c, 0, gridCols_ - 1);
}

int DicePhysicsEngine::bodyCellZMin(float z, float radius) const {
    const float rel = z - radius - gridOriginZ_;
    const int c = static_cast<int>(std::floor(rel / GRID_CELL_SIZE));
    return std::clamp(c, 0, gridRows_ - 1);
}

int DicePhysicsEngine::bodyCellZMax(float z, float radius) const {
    const float rel = z + radius - gridOriginZ_;
    const int c = static_cast<int>(std::floor(rel / GRID_CELL_SIZE));
    return std::clamp(c, 0, gridRows_ - 1);
}

void DicePhysicsEngine::rebuildDieGrid() {
    ensureDieGridDimensions();
    const size_t cellCount = static_cast<size_t>(gridCols_ * gridRows_);
    if (dieGridCells_.size() != cellCount) {
        dieGridCells_.assign(cellCount, {});
    } else {
        for (auto& cell : dieGridCells_) {
            cell.clear();
        }
    }

    for (size_t i = 0; i < bodies_.size(); ++i) {
        const auto& b = bodies_[i];
        const int minCx = bodyCellXMin(b.position.x, b.radius);
        const int maxCx = bodyCellXMax(b.position.x, b.radius);
        const int minCz = bodyCellZMin(b.position.z, b.radius);
        const int maxCz = bodyCellZMax(b.position.z, b.radius);
        for (int cz = minCz; cz <= maxCz; ++cz) {
            for (int cx = minCx; cx <= maxCx; ++cx) {
                dieGridCells_[static_cast<size_t>(cz * gridCols_ + cx)].push_back(i);
            }
        }
    }
}

void DicePhysicsEngine::forEachDiePair(const std::function<void(size_t, size_t)>& fn) {
    if (!useBroadphase_ || bodies_.size() < 2) {
        for (size_t i = 0; i < bodies_.size(); ++i) {
            for (size_t j = i + 1; j < bodies_.size(); ++j) {
                fn(i, j);
            }
        }
        return;
    }

    rebuildDieGrid();
    for (int cz = 0; cz < gridRows_; ++cz) {
        for (int cx = 0; cx < gridCols_; ++cx) {
            const auto& cell = dieGridCells_[static_cast<size_t>(cz * gridCols_ + cx)];

            for (size_t ai = 0; ai < cell.size(); ++ai) {
                for (size_t bi = ai + 1; bi < cell.size(); ++bi) {
                    fn(cell[ai], cell[bi]);
                }
            }

            for (int dz = 0; dz <= 1; ++dz) {
                const int dxStart = dz == 0 ? 1 : -1;
                for (int dx = dxStart; dx <= 1; ++dx) {
                    if (dx == 0 && dz == 0) continue;
                    const int nx = cx + dx;
                    const int nz = cz + dz;
                    if (nx < 0 || nx >= gridCols_ || nz < 0 || nz >= gridRows_) continue;
                    if (nz < cz || (nz == cz && nx <= cx)) continue;

                    const auto& neighbor =
                        dieGridCells_[static_cast<size_t>(nz * gridCols_ + nx)];
                    for (size_t a : cell) {
                        for (size_t b : neighbor) {
                            if (a < b) {
                                fn(a, b);
                            } else if (b < a) {
                                fn(b, a);
                            }
                        }
                    }
                }
            }
        }
    }
}

void DicePhysicsEngine::processDiePair(size_t i, size_t j, StepStats& stats) {
    auto& a = bodies_[i];
    auto& b = bodies_[j];
    stats.pairCandidates++;
    if (a.kinematic && b.kinematic) return;
    if (a.sleeping && b.sleeping) return;

    Vec3 delta = b.position - a.position;
    float distSq = delta.lengthSq();
    float combinedR = a.radius + b.radius;
    if (distSq >= combinedR * combinedR) return;

    stats.sphereTests++;
    wake(a);
    wake(b);

    Contact c;
    c.a = static_cast<int>(i);
    c.b = static_cast<int>(j);
    bool hit = false;

    if (a.useHull && b.useHull) {
        stats.satTests++;
        hit = satTest(a.hull, a.position, a.rotation,
                      b.hull, b.position, b.rotation,
                      c.normal, c.penetration, c.point);
    } else {
        sphereContact(a, b, c.normal, c.penetration, c.point);
        hit = c.penetration > 0;
    }

    if (!hit) return;

    Vec3 relVel = b.velocity - a.velocity;
    float speed = std::abs(Vec3::dot(relVel, c.normal));
    if (speed > 0.5f && events_.size() < static_cast<size_t>(MAX_EVENTS_PER_STEP)) {
        const float energyA = 0.5f * a.mass * a.velocity.lengthSq() +
                              0.5f * inertiaScalar(a) * a.angularVelocity.lengthSq();
        const float energyB = 0.5f * b.mass * b.velocity.lengthSq() +
                              0.5f * inertiaScalar(b) * b.angularVelocity.lengthSq();
        events_.push_back(energyA >= energyB ? makeEvent(a, b.id, speed)
                                             : makeEvent(b, a.id, speed));
    }

    contacts_.push_back(c);
}

void DicePhysicsEngine::resolveDieCollisions(float /*dt*/, StepStats& stats) {
    contacts_.clear();
    const float POSITION_SLOP = 0.001f;

    std::set<std::pair<size_t, size_t>> pairSet;
    forEachDiePair([&](size_t i, size_t j) { pairSet.insert({i, j}); });
    for (const auto& [i, j] : pairSet) {
        processDiePair(i, j, stats);
    }

    stats.contacts = static_cast<uint32_t>(contacts_.size());

    const int ITERATIONS = 4;
    for (int iter = 0; iter < ITERATIONS; ++iter) {
        for (auto& c : contacts_) {
            auto& a = bodies_[c.a];
            auto& b = bodies_[c.b];
            Vec3 rA = c.point - a.position;
            Vec3 rB = c.point - b.position;
            Vec3 relVel = (b.velocity + Vec3::cross(b.angularVelocity, rB))
                        - (a.velocity + Vec3::cross(a.angularVelocity, rA));
            float velN = Vec3::dot(relVel, c.normal);
            if (velN > 0.0f) continue;

            const float invMassA = a.kinematic ? 0.0f : a.invMass;
            const float invMassB = b.kinematic ? 0.0f : b.invMass;
            float denom = invMassA + invMassB;
            Vec3 raCrossN = Vec3::cross(rA, c.normal);
            Vec3 rbCrossN = Vec3::cross(rB, c.normal);
            if (!a.kinematic) denom += Vec3::dot(raCrossN, a.applyInvInertiaWorld(raCrossN));
            if (!b.kinematic) denom += Vec3::dot(rbCrossN, b.applyInvInertiaWorld(rbCrossN));
            if (denom < 1e-6f) continue;

            float rest = std::min(a.restitution, b.restitution);
            float j = -(1.0f + rest) * velN / denom;
            float jOld = c.normalImpulse;
            c.normalImpulse = std::max(jOld + j, 0.0f);
            float jApplied = c.normalImpulse - jOld;

            Vec3 impulse = c.normal * jApplied;
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
                float jt = -velT / denom;
                float mu = std::sqrt(a.friction * b.friction);
                float maxFriction = c.normalImpulse * mu;
                float jtOld = c.frictionImpulse;
                c.frictionImpulse = std::clamp(jtOld + jt, -maxFriction, maxFriction);
                float jtApplied = c.frictionImpulse - jtOld;
                Vec3 fImpulse = tangent * jtApplied;
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
    }

    for (auto& c : contacts_) {
        if (c.penetration <= POSITION_SLOP) continue;
        auto& a = bodies_[c.a];
        auto& b = bodies_[c.b];
        const float invMassA = a.kinematic ? 0.0f : a.invMass;
        const float invMassB = b.kinematic ? 0.0f : b.invMass;
        const float invSum = invMassA + invMassB;
        if (invSum < 1e-6f) continue;
        float corrMag = (c.penetration - POSITION_SLOP) * 0.6f / invSum;
        Vec3 corr = c.normal * corrMag;
        if (!a.kinematic) a.position -= corr * invMassA;
        if (!b.kinematic) b.position += corr * invMassB;
    }
}

} // namespace dice_physics
