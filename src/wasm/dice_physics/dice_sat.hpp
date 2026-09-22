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

/**
 * World-space inverse-inertia tensor R * diag(invInertiaLocal) * R^T, as a
 * dense Mat3 (symmetric, but stored dense to match Mat3::mul). Mathematically
 * equivalent to the two-quaternion-rotate form (`rot.rotate(invInertiaLocal
 * scaled rot.conjugate().rotate(v))`, see BodyView::applyInvInertiaWorld in
 * dice_contacts.hpp before this existed) for a fixed rotation applied to many
 * vectors — the sequential-impulse solver calls this ~VELOCITY_ITERATIONS
 * times per contact point per substep with a rotation that doesn't change
 * across those calls (integrate() only updates it once, before contact
 * solving starts), so computing R once per BodyView construction and reusing
 * it as a single Mat3::mul beats re-deriving it via two quaternion rotates
 * on every call.
 *
 * R*D*R^T with diagonal D = sum_k D_kk * outer(col_k(R), col_k(R)); expanded
 * directly here rather than through a generic 3x3 matrix multiply.
 */
inline Mat3 inertiaWorldMat3(const Quat& rot, const Vec3& invInertiaLocal) {
    const Mat3 R = mat3FromQuat(rot);
    const Vec3 col0{R.m[0], R.m[3], R.m[6]};
    const Vec3 col1{R.m[1], R.m[4], R.m[7]};
    const Vec3 col2{R.m[2], R.m[5], R.m[8]};

    Mat3 out = Mat3::diagonal(0.0f, 0.0f, 0.0f);
    auto addWeightedOuter = [&out](const Vec3& c, float w) {
        out.m[0] += w * c.x * c.x; out.m[1] += w * c.x * c.y; out.m[2] += w * c.x * c.z;
        out.m[3] += w * c.y * c.x; out.m[4] += w * c.y * c.y; out.m[5] += w * c.y * c.z;
        out.m[6] += w * c.z * c.x; out.m[7] += w * c.z * c.y; out.m[8] += w * c.z * c.z;
    };
    addWeightedOuter(col0, invInertiaLocal.x);
    addWeightedOuter(col1, invInertiaLocal.y);
    addWeightedOuter(col2, invInertiaLocal.z);
    return out;
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

inline bool satTestFromWorld(
    const PolyHull& ha, const Vec3& posA, const Quat& rotA, const Vec3* wa,
    const PolyHull& hb, const Vec3& posB, const Quat& rotB, const Vec3* wb,
    Vec3& outNormal, float& outPenetration, Vec3& outContact,
    uint32_t* outFeatureId = nullptr, bool* outNormalFromA = nullptr,
    float speculativeMargin = 1e-3f
) {
    const int MAX_AXES = 256;
    Vec3 axes[MAX_AXES];
    int axisCount = 0;
    int bestAxis = 0;

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

    if (axisCount <= 0) return false;

    int na = static_cast<int>(ha.verts.size());
    int nb = static_cast<int>(hb.verts.size());

    outPenetration = 1e20f;
    bool normalFromA = true;
    const Vec3 deltaCenters = posB - posA;
    const float deltaLen = deltaCenters.length();
    const Vec3 deltaDir = deltaLen > 1e-6f ? deltaCenters * (1.0f / deltaLen) : Vec3{0, 1, 0};
    float bestAlign = -1.0f;

    for (int ai = 0; ai < axisCount; ++ai) {
        const Vec3& axis = axes[ai];
        float minA = 0.0f, maxA = 0.0f;
        float minB = 0.0f, maxB = 0.0f;
        projectHullOntoAxis(wa, na, axis, minA, maxA);
        projectHullOntoAxis(wb, nb, axis, minB, maxB);
        float overlap = std::min(maxA, maxB) - std::max(minA, minB);
        if (overlap < -speculativeMargin) return false;
        const float align = std::abs(Vec3::dot(axis, deltaDir));
        const bool strictlyBetter = overlap < outPenetration - 1e-4f;
        const bool tieBreak = std::abs(overlap - outPenetration) <= 1e-4f && align > bestAlign;
        if (strictlyBetter || tieBreak) {
            outPenetration = overlap;
            outNormal = axis;
            normalFromA = (maxA - minA) < (maxB - minB);
            bestAxis = ai;
            bestAlign = align;
        }
    }

    if (Vec3::dot(outNormal, posB - posA) < 0) outNormal = outNormal * -1.0f;

    float deepest = -1e20f;
    int supportIndex = 0;
    if (normalFromA) {
        for (int i = 0; i < nb; ++i) {
            float d = Vec3::dot(wb[i] - posA, outNormal);
            if (d > deepest) { deepest = d; outContact = wb[i]; supportIndex = i; }
        }
    } else {
        for (int i = 0; i < na; ++i) {
            float d = Vec3::dot(wa[i] - posB, outNormal * -1.0f);
            if (d > deepest) { deepest = d; outContact = wa[i]; supportIndex = i; }
        }
    }
    if (outFeatureId) {
        *outFeatureId = (static_cast<uint32_t>(bestAxis) << 16) |
                        (static_cast<uint32_t>(supportIndex) & 0xFFFFu);
    }
    if (outNormalFromA) *outNormalFromA = normalFromA;
    return true;
}

inline bool satTest(const PolyHull& ha, const Vec3& posA, const Quat& rotA,
                    const PolyHull& hb, const Vec3& posB, const Quat& rotB,
                    Vec3& outNormal, float& outPenetration, Vec3& outContact,
                    uint32_t* outFeatureId = nullptr, bool* outNormalFromA = nullptr,
                    float speculativeMargin = 1e-3f) {
    Vec3 wa[64], wb[64];
    int na = static_cast<int>(ha.verts.size());
    int nb = static_cast<int>(hb.verts.size());
    if (na > 64 || nb > 64) return false;
    transformHullVerts(ha.verts.data(), na, rotA, posA, wa);
    transformHullVerts(hb.verts.data(), nb, rotB, posB, wb);
    return satTestFromWorld(ha, posA, rotA, wa, hb, posB, rotB, wb,
                            outNormal, outPenetration, outContact,
                            outFeatureId, outNormalFromA, speculativeMargin);
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
// Swept (continuous) tests
// ---------------------------------------------------------------------------

/**
 * First time in [0, 1] at which a sphere of `radius`, travelling along
 * `from` -> `to`, touches the oriented box (`center`, `rotation`,
 * `halfExtents`); false when it never does, or when it starts already
 * touching (t == 0 — that is the discrete solver's case, not ours).
 *
 * The sphere sweep is approximated by a ray against the box grown by `radius`
 * on each axis. That grown box strictly contains the true Minkowski sum
 * (which has rounded edges and corners), so the test never misses a real hit;
 * the over-coverage at the corners can only stop a body a shade early, which
 * a speculative contact would have done anyway.
 */
inline bool sweepSphereAgainstObb(
    const Vec3& from, const Vec3& to, float radius,
    const Vec3& center, const Quat& rotation, const Vec3& halfExtents,
    float& tOut
) {
    const Quat inv = rotation.conjugate();
    const Vec3 start = inv.rotate(from - center);
    const Vec3 end = inv.rotate(to - center);
    const Vec3 dir = end - start;

    const float e[3] = {halfExtents.x + radius, halfExtents.y + radius, halfExtents.z + radius};
    const float s[3] = {start.x, start.y, start.z};
    const float d[3] = {dir.x, dir.y, dir.z};

    float tmin = 0.0f;
    float tmax = 1.0f;
    for (int a = 0; a < 3; ++a) {
        if (std::abs(d[a]) < 1e-9f) {
            // Parallel to this slab: a start outside it never enters.
            if (std::abs(s[a]) > e[a]) return false;
            continue;
        }
        const float invD = 1.0f / d[a];
        float t1 = (-e[a] - s[a]) * invD;
        float t2 = (e[a] - s[a]) * invD;
        if (t1 > t2) std::swap(t1, t2);
        tmin = std::max(tmin, t1);
        tmax = std::min(tmax, t2);
        if (tmin > tmax) return false;
    }
    // A sweep that began *strictly inside* the grown box is the discrete
    // solver's case, not ours: the body is already in contact range, and
    // clipping it to zero motion here would freeze anything resting on a
    // collider. Tested explicitly rather than inferred from `tmin == 0`,
    // which also fires for a body sitting exactly on the surface and heading
    // through — that one is a real crossing and must be reported (a body
    // teleported onto a face, as a seeded drop can do, has had no prior
    // discrete pass to catch it).
    const bool startsInside =
        std::abs(s[0]) < e[0] && std::abs(s[1]) < e[1] && std::abs(s[2]) < e[2];
    if (startsInside) return false;
    tOut = std::max(0.0f, tmin);
    return true;
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
