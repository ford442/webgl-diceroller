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
    v.invInertiaWorldMat = inertiaWorldMat3(b.rotation, b.invInertia);
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
    v.invInertiaWorldMat = inertiaWorldMat3(b.rotation, b.invInertia);
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
    // Last substep's normal for this pair, if it had one (SAT coherence).
    // Manifolds store the solver normal (A→B), which is what SAT reports.
    const Vec3* preferred = nullptr;
    int preferredAxis = -1;
    for (const auto& m : manifolds_) {
        if (m.kind == kind && m.idA == idA && m.idB == idB && m.aux == aux) {
            if (m.pointCount > 0) {
                preferred = &m.normal;
                preferredAxis = static_cast<int>(m.points[0].featureId >> 16);
            }
            break;
        }
    }
    if (!satTestFromWorld(ha, posA, rotA, wa.data(), hb, posB, rotB, wb.data(),
                          normal, pen, contact, &feature, &normalFromA, spec,
                          preferred, preferredAxis)) {
        return;
    }

    // Contact points are the vertices of either hull that sit inside the
    // other one (or within the speculative margin of it). Both directions
    // matter: a die face on a table box contributes the die's vertices, a die
    // straddling the box's corner contributes the corner. A face-on rest gets
    // the whole face (up to four points) rather than one corner, which is
    // what lets it stop rocking and sleep.
    //
    // A vertex's separation is its exit distance from the other hull along
    // the contact normal — the nearest of that hull's planes facing the way
    // it must move. (A slab distance against the other hull's extreme along
    // n read a box corner that had just entered a die straddling the velvet
    // zone's rim as 10 cm deep, and the solver kicked the die off. #341)
    const float tol = std::max(spec, 0.0f) + 0.01f;
    struct Plane {
        Vec3 n;
        float d;
    };
    auto planesOf = [](const PolyHull& h, const Quat& rot, const std::vector<Vec3>& w,
                       std::vector<Plane>& out) {
        out.clear();
        for (const auto& ln : h.faceNormals) {
            const Vec3 fn = rot.rotate(ln);
            float support = -1e20f;
            for (const auto& v : w) support = std::max(support, Vec3::dot(fn, v));
            out.push_back({fn, support});
        }
    };
    std::vector<Plane> planesA, planesB;
    planesOf(ha, rotA, wa, planesA);
    planesOf(hb, rotB, wb, planesB);
    auto inside = [&](const Vec3& p, const std::vector<Plane>& planes) {
        for (const auto& pl : planes) {
            if (Vec3::dot(pl.n, p) - pl.d > tol) return false;
        }
        return true;
    };
    // Signed exit distance of p from a hull along `dir`: > 0 when p must move
    // that far to leave it, < 0 when it is already that far outside.
    auto exitDistance = [](const Vec3& p, const std::vector<Plane>& planes, const Vec3& dir,
                           float fallback) {
        float best = 1e20f;
        bool any = false;
        for (const auto& pl : planes) {
            const float facing = Vec3::dot(pl.n, dir);
            if (facing <= 1e-3f) continue;
            best = std::min(best, (pl.d - Vec3::dot(pl.n, p)) / facing);
            any = true;
        }
        return any ? best : fallback;
    };
    float maxA = -1e20f, minB = 1e20f;
    for (const auto& v : wa) maxA = std::max(maxA, Vec3::dot(v, normal));
    for (const auto& v : wb) minB = std::min(minB, Vec3::dot(v, normal));

    struct Cand {
        Vec3 p;
        float sep;
        uint32_t id;
    };
    Cand cands[128];
    int nC = 0;
    const uint32_t axisBits = feature & 0xFFFF0000u;
    const Vec3 backward = normal * -1.0f;
    for (size_t i = 0; i < wa.size() && nC < 128; ++i) {
        // An A vertex leaves B by moving back along -n.
        if (minB - Vec3::dot(wa[i], normal) >= spec || !inside(wa[i], planesB)) continue;
        const float sep = -exitDistance(wa[i], planesB, backward, Vec3::dot(wa[i], normal) - minB);
        if (sep < spec) cands[nC++] = {wa[i], sep, axisBits | static_cast<uint32_t>(i)};
    }
    for (size_t i = 0; i < wb.size() && nC < 128; ++i) {
        // A B vertex leaves A by moving along +n.
        if (Vec3::dot(wb[i], normal) - maxA >= spec || !inside(wb[i], planesA)) continue;
        const float sep = -exitDistance(wb[i], planesA, normal, maxA - Vec3::dot(wb[i], normal));
        if (sep < spec) cands[nC++] = {wb[i], sep, axisBits | 0x8000u | static_cast<uint32_t>(i)};
    }
    if (nC == 0) {
        // Edge-edge: no vertex of either hull is inside the other. Put the
        // contact on the *smaller* hull's support feature — the average of its
        // vertices within 1 cm of its deepest — shifted half the penetration
        // toward the other hull. (The midpoint of the two hulls' supports used
        // to be used, but a table box's support along its normal is a whole
        // face, so that point could land metres from the die; the lever arm
        // pumped energy into it every substep. #341)
        auto radius = [](const std::vector<Vec3>& w) {
            Vec3 c{};
            for (const auto& v : w) c += v;
            c = c * (1.0f / static_cast<float>(w.size()));
            float r = 0.0f;
            for (const auto& v : w) r = std::max(r, (v - c).lengthSq());
            return r;
        };
        const bool useA = radius(wa) <= radius(wb);
        const std::vector<Vec3>& w = useA ? wa : wb;
        // A's deepest points have the largest projection on n (it points
        // A→B); B's have the smallest.
        const float sign = useA ? 1.0f : -1.0f;
        float deepest = -1e20f;
        for (const auto& v : w) deepest = std::max(deepest, sign * Vec3::dot(v, normal));
        Vec3 sum{};
        int n = 0;
        for (const auto& v : w) {
            if (sign * Vec3::dot(v, normal) >= deepest - 0.01f) {
                sum += v;
                ++n;
            }
        }
        const Vec3 support = sum * (1.0f / static_cast<float>(n));
        const Vec3 point = support - normal * (sign * pen * 0.5f);
        cands[nC++] = {point, -pen, axisBits | 0x7FFFu};
    }
    std::sort(cands, cands + nC, [](const Cand& a, const Cand& b) { return a.sep < b.sep; });

    // Every candidate inside the speculative margin is a real constraint now
    // that a speculative point only stops the approach that would close its
    // gap this substep (solveVelocityConstraints).
    const float deepestSep = cands[0].sep;
    Cand pool[128];
    int nP = 0;
    for (int i = 0; i < nC; ++i) {
        if (cands[i].sep > deepestSep + 0.02f) break;
        pool[nP++] = cands[i];
    }
    if (nP <= 0) return;

    // Reduce to MAX_MANIFOLD_POINTS by spread: the deepest point, the one
    // furthest from it, then the furthest on each side of that segment.
    int pick[MAX_MANIFOLD_POINTS] = {0, -1, -1, -1};
    int take = 1;
    if (nP > 1) {
        float best = -1.0f;
        for (int i = 1; i < nP; ++i) {
            const float d = (pool[i].p - pool[0].p).lengthSq();
            if (d > best) { best = d; pick[1] = i; }
        }
        if (best > 1e-6f) {
            take = 2;
            const Vec3 a = pool[pick[0]].p;
            const Vec3 b = pool[pick[1]].p;
            float bestPos = 1e-6f, bestNeg = -1e-6f;
            for (int i = 0; i < nP; ++i) {
                const float area = Vec3::dot(Vec3::cross(b - a, pool[i].p - a), normal);
                if (area > bestPos) { bestPos = area; pick[2] = i; }
                if (area < bestNeg) { bestNeg = area; pick[3] = i; }
            }
            if (pick[2] >= 0) pick[take++] = pick[2];
            if (pick[3] >= 0) pick[take++] = pick[3];
        }
    }
    ContactPoint pts[MAX_MANIFOLD_POINTS];
    for (int i = 0; i < take; ++i) {
        const Cand& c = pool[pick[i]];
        pts[i].point = c.p;
        pts[i].separation = c.sep;
        pts[i].featureId = c.id;
    }
    if (take <= 0) return;

    ContactManifold* m = matchManifold(kind, idA, idB, aux);
    if (!m) return;
    m->indexA = indexA;
    m->indexB = indexB;
    m->friction = friction;
    m->restitution = restitution;
    if (kind == ManifoldKind::DieStatic || kind == ManifoldKind::DynamicStatic) {
        // Static props have no rolling-resistance model, so full Coulomb grip
        // turns a sliding die into a long roll: measured on the tavern table
        // boxes (#341), lifting this cap to the material's 0.6 moved the
        // median settle from ~5 s to ~6.6 s and left more throws awake at
        // 12 s, not fewer.
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

void DicePhysicsEngine::rebuildDynGrid(float expand) {
    ensureDieGridDimensions();
    const size_t cellCount = static_cast<size_t>(gridCols_ * gridRows_);
    if (dynGridCells_.size() != cellCount) {
        dynGridCells_.assign(cellCount, {});
    } else {
        for (auto& cell : dynGridCells_) cell.clear();
    }

    for (size_t i = 0; i < dynamics_.size(); ++i) {
        const auto& d = dynamics_[i];
        const float r = d.radius + expand;
        const int minCx = bodyCellXMin(d.position.x, r);
        const int maxCx = bodyCellXMax(d.position.x, r);
        const int minCz = bodyCellZMin(d.position.z, r);
        const int maxCz = bodyCellZMax(d.position.z, r);
        for (int cz = minCz; cz <= maxCz; ++cz) {
            for (int cx = minCx; cx <= maxCx; ++cx) {
                dynGridCells_[static_cast<size_t>(cz * gridCols_ + cx)].push_back(i);
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

namespace {

struct CylinderPlane {
    Vec3 normal;
    float dist = 0.0f;
    int aux = 0;
};

/**
 * The open-cylinder planes a body at `p` (bounding radius `reach`) should
 * collide with. Inside the wall: every inward radial plane (a cup holding a
 * die). Outside: only the nearest segment's outward plane, as a solid wall.
 * Above or below the cylinder: none. The radial planes are infinite
 * half-spaces, so applying the inward set to a body *outside* the cup used to
 * drag it in through the wall (#341). Returns the plane count.
 */
int openCylinderPlanes(const StaticBody& s, const Vec3& p, float reach, float spec,
                       CylinderPlane* out, bool& inside) {
    const Vec3& c = s.center;
    inside = false;
    if (p.y - reach > c.y + s.cylinderHalfHeight + spec) return 0;
    if (p.y + reach < c.y - s.cylinderHalfHeight - spec) return 0;
    const int segs = s.cylinderSegments;
    const float r = s.cylinderRadius;
    const float dx = p.x - c.x;
    const float dz = p.z - c.z;
    const float h = std::sqrt(dx * dx + dz * dz);
    const float step = 6.28318530718f / static_cast<float>(segs);
    if (h <= r) {
        inside = true;
        for (int i = 0; i < segs; ++i) {
            const float angle = step * static_cast<float>(i);
            const Vec3 outward{std::cos(angle), 0.0f, std::sin(angle)};
            out[i].normal = outward * -1.0f;
            out[i].dist = Vec3::dot(out[i].normal, c + outward * r);
            out[i].aux = i + 1;
        }
        return segs;
    }
    if (h - r > reach + spec) return 0;
    float angle = std::atan2(dz, dx);
    if (angle < 0.0f) angle += 6.28318530718f;
    const int i = static_cast<int>(std::lround(angle / step)) % segs;
    const float a = step * static_cast<float>(i);
    const Vec3 outward{std::cos(a), 0.0f, std::sin(a)};
    out[0].normal = outward;
    out[0].dist = Vec3::dot(outward, c + outward * r);
    out[0].aux = i + 1;
    return 1;
}

} // namespace

void DicePhysicsEngine::resolveStaticOpenCylinder(RigidBody& b, const StaticBody& s, float spec) {
    CylinderPlane planes[32];
    bool inside = false;
    const int n = openCylinderPlanes(s, b.position, b.radius, spec, planes, inside);
    const int dieIndex = static_cast<int>(&b - bodies_.data());
    for (int k = 0; k < n; ++k) {
        addPlaneContacts(
            ManifoldKind::DieStatic, b.id, s.userId, planes[k].aux,
            dieIndex, -1,
            planes[k].normal, planes[k].dist, b.worldVerts, b.position, b.radius,
            spec, std::sqrt(b.friction * s.friction), std::min(b.restitution, s.restitution)
        );
    }
    const Vec3 center = s.center;
    if (inside && s.cylinderClosedBottom) {
        Vec3 up{0, 1, 0};
        const float d = center.y - s.cylinderHalfHeight;
        resolveStaticPlane(b, up, d, s, spec);
    }
}

void DicePhysicsEngine::generateStaticContacts(RigidBody& b, size_t dieIndex, float spec) {
    (void)dieIndex;
    if (b.kinematic) return;
    for (const auto& s : statics_) {
        const bool cylinder = s.shape == StaticShapeType::OpenCylinder;
        const float sr = cylinder ? (s.cylinderRadius + s.cylinderHalfHeight) : (s.boundRadius + 0.01f);
        const float maxR = b.radius + sr + spec + 0.05f;
        const Vec3 delta = (cylinder ? s.center : s.boundCenter) - b.position;
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
    CylinderPlane planes[32];
    bool inside = false;
    const int n = openCylinderPlanes(s, b.position, b.radius, spec, planes, inside);
    const int dynIndex = static_cast<int>(&b - dynamics_.data());
    for (int k = 0; k < n; ++k) {
        addPlaneContacts(
            ManifoldKind::DynamicStatic, b.userId, s.userId, planes[k].aux,
            dynIndex, -1, planes[k].normal, planes[k].dist, b.worldVerts, b.position, b.radius,
            spec, std::sqrt(b.friction * s.friction), std::min(b.restitution, s.restitution)
        );
    }
    const Vec3 center = s.center;
    if (inside && s.cylinderClosedBottom) {
        resolveDynamicStaticPlane(b, Vec3{0, 1, 0}, center.y - s.cylinderHalfHeight, s, spec);
    }
}

void DicePhysicsEngine::generateDynamicStaticContacts(DynamicBody& b, size_t dynIndex, float spec) {
    (void)dynIndex;
    if (b.kinematic) return;
    for (const auto& s : statics_) {
        // Same bounding-sphere reject as generateStaticContacts: every static
        // used to be tested against every prop, every substep.
        const bool cylinder = s.shape == StaticShapeType::OpenCylinder;
        const float sr = cylinder ? (s.cylinderRadius + s.cylinderHalfHeight) : (s.boundRadius + 0.01f);
        const float maxR = b.radius + sr + spec + 0.05f;
        const Vec3 delta = (cylinder ? s.center : s.boundCenter) - b.position;
        if (s.shape != StaticShapeType::Plane && delta.lengthSq() > maxR * maxR) continue;
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
    forEachDieDynamicPair([&](size_t di, size_t pi) {
        auto& die = bodies_[di];
        auto& prop = dynamics_[pi];
        stats.pairCandidates++;
        if (die.kinematic && prop.kinematic) return;
        if (die.sleeping && prop.sleeping) return;
        Vec3 delta = prop.position - die.position;
        const float distSq = delta.lengthSq();
        const float combinedR = die.radius + prop.radius + spec;
        if (distSq >= combinedR * combinedR) return;
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
            if (!m) return;
            m->indexA = static_cast<int>(di);
            m->indexB = static_cast<int>(pi);
            m->friction = mu;
            m->restitution = rest;
            commitManifoldPoints(*m, pts, 1, normal);
        }
        auto* found = matchManifold(ManifoldKind::DieDynamic, die.id, prop.userId, 0);
        if (!found || found->stale) return;
        // Wake the sleeper only. wake() also clears sleepTimer, so waking
        // both every substep kept a die resting against a prop (and the
        // prop) awake for ever (#341). The island pass handles the rest.
        if (die.sleeping != prop.sleeping) {
            wake(die);
            wake(prop);
        }
        Vec3 relVel = prop.velocity - die.velocity;
        float speed = std::abs(Vec3::dot(relVel, found->normal));
        if (speed > 0.5f && events_.size() < static_cast<size_t>(MAX_EVENTS_PER_STEP)) {
            events_.push_back(makeEvent(die, dynamicEventOtherId(prop.userId), speed));
        }
    }, spec);
}

void DicePhysicsEngine::generateDynamicDynamicContacts(float spec, StepStats& stats) {
    forEachDynamicPair([&](size_t i, size_t j) {
        auto& a = dynamics_[i];
        auto& b = dynamics_[j];
        stats.pairCandidates++;
        if (a.kinematic && b.kinematic) return;
        if (a.sleeping && b.sleeping) return;
        Vec3 delta = b.position - a.position;
        const float distSq = delta.lengthSq();
        const float combinedR = a.radius + b.radius + spec;
        if (distSq >= combinedR * combinedR) return;
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
        if (!found || found->stale) return;
        if (a.sleeping != b.sleeping) {
            wake(a);
            wake(b);
        }
    }, spec);
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
    const float invDt = dt > 0.0f ? 1.0f / dt : 0.0f;
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
                    // Speculative: allow approach until the gap closes this
                    // substep, no faster. (This used to cancel all approach
                    // velocity however wide the gap, so a die hovered over
                    // any point within the margin — which is why the near
                    // vertices of a resting face had to be left out, leaving
                    // it balanced on one corner for seconds. #341)
                    j = -(velN + p.separation * invDt) / denom;
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

void DicePhysicsEngine::computeIslands(std::vector<int>& root, std::vector<float>& islandKe) const {
    const int dieN = static_cast<int>(bodies_.size());
    const int dynN = static_cast<int>(dynamics_.size());
    const int n = dieN + dynN;
    root.assign(static_cast<size_t>(n), 0);
    islandKe.assign(static_cast<size_t>(n), 0.0f);
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

    for (const auto& m : manifolds_) {
        if (m.indexA < 0 || m.indexB < 0) continue;
        if (m.kind == ManifoldKind::DieDie) {
            unite(m.indexA, m.indexB);
        } else if (m.kind == ManifoldKind::DieDynamic) {
            unite(m.indexA, dieN + m.indexB);
        } else if (m.kind == ManifoldKind::DynamicDynamic) {
            unite(dieN + m.indexA, dieN + m.indexB);
        }
    }

    for (int i = 0; i < n; ++i) root[static_cast<size_t>(i)] = find(i);
    auto accumulate = [&](int node, const auto& b) {
        if (b.kinematic) return;
        const float ke = 0.5f * b.mass * b.velocity.lengthSq()
            + 0.5f * inertiaScalar(b) * b.angularVelocity.lengthSq();
        float& slot = islandKe[static_cast<size_t>(root[static_cast<size_t>(node)])];
        slot = std::max(slot, ke);
    };
    for (int i = 0; i < dieN; ++i) accumulate(i, bodies_[static_cast<size_t>(i)]);
    for (int i = 0; i < dynN; ++i) accumulate(dieN + i, dynamics_[static_cast<size_t>(i)]);
}

void DicePhysicsEngine::updateIslandSleep(float dt) {
    const int dieN = static_cast<int>(bodies_.size());
    const int dynN = static_cast<int>(dynamics_.size());
    if (dieN + dynN <= 0) return;
    std::vector<int> roots;
    std::vector<float> islandKe;
    computeIslands(roots, islandKe);
    auto find = [&](int node) { return roots[static_cast<size_t>(node)]; };
    auto dieNode = [&](int idx) { return idx; };
    auto dynNode = [&](int idx) { return dieN + idx; };

    for (int i = 0; i < dieN; ++i) {
        auto& b = bodies_[static_cast<size_t>(i)];
        if (b.kinematic) continue;
        const int root = find(dieNode(i));
        if (islandKe[static_cast<size_t>(root)] >= SLEEP_ENERGY_THRESHOLD) {
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
        if (islandKe[static_cast<size_t>(root)] >= SLEEP_ENERGY_THRESHOLD) {
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
}

void DicePhysicsEngine::solveContacts(float dt) {
    prepareVelocityConstraints(dt);
    warmStartManifolds();
    solveVelocityConstraints(dt);
    solvePositionConstraints();
    // No post-solve velocity projection. There used to be one that stripped
    // a body's centre-of-mass velocity along any static/world contact normal,
    // to mop up residual approach velocity from one-point SAT contacts. It
    // also stopped a die tipping over a vertex from letting its centre of
    // mass fall, so it pivoted upward on that vertex for seconds (#341).
    // Multi-point manifolds made it unnecessary.
}

} // namespace dice_physics
