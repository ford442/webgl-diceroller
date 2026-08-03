/**
 * dice_engine_lifecycle.hpp — DicePhysicsEngine construction, per-die setters,
 * and static-collider registration.
 *
 * Part of the dice_physics_engine module split; included by
 * dice_physics_engine.hpp after the class declaration.
 */

#pragma once

#include <algorithm>
#include <cmath>

namespace dice_physics {

inline DicePhysicsEngine::DicePhysicsEngine()
    : gravity_(-15.0f), tableY_(-2.75f), tableHalfW_(18.0f), tableHalfD_(18.0f), nextId_(0) {}

inline void DicePhysicsEngine::setFlags(uint32_t flags) {
    noDrag_ = (flags & FLAG_NO_DRAG) != 0;
}

inline void DicePhysicsEngine::init(float gravity, float tableY, float tableHalfW, float tableHalfD) {
    gravity_ = gravity; tableY_ = tableY;
    tableHalfW_ = tableHalfW; tableHalfD_ = tableHalfD;
    bodies_.clear(); contacts_.clear(); events_.clear();
    statics_.clear();
    nextId_ = 0;
    gridCols_ = 0;
    gridRows_ = 0;
    dieGridCells_.clear();
    lastStepStats_ = {};
}

inline void DicePhysicsEngine::reset() {
    bodies_.clear(); contacts_.clear(); events_.clear(); statics_.clear(); nextId_ = 0;
}

inline int DicePhysicsEngine::addDie(int sides, float x, float y, float z) {
    if (bodies_.size() >= static_cast<size_t>(MAX_DICE)) return -1;
    if (std::isnan(x) || std::isnan(y) || std::isnan(z)) return -1;
    RigidBody b;
    b.id = nextId_++;
    b.sides = sides;
    b.position = {x, y, z};
    b.rotation = {0,0,0,1};
    b.radius = radiusForSides(sides);
    b.mass = 5.0f;
    b.invMass = 1.0f / b.mass;
    b.computeInertiaFromHull();
    bodies_.push_back(b);
    return b.id;
}

inline void DicePhysicsEngine::removeDie(int id) {
    bodies_.erase(
        std::remove_if(bodies_.begin(), bodies_.end(),
            [id](const RigidBody& b) { return b.id == id; }),
        bodies_.end());
}

inline void DicePhysicsEngine::clearAllDice() { bodies_.clear(); contacts_.clear(); events_.clear(); }

inline void DicePhysicsEngine::setDieMaterial(int id, float friction, float rollingFriction) {
    for (auto& b : bodies_) {
        if (b.id != id) continue;
        b.friction = std::clamp(friction, 0.0f, 2.0f);
        b.rollingFriction = std::clamp(rollingFriction, 0.0f, 1.0f);
        break;
    }
}

inline void DicePhysicsEngine::setDieDrag(int id, float dragFactor) {
    for (auto& b : bodies_) {
        if (b.id != id) continue;
        b.dragFactor = std::max(0.0f, dragFactor);
        break;
    }
}

inline void DicePhysicsEngine::setDieHull(int id, const std::vector<float>& flatVerts) {
    if (flatVerts.size() % 3 != 0) return;
    if (flatVerts.size() / 3 > MAX_VERTICES_PER_HULL) return;
    for (auto& b : bodies_) {
        if (b.id != id) continue;
        std::vector<Vec3> verts;
        verts.reserve(flatVerts.size() / 3);
        for (size_t i = 0; i < flatVerts.size(); i += 3) {
            float vx = flatVerts[i], vy = flatVerts[i+1], vz = flatVerts[i+2];
            if (std::isnan(vx) || std::isnan(vy) || std::isnan(vz)) continue;
            verts.push_back({vx, vy, vz});
        }
        b.hull.build(verts);
        b.useHull = true;
        b.computeInertiaFromHull();
        break;
    }
}

inline void DicePhysicsEngine::applyImpulse(int id, float fx, float fy, float fz) {
    for (auto& b : bodies_) {
        if (b.id != id) continue;
        b.velocity += Vec3{fx, fy, fz} * b.invMass;
        wake(b);
        break;
    }
}

inline void DicePhysicsEngine::applyTorqueImpulse(int id, float tx, float ty, float tz) {
    for (auto& b : bodies_) {
        if (b.id != id) continue;
        b.angularVelocity += b.applyInvInertiaWorld(Vec3{tx, ty, tz});
        wake(b);
        break;
    }
}

inline void DicePhysicsEngine::setDieTransform(int id, float px, float py, float pz,
                     float qx, float qy, float qz, float qw) {
    for (auto& b : bodies_) {
        if (b.id != id) continue;
        b.position = {px, py, pz};
        b.rotation = Quat{qx, qy, qz, qw}.normalized();
        b.velocity = {};
        b.angularVelocity = {};
        wake(b);
        break;
    }
}

inline void DicePhysicsEngine::setDieVelocity(int id, float lvx, float lvy, float lvz,
                    float avx, float avy, float avz) {
    for (auto& b : bodies_) {
        if (b.id != id) continue;
        b.velocity = {lvx, lvy, lvz};
        b.angularVelocity = {avx, avy, avz};
        wake(b);
        break;
    }
}

inline void DicePhysicsEngine::setDieKinematic(int id, bool kinematic) {
    for (auto& b : bodies_) {
        if (b.id != id) continue;
        b.kinematic = kinematic;
        if (kinematic) {
            b.velocity = {};
            b.angularVelocity = {};
            b.sleeping = false;
            b.sleepTimer = 0.0f;
        } else {
            wake(b);
        }
        break;
    }
}

inline void DicePhysicsEngine::setContainerActive(bool active) { containerActive_ = active; }

inline void DicePhysicsEngine::setContainerPlanes(const std::vector<float>& flat) {
    containerPlanes_.clear();
    if (flat.size() % 4 != 0) return;
    const size_t count = std::min(flat.size() / 4, static_cast<size_t>(MAX_CONTAINER_PLANES));
    containerPlanes_.reserve(count);
    for (size_t i = 0; i < count; ++i) {
        Vec3 n{flat[i * 4], flat[i * 4 + 1], flat[i * 4 + 2]};
        const float len = n.length();
        if (len < 1e-6f) continue;
        n = n * (1.0f / len);
        containerPlanes_.push_back({n, flat[i * 4 + 3]});
    }
}

inline void DicePhysicsEngine::clearStatics() { statics_.clear(); }

inline bool DicePhysicsEngine::removeStatic(int userId) {
    const size_t before = statics_.size();
    statics_.erase(
        std::remove_if(statics_.begin(), statics_.end(),
            [userId](const StaticBody& s) { return s.userId == userId; }),
        statics_.end());
    return statics_.size() < before;
}

inline int DicePhysicsEngine::addStaticBox(int userId,
                 float cx, float cy, float cz,
                 float hx, float hy, float hz,
                 float qx, float qy, float qz, float qw,
                 int materialTag) {
    if (userId < 0 || statics_.size() >= static_cast<size_t>(MAX_STATICS)) return -1;
    for (const auto& s : statics_) if (s.userId == userId) return -1;
    if (hx <= 0.0f || hy <= 0.0f || hz <= 0.0f) return -1;

    StaticBody body;
    body.userId = userId;
    body.shape = StaticShapeType::Box;
    body.center = {cx, cy, cz};
    body.rotation = Quat{qx, qy, qz, qw}.normalized();
    body.halfExtents = {hx, hy, hz};
    applyStaticMaterial(body, materialTag);
    body.hull.build({
        {-hx, -hy, -hz}, { hx, -hy, -hz}, { hx,  hy, -hz}, {-hx,  hy, -hz},
        {-hx, -hy,  hz}, { hx, -hy,  hz}, { hx,  hy,  hz}, {-hx,  hy,  hz},
    });
    statics_.push_back(body);
    return userId;
}

inline int DicePhysicsEngine::addStaticPlane(int userId, float nx, float ny, float nz, float dist, int materialTag) {
    if (userId < 0 || statics_.size() >= static_cast<size_t>(MAX_STATICS)) return -1;
    for (const auto& s : statics_) if (s.userId == userId) return -1;
    Vec3 n{nx, ny, nz};
    const float len = n.length();
    if (len < 1e-6f) return -1;
    n = n * (1.0f / len);

    StaticBody body;
    body.userId = userId;
    body.shape = StaticShapeType::Plane;
    body.planeNormal = n;
    body.planeDist = dist;
    applyStaticMaterial(body, materialTag);
    statics_.push_back(body);
    return userId;
}

inline int DicePhysicsEngine::addStaticConvexHull(int userId,
                        float cx, float cy, float cz,
                        float qx, float qy, float qz, float qw,
                        const std::vector<float>& flatVerts,
                        int materialTag) {
    if (userId < 0 || statics_.size() >= static_cast<size_t>(MAX_STATICS)) return -1;
    for (const auto& s : statics_) if (s.userId == userId) return -1;
    if (flatVerts.size() % 3 != 0) return -1;
    if (flatVerts.size() / 3 > MAX_VERTICES_PER_HULL) return -1;

    StaticBody body;
    body.userId = userId;
    body.shape = StaticShapeType::ConvexHull;
    body.center = {cx, cy, cz};
    body.rotation = Quat{qx, qy, qz, qw}.normalized();
    applyStaticMaterial(body, materialTag);

    std::vector<Vec3> verts;
    verts.reserve(flatVerts.size() / 3);
    for (size_t i = 0; i < flatVerts.size(); i += 3) {
        verts.push_back({flatVerts[i], flatVerts[i + 1], flatVerts[i + 2]});
    }
    body.hull.build(verts);
    if (body.hull.verts.empty()) return -1;
    statics_.push_back(body);
    return userId;
}

inline int DicePhysicsEngine::addStaticOpenCylinder(int userId,
                          float cx, float cy, float cz,
                          float radius, float halfHeight,
                          int segments, bool closedBottom,
                          int materialTag) {
    if (userId < 0 || statics_.size() >= static_cast<size_t>(MAX_STATICS)) return -1;
    for (const auto& s : statics_) if (s.userId == userId) return -1;
    if (radius <= 0.0f || halfHeight <= 0.0f) return -1;

    StaticBody body;
    body.userId = userId;
    body.shape = StaticShapeType::OpenCylinder;
    body.center = {cx, cy, cz};
    body.rotation = {0, 0, 0, 1};
    body.cylinderRadius = radius;
    body.cylinderHalfHeight = halfHeight;
    body.cylinderSegments = std::clamp(segments, 3, 32);
    body.cylinderClosedBottom = closedBottom;
    applyStaticMaterial(body, materialTag);
    statics_.push_back(body);
    return userId;
}

} // namespace dice_physics
