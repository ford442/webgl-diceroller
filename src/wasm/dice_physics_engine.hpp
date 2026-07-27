/**
 * dice_physics_engine.hpp — Core C++ dice physics solver.
 *
 * Shared by the Emscripten WASM build (via dice_physics.cpp bindings) and the
 * native solver test harness (solver_tests.cpp).
 */

#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <functional>
#include <set>
#include <string>
#include <vector>

namespace dice_physics {

// ---------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------

struct Vec3 {
    float x = 0, y = 0, z = 0;

    Vec3() = default;
    Vec3(float x, float y, float z) : x(x), y(y), z(z) {}

    Vec3 operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
    Vec3 operator-(const Vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
    Vec3 operator*(float s)        const { return {x * s,   y * s,   z * s};   }
    Vec3 operator/(float s)        const { return {x / s,   y / s,   z / s};   }
    Vec3& operator+=(const Vec3& o) { x += o.x; y += o.y; z += o.z; return *this; }
    Vec3& operator-=(const Vec3& o) { x -= o.x; y -= o.y; z -= o.z; return *this; }

    static float dot(const Vec3& a, const Vec3& b) { return a.x*b.x + a.y*b.y + a.z*b.z; }
    static Vec3 cross(const Vec3& a, const Vec3& b) {
        return { a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x };
    }
    float lengthSq() const { return x*x + y*y + z*z; }
    float length()   const { return std::sqrt(lengthSq()); }
    Vec3 normalized() const {
        float l = length();
        return l < 1e-7f ? Vec3{} : *this * (1.0f / l);
    }
};

struct Quat {
    float x = 0, y = 0, z = 0, w = 1;

    Quat() = default;
    Quat(float x, float y, float z, float w) : x(x), y(y), z(z), w(w) {}

    Quat operator*(const Quat& o) const {
        return {
            w*o.x + x*o.w + y*o.z - z*o.y,
            w*o.y - x*o.z + y*o.w + z*o.x,
            w*o.z + x*o.y - y*o.x + z*o.w,
            w*o.w - x*o.x - y*o.y - z*o.z
        };
    }
    Quat conjugate() const { return {-x, -y, -z, w}; }
    Quat normalized() const {
        float l = std::sqrt(x*x + y*y + z*z + w*w);
        return l < 1e-7f ? Quat{0,0,0,1} : Quat{x/l, y/l, z/l, w/l};
    }
    Vec3 rotate(const Vec3& v) const {
        Vec3 qv = {x, y, z};
        Vec3 uv  = Vec3::cross(qv, v);
        Vec3 uuv = Vec3::cross(qv, uv);
        return v + (uv * (2.0f * w)) + (uuv * 2.0f);
    }
    Quat integrate(const Vec3& omega, float dt) const {
        float hx = omega.x * 0.5f * dt;
        float hy = omega.y * 0.5f * dt;
        float hz = omega.z * 0.5f * dt;
        Quat dq = {
            hx*w + hy*z - hz*y,
            hy*w + hz*x - hx*z,
            hz*w + hx*y - hy*x,
           -hx*x - hy*y - hz*z
        };
        return Quat{x+dq.x, y+dq.y, z+dq.z, w+dq.w}.normalized();
    }
};

struct Mat3 {
    float m[9];
    static Mat3 diagonal(float ix, float iy, float iz) {
        return { ix,0,0, 0,iy,0, 0,0,iz };
    }
    Vec3 mul(const Vec3& v) const {
        return {
            m[0]*v.x + m[1]*v.y + m[2]*v.z,
            m[3]*v.x + m[4]*v.y + m[5]*v.z,
            m[6]*v.x + m[7]*v.y + m[8]*v.z
        };
    }
};

// ---------------------------------------------------------------------------
// PolyHull
// ---------------------------------------------------------------------------

struct PolyHull {
    std::vector<Vec3> verts;
    std::vector<Vec3> faceNormals;
    std::vector<Vec3> edgeDirs;
    Vec3 aabbMin, aabbMax;

    void build(const std::vector<Vec3>& input) {
        verts = input;
        if (verts.empty()) return;

        aabbMin = aabbMax = verts[0];
        for (size_t i = 1; i < verts.size(); ++i) {
            aabbMin.x = std::min(aabbMin.x, verts[i].x);
            aabbMin.y = std::min(aabbMin.y, verts[i].y);
            aabbMin.z = std::min(aabbMin.z, verts[i].z);
            aabbMax.x = std::max(aabbMax.x, verts[i].x);
            aabbMax.y = std::max(aabbMax.y, verts[i].y);
            aabbMax.z = std::max(aabbMax.z, verts[i].z);
        }

        computeFaceNormals();
        computeEdgeDirections();
    }

    void computeFaceNormals() {
        const int n = static_cast<int>(verts.size());
        for (int i = 0; i < n; ++i) {
            for (int j = i+1; j < n; ++j) {
                for (int k = j+1; k < n; ++k) {
                    Vec3 e1 = verts[j] - verts[i];
                    Vec3 e2 = verts[k] - verts[i];
                    Vec3 nrm = Vec3::cross(e1, e2).normalized();
                    if (nrm.lengthSq() < 1e-6f) continue;

                    float d = Vec3::dot(nrm, verts[i]);
                    int pos = 0, neg = 0;
                    for (int m = 0; m < n; ++m) {
                        if (m == i || m == j || m == k) continue;
                        float side = Vec3::dot(nrm, verts[m]) - d;
                        if (side > 1e-4f) pos++;
                        if (side < -1e-4f) neg++;
                    }
                    if (pos > 0 && neg > 0) continue;

                    if (neg > 0) nrm = nrm * -1.0f;
                    bool exists = false;
                    for (const auto& fn : faceNormals) {
                        if (Vec3::dot(fn, nrm) > 0.995f) { exists = true; break; }
                    }
                    if (!exists) faceNormals.push_back(nrm);
                }
            }
        }
    }

    void computeEdgeDirections() {
        const int n = static_cast<int>(verts.size());
        float minDistSq = 1e20f;
        for (int i = 0; i < n; ++i) {
            for (int j = i+1; j < n; ++j) {
                float d = (verts[j] - verts[i]).lengthSq();
                if (d > 1e-6f && d < minDistSq) minDistSq = d;
            }
        }
        for (int i = 0; i < n; ++i) {
            for (int j = i+1; j < n; ++j) {
                float d = (verts[j] - verts[i]).lengthSq();
                if (std::abs(d - minDistSq) < 1e-3f) {
                    Vec3 dir = (verts[j] - verts[i]).normalized();
                    bool exists = false;
                    for (const auto& e : edgeDirs) {
                        if (std::abs(Vec3::dot(e, dir)) > 0.995f) { exists = true; break; }
                    }
                    if (!exists) edgeDirs.push_back(dir);
                }
            }
        }
    }
};

// ---------------------------------------------------------------------------
// Rigid body
// ---------------------------------------------------------------------------

struct RigidBody {
    int   id     = -1;
    int   sides  = 6;

    Vec3  position;
    Vec3  velocity;
    Quat  rotation;
    Vec3  angularVelocity;

    PolyHull hull;
    bool  useHull    = false;
    float radius     = 0.9f;
    float mass       = 5.0f;
    float invMass    = 0.2f;

    Vec3  invInertia = {0, 0, 0};

    float restitution = 0.2f;
    float friction    = 0.6f;
    float rollingFriction = 0.1f;
    float dragFactor = 0.0f;

    bool  sleeping    = false;
    float sleepTimer  = 0.0f;
    bool  kinematic   = false;

    void computeInertiaFromHull() {
        if (!useHull || hull.verts.empty()) {
            float i = 0.4f * mass * radius * radius;
            invInertia = {1.0f/i, 1.0f/i, 1.0f/i};
            return;
        }
        Vec3 dim = hull.aabbMax - hull.aabbMin;
        float ix = (1.0f / 12.0f) * mass * (dim.y*dim.y + dim.z*dim.z);
        float iy = (1.0f / 12.0f) * mass * (dim.x*dim.x + dim.z*dim.z);
        float iz = (1.0f / 12.0f) * mass * (dim.x*dim.x + dim.y*dim.y);
        invInertia = {1.0f/ix, 1.0f/iy, 1.0f/iz};
    }

    Vec3 applyInvInertiaWorld(const Vec3& v) const {
        Vec3 local = rotation.conjugate().rotate(v);
        local.x *= invInertia.x;
        local.y *= invInertia.y;
        local.z *= invInertia.z;
        return rotation.rotate(local);
    }
};

// ---------------------------------------------------------------------------
// Contact & event structures
// ---------------------------------------------------------------------------

struct Contact {
    int a = -1, b = -1;
    Vec3 normal;
    Vec3 point;
    float penetration = 0.0f;
    float normalImpulse = 0.0f;
    float frictionImpulse = 0.0f;
};

struct CollisionEvent {
    int idA = -1, idB = -1;
    float impactSpeed = 0.0f;
    float mass = 0.0f;
    float inertiaScalar = 0.0f;
    float linearSpeedSq = 0.0f;
    float angularSpeedSq = 0.0f;
    int staticColliderId = 0;
    int materialTag = 0;
};

struct StepStats {
    uint32_t pairCandidates = 0;
    uint32_t sphereTests = 0;
    uint32_t satTests = 0;
    uint32_t contacts = 0;
};

enum class StaticShapeType : uint8_t {
    Box = 0,
    Plane = 1,
    ConvexHull = 2,
    OpenCylinder = 3,
};

struct StaticBody {
    int userId = -1;
    StaticShapeType shape = StaticShapeType::Box;
    uint8_t materialTag = 0;
    Vec3 center{};
    Quat rotation{};
    float friction = 0.6f;
    float restitution = 0.2f;
    float rollingFriction = 0.1f;
    Vec3 halfExtents{};
    PolyHull hull;
    Vec3 planeNormal{};
    float planeDist = 0.0f;
    float cylinderRadius = 0.0f;
    float cylinderHalfHeight = 0.0f;
    int cylinderSegments = 8;
    bool cylinderClosedBottom = false;
};

// ---------------------------------------------------------------------------
// SAT helpers (exported for unit tests)
// ---------------------------------------------------------------------------

#if defined(__wasm_simd128__)
#include <wasm_simd128.h>
#endif

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

// ---------------------------------------------------------------------------
// Physics engine
// ---------------------------------------------------------------------------

class DicePhysicsEngine {
public:
    static constexpr int MAX_DICE = 500;
    static constexpr int MAX_VERTICES_PER_HULL = 64;
    static constexpr int MAX_EVENTS_PER_STEP = 1024;
    static constexpr uint32_t FLAG_NO_DRAG = 1u << 0;

    DicePhysicsEngine()
        : gravity_(-15.0f), tableY_(-2.75f), tableHalfW_(18.0f), tableHalfD_(18.0f), nextId_(0) {}

    void setFlags(uint32_t flags) {
        noDrag_ = (flags & FLAG_NO_DRAG) != 0;
    }

    void init(float gravity, float tableY, float tableHalfW, float tableHalfD) {
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

    void reset() { bodies_.clear(); contacts_.clear(); events_.clear(); statics_.clear(); nextId_ = 0; }

    int addDie(int sides, float x, float y, float z) {
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

    void removeDie(int id) {
        bodies_.erase(
            std::remove_if(bodies_.begin(), bodies_.end(),
                [id](const RigidBody& b) { return b.id == id; }),
            bodies_.end());
    }

    void clearAllDice() { bodies_.clear(); contacts_.clear(); events_.clear(); }

    void setDieMaterial(int id, float friction, float rollingFriction) {
        for (auto& b : bodies_) {
            if (b.id != id) continue;
            b.friction = std::clamp(friction, 0.0f, 2.0f);
            b.rollingFriction = std::clamp(rollingFriction, 0.0f, 1.0f);
            break;
        }
    }

    void setDieDrag(int id, float dragFactor) {
        for (auto& b : bodies_) {
            if (b.id != id) continue;
            b.dragFactor = std::max(0.0f, dragFactor);
            break;
        }
    }

    void setDieHull(int id, const std::vector<float>& flatVerts) {
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

    void applyImpulse(int id, float fx, float fy, float fz) {
        for (auto& b : bodies_) {
            if (b.id != id) continue;
            b.velocity += Vec3{fx, fy, fz} * b.invMass;
            wake(b);
            break;
        }
    }

    void applyTorqueImpulse(int id, float tx, float ty, float tz) {
        for (auto& b : bodies_) {
            if (b.id != id) continue;
            b.angularVelocity += b.applyInvInertiaWorld(Vec3{tx, ty, tz});
            wake(b);
            break;
        }
    }

    void setDieTransform(int id, float px, float py, float pz,
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

    void setDieVelocity(int id, float lvx, float lvy, float lvz,
                        float avx, float avy, float avz) {
        for (auto& b : bodies_) {
            if (b.id != id) continue;
            b.velocity = {lvx, lvy, lvz};
            b.angularVelocity = {avx, avy, avz};
            wake(b);
            break;
        }
    }

    void setDieKinematic(int id, bool kinematic) {
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

    /** Enable/disable interior container planes (dice cup walls). */
    void setContainerActive(bool active) { containerActive_ = active; }

    /**
     * Upload world-space container planes: 4 floats each (nx, ny, nz, d) where
     * dot(normal, point) >= d is the valid interior half-space. Up to 9 planes.
     */
    void setContainerPlanes(const std::vector<float>& flat) {
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

    /** Remove all registered static colliders (table bounds, props, cups). */
    void clearStatics() { statics_.clear(); }

    bool removeStatic(int userId) {
        const size_t before = statics_.size();
        statics_.erase(
            std::remove_if(statics_.begin(), statics_.end(),
                [userId](const StaticBody& s) { return s.userId == userId; }),
            statics_.end());
        return statics_.size() < before;
    }

    /**
     * Axis-aligned box in local space, posed by center + quaternion.
     * materialTag: 0=default, 1=velvet, 2=wood, 3=metal, 4=leather
     */
    int addStaticBox(int userId,
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

    /** World-space plane: valid interior half-space is dot(normal, p) >= dist. */
    int addStaticPlane(int userId, float nx, float ny, float nz, float dist, int materialTag) {
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

    /** Convex hull vertices in local space (flat xyz). */
    int addStaticConvexHull(int userId,
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

    /**
     * Open cylinder aligned on Y: N inward radial planes + optional bottom cap.
     * segments clamped to [3, 32].
     */
    int addStaticOpenCylinder(int userId,
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

    void step(float dt) {
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

    int getDieCount() const { return static_cast<int>(bodies_.size()); }

    const StepStats& getLastStepStats() const { return lastStepStats_; }

    /** Test hook: disable broadphase to compare against brute-force pair generation. */
    void setBroadphaseForTesting(bool enabled) { useBroadphase_ = enabled; }

    /** Test hook: enumerate die–die pair indices without running the solver. */
    std::vector<std::pair<size_t, size_t>> collectDiePairsForTesting(bool useBroadphase) {
        const bool saved = useBroadphase_;
        useBroadphase_ = useBroadphase;
        std::set<std::pair<size_t, size_t>> pairSet;
        forEachDiePair([&](size_t i, size_t j) { pairSet.insert({i, j}); });
        useBroadphase_ = saved;
        return {pairSet.begin(), pairSet.end()};
    }

    bool areAllSettled() const {
        if (bodies_.empty()) return false;
        for (const auto& b : bodies_) {
            if (b.kinematic) continue;
            if (!b.sleeping) return false;
        }
        return true;
    }

    const std::vector<float>& buildTransformBuffer() {
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

    const std::vector<float>& buildDieIdBuffer() {
        idBuffer_.clear();
        idBuffer_.reserve(bodies_.size());
        for (const auto& b : bodies_) {
            idBuffer_.push_back(static_cast<float>(b.id));
        }
        return idBuffer_;
    }

    const std::vector<float>& buildCollisionEventBuffer() {
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

    void seedRNG(uint64_t s) { rng_.seed(s); }
    float randomFloat() { return rng_.nextFloat(); }

    std::vector<uint8_t> serializeState() const {
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

    void deserializeState(const std::vector<uint8_t>& data) {
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

    // Test / fuzz invariant helpers
    bool allBodyStatesFinite() const {
        for (const auto& b : bodies_) {
            auto bad = [](float v) { return !std::isfinite(v); };
            if (bad(b.position.x) || bad(b.position.y) || bad(b.position.z)) return false;
            if (bad(b.velocity.x) || bad(b.velocity.y) || bad(b.velocity.z)) return false;
            if (bad(b.angularVelocity.x) || bad(b.angularVelocity.y) || bad(b.angularVelocity.z)) return false;
            if (bad(b.rotation.x) || bad(b.rotation.y) || bad(b.rotation.z) || bad(b.rotation.w)) return false;
        }
        return true;
    }

    bool allRotationsUnitLength(float eps = 1e-3f) const {
        for (const auto& b : bodies_) {
            float lenSq = b.rotation.x*b.rotation.x + b.rotation.y*b.rotation.y
                          + b.rotation.z*b.rotation.z + b.rotation.w*b.rotation.w;
            if (std::abs(lenSq - 1.0f) > eps) return false;
        }
        return true;
    }

    bool allBodyStatesInWorldBounds(float margin) const {
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

    float totalKineticEnergy() const {
        float total = 0.0f;
        for (const auto& b : bodies_) {
            if (b.kinematic) continue;
            total += 0.5f * b.mass * b.velocity.lengthSq()
                  + 0.5f * inertiaScalar(b) * b.angularVelocity.lengthSq();
        }
        return total;
    }

    float tableHalfW() const { return tableHalfW_; }
    float tableHalfD() const { return tableHalfD_; }
    float tableY() const { return tableY_; }

    bool getDiePosition(int id, float& x, float& y, float& z) const {
        for (const auto& b : bodies_) {
            if (b.id != id) continue;
            x = b.position.x;
            y = b.position.y;
            z = b.position.z;
            return true;
        }
        return false;
    }

private:
    static constexpr int MAX_CONTAINER_PLANES = 9;
    static constexpr int CONTAINER_EVENT_ID_BASE = -100;
    static constexpr int MAX_STATICS = 128;
    static constexpr int STATIC_EVENT_ID_BASE = -2000;
    static constexpr int TABLE_MATERIAL_TAG = 1; // velvet

    struct ContainerPlane {
        Vec3 normal;
        float dist;
    };

    float gravity_, tableY_, tableHalfW_, tableHalfD_;
    int nextId_;
    std::vector<RigidBody> bodies_;
    std::vector<StaticBody> statics_;
    std::vector<Contact> contacts_;
    std::vector<CollisionEvent> events_;
    std::vector<ContainerPlane> containerPlanes_;
    mutable std::vector<float> transformBuffer_;
    mutable std::vector<float> idBuffer_;
    mutable std::vector<float> eventBuffer_;
    DeterministicRNG rng_;
    bool noDrag_ = false;
    bool containerActive_ = false;
    StepStats lastStepStats_;
    bool useBroadphase_ = true;

    static constexpr float GRID_CELL_SIZE = 2.2f;
    std::vector<std::vector<size_t>> dieGridCells_;
    int gridCols_ = 0;
    int gridRows_ = 0;
    float gridOriginX_ = 0.0f;
    float gridOriginZ_ = 0.0f;

    static float radiusForSides(int sides) {
        switch (sides) {
            case  4: return 0.80f;
            case  6: return 0.90f;
            case  8: return 0.85f;
            case 10: return 0.88f;
            case 12: return 0.93f;
            case 20: return 1.00f;
            default: return 0.90f;
        }
    }

    static float inertiaScalar(const RigidBody& b) {
        if (!b.useHull || b.hull.verts.empty()) {
            return 0.4f * b.mass * b.radius * b.radius;
        }
        Vec3 dim = b.hull.aabbMax - b.hull.aabbMin;
        float ix = (1.0f / 12.0f) * b.mass * (dim.y*dim.y + dim.z*dim.z);
        float iy = (1.0f / 12.0f) * b.mass * (dim.x*dim.x + dim.z*dim.z);
        float iz = (1.0f / 12.0f) * b.mass * (dim.x*dim.x + dim.y*dim.y);
        return (ix + iy + iz) / 3.0f;
    }

    static CollisionEvent makeEvent(
        const RigidBody& primary,
        int otherId,
        float impactSpeed,
        float linearSpeedSq = -1.0f,
        float angularSpeedSq = -1.0f,
        int staticColliderId = 0,
        int materialTag = 0
    ) {
        return {
            primary.id,
            otherId,
            impactSpeed,
            primary.mass,
            inertiaScalar(primary),
            linearSpeedSq >= 0.0f ? linearSpeedSq : primary.velocity.lengthSq(),
            angularSpeedSq >= 0.0f ? angularSpeedSq : primary.angularVelocity.lengthSq(),
            staticColliderId,
            materialTag,
        };
    }

    static void applyStaticMaterial(StaticBody& s, int tag) {
        s.materialTag = static_cast<uint8_t>(std::clamp(tag, 0, 255));
        switch (s.materialTag) {
            case 1: s.friction = 0.6f; s.restitution = 0.05f; s.rollingFriction = 0.12f; break;
            case 2: s.friction = 0.6f; s.restitution = 0.30f; s.rollingFriction = 0.10f; break;
            case 3: s.friction = 0.45f; s.restitution = 0.50f; s.rollingFriction = 0.08f; break;
            case 4: s.friction = 0.70f; s.restitution = 0.15f; s.rollingFriction = 0.12f; break;
            default: s.friction = 0.6f; s.restitution = 0.20f; s.rollingFriction = 0.10f; break;
        }
    }

    static int staticEventOtherId(int userId) {
        return STATIC_EVENT_ID_BASE - userId;
    }

    void resolveStaticPlane(RigidBody& b, const Vec3& n, float d, const StaticBody& s) {
        if (b.kinematic) return;

        float maxPen = 0.0f;
        Vec3 deepest = b.position;

        auto testPoint = [&](const Vec3& wv) {
            const float signedDist = Vec3::dot(n, wv) - d;
            if (signedDist < 0.0f) {
                const float pen = -signedDist;
                if (pen > maxPen) {
                    maxPen = pen;
                    deepest = wv;
                }
            }
        };

        if (b.useHull && !b.hull.verts.empty()) {
            for (const auto& v : b.hull.verts) {
                testPoint(b.rotation.rotate(v) + b.position);
            }
        } else {
            testPoint(b.position - n * b.radius);
        }

        if (maxPen <= 0.0f) return;

        wake(b);
        const float impactSpeed = std::max(0.0f, -Vec3::dot(b.velocity, n));
        const float preImpactLinearSpeedSq = b.velocity.lengthSq();
        const float preImpactAngularSpeedSq = b.angularVelocity.lengthSq();

        b.position += n * maxPen;

        if (Vec3::dot(b.velocity, n) < 0.0f) {
            b.velocity -= n * (Vec3::dot(b.velocity, n) * (1.0f + s.restitution));
            Vec3 r = deepest - b.position;
            Vec3 velAtContact = b.velocity + Vec3::cross(b.angularVelocity, r);
            float velN = Vec3::dot(velAtContact, n);
            if (velN < 0.0f) {
                float denom = b.invMass + Vec3::dot(
                    Vec3::cross(r, n),
                    b.applyInvInertiaWorld(Vec3::cross(r, n))
                );
                if (denom > 1e-6f) {
                    float j = -(1.0f + s.restitution) * velN / denom;
                    Vec3 impulse = n * j;
                    b.velocity += impulse * b.invMass;
                    b.angularVelocity += b.applyInvInertiaWorld(Vec3::cross(r, impulse));
                }
            }
            const float rollFric = std::max(0.0f, 1.0f - s.rollingFriction);
            b.velocity.x *= rollFric;
            b.velocity.y *= rollFric;
            b.velocity.z *= rollFric;
            b.angularVelocity = b.angularVelocity * rollFric;
        }

        if (maxPen > 0.01f && impactSpeed > 1.0f &&
            events_.size() < static_cast<size_t>(MAX_EVENTS_PER_STEP)) {
            events_.push_back(makeEvent(
                b,
                staticEventOtherId(s.userId),
                impactSpeed,
                preImpactLinearSpeedSq,
                preImpactAngularSpeedSq,
                s.userId,
                s.materialTag
            ));
        }
    }

    void resolveStaticHull(RigidBody& b, const StaticBody& s) {
        if (b.kinematic || !b.useHull || b.hull.verts.empty() || s.hull.verts.empty()) return;

        Vec3 normal, contact;
        float pen = 0.0f;
        if (!satTest(b.hull, b.position, b.rotation, s.hull, s.center, s.rotation,
                     normal, pen, contact)) {
            return;
        }
        if (pen <= 1e-6f) return;

        wake(b);
        const float impactSpeed = std::max(0.0f, -Vec3::dot(b.velocity, normal));
        const float preImpactLinearSpeedSq = b.velocity.lengthSq();
        const float preImpactAngularSpeedSq = b.angularVelocity.lengthSq();

        b.position -= normal * pen;

        if (Vec3::dot(b.velocity, normal) < 0.0f) {
            b.velocity -= normal * (Vec3::dot(b.velocity, normal) * (1.0f + s.restitution));
            Vec3 r = contact - b.position;
            Vec3 velAtContact = b.velocity + Vec3::cross(b.angularVelocity, r);
            float velN = Vec3::dot(velAtContact, normal);
            if (velN < 0.0f) {
                float denom = b.invMass + Vec3::dot(
                    Vec3::cross(r, normal),
                    b.applyInvInertiaWorld(Vec3::cross(r, normal))
                );
                if (denom > 1e-6f) {
                    float j = -(1.0f + s.restitution) * velN / denom;
                    Vec3 impulse = normal * j;
                    b.velocity += impulse * b.invMass;
                    b.angularVelocity += b.applyInvInertiaWorld(Vec3::cross(r, impulse));
                }
            }
            const float rollFric = std::max(0.0f, 1.0f - s.rollingFriction);
            b.velocity.x *= rollFric;
            b.velocity.y *= rollFric;
            b.velocity.z *= rollFric;
            b.angularVelocity = b.angularVelocity * rollFric;
        }

        if (pen > 0.01f && impactSpeed > 1.0f &&
            events_.size() < static_cast<size_t>(MAX_EVENTS_PER_STEP)) {
            events_.push_back(makeEvent(
                b,
                staticEventOtherId(s.userId),
                impactSpeed,
                preImpactLinearSpeedSq,
                preImpactAngularSpeedSq,
                s.userId,
                s.materialTag
            ));
        }
    }

    void resolveStaticOpenCylinder(RigidBody& b, const StaticBody& s) {
        const int segs = s.cylinderSegments;
        const float r = s.cylinderRadius;
        const Vec3 center = s.center;

        for (int i = 0; i < segs; ++i) {
            const float angle = (6.28318530718f * static_cast<float>(i)) / static_cast<float>(segs);
            Vec3 outward{std::cos(angle), 0.0f, std::sin(angle)};
            Vec3 inward = outward * -1.0f;
            Vec3 edgePoint = center + outward * r;
            const float d = Vec3::dot(inward, edgePoint);
            resolveStaticPlane(b, inward, d, s);
        }

        if (s.cylinderClosedBottom) {
            Vec3 up{0, 1, 0};
            const float d = center.y - s.cylinderHalfHeight;
            resolveStaticPlane(b, up, d, s);
        }
    }

    void resolveStaticCollisions(RigidBody& b, float /*dt*/) {
        for (const auto& s : statics_) {
            switch (s.shape) {
                case StaticShapeType::Plane:
                    resolveStaticPlane(b, s.planeNormal, s.planeDist, s);
                    break;
                case StaticShapeType::Box:
                case StaticShapeType::ConvexHull:
                    resolveStaticHull(b, s);
                    break;
                case StaticShapeType::OpenCylinder:
                    resolveStaticOpenCylinder(b, s);
                    break;
            }
        }
    }

    static void wake(RigidBody& b) {
        b.sleeping = false;
        b.sleepTimer = 0.0f;
    }

    void integrate(RigidBody& b, float dt) {
        if (b.kinematic) return;
        b.velocity.y += gravity_ * dt;
        if (!noDrag_ && b.dragFactor > 0.0f) {
            const float speedSq = b.velocity.lengthSq();
            if (speedSq > 1e-6f) {
                b.velocity -= b.velocity * (b.dragFactor * speedSq * dt);
            }
        }
        const float linDamp = 1.0f - 0.05f * dt;
        b.velocity = b.velocity * linDamp;
        const float angDamp = 1.0f - 0.10f * dt;
        b.angularVelocity = b.angularVelocity * angDamp;
        b.position += b.velocity * dt;
        b.rotation = b.rotation.integrate(b.angularVelocity, dt);
    }

    void ensureDieGridDimensions() {
        if (gridCols_ > 0) return;
        gridOriginX_ = -tableHalfW_ - GRID_CELL_SIZE;
        gridOriginZ_ = -tableHalfD_ - GRID_CELL_SIZE;
        const float extentX = 2.0f * tableHalfW_ + 2.0f * GRID_CELL_SIZE;
        const float extentZ = 2.0f * tableHalfD_ + 2.0f * GRID_CELL_SIZE;
        gridCols_ = std::max(1, static_cast<int>(std::ceil(extentX / GRID_CELL_SIZE)));
        gridRows_ = std::max(1, static_cast<int>(std::ceil(extentZ / GRID_CELL_SIZE)));
    }

    int bodyCellXMin(float x, float radius) const {
        const float rel = x - radius - gridOriginX_;
        const int c = static_cast<int>(std::floor(rel / GRID_CELL_SIZE));
        return std::clamp(c, 0, gridCols_ - 1);
    }

    int bodyCellXMax(float x, float radius) const {
        const float rel = x + radius - gridOriginX_;
        const int c = static_cast<int>(std::floor(rel / GRID_CELL_SIZE));
        return std::clamp(c, 0, gridCols_ - 1);
    }

    int bodyCellZMin(float z, float radius) const {
        const float rel = z - radius - gridOriginZ_;
        const int c = static_cast<int>(std::floor(rel / GRID_CELL_SIZE));
        return std::clamp(c, 0, gridRows_ - 1);
    }

    int bodyCellZMax(float z, float radius) const {
        const float rel = z + radius - gridOriginZ_;
        const int c = static_cast<int>(std::floor(rel / GRID_CELL_SIZE));
        return std::clamp(c, 0, gridRows_ - 1);
    }

    void rebuildDieGrid() {
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

    void forEachDiePair(const std::function<void(size_t, size_t)>& fn) {
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

    void processDiePair(size_t i, size_t j, StepStats& stats) {
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

    void resolveDieCollisions(float /*dt*/, StepStats& stats) {
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

    void resolveContainerCollisions(RigidBody& b, float /*dt*/) {
        if (!containerActive_ || b.kinematic || containerPlanes_.empty()) return;

        for (size_t pi = 0; pi < containerPlanes_.size(); ++pi) {
            const ContainerPlane& plane = containerPlanes_[pi];
            const Vec3& n = plane.normal;
            const float d = plane.dist;
            const int otherId = CONTAINER_EVENT_ID_BASE - static_cast<int>(pi);

            float maxPen = 0.0f;
            Vec3 deepest = b.position;

            auto testPoint = [&](const Vec3& wv) {
                const float signedDist = Vec3::dot(n, wv) - d;
                if (signedDist < 0.0f) {
                    const float pen = -signedDist;
                    if (pen > maxPen) {
                        maxPen = pen;
                        deepest = wv;
                    }
                }
            };

            if (b.useHull && !b.hull.verts.empty()) {
                for (const auto& v : b.hull.verts) {
                    testPoint(b.rotation.rotate(v) + b.position);
                }
            } else {
                testPoint(b.position - n * b.radius);
            }

            if (maxPen <= 0.0f) continue;

            wake(b);
            const float impactSpeed = std::max(0.0f, -Vec3::dot(b.velocity, n));
            const float preImpactLinearSpeedSq = b.velocity.lengthSq();
            const float preImpactAngularSpeedSq = b.angularVelocity.lengthSq();

            b.position += n * maxPen;

            if (Vec3::dot(b.velocity, n) < 0.0f) {
                b.velocity -= n * (Vec3::dot(b.velocity, n) * (1.0f + b.restitution));
                Vec3 r = deepest - b.position;
                Vec3 velAtContact = b.velocity + Vec3::cross(b.angularVelocity, r);
                float velN = Vec3::dot(velAtContact, n);
                if (velN < 0.0f) {
                    float denom = b.invMass + Vec3::dot(
                        Vec3::cross(r, n),
                        b.applyInvInertiaWorld(Vec3::cross(r, n))
                    );
                    if (denom > 1e-6f) {
                        float j = -(1.0f + b.restitution) * velN / denom;
                        Vec3 impulse = n * j;
                        b.velocity += impulse * b.invMass;
                        b.angularVelocity += b.applyInvInertiaWorld(Vec3::cross(r, impulse));
                    }
                }
                const float rollFric = std::max(0.0f, 1.0f - b.rollingFriction);
                b.velocity.x *= rollFric;
                b.velocity.y *= rollFric;
                b.velocity.z *= rollFric;
                b.angularVelocity = b.angularVelocity * rollFric;
            }

            if (maxPen > 0.01f && impactSpeed > 1.0f &&
                events_.size() < static_cast<size_t>(MAX_EVENTS_PER_STEP)) {
                events_.push_back(makeEvent(
                    b,
                    otherId,
                    impactSpeed,
                    preImpactLinearSpeedSq,
                    preImpactAngularSpeedSq,
                    0,
                    4
                ));
            }
        }
    }

    void resolveTableCollision(RigidBody& b, float dt) {
        (void)dt;
        if (b.kinematic) return;
        const float floorY = tableY_ + b.radius;

        if (b.useHull && !b.hull.verts.empty()) {
            Vec3 tableN = {0, 1, 0};
            float minProj = 1e20f;
            Vec3 deepest;
            for (const auto& v : b.hull.verts) {
                Vec3 wv = b.rotation.rotate(v) + b.position;
                float proj = wv.y - tableY_;
                if (proj < minProj) { minProj = proj; deepest = wv; }
            }
            if (minProj < 0.0f) {
                const float impactSpeed = std::max(0.0f, -b.velocity.y);
                const float preImpactLinearSpeedSq = b.velocity.lengthSq();
                const float preImpactAngularSpeedSq = b.angularVelocity.lengthSq();
                b.position.y -= minProj;
                if (b.velocity.y < 0.0f) {
                    b.velocity.y = -b.velocity.y * b.restitution;
                    Vec3 r = deepest - b.position;
                    Vec3 velAtContact = b.velocity + Vec3::cross(b.angularVelocity, r);
                    float velN = Vec3::dot(velAtContact, tableN);
                    if (velN < 0.0f) {
                        float denom = b.invMass + Vec3::dot(Vec3::cross(r, tableN), b.applyInvInertiaWorld(Vec3::cross(r, tableN)));
                        if (denom > 1e-6f) {
                            float j = -(1.0f + b.restitution) * velN / denom;
                            Vec3 impulse = tableN * j;
                            b.velocity += impulse * b.invMass;
                            b.angularVelocity += b.applyInvInertiaWorld(Vec3::cross(r, impulse));
                        }
                    }
                    const float rollFric = std::max(0.0f, 1.0f - b.rollingFriction);
                    b.velocity.x *= rollFric;
                    b.velocity.z *= rollFric;
                    b.angularVelocity = b.angularVelocity * rollFric;
                }
                if (std::abs(minProj) > 0.01f && impactSpeed > 1.0f &&
                    events_.size() < static_cast<size_t>(MAX_EVENTS_PER_STEP)) {
                    events_.push_back(makeEvent(
                        b,
                        -1,
                        impactSpeed,
                        preImpactLinearSpeedSq,
                        preImpactAngularSpeedSq,
                        0,
                        TABLE_MATERIAL_TAG
                    ));
                }
            }
        } else {
            if (b.position.y < floorY) {
                const float impactSpeed = std::max(0.0f, -b.velocity.y);
                const float preImpactLinearSpeedSq = b.velocity.lengthSq();
                const float preImpactAngularSpeedSq = b.angularVelocity.lengthSq();
                b.position.y = floorY;
                if (b.velocity.y < 0.0f) {
                    b.velocity.y = -b.velocity.y * b.restitution;
                    const float rollFric = std::max(0.0f, 1.0f - b.rollingFriction);
                    b.velocity.x *= rollFric;
                    b.velocity.z *= rollFric;
                    b.angularVelocity = b.angularVelocity * rollFric;
                }
                if (impactSpeed > 1.0f &&
                    events_.size() < static_cast<size_t>(MAX_EVENTS_PER_STEP)) {
                    events_.push_back(makeEvent(
                        b,
                        -1,
                        impactSpeed,
                        preImpactLinearSpeedSq,
                        preImpactAngularSpeedSq,
                        0,
                        TABLE_MATERIAL_TAG
                    ));
                }
            }
        }

        const float wx = tableHalfW_ - b.radius;
        const float wz = tableHalfD_ - b.radius;
        if (b.position.x >  wx) { b.position.x =  wx; b.velocity.x = -b.velocity.x * b.restitution; }
        if (b.position.x < -wx) { b.position.x = -wx; b.velocity.x = -b.velocity.x * b.restitution; }
        if (b.position.z >  wz) { b.position.z =  wz; b.velocity.z = -b.velocity.z * b.restitution; }
        if (b.position.z < -wz) { b.position.z = -wz; b.velocity.z = -b.velocity.z * b.restitution; }
    }

    void checkSleep(RigidBody& b, float dt) const {
        if (b.kinematic) return;
        const float SPEED_THRESHOLD = 0.05f;
        const float SLEEP_DELAY = 0.5f;
        float speed = b.velocity.length() + b.angularVelocity.length() * b.radius;
        if (speed < SPEED_THRESHOLD) {
            b.sleepTimer += dt;
            if (b.sleepTimer >= SLEEP_DELAY) {
                b.sleeping = true;
                b.velocity = {};
                b.angularVelocity = {};
            }
        } else {
            b.sleepTimer = 0.0f;
        }
    }
};

} // namespace dice_physics
