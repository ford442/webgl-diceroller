/**
 * dice_sat.hpp — SAT collision helpers (exported for unit tests) and the
 * deterministic PRNG.
 *
 * Part of the dice_physics_engine module split; included by
 * dice_physics_engine.hpp.
 */

#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>

#include "dice_math.hpp"
#include "dice_types.hpp"

#if defined(__wasm_simd128__)
#include <wasm_simd128.h>
#endif

namespace dice_physics {

inline Mat3 mat3FromQuat(const Quat& q) {
    const float xx = q.x * q.x;
    const float yy = q.y * q.y;
    const float zz = q.z * q.z;
    const float xy = q.x * q.y;
    const float xz = q.x * q.z;
    const float yz = q.y * q.z;
    const float wx = q.w * q.x;
    const float wy = q.w * q.y;
    const float wz = q.w * q.z;
    return {
        1.0f - 2.0f * (yy + zz), 2.0f * (xy - wz), 2.0f * (xz + wy),
        2.0f * (xy + wz), 1.0f - 2.0f * (xx + zz), 2.0f * (yz - wx),
        2.0f * (xz - wy), 2.0f * (yz + wx), 1.0f - 2.0f * (xx + yy),
    };
}

inline void transformHullVerts(const Vec3* local, int count, const Quat& rot, const Vec3& pos,
                               Vec3* out) {
#if defined(__wasm_simd128__) && !defined(DICE_FORCE_SCALAR_SAT)
    const Mat3 R = mat3FromQuat(rot);
    const v128_t row0x = wasm_f32x4_splat(R.m[0]);
    const v128_t row0y = wasm_f32x4_splat(R.m[1]);
    const v128_t row0z = wasm_f32x4_splat(R.m[2]);
    const v128_t row1x = wasm_f32x4_splat(R.m[3]);
    const v128_t row1y = wasm_f32x4_splat(R.m[4]);
    const v128_t row1z = wasm_f32x4_splat(R.m[5]);
    const v128_t row2x = wasm_f32x4_splat(R.m[6]);
    const v128_t row2y = wasm_f32x4_splat(R.m[7]);
    const v128_t row2z = wasm_f32x4_splat(R.m[8]);
    const v128_t px = wasm_f32x4_splat(pos.x);
    const v128_t py = wasm_f32x4_splat(pos.y);
    const v128_t pz = wasm_f32x4_splat(pos.z);
    int i = 0;
    for (; i + 3 < count; i += 4) {
        const v128_t vx = wasm_f32x4_make(local[i].x, local[i + 1].x, local[i + 2].x, local[i + 3].x);
        const v128_t vy = wasm_f32x4_make(local[i].y, local[i + 1].y, local[i + 2].y, local[i + 3].y);
        const v128_t vz = wasm_f32x4_make(local[i].z, local[i + 1].z, local[i + 2].z, local[i + 3].z);
        const v128_t ox = wasm_f32x4_add(
            wasm_f32x4_add(wasm_f32x4_add(wasm_f32x4_mul(vx, row0x), wasm_f32x4_mul(vy, row0y)),
                           wasm_f32x4_mul(vz, row0z)),
            px);
        const v128_t oy = wasm_f32x4_add(
            wasm_f32x4_add(wasm_f32x4_add(wasm_f32x4_mul(vx, row1x), wasm_f32x4_mul(vy, row1y)),
                           wasm_f32x4_mul(vz, row1z)),
            py);
        const v128_t oz = wasm_f32x4_add(
            wasm_f32x4_add(wasm_f32x4_add(wasm_f32x4_mul(vx, row2x), wasm_f32x4_mul(vy, row2y)),
                           wasm_f32x4_mul(vz, row2z)),
            pz);
        out[i].x = wasm_f32x4_extract_lane(ox, 0);
        out[i].y = wasm_f32x4_extract_lane(oy, 0);
        out[i].z = wasm_f32x4_extract_lane(oz, 0);
        out[i + 1].x = wasm_f32x4_extract_lane(ox, 1);
        out[i + 1].y = wasm_f32x4_extract_lane(oy, 1);
        out[i + 1].z = wasm_f32x4_extract_lane(oz, 1);
        out[i + 2].x = wasm_f32x4_extract_lane(ox, 2);
        out[i + 2].y = wasm_f32x4_extract_lane(oy, 2);
        out[i + 2].z = wasm_f32x4_extract_lane(oz, 2);
        out[i + 3].x = wasm_f32x4_extract_lane(ox, 3);
        out[i + 3].y = wasm_f32x4_extract_lane(oy, 3);
        out[i + 3].z = wasm_f32x4_extract_lane(oz, 3);
    }
    for (; i < count; ++i) {
        out[i] = rot.rotate(local[i]) + pos;
    }
#else
    for (int i = 0; i < count; ++i) {
        out[i] = rot.rotate(local[i]) + pos;
    }
#endif
}

inline void projectHullOntoAxis(const Vec3* pts, int count, const Vec3& axis,
                                float& outMin, float& outMax) {
#if defined(__wasm_simd128__) && !defined(DICE_FORCE_SCALAR_SAT)
    const v128_t ax = wasm_f32x4_splat(axis.x);
    const v128_t ay = wasm_f32x4_splat(axis.y);
    const v128_t az = wasm_f32x4_splat(axis.z);
    float minP = 1e20f;
    float maxP = -1e20f;
    int i = 0;
    for (; i + 3 < count; i += 4) {
        const v128_t px = wasm_f32x4_make(pts[i].x, pts[i + 1].x, pts[i + 2].x, pts[i + 3].x);
        const v128_t py = wasm_f32x4_make(pts[i].y, pts[i + 1].y, pts[i + 2].y, pts[i + 3].y);
        const v128_t pz = wasm_f32x4_make(pts[i].z, pts[i + 1].z, pts[i + 2].z, pts[i + 3].z);
        const v128_t dot = wasm_f32x4_add(
            wasm_f32x4_add(wasm_f32x4_mul(px, ax), wasm_f32x4_mul(py, ay)),
            wasm_f32x4_mul(pz, az));
        // Ordered lane reduction — same min/max sequence as the scalar loop.
        {
            const float p0 = wasm_f32x4_extract_lane(dot, 0);
            minP = std::min(minP, p0);
            maxP = std::max(maxP, p0);
            const float p1 = wasm_f32x4_extract_lane(dot, 1);
            minP = std::min(minP, p1);
            maxP = std::max(maxP, p1);
            const float p2 = wasm_f32x4_extract_lane(dot, 2);
            minP = std::min(minP, p2);
            maxP = std::max(maxP, p2);
            const float p3 = wasm_f32x4_extract_lane(dot, 3);
            minP = std::min(minP, p3);
            maxP = std::max(maxP, p3);
        }
    }
    for (; i < count; ++i) {
        const float p = Vec3::dot(pts[i], axis);
        minP = std::min(minP, p);
        maxP = std::max(maxP, p);
    }
    outMin = minP;
    outMax = maxP;
#else
    float minP = 1e20f;
    float maxP = -1e20f;
    for (int i = 0; i < count; ++i) {
        const float p = Vec3::dot(pts[i], axis);
        minP = std::min(minP, p);
        maxP = std::max(maxP, p);
    }
    outMin = minP;
    outMax = maxP;
#endif
}

inline bool satTest(const PolyHull& ha, const Vec3& posA, const Quat& rotA,
                    const PolyHull& hb, const Vec3& posB, const Quat& rotB,
                    Vec3& outNormal, float& outPenetration, Vec3& outContact) {
    const int MAX_AXES = 256;
    Vec3 axes[MAX_AXES];
    int axisCount = 0;

    for (const auto& n : ha.faceNormals) axes[axisCount++] = rotA.rotate(n);
    for (const auto& n : hb.faceNormals) axes[axisCount++] = rotB.rotate(n);
    for (const auto& ea : ha.edgeDirs) {
        Vec3 wea = rotA.rotate(ea);
        for (const auto& eb : hb.edgeDirs) {
            Vec3 web = rotB.rotate(eb);
            Vec3 ax = Vec3::cross(wea, web);
            if (ax.lengthSq() > 1e-4f) {
                ax = ax.normalized();
                bool dup = false;
                for (int i = 0; i < axisCount; ++i) {
                    if (std::abs(Vec3::dot(axes[i], ax)) > 0.99f) { dup = true; break; }
                }
                if (!dup && axisCount < MAX_AXES) axes[axisCount++] = ax;
            }
        }
    }

    Vec3 wa[32], wb[32];
    int na = static_cast<int>(ha.verts.size());
    int nb = static_cast<int>(hb.verts.size());
    transformHullVerts(ha.verts.data(), na, rotA, posA, wa);
    transformHullVerts(hb.verts.data(), nb, rotB, posB, wb);

    outPenetration = 1e20f;
    bool normalFromA = true;

    for (int ai = 0; ai < axisCount; ++ai) {
        const Vec3& axis = axes[ai];
        float minA = 0.0f, maxA = 0.0f;
        float minB = 0.0f, maxB = 0.0f;
        projectHullOntoAxis(wa, na, axis, minA, maxA);
        projectHullOntoAxis(wb, nb, axis, minB, maxB);
        float overlap = std::min(maxA, maxB) - std::max(minA, minB);
        if (overlap < -1e-3f) return false;
        if (overlap < outPenetration) {
            outPenetration = overlap;
            outNormal = axis;
            normalFromA = (maxA - minA) < (maxB - minB);
        }
    }

    if (Vec3::dot(outNormal, posB - posA) < 0) outNormal = outNormal * -1.0f;

    float deepest = -1e20f;
    if (normalFromA) {
        for (int i = 0; i < nb; ++i) {
            float d = Vec3::dot(wb[i] - posA, outNormal);
            if (d > deepest) { deepest = d; outContact = wb[i]; }
        }
    } else {
        for (int i = 0; i < na; ++i) {
            float d = Vec3::dot(wa[i] - posB, outNormal * -1.0f);
            if (d > deepest) { deepest = d; outContact = wa[i]; }
        }
    }
    return true;
}

inline void sphereContact(const RigidBody& a, const RigidBody& b,
                          Vec3& outNormal, float& outPenetration, Vec3& outContact) {
    Vec3 delta = b.position - a.position;
    float dist = delta.length();
    outNormal = dist > 1e-4f ? (delta / dist) : Vec3{1,0,0};
    outPenetration = (a.radius + b.radius) - dist;
    outContact = a.position + outNormal * a.radius;
}

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------

class DeterministicRNG {
    uint64_t state_ = 0x123456789ABCDEF0ULL;
public:
    void seed(uint64_t s) { state_ = s ? s : 0x123456789ABCDEF0ULL; }
    uint64_t state() const { return state_; }
    uint64_t next() {
        state_ ^= state_ >> 12;
        state_ ^= state_ << 25;
        state_ ^= state_ >> 27;
        return state_ * 0x2545F4914F6CDD1DULL;
    }
    float nextFloat() {
        return static_cast<float>(next() >> 32) * (1.0f / 4294967296.0f);
    }
};

} // namespace dice_physics
