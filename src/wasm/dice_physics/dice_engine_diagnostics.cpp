/**
 * dice_engine_diagnostics.cpp — Read-only introspection of the sleep policy:
 * allAsleep() and buildSleepDiagnostics(), so a settle timeout in the app or
 * a test can say which body is awake and what it is touching (#341).
 */

#include "../dice_physics_engine.hpp"

#include <algorithm>
#include <cmath>

namespace dice_physics {

namespace {

bool isDieKind(ManifoldKind k) {
    switch (k) {
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

struct ManifoldRef {
    int kind = -1;
    int otherId = -1;
    int materialTag = -1;
    float deepest = 0.0f;
};

} // namespace

bool DicePhysicsEngine::allAsleep() const {
    for (const auto& b : bodies_) {
        if (b.kinematic) continue;
        if (!b.sleeping) return false;
    }
    return true;
}

const std::vector<float>& DicePhysicsEngine::buildSleepDiagnostics() {
    const int dieN = static_cast<int>(bodies_.size());
    const int dynN = static_cast<int>(dynamics_.size());
    std::vector<int> roots;
    std::vector<float> islandKe;
    computeIslands(roots, islandKe);
    std::vector<int> islandSize(static_cast<size_t>(dieN + dynN), 0);
    for (int r : roots) islandSize[static_cast<size_t>(r)]++;

    auto staticTag = [&](int userId) {
        for (const auto& s : statics_) {
            if (s.userId == userId) return static_cast<int>(s.materialTag);
        }
        return -1;
    };

    // Collects the manifolds touching one body: `isDie` selects which index
    // space `index` lives in.
    auto collect = [&](bool isDie, int index, std::vector<ManifoldRef>& out, int& points) {
        out.clear();
        points = 0;
        for (const auto& m : manifolds_) {
            if (m.stale || m.pointCount <= 0) continue;
            const bool asA = isDie ? (isDieKind(m.kind) && m.indexA == index)
                                   : (!isDieKind(m.kind) && m.indexA == index);
            const bool asB = isDie ? (m.kind == ManifoldKind::DieDie && m.indexB == index)
                                   : ((m.kind == ManifoldKind::DieDynamic ||
                                       m.kind == ManifoldKind::DynamicDynamic) &&
                                      m.indexB == index);
            if (!asA && !asB) continue;
            ManifoldRef ref;
            ref.kind = static_cast<int>(m.kind);
            ref.deepest = 1e20f;
            for (int i = 0; i < m.pointCount; ++i) ref.deepest = std::min(ref.deepest, m.points[i].separation);
            points += m.pointCount;
            switch (m.kind) {
                case ManifoldKind::DieTable:
                case ManifoldKind::DieWall:
                case ManifoldKind::DieContainer:
                case ManifoldKind::DynamicTable:
                case ManifoldKind::DynamicWall:
                case ManifoldKind::DynamicContainer:
                    ref.otherId = -1;
                    break;
                case ManifoldKind::DieStatic:
                case ManifoldKind::DynamicStatic:
                    ref.otherId = m.idB;
                    ref.materialTag = staticTag(m.idB);
                    break;
                default:
                    ref.otherId = asA ? m.idB : m.idA;
                    break;
            }
            out.push_back(ref);
        }
        std::sort(out.begin(), out.end(),
                  [](const ManifoldRef& a, const ManifoldRef& b) { return a.deepest < b.deepest; });
    };

    sleepDiagBuffer_.assign(static_cast<size_t>((dieN + dynN) * SLEEP_DIAG_STRIDE), -1.0f);
    std::vector<ManifoldRef> refs;
    auto emit = [&](int node, int kind, const auto& b, float radius, bool isDie, int index) {
        float* rec = sleepDiagBuffer_.data() + static_cast<size_t>(node) * SLEEP_DIAG_STRIDE;
        int points = 0;
        collect(isDie, index, refs, points);
        const int root = roots[static_cast<size_t>(node)];
        rec[0] = static_cast<float>(kind);
        rec[1] = static_cast<float>(isDie ? bodies_[static_cast<size_t>(index)].id
                                          : dynamics_[static_cast<size_t>(index)].userId);
        rec[2] = b.sleeping ? 1.0f : 0.0f;
        rec[3] = b.kinematic ? 1.0f : 0.0f;
        rec[4] = b.velocity.length();
        rec[5] = b.angularVelocity.length() * radius;
        rec[6] = b.sleepTimer;
        rec[7] = 0.5f * b.mass * b.velocity.lengthSq() + 0.5f * inertiaScalar(b) * b.angularVelocity.lengthSq();
        rec[8] = islandKe[static_cast<size_t>(root)];
        rec[9] = static_cast<float>(islandSize[static_cast<size_t>(root)]);
        rec[10] = static_cast<float>(refs.size());
        rec[11] = static_cast<float>(points);
        rec[12] = refs.empty() ? 0.0f : refs.front().deepest;
        for (int k = 0; k < SLEEP_DIAG_MANIFOLDS && k < static_cast<int>(refs.size()); ++k) {
            float* slot = rec + 13 + k * 4;
            slot[0] = static_cast<float>(refs[static_cast<size_t>(k)].kind);
            slot[1] = static_cast<float>(refs[static_cast<size_t>(k)].otherId);
            slot[2] = static_cast<float>(refs[static_cast<size_t>(k)].materialTag);
            slot[3] = refs[static_cast<size_t>(k)].deepest;
        }
    };
    for (int i = 0; i < dieN; ++i) {
        const auto& b = bodies_[static_cast<size_t>(i)];
        emit(i, 0, b, b.radius, true, i);
    }
    for (int i = 0; i < dynN; ++i) {
        const auto& d = dynamics_[static_cast<size_t>(i)];
        emit(dieN + i, 1, d, d.radius, false, i);
    }
    return sleepDiagBuffer_;
}

} // namespace dice_physics
