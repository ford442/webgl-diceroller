/**
 * dice_engine_solver.cpp — Persistent manifolds, sequential-impulse velocity
 * solve with warm starting, Baumgarte position correction, speculative
 * contacts, and island sleep.
 */

#include "../dice_physics_engine.hpp"

#include <algorithm>
#include <cmath>
#include <set>
#include <vector>

namespace dice_physics {

namespace {

BodyView viewDie(RigidBody& b) {
    BodyView v;
    v.position = &b.position;
    v.velocity = &b.velocity;
    v.angularVelocity = &b.angularVelocity;
    v.rotation = &b.rotation;
    v.invMass = b.kinematic ? 0.0f : b.invMass;
    v.invInertia = b.invInertia;
    v.kinematic = b.kinematic;
    return v;
}

BodyView viewDyn(DynamicBody& b) {
    BodyView v;
    v.position = &b.position;
    v.velocity = &b.velocity;
    v.angularVelocity = &b.angularVelocity;
    v.rotation = &b.rotation;
    v.invMass = b.kinematic ? 0.0f : b.invMass;
    v.invInertia = b.invInertia;
    v.kinematic = b.kinematic;
    return v;
}

BodyView viewStatic(StaticBody& s) {
    BodyView v;
    v.position = &s.center;
    v.rotation = &s.rotation;
    v.invMass = 0.0f;
    v.kinematic = true;
    return v;
}

BodyView viewWorld(WorldAnchor& a) {
    BodyView v;
    v.position = &a.position;
    v.velocity = &a.velocity;
    v.angularVelocity = &a.angular;
    v.rotation = &a.rotation;
    v.invMass = 0.0f;
    v.kinematic = true;
    return v;
}

int collectPlanePoints(
    const std::vector<Vec3>& verts,
    const Vec3& fallbackPoint,
    float fallbackRadius,
    const Vec3& n,
    float planeD,
    float spec,
    ContactPoint* out
) {
    struct Cand {
        Vec3 p;
        float sep;
        uint32_t id;
    };
    Cand cands[64];
    int nC = 0;
    if (!verts.empty()) {
        for (size_t i = 0; i < verts.size() && nC < 64; ++i) {
            const float sep = Vec3::dot(n, verts[i]) - planeD;
            if (sep < spec) {
                cands[nC++] = {verts[i], sep, static_cast<uint32_t>(i)};
            }
        }
    } else {
        const Vec3 p = fallbackPoint - n * fallbackRadius;
        const float sep = Vec3::dot(n, fallbackPoint) - planeD - fallbackRadius;
        if (sep < spec) {
            cands[nC++] = {p, sep, 0};
        }
    }
    if (nC == 0) return 0;
    std::sort(cands, cands + nC, [](const Cand& a, const Cand& b) { return a.sep < b.sep; });
    const int take = std::min(nC, 2);
    for (int i = 0; i < take; ++i) {
        out[i].point = cands[i].p;
        out[i].separation = cands[i].sep;
        out[i].featureId = cands[i].id;
        out[i].accN = out[i].accT1 = out[i].accT2 = 0.0f;
    }
    return take;
}

bool manifoldTouchesDie(const ContactManifold& m) {
    switch (m.kind) {
        case ManifoldKind::DieDie:
        case ManifoldKind::DieStatic:
        case ManifoldKind::DieTable:
        case ManifoldKind::DieWall:
        case ManifoldKind::DieContainer:
        case ManifoldKind::DieDynamic:
            return true;
        default:
            return false;
    }
}

} // namespace

float DicePhysicsEngine::speculativeFor(const Vec3& velocity, float dt) const {
    const float speed = velocity.length();
    return std::min(SPECULATIVE_MAX, SPECULATIVE_SLOP + speed * dt);
}

void DicePhysicsEngine::refreshDieDerived(RigidBody& b) const {
    if (!b.useHull || b.hull.verts.empty()) {
        b.worldVerts.clear();
        return;
    }
    const int n = static_cast<int>(b.hull.verts.size());
    b.worldVerts.resize(static_cast<size_t>(n));
    transformHullVerts(b.hull.verts.data(), n, b.rotation, b.position, b.worldVerts.data());
}

void DicePhysicsEngine::refreshDynamicDerived(DynamicBody& b) const {
    if (b.hull.verts.empty()) {
        b.worldVerts.clear();
        return;
    }
    const int n = static_cast<int>(b.hull.verts.size());
    b.worldVerts.resize(static_cast<size_t>(n));
    transformHullVerts(b.hull.verts.data(), n, b.rotation, b.position, b.worldVerts.data());
}

ContactManifold* DicePhysicsEngine::matchManifold(ManifoldKind kind, int idA, int idB, int aux) {
    for (auto& m : manifolds_) {
        if (m.kind == kind && m.idA == idA && m.idB == idB && m.aux == aux) return &m;
    }
    if (manifolds_.size() >= 8192) return nullptr;
    ContactManifold m;
    m.kind = kind;
    m.idA = idA;
    m.idB = idB;
    m.aux = aux;
    manifolds_.push_back(m);
    return &manifolds_.back();
}

void DicePhysicsEngine::commitManifoldPoints(
    ContactManifold& m,
    ContactPoint* pts,
    int count,
    const Vec3& normal
) {
    ContactPoint old[MAX_MANIFOLD_POINTS];
    const int oldN = m.pointCount;
    for (int i = 0; i < oldN; ++i) old[i] = m.points[i];

    m.normal = normal;
    tangentBasis(normal, m.tangent1, m.tangent2);
    m.pointCount = count;
    m.stale = false;
    for (int i = 0; i < count; ++i) {
        m.points[i] = pts[i];
        for (int k = 0; k < oldN; ++k) {
            if (old[k].featureId == pts[i].featureId) {
                m.points[i].accN = old[k].accN * WARM_START_FACTOR;
                m.points[i].accT1 = old[k].accT1 * WARM_START_FACTOR;
                m.points[i].accT2 = old[k].accT2 * WARM_START_FACTOR;
                m.points[i].accN = std::clamp(m.points[i].accN, 0.0f, 40.0f);
                m.points[i].accT1 = std::clamp(m.points[i].accT1, -40.0f, 40.0f);
                m.points[i].accT2 = std::clamp(m.points[i].accT2, -40.0f, 40.0f);
                break;
            }
        }
    }
}

void DicePhysicsEngine::addPlaneContacts(
    ManifoldKind kind, int idA, int idB, int aux,
    int indexA, int indexB,
    const Vec3& normal, float planeD,
    const std::vector<Vec3>& worldVerts, const Vec3& fallbackPoint, float fallbackRadius,
    float spec, float friction, float restitution
) {
    ContactPoint pts[MAX_MANIFOLD_POINTS];
    const int nAll = collectPlanePoints(worldVerts, fallbackPoint, fallbackRadius, normal, planeD, spec, pts);
    int n = 0;
    const bool keepSpeculative = spec > SPECULATIVE_SLOP + 0.01f;
    for (int i = 0; i < nAll; ++i) {
        if (pts[i].separation <= 0.002f || keepSpeculative) {
            pts[n++] = pts[i];
        }
    }
    if (n <= 0) return;
    ContactManifold* m = matchManifold(kind, idA, idB, aux);
    if (!m) return;
    m->indexA = indexA;
    m->indexB = indexB;
    m->friction = friction;
    m->restitution = restitution;
    // Plane normals are stored as interior half-spaces (dot(n,p) >= d). The
    // sequential-impulse convention is n from A (dynamic) to B (static/world),
    // so flip for the solver while keeping collected separations.
    commitManifoldPoints(*m, pts, n, normal * -1.0f);
}

void DicePhysicsEngine::addSatContacts(
    ManifoldKind kind, int idA, int idB, int aux,
    int indexA, int indexB,
    const PolyHull& ha, const Vec3& posA, const Quat& rotA, const std::vector<Vec3>& wa,
    const PolyHull& hb, const Vec3& posB, const Quat& rotB, const std::vector<Vec3>& wb,
    float spec, float friction, float restitution, StepStats* stats
) {
    if (wa.empty() || wb.empty()) return;
    Vec3 normal, contact;
    float pen = 0.0f;
    uint32_t feature = 0;
    bool normalFromA = true;
    if (stats) stats->satTests++;
    if (!satTestFromWorld(ha, posA, rotA, wa.data(), hb, posB, rotB, wb.data(),
                          normal, pen, contact, &feature, &normalFromA, spec)) {
        return;
    }

    const std::vector<Vec3>& incident = normalFromA ? wb : wa;
    struct Cand {
        Vec3 p;
        float sep;
        uint32_t id;
    };
    Cand cands[64];
    int nC = 0;
    const float dDeep = Vec3::dot(normal, contact);
    for (size_t i = 0; i < incident.size() && nC < 64; ++i) {
        const float dV = Vec3::dot(normal, incident[i]);
        const float penV = pen - (dDeep - dV);
        const float sep = -penV;
        if (sep < spec) {
            cands[nC++] = {incident[i], sep, feature ^ (static_cast<uint32_t>(i) << 4)};
        }
    }
    if (nC == 0) {
        cands[nC++] = {contact, -pen, feature};
    }
    std::sort(cands, cands + nC, [](const Cand& a, const Cand& b) { return a.sep < b.sep; });
    const bool keepSpeculative = spec > SPECULATIVE_SLOP + 0.01f;
    const float deepestSep = cands[0].sep;
    const int maxTake = 1;
    int take = 0;
    ContactPoint pts[MAX_MANIFOLD_POINTS];
    for (int i = 0; i < maxTake; ++i) {
        if (cands[i].sep > deepestSep + 0.02f) break;
        if (cands[i].sep <= 0.004f || keepSpeculative) {
            pts[take].point = cands[i].p;
            pts[take].separation = cands[i].sep;
            pts[take].featureId = cands[i].id;
            take++;
        }
    }
    if (take <= 0) return;

    ContactManifold* m = matchManifold(kind, idA, idB, aux);
    if (!m) return;
    m->indexA = indexA;
    m->indexB = indexB;
    m->friction = friction;
    m->restitution = restitution;
    if (kind == ManifoldKind::DieStatic || kind == ManifoldKind::DynamicStatic) {
        m->friction = std::min(friction, 0.25f);
    }
    commitManifoldPoints(*m, pts, take, normal);
}

void DicePhysicsEngine::rebuildDieGrid(float expand) {
    ensureDieGridDimensions();
    const size_t cellCount = static_cast<size_t>(gridCols_ * gridRows_);
    if (dieGridCells_.size() != cellCount) {
        dieGridCells_.assign(cellCount, {});
    } else {
        for (auto& cell : dieGridCells_) cell.clear();
    }

    for (size_t i = 0; i < bodies_.size(); ++i) {
        const auto& b = bodies_[i];
        const float r = b.radius + expand;
        const int minCx = bodyCellXMin(b.position.x, r);
        const int maxCx = bodyCellXMax(b.position.x, r);
        const int minCz = bodyCellZMin(b.position.z, r);
        const int maxCz = bodyCellZMax(b.position.z, r);
        for (int cz = minCz; cz <= maxCz; ++cz) {
            for (int cx = minCx; cx <= maxCx; ++cx) {
                dieGridCells_[static_cast<size_t>(cz * gridCols_ + cx)].push_back(i);
            }
        }
    }
}

void DicePhysicsEngine::processDiePair(size_t i, size_t j, StepStats& stats, float spec) {
    auto& a = bodies_[i];
    auto& b = bodies_[j];
    stats.pairCandidates++;
    if (a.kinematic && b.kinematic) return;
    if (a.sleeping && b.sleeping) return;

    Vec3 delta = b.position - a.position;
    float distSq = delta.lengthSq();
    float combinedR = a.radius + b.radius + spec;
    if (distSq >= combinedR * combinedR) return;

    stats.sphereTests++;

    const float mu = std::max(0.85f, std::sqrt(a.friction * b.friction));
    const float rest = 0.0f;

    if (a.useHull && b.useHull && !a.worldVerts.empty() && !b.worldVerts.empty()) {
        addSatContacts(
            ManifoldKind::DieDie, a.id, b.id, 0,
            static_cast<int>(i), static_cast<int>(j),
            a.hull, a.position, a.rotation, a.worldVerts,
            b.hull, b.position, b.rotation, b.worldVerts,
            spec, mu, rest, &stats
        );
    } else {
        Vec3 normal, contact;
        float pen = 0.0f;
        sphereContact(a, b, normal, pen, contact);
        if (-pen >= spec && pen <= 0.0f) return;
        ContactPoint pts[1];
        pts[0].point = contact;
        pts[0].separation = -pen;
        pts[0].featureId = 0;
        ContactManifold* m = matchManifold(ManifoldKind::DieDie, a.id, b.id, 0);
        if (!m) return;
        m->indexA = static_cast<int>(i);
        m->indexB = static_cast<int>(j);
        m->friction = mu;
        m->restitution = rest;
        commitManifoldPoints(*m, pts, 1, normal);
        stats.contacts++;
    }

    ContactManifold* found = matchManifold(ManifoldKind::DieDie, a.id, b.id, 0);
    if (!found || found->stale) return;

    if ((!a.sleeping && b.sleeping) || (a.sleeping && !b.sleeping)) {
        wake(a);
        wake(b);
    }

    Vec3 relVel = b.velocity - a.velocity;
    float speed = std::abs(Vec3::dot(relVel, found->normal));
    if (speed > 0.5f && events_.size() < static_cast<size_t>(MAX_EVENTS_PER_STEP)) {
        const float energyA = 0.5f * a.mass * a.velocity.lengthSq() +
                              0.5f * inertiaScalar(a) * a.angularVelocity.lengthSq();
        const float energyB = 0.5f * b.mass * b.velocity.lengthSq() +
                              0.5f * inertiaScalar(b) * b.angularVelocity.lengthSq();
        events_.push_back(energyA >= energyB ? makeEvent(a, b.id, speed)
                                             : makeEvent(b, a.id, speed));
    }
}

void DicePhysicsEngine::generateDieDieContacts(float spec, StepStats& stats) {
    // Grid cells overlap, so a pair can be visited more than once. Dedup
    // before the SAT / event path so warm-start and collision audio stay
    // one-shot per substep.
    std::set<std::pair<size_t, size_t>> pairSet;
    forEachDiePair([&](size_t i, size_t j) { pairSet.insert({i, j}); }, spec);
    for (const auto& pair : pairSet) {
        processDiePair(pair.first, pair.second, stats, spec);
    }
}

void DicePhysicsEngine::generateTableContacts(RigidBody& b, size_t dieIndex, float spec) {
    const Vec3 n{0, 1, 0};
    addPlaneContacts(
        ManifoldKind::DieTable, b.id, -1, 0,
        static_cast<int>(dieIndex), -1,
        n, tableY_, b.worldVerts, b.position, b.radius,
        spec, std::min(1.2f, b.friction + b.rollingFriction), 0.05f
    );
}

void DicePhysicsEngine::generateWallContacts(RigidBody& b, size_t dieIndex, float spec) {
    const float hx = tableHalfW_;
    const float hz = tableHalfD_;
    const float reach = b.radius + spec + 0.05f;
    if (b.position.x + reach > hx) {
        addPlaneContacts(ManifoldKind::DieWall, b.id, -1, 0, static_cast<int>(dieIndex), -1,
            Vec3{-1, 0, 0}, -hx, b.worldVerts, b.position, b.radius, spec, b.friction, b.restitution);
    }
    if (b.position.x - reach < -hx) {
        addPlaneContacts(ManifoldKind::DieWall, b.id, -1, 1, static_cast<int>(dieIndex), -1,
            Vec3{1, 0, 0}, -hx, b.worldVerts, b.position, b.radius, spec, b.friction, b.restitution);
    }
    if (b.position.z + reach > hz) {
        addPlaneContacts(ManifoldKind::DieWall, b.id, -1, 2, static_cast<int>(dieIndex), -1,
            Vec3{0, 0, -1}, -hz, b.worldVerts, b.position, b.radius, spec, b.friction, b.restitution);
    }
    if (b.position.z - reach < -hz) {
        addPlaneContacts(ManifoldKind::DieWall, b.id, -1, 3, static_cast<int>(dieIndex), -1,
            Vec3{0, 0, 1}, -hz, b.worldVerts, b.position, b.radius, spec, b.friction, b.restitution);
    }
}

void DicePhysicsEngine::generateContainerContacts(RigidBody& b, size_t dieIndex, float spec) {
    if (!containerActive_ || containerPlanes_.empty() || b.kinematic) return;
    for (size_t pi = 0; pi < containerPlanes_.size(); ++pi) {
        const auto& plane = containerPlanes_[pi];
        addPlaneContacts(
            ManifoldKind::DieContainer, b.id, -1, static_cast<int>(pi),
            static_cast<int>(dieIndex), -1,
            plane.normal, plane.dist, b.worldVerts, b.position, b.radius,
            spec, b.friction, b.restitution
        );
        ContactManifold* m = matchManifold(ManifoldKind::DieContainer, b.id, -1, static_cast<int>(pi));
        if (!m || m->stale || m->pointCount == 0) continue;
        const float impactSpeed = std::max(0.0f, -Vec3::dot(b.velocity, plane.normal));
        if (m->points[0].separation < -0.01f && impactSpeed > 1.0f &&
            events_.size() < static_cast<size_t>(MAX_EVENTS_PER_STEP)) {
            events_.push_back(makeEvent(
                b, CONTAINER_EVENT_ID_BASE - static_cast<int>(pi), impactSpeed,
                b.velocity.lengthSq(), b.angularVelocity.lengthSq(), 0, 4
            ));
        }
        if (b.sleeping) wake(b);
    }
}

void DicePhysicsEngine::resolveStaticPlane(
    RigidBody& b, const Vec3& n, float d, const StaticBody& s, float spec
) {
    const int dieIndex = static_cast<int>(&b - bodies_.data());
    addPlaneContacts(
        ManifoldKind::DieStatic, b.id, s.userId, 0,
        dieIndex, -1,
        n, d, b.worldVerts, b.position, b.radius,
        spec, std::sqrt(b.friction * s.friction), std::min(b.restitution, s.restitution)
    );
    ContactManifold* m = matchManifold(ManifoldKind::DieStatic, b.id, s.userId, 0);
    if (!m || m->stale) return;
    m->aux = s.userId;
    if (b.sleeping) wake(b);
    const float impactSpeed = std::max(0.0f, -Vec3::dot(b.velocity, n));
    if (m->points[0].separation < -0.01f && impactSpeed > 1.0f &&
        events_.size() < static_cast<size_t>(MAX_EVENTS_PER_STEP)) {
        events_.push_back(makeEvent(
            b, staticEventOtherId(s.userId), impactSpeed,
            b.velocity.lengthSq(), b.angularVelocity.lengthSq(), s.userId, s.materialTag
        ));
    }
}

void DicePhysicsEngine::resolveStaticHull(RigidBody& b, const StaticBody& s, float spec) {
    if (!b.useHull || b.hull.verts.empty() || s.hull.verts.empty()) return;
    std::vector<Vec3> sw(s.hull.verts.size());
    transformHullVerts(
        s.hull.verts.data(), static_cast<int>(s.hull.verts.size()),
        s.rotation, s.center, sw.data()
    );
    const int dieIndex = static_cast<int>(&b - bodies_.data());
    addSatContacts(
        ManifoldKind::DieStatic, b.id, s.userId, 0,
        dieIndex, -1,
        b.hull, b.position, b.rotation, b.worldVerts,
        s.hull, s.center, s.rotation, sw,
        spec, std::sqrt(b.friction * s.friction), std::min(b.restitution, s.restitution), nullptr
    );
    ContactManifold* m = matchManifold(ManifoldKind::DieStatic, b.id, s.userId, 0);
    if (!m || m->stale) return;
    if (b.sleeping) wake(b);
    const float impactSpeed = std::max(0.0f, -Vec3::dot(b.velocity, m->normal));
    if (m->points[0].separation < -0.01f && impactSpeed > 1.0f &&
        events_.size() < static_cast<size_t>(MAX_EVENTS_PER_STEP)) {
        events_.push_back(makeEvent(
            b, staticEventOtherId(s.userId), impactSpeed,
            b.velocity.lengthSq(), b.angularVelocity.lengthSq(), s.userId, s.materialTag
        ));
    }
}

void DicePhysicsEngine::resolveStaticOpenCylinder(RigidBody& b, const StaticBody& s, float spec) {
    const int segs = s.cylinderSegments;
    const float r = s.cylinderRadius;
    const Vec3 center = s.center;
    for (int i = 0; i < segs; ++i) {
        const float angle = (6.28318530718f * static_cast<float>(i)) / static_cast<float>(segs);
        Vec3 outward{std::cos(angle), 0.0f, std::sin(angle)};
        Vec3 inward = outward * -1.0f;
        Vec3 edgePoint = center + outward * r;
        const float d = Vec3::dot(inward, edgePoint);
        const int dieIndex = static_cast<int>(&b - bodies_.data());
        addPlaneContacts(
            ManifoldKind::DieStatic, b.id, s.userId, i + 1,
            dieIndex, -1,
            inward, d, b.worldVerts, b.position, b.radius,
            spec, std::sqrt(b.friction * s.friction), std::min(b.restitution, s.restitution)
        );
    }
    if (s.cylinderClosedBottom) {
        Vec3 up{0, 1, 0};
        const float d = center.y - s.cylinderHalfHeight;
        resolveStaticPlane(b, up, d, s, spec);
    }
}

void DicePhysicsEngine::generateStaticContacts(RigidBody& b, size_t dieIndex, float spec) {
    (void)dieIndex;
    if (b.kinematic) return;
    for (const auto& s : statics_) {
        const float sr = (s.shape == StaticShapeType::OpenCylinder)
            ? (s.cylinderRadius + s.cylinderHalfHeight)
            : (s.halfExtents.length() + 0.01f);
        const float maxR = b.radius + sr + spec + 0.05f;
        const Vec3 delta = s.center - b.position;
        if (s.shape != StaticShapeType::Plane && delta.lengthSq() > maxR * maxR) {
            continue;
        }
        switch (s.shape) {
            case StaticShapeType::Plane:
                resolveStaticPlane(b, s.planeNormal, s.planeDist, s, spec);
                break;
            case StaticShapeType::Box:
            case StaticShapeType::ConvexHull:
                resolveStaticHull(b, s, spec);
                break;
            case StaticShapeType::OpenCylinder:
                resolveStaticOpenCylinder(b, s, spec);
                break;
        }
    }
}

void DicePhysicsEngine::generateDynamicTableContacts(DynamicBody& b, size_t dynIndex, float spec) {
    addPlaneContacts(
        ManifoldKind::DynamicTable, b.userId, -1, 0,
        static_cast<int>(dynIndex), -1,
        Vec3{0, 1, 0}, tableY_, b.worldVerts, b.position, b.radius,
        spec, std::min(1.2f, b.friction + b.rollingFriction), 0.05f
    );
}

void DicePhysicsEngine::generateDynamicWallContacts(DynamicBody& b, size_t dynIndex, float spec) {
    const float hx = tableHalfW_;
    const float hz = tableHalfD_;
    addPlaneContacts(ManifoldKind::DynamicWall, b.userId, -1, 0, static_cast<int>(dynIndex), -1,
        Vec3{-1, 0, 0}, -hx, b.worldVerts, b.position, b.radius, spec, b.friction, b.restitution);
    addPlaneContacts(ManifoldKind::DynamicWall, b.userId, -1, 1, static_cast<int>(dynIndex), -1,
        Vec3{1, 0, 0}, -hx, b.worldVerts, b.position, b.radius, spec, b.friction, b.restitution);
    addPlaneContacts(ManifoldKind::DynamicWall, b.userId, -1, 2, static_cast<int>(dynIndex), -1,
        Vec3{0, 0, -1}, -hz, b.worldVerts, b.position, b.radius, spec, b.friction, b.restitution);
    addPlaneContacts(ManifoldKind::DynamicWall, b.userId, -1, 3, static_cast<int>(dynIndex), -1,
        Vec3{0, 0, 1}, -hz, b.worldVerts, b.position, b.radius, spec, b.friction, b.restitution);
}

void DicePhysicsEngine::generateDynamicContainerContacts(DynamicBody& b, size_t dynIndex, float spec) {
    if (!containerActive_ || containerPlanes_.empty() || b.kinematic) return;
    for (size_t pi = 0; pi < containerPlanes_.size(); ++pi) {
        addPlaneContacts(
            ManifoldKind::DynamicContainer, b.userId, -1, static_cast<int>(pi),
            static_cast<int>(dynIndex), -1,
            containerPlanes_[pi].normal, containerPlanes_[pi].dist,
            b.worldVerts, b.position, b.radius,
            spec, b.friction, b.restitution
        );
        if (b.sleeping) wake(b);
    }
}

void DicePhysicsEngine::resolveDynamicStaticPlane(
    DynamicBody& b, const Vec3& n, float d, const StaticBody& s, float spec
) {
    const int dynIndex = static_cast<int>(&b - dynamics_.data());
    addPlaneContacts(
        ManifoldKind::DynamicStatic, b.userId, s.userId, 0,
        dynIndex, -1, n, d, b.worldVerts, b.position, b.radius,
        spec, std::sqrt(b.friction * s.friction), std::min(b.restitution, s.restitution)
    );
    if (b.sleeping) wake(b);
}

void DicePhysicsEngine::resolveDynamicStaticHull(DynamicBody& b, const StaticBody& s, float spec) {
    if (b.hull.verts.empty() || s.hull.verts.empty()) return;
    std::vector<Vec3> sw(s.hull.verts.size());
    transformHullVerts(
        s.hull.verts.data(), static_cast<int>(s.hull.verts.size()),
        s.rotation, s.center, sw.data()
    );
    const int dynIndex = static_cast<int>(&b - dynamics_.data());
    addSatContacts(
        ManifoldKind::DynamicStatic, b.userId, s.userId, 0,
        dynIndex, -1,
        b.hull, b.position, b.rotation, b.worldVerts,
        s.hull, s.center, s.rotation, sw,
        spec, std::sqrt(b.friction * s.friction), std::min(b.restitution, s.restitution), nullptr
    );
    if (b.sleeping) wake(b);
}

void DicePhysicsEngine::resolveDynamicStaticOpenCylinder(DynamicBody& b, const StaticBody& s, float spec) {
    const int segs = s.cylinderSegments;
    const float r = s.cylinderRadius;
    const Vec3 center = s.center;
    const int dynIndex = static_cast<int>(&b - dynamics_.data());
    for (int i = 0; i < segs; ++i) {
        const float angle = (6.28318530718f * static_cast<float>(i)) / static_cast<float>(segs);
        Vec3 outward{std::cos(angle), 0.0f, std::sin(angle)};
        Vec3 inward = outward * -1.0f;
        Vec3 edgePoint = center + outward * r;
        const float d = Vec3::dot(inward, edgePoint);
        addPlaneContacts(
            ManifoldKind::DynamicStatic, b.userId, s.userId, i + 1,
            dynIndex, -1, inward, d, b.worldVerts, b.position, b.radius,
            spec, std::sqrt(b.friction * s.friction), std::min(b.restitution, s.restitution)
        );
    }
    if (s.cylinderClosedBottom) {
        resolveDynamicStaticPlane(b, Vec3{0, 1, 0}, center.y - s.cylinderHalfHeight, s, spec);
    }
}

void DicePhysicsEngine::generateDynamicStaticContacts(DynamicBody& b, size_t dynIndex, float spec) {
    (void)dynIndex;
    if (b.kinematic) return;
    for (const auto& s : statics_) {
        switch (s.shape) {
            case StaticShapeType::Plane:
                resolveDynamicStaticPlane(b, s.planeNormal, s.planeDist, s, spec);
                break;
            case StaticShapeType::Box:
            case StaticShapeType::ConvexHull:
                resolveDynamicStaticHull(b, s, spec);
                break;
            case StaticShapeType::OpenCylinder:
                resolveDynamicStaticOpenCylinder(b, s, spec);
                break;
        }
    }
}

void DicePhysicsEngine::generateDieDynamicContacts(float spec, StepStats& stats) {
    for (size_t pi = 0; pi < dynamics_.size(); ++pi) {
        auto& prop = dynamics_[pi];
        for (size_t di = 0; di < bodies_.size(); ++di) {
            auto& die = bodies_[di];
            stats.pairCandidates++;
            if (die.kinematic && prop.kinematic) continue;
            if (die.sleeping && prop.sleeping) continue;
            Vec3 delta = prop.position - die.position;
            const float distSq = delta.lengthSq();
            const float combinedR = die.radius + prop.radius + spec;
            if (distSq >= combinedR * combinedR) continue;
            stats.sphereTests++;
            const float mu = std::sqrt(die.friction * prop.friction);
            const float rest = std::min(die.restitution, prop.restitution);
            if (die.useHull && !die.worldVerts.empty()) {
                addSatContacts(
                    ManifoldKind::DieDynamic, die.id, prop.userId, 0,
                    static_cast<int>(di), static_cast<int>(pi),
                    die.hull, die.position, die.rotation, die.worldVerts,
                    prop.hull, prop.position, prop.rotation, prop.worldVerts,
                    spec, mu, rest, &stats
                );
            } else {
                Vec3 normal = distSq > 1e-8f ? delta / std::sqrt(distSq) : Vec3{1, 0, 0};
                float dist = std::sqrt(std::max(distSq, 0.0f));
                float pen = die.radius + prop.radius - dist;
                ContactPoint pts[1];
                pts[0].point = die.position + normal * die.radius;
                pts[0].separation = -pen;
                pts[0].featureId = 0;
                auto* m = matchManifold(ManifoldKind::DieDynamic, die.id, prop.userId, 0);
                if (!m) continue;
                m->indexA = static_cast<int>(di);
                m->indexB = static_cast<int>(pi);
                m->friction = mu;
                m->restitution = rest;
                commitManifoldPoints(*m, pts, 1, normal);
            }
            auto* found = matchManifold(ManifoldKind::DieDynamic, die.id, prop.userId, 0);
            if (!found || found->stale) continue;
            wake(die);
            wake(prop);
            Vec3 relVel = prop.velocity - die.velocity;
            float speed = std::abs(Vec3::dot(relVel, found->normal));
            if (speed > 0.5f && events_.size() < static_cast<size_t>(MAX_EVENTS_PER_STEP)) {
                events_.push_back(makeEvent(die, dynamicEventOtherId(prop.userId), speed));
            }
        }
    }
}

void DicePhysicsEngine::generateDynamicDynamicContacts(float spec, StepStats& stats) {
    for (size_t i = 0; i < dynamics_.size(); ++i) {
        for (size_t j = i + 1; j < dynamics_.size(); ++j) {
            auto& a = dynamics_[i];
            auto& b = dynamics_[j];
            stats.pairCandidates++;
            if (a.kinematic && b.kinematic) continue;
            if (a.sleeping && b.sleeping) continue;
            Vec3 delta = b.position - a.position;
            const float distSq = delta.lengthSq();
            const float combinedR = a.radius + b.radius + spec;
            if (distSq >= combinedR * combinedR) continue;
            stats.sphereTests++;
            addSatContacts(
                ManifoldKind::DynamicDynamic, a.userId, b.userId, 0,
                static_cast<int>(i), static_cast<int>(j),
                a.hull, a.position, a.rotation, a.worldVerts,
                b.hull, b.position, b.rotation, b.worldVerts,
                spec, std::sqrt(a.friction * b.friction), std::min(a.restitution, b.restitution),
                &stats
            );
            auto* found = matchManifold(ManifoldKind::DynamicDynamic, a.userId, b.userId, 0);
            if (!found || found->stale) continue;
            wake(a);
            wake(b);
        }
    }
}

void DicePhysicsEngine::generateContacts(float dt, StepStats& stats) {
    for (auto& m : manifolds_) m.stale = true;

    float maxSpec = SPECULATIVE_SLOP;
    for (const auto& b : bodies_) maxSpec = std::max(maxSpec, speculativeFor(b.velocity, dt));
    for (const auto& d : dynamics_) maxSpec = std::max(maxSpec, speculativeFor(d.velocity, dt));

    generateDieDieContacts(maxSpec, stats);
    generateDieDynamicContacts(maxSpec, stats);
    generateDynamicDynamicContacts(maxSpec, stats);

    for (size_t i = 0; i < bodies_.size(); ++i) {
        auto& b = bodies_[i];
        if (b.sleeping) continue;
        const float spec = speculativeFor(b.velocity, dt);
        generateContainerContacts(b, i, spec);
        generateStaticContacts(b, i, spec);
        generateTableContacts(b, i, spec);
        generateWallContacts(b, i, spec);
    }
    for (size_t i = 0; i < dynamics_.size(); ++i) {
        auto& d = dynamics_[i];
        if (d.sleeping) continue;
        const float spec = speculativeFor(d.velocity, dt);
        generateDynamicContainerContacts(d, i, spec);
        generateDynamicStaticContacts(d, i, spec);
        generateDynamicTableContacts(d, i, spec);
        generateDynamicWallContacts(d, i, spec);
    }

    manifolds_.erase(
        std::remove_if(manifolds_.begin(), manifolds_.end(),
            [](const ContactManifold& m) { return m.stale; }),
        manifolds_.end()
    );

    uint32_t points = 0;
    for (const auto& m : manifolds_) points += static_cast<uint32_t>(m.pointCount);
    stats.contacts = points;
}

bool DicePhysicsEngine::bindViews(ContactManifold& m, BodyView& a, BodyView& b, WorldAnchor& world) {
    switch (m.kind) {
        case ManifoldKind::DieDie:
            if (m.indexA < 0 || m.indexB < 0) return false;
            if (static_cast<size_t>(m.indexA) >= bodies_.size()) return false;
            if (static_cast<size_t>(m.indexB) >= bodies_.size()) return false;
            a = viewDie(bodies_[static_cast<size_t>(m.indexA)]);
            b = viewDie(bodies_[static_cast<size_t>(m.indexB)]);
            return true;
        case ManifoldKind::DieDynamic:
            if (m.indexA < 0 || m.indexB < 0) return false;
            if (static_cast<size_t>(m.indexA) >= bodies_.size()) return false;
            if (static_cast<size_t>(m.indexB) >= dynamics_.size()) return false;
            a = viewDie(bodies_[static_cast<size_t>(m.indexA)]);
            b = viewDyn(dynamics_[static_cast<size_t>(m.indexB)]);
            return true;
        case ManifoldKind::DynamicDynamic:
            if (m.indexA < 0 || m.indexB < 0) return false;
            if (static_cast<size_t>(m.indexA) >= dynamics_.size()) return false;
            if (static_cast<size_t>(m.indexB) >= dynamics_.size()) return false;
            a = viewDyn(dynamics_[static_cast<size_t>(m.indexA)]);
            b = viewDyn(dynamics_[static_cast<size_t>(m.indexB)]);
            return true;
        case ManifoldKind::DieStatic: {
            if (m.indexA < 0 || static_cast<size_t>(m.indexA) >= bodies_.size()) return false;
            a = viewDie(bodies_[static_cast<size_t>(m.indexA)]);
            StaticBody* found = nullptr;
            for (auto& s : statics_) {
                if (s.userId == m.idB || s.userId == m.aux) { found = &s; break; }
            }
            b = found ? viewStatic(*found) : viewWorld(world);
            return true;
        }
        case ManifoldKind::DynamicStatic: {
            if (m.indexA < 0 || static_cast<size_t>(m.indexA) >= dynamics_.size()) return false;
            a = viewDyn(dynamics_[static_cast<size_t>(m.indexA)]);
            StaticBody* found = nullptr;
            for (auto& s : statics_) {
                if (s.userId == m.idB || s.userId == m.aux) { found = &s; break; }
            }
            b = found ? viewStatic(*found) : viewWorld(world);
            return true;
        }
        case ManifoldKind::DieTable:
        case ManifoldKind::DieWall:
        case ManifoldKind::DieContainer:
            if (m.indexA < 0 || static_cast<size_t>(m.indexA) >= bodies_.size()) return false;
            a = viewDie(bodies_[static_cast<size_t>(m.indexA)]);
            b = viewWorld(world);
            return true;
        case ManifoldKind::DynamicTable:
        case ManifoldKind::DynamicWall:
        case ManifoldKind::DynamicContainer:
            if (m.indexA < 0 || static_cast<size_t>(m.indexA) >= dynamics_.size()) return false;
            a = viewDyn(dynamics_[static_cast<size_t>(m.indexA)]);
            b = viewWorld(world);
            return true;
    }
    return false;
}

void DicePhysicsEngine::warmStartManifolds() {
    WorldAnchor world;
    for (auto& m : manifolds_) {
        BodyView va, vb;
        if (!bindViews(m, va, vb, world)) continue;
        for (int i = 0; i < m.pointCount; ++i) {
            auto& p = m.points[i];
            Vec3 impulse = m.normal * p.accN + m.tangent1 * p.accT1 + m.tangent2 * p.accT2;
            Vec3 rA = p.point - *va.position;
            Vec3 rB = p.point - *vb.position;
            va.applyImpulse(impulse * -1.0f, rA);
            vb.applyImpulse(impulse, rB);
        }
    }
}

void DicePhysicsEngine::prepareVelocityConstraints(float dt) {
    WorldAnchor world;
    for (auto& m : manifolds_) {
        BodyView va, vb;
        if (!bindViews(m, va, vb, world)) continue;
        for (int i = 0; i < m.pointCount; ++i) {
            auto& p = m.points[i];
            Vec3 rA = p.point - *va.position;
            Vec3 rB = p.point - *vb.position;
            Vec3 rel = vb.velocityAt(rB) - va.velocityAt(rA);
            float velN = Vec3::dot(rel, m.normal);
            (void)dt;
            p.velBias = 0.0f;
            if (p.separation < -CONTACT_SLOP * 2.0f && velN < -RESTITUTION_THRESHOLD) {
                p.velBias += std::min(-m.restitution * velN, 8.0f);
            }
        }
    }
}

namespace {
float effectiveMass(const BodyView& va, const BodyView& vb, const Vec3& rA, const Vec3& rB, const Vec3& dir) {
    float denom = va.invMass + vb.invMass;
    Vec3 ra = Vec3::cross(rA, dir);
    Vec3 rb = Vec3::cross(rB, dir);
    if (!va.kinematic) denom += Vec3::dot(ra, va.applyInvInertiaWorld(ra));
    if (!vb.kinematic) denom += Vec3::dot(rb, vb.applyInvInertiaWorld(rb));
    return denom;
}
} // namespace

void DicePhysicsEngine::solveVelocityConstraints(float dt) {
    WorldAnchor world;
    (void)dt;
    // Solve lower contacts first so table reaction can propagate up a stack.
    std::vector<size_t> order(manifolds_.size());
    for (size_t i = 0; i < order.size(); ++i) order[i] = i;
    std::sort(order.begin(), order.end(), [&](size_t ia, size_t ib) {
        const auto& a = manifolds_[ia];
        const auto& b = manifolds_[ib];
        const auto rankOf = [](ManifoldKind k) {
            switch (k) {
                case ManifoldKind::DieTable:
                case ManifoldKind::DynamicTable: return 0;
                case ManifoldKind::DieStatic:
                case ManifoldKind::DynamicStatic: return 1;
                default: return 2;
            }
        };
        const int ra = rankOf(a.kind), rb = rankOf(b.kind);
        if (ra != rb) return ra < rb;
        return a.idA < b.idA;
    });
    for (int iter = 0; iter < VELOCITY_ITERATIONS; ++iter) {
        for (size_t oi : order) {
            auto& m = manifolds_[oi];
            BodyView va, vb;
            if (!bindViews(m, va, vb, world)) continue;
            for (int i = 0; i < m.pointCount; ++i) {
                auto& p = m.points[i];
                Vec3 rA = p.point - *va.position;
                Vec3 rB = p.point - *vb.position;
                Vec3 rel = vb.velocityAt(rB) - va.velocityAt(rA);
                float velN = Vec3::dot(rel, m.normal);

                float denom = effectiveMass(va, vb, rA, rB, m.normal);
                if (denom < 1e-6f) continue;
                if (!std::isfinite(denom) || !std::isfinite(velN)) continue;

                float j;
                if (p.separation > 0.0f) {
                    j = -std::min(velN, 0.0f) / denom;
                } else {
                    j = -(velN - p.velBias) / denom;
                }
                float accOld = p.accN;
                p.accN = std::max(accOld + j, 0.0f);
                float jApp = p.accN - accOld;
                jApp = std::clamp(jApp, -400.0f, 400.0f);
                Vec3 impulse = m.normal * jApp;
                va.applyImpulse(impulse * -1.0f, rA);
                vb.applyImpulse(impulse, rB);

                rel = vb.velocityAt(rB) - va.velocityAt(rA);
                auto solveTangent = [&](const Vec3& t, float& accT) {
                    float vt = Vec3::dot(rel, t);
                    float tDenom = effectiveMass(va, vb, rA, rB, t);
                    if (tDenom < 1e-6f || !std::isfinite(tDenom)) return;
                    float tOld = accT;
                    accT += -vt / tDenom;
                    const float maxF = p.accN * m.friction;
                    accT = std::clamp(accT, -maxF, maxF);
                    va.applyImpulse(t * (accT - tOld) * -1.0f, rA);
                    vb.applyImpulse(t * (accT - tOld), rB);
                    rel = vb.velocityAt(rB) - va.velocityAt(rA);
                };
                solveTangent(m.tangent1, p.accT1);
                solveTangent(m.tangent2, p.accT2);
            }
        }
    }
}

void DicePhysicsEngine::solvePositionConstraints() {
    WorldAnchor world;
    for (int iter = 0; iter < POSITION_ITERATIONS; ++iter) {
        for (auto& m : manifolds_) {
            BodyView va, vb;
            if (!bindViews(m, va, vb, world)) continue;
            for (int i = 0; i < m.pointCount; ++i) {
                auto& p = m.points[i];
                if (p.separation >= -CONTACT_SLOP) continue;
                const float invSum = va.invMass + vb.invMass;
                if (invSum < 1e-6f) continue;
                float corrMag = (-p.separation - CONTACT_SLOP) * 0.08f / invSum;
                Vec3 corr = m.normal * corrMag;
                if (!va.kinematic) *va.position -= corr * va.invMass;
                if (!vb.kinematic) *vb.position += corr * vb.invMass;
                p.separation += corrMag * invSum;
            }
        }
    }
}

void DicePhysicsEngine::updateIslandSleep(float dt) {
    const int dieN = static_cast<int>(bodies_.size());
    const int dynN = static_cast<int>(dynamics_.size());
    const int n = dieN + dynN;
    if (n <= 0) return;
    std::vector<int> parent(static_cast<size_t>(n));
    for (int i = 0; i < n; ++i) parent[static_cast<size_t>(i)] = i;
    auto find = [&](int x) {
        while (parent[static_cast<size_t>(x)] != x) {
            parent[static_cast<size_t>(x)] = parent[static_cast<size_t>(parent[static_cast<size_t>(x)])];
            x = parent[static_cast<size_t>(x)];
        }
        return x;
    };
    auto unite = [&](int x, int y) {
        x = find(x);
        y = find(y);
        if (x != y) parent[static_cast<size_t>(y)] = x;
    };

    auto dieNode = [&](int idx) { return idx; };
    auto dynNode = [&](int idx) { return dieN + idx; };

    for (const auto& m : manifolds_) {
        if (m.kind == ManifoldKind::DieDie && m.indexA >= 0 && m.indexB >= 0) {
            unite(dieNode(m.indexA), dieNode(m.indexB));
        } else if (m.kind == ManifoldKind::DieDynamic && m.indexA >= 0 && m.indexB >= 0) {
            unite(dieNode(m.indexA), dynNode(m.indexB));
        } else if (m.kind == ManifoldKind::DynamicDynamic && m.indexA >= 0 && m.indexB >= 0) {
            unite(dynNode(m.indexA), dynNode(m.indexB));
        }
    }

    std::vector<float> islandKe(static_cast<size_t>(n), 0.0f);

    for (int i = 0; i < dieN; ++i) {
        auto& b = bodies_[static_cast<size_t>(i)];
        if (b.kinematic) continue;
        const int root = find(dieNode(i));
        const float ke = 0.5f * b.mass * b.velocity.lengthSq()
            + 0.5f * inertiaScalar(b) * b.angularVelocity.lengthSq();
        islandKe[static_cast<size_t>(root)] = std::max(islandKe[static_cast<size_t>(root)], ke);
    }
    for (int i = 0; i < dynN; ++i) {
        auto& b = dynamics_[static_cast<size_t>(i)];
        if (b.kinematic) continue;
        const int root = find(dynNode(i));
        const float ke = 0.5f * b.mass * b.velocity.lengthSq()
            + 0.5f * inertiaScalar(b) * b.angularVelocity.lengthSq();
        islandKe[static_cast<size_t>(root)] = std::max(islandKe[static_cast<size_t>(root)], ke);
    }

    for (int i = 0; i < dieN; ++i) {
        auto& b = bodies_[static_cast<size_t>(i)];
        if (b.kinematic) continue;
        const int root = find(dieNode(i));
        if (islandKe[static_cast<size_t>(root)] >= 0.08f) {
            if (b.sleeping) wake(b);
            else b.sleepTimer = 0.0f;
        } else {
            b.sleepTimer += dt;
            if (b.sleepTimer >= SLEEP_DELAY) {
                b.sleeping = true;
                b.velocity = {};
                b.angularVelocity = {};
            }
        }
    }
    for (int i = 0; i < dynN; ++i) {
        auto& b = dynamics_[static_cast<size_t>(i)];
        if (b.kinematic) continue;
        const int root = find(dynNode(i));
        if (islandKe[static_cast<size_t>(root)] >= 0.08f) {
            if (b.sleeping) wake(b);
            else b.sleepTimer = 0.0f;
        } else {
            b.sleepTimer += dt;
            if (b.sleepTimer >= SLEEP_DELAY) {
                b.sleeping = true;
                b.velocity = {};
                b.angularVelocity = {};
            }
        }
    }
    (void)manifoldTouchesDie;
}

void DicePhysicsEngine::solveContacts(float dt) {
    prepareVelocityConstraints(dt);
    warmStartManifolds();
    solveVelocityConstraints(dt);
    solvePositionConstraints();
    // Linear projection against infinite-mass bodies: sequential impulse can
    // leave residual approach velocity on a 1-point SAT contact (corner r, inertia).
    WorldAnchor world;
    for (auto& m : manifolds_) {
        if (m.kind != ManifoldKind::DieStatic && m.kind != ManifoldKind::DieTable &&
            m.kind != ManifoldKind::DieWall && m.kind != ManifoldKind::DieContainer &&
            m.kind != ManifoldKind::DynamicStatic && m.kind != ManifoldKind::DynamicTable &&
            m.kind != ManifoldKind::DynamicWall && m.kind != ManifoldKind::DynamicContainer) {
            continue;
        }
        BodyView va, vb;
        if (!bindViews(m, va, vb, world)) continue;
        if (va.kinematic || !va.velocity) continue;
        bool touching = false;
        for (int i = 0; i < m.pointCount; ++i) {
            if (m.points[i].separation < SPECULATIVE_MAX) { touching = true; break; }
        }
        if (!touching) continue;
        const float into = Vec3::dot(*va.velocity, m.normal);
        if (into > 0.0f) {
            *va.velocity -= m.normal * into;
        }
    }
}

} // namespace dice_physics
