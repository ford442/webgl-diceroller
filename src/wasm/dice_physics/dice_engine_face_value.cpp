/**
 * dice_engine_face_value.cpp — Engine-authoritative die face settlement.
 *
 * Face normals are uploaded per die via setDieFaceTable (nx,ny,nz,value × N) in
 * the same local frame as the visual mesh (post center/rotateX(-π/2) pipeline).
 * d4 uses the bottom face (minimum dot with local-up); all other dice use top.
 */

#include "../dice_physics_engine.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cfloat>
#include <vector>

namespace dice_physics {

namespace {

int computeDieFaceValue(const RigidBody& body, bool requireSleep = true) {
    if (requireSleep && (!body.sleeping || body.kinematic)) return 0;
    if (body.faceTable.empty()) return 0;

    const Vec3 localUp = body.rotation.conjugate().rotate(Vec3{0.0f, 1.0f, 0.0f});
    const bool useBottomFace = (body.sides == 4);
    float bestDot = useBottomFace ? FLT_MAX : -FLT_MAX;
    int bestValue = 0;

    for (const FaceEntry& face : body.faceTable) {
        const float dot = Vec3::dot(localUp, face.normal);
        if (useBottomFace) {
            if (dot < bestDot) {
                bestDot = dot;
                bestValue = face.value;
            }
        } else if (dot > bestDot) {
            bestDot = dot;
            bestValue = face.value;
        }
    }

    return bestValue;
}

} // namespace

void DicePhysicsEngine::setDieFaceTable(int id, const std::vector<float>& packed) {
    if (packed.size() % 4 != 0) return;
    for (auto& b : bodies_) {
        if (b.id != id) continue;
        b.faceTable.clear();
        b.faceTable.reserve(packed.size() / 4);
        for (size_t i = 0; i < packed.size(); i += 4) {
            const float nx = packed[i];
            const float ny = packed[i + 1];
            const float nz = packed[i + 2];
            const float valueF = packed[i + 3];
            if (std::isnan(nx) || std::isnan(ny) || std::isnan(nz) || std::isnan(valueF)) continue;
            const int value = static_cast<int>(valueF);
            if (value <= 0) continue;
            b.faceTable.push_back({Vec3{nx, ny, nz}.normalized(), value});
        }
        break;
    }
}

int DicePhysicsEngine::getDieFaceValue(int id) const {
    for (const auto& b : bodies_) {
        if (b.id != id) return 0;
        return computeDieFaceValue(b, true);
    }
    return 0;
}

const std::vector<int32_t>& DicePhysicsEngine::buildFaceValueBuffer() {
    faceValueBuffer_.clear();
    faceValueBuffer_.reserve(bodies_.size());
    for (const auto& b : bodies_) {
        faceValueBuffer_.push_back(static_cast<int32_t>(computeDieFaceValue(b, true)));
    }
    return faceValueBuffer_;
}

void DicePhysicsEngine::setDieSleepingForTesting(int id, bool sleeping) {
    for (auto& b : bodies_) {
        if (b.id != id) continue;
        b.sleeping = sleeping;
        if (sleeping) {
            b.velocity = {};
            b.angularVelocity = {};
        }
        break;
    }
}

} // namespace dice_physics
