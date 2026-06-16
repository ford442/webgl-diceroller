/**
 * dice_physics.cpp — Phase 3 WASM dice physics engine.
 *
 * Features:
 *   • SAT-based convex polyhedral collision (die-die + die-table)
 *   • Per-die convex hulls loaded from glTF-extracted JSON
 *   • Deterministic xorshift64* PRNG + full state serialisation
 *   • Collision event buffer for audio callbacks
 *   • Sequential-impulse solver with angular velocity
 *   • Graceful sphere fallback when hulls are absent
 *
 * Build:
 *   npm run build:wasm
 */

#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

using namespace emscripten;

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

        // AABB
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

    // Diagonal inverse inertia tensor in body space
    Vec3  invInertia = {0, 0, 0};

    float restitution = 0.2f;
    float friction    = 0.6f;
    float rollingFriction = 0.1f;
    float dragFactor = 0.0f;

    bool  sleeping    = false;
    float sleepTimer  = 0.0f;

    void computeInertiaFromHull() {
        if (!useHull || hull.verts.empty()) {
            // Solid sphere fallback
            float i = 0.4f * mass * radius * radius;
            invInertia = {1.0f/i, 1.0f/i, 1.0f/i};
            return;
        }
        // Approximate with bounding-box inertia
        Vec3 dim = hull.aabbMax - hull.aabbMin;
        float ix = (1.0f / 12.0f) * mass * (dim.y*dim.y + dim.z*dim.z);
        float iy = (1.0f / 12.0f) * mass * (dim.x*dim.x + dim.z*dim.z);
        float iz = (1.0f / 12.0f) * mass * (dim.x*dim.x + dim.y*dim.y);
        invInertia = {1.0f/ix, 1.0f/iy, 1.0f/iz};
    }

    Vec3 applyInvInertiaWorld(const Vec3& v) const {
        // invI_world = R * invI_body * R^T
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
};

// ---------------------------------------------------------------------------
// SAT helpers
// ---------------------------------------------------------------------------

static bool satTest(const PolyHull& ha, const Vec3& posA, const Quat& rotA,
                    const PolyHull& hb, const Vec3& posB, const Quat& rotB,
                    Vec3& outNormal, float& outPenetration, Vec3& outContact) {
    const int MAX_AXES = 256;
    Vec3 axes[MAX_AXES];
    int axisCount = 0;

    // Face normals
    for (const auto& n : ha.faceNormals) axes[axisCount++] = rotA.rotate(n);
    for (const auto& n : hb.faceNormals) axes[axisCount++] = rotB.rotate(n);
    // Edge cross products
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

    // World-space vertices
    Vec3 wa[32], wb[32];
    int na = static_cast<int>(ha.verts.size());
    int nb = static_cast<int>(hb.verts.size());
    for (int i = 0; i < na; ++i) wa[i] = rotA.rotate(ha.verts[i]) + posA;
    for (int i = 0; i < nb; ++i) wb[i] = rotB.rotate(hb.verts[i]) + posB;

    outPenetration = 1e20f;
    bool normalFromA = true;

    for (int ai = 0; ai < axisCount; ++ai) {
        const Vec3& axis = axes[ai];
        float minA = 1e20f, maxA = -1e20f;
        float minB = 1e20f, maxB = -1e20f;
        for (int i = 0; i < na; ++i) {
            float p = Vec3::dot(wa[i], axis);
            minA = std::min(minA, p); maxA = std::max(maxA, p);
        }
        for (int i = 0; i < nb; ++i) {
            float p = Vec3::dot(wb[i], axis);
            minB = std::min(minB, p); maxB = std::max(maxB, p);
        }
        float overlap = std::min(maxA, maxB) - std::max(minA, minB);
        if (overlap < -1e-3f) return false;
        if (overlap < outPenetration) {
            outPenetration = overlap;
            outNormal = axis;
            normalFromA = (maxA - minA) < (maxB - minB);
        }
    }

    // Ensure normal points from A to B
    if (Vec3::dot(outNormal, posB - posA) < 0) outNormal = outNormal * -1.0f;

    // Find deepest penetrating vertex as contact point
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

static void sphereContact(const RigidBody& a, const RigidBody& b,
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

    DicePhysicsEngine()
        : gravity_(-15.0f), tableY_(-2.75f), tableHalfW_(18.0f), tableHalfD_(18.0f), nextId_(0) {
        val window = val::global("window");
        std::string search = window["location"]["search"].as<std::string>();
        noDrag_ = search.find("no-drag") != std::string::npos;
    }

    void init(float gravity, float tableY, float tableHalfW, float tableHalfD) {
        gravity_ = gravity; tableY_ = tableY;
        tableHalfW_ = tableHalfW; tableHalfD_ = tableHalfD;
        bodies_.clear(); contacts_.clear(); events_.clear();
        nextId_ = 0;
    }

    void reset() { bodies_.clear(); contacts_.clear(); events_.clear(); nextId_ = 0; }

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
            // Wake the body so the new velocity is actually integrated — step()
            // skips sleeping bodies, so without this a settled die ignores
            // user-driven velocity (e.g. ?wasm-drag release throws).
            wake(b);
            break;
        }
    }

    void step(float dt) {
        const int SUB_STEPS = 4;
        const float subDt = dt / static_cast<float>(SUB_STEPS);

        for (int s = 0; s < SUB_STEPS; ++s) {
            for (auto& b : bodies_) {
                if (b.sleeping) continue;
                integrate(b, subDt);
            }
            resolveDieCollisions(subDt);
            for (auto& b : bodies_) {
                resolveTableCollision(b, subDt);
                checkSleep(b, subDt);
            }
        }
    }

    int getDieCount() const { return static_cast<int>(bodies_.size()); }

    bool areAllSettled() const {
        if (bodies_.empty()) return false;
        for (const auto& b : bodies_) if (!b.sleeping) return false;
        return true;
    }

    val getTransforms() {
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
        return val(typed_memory_view(transformBuffer_.size(), transformBuffer_.data()));
    }

    val getDieIds() {
        idBuffer_.clear();
        idBuffer_.reserve(bodies_.size());
        for (const auto& b : bodies_) {
            idBuffer_.push_back(static_cast<float>(b.id));
        }
        return val(typed_memory_view(idBuffer_.size(), idBuffer_.data()));
    }

    // ------------------------------------------------------------------
    // Deterministic RNG
    // ------------------------------------------------------------------
    void seedRNG(uint64_t s) { rng_.seed(s); }
    float randomFloat() { return rng_.nextFloat(); }

    // ------------------------------------------------------------------
    // Collision events (for audio)
    // ------------------------------------------------------------------
    val getCollisionEvents() {
        eventBuffer_.clear();
        eventBuffer_.reserve(events_.size() * 7);
        for (const auto& e : events_) {
            eventBuffer_.push_back(static_cast<float>(e.idA));
            eventBuffer_.push_back(static_cast<float>(e.idB));
            eventBuffer_.push_back(e.impactSpeed);
            eventBuffer_.push_back(e.mass);
            eventBuffer_.push_back(e.inertiaScalar);
            eventBuffer_.push_back(e.linearSpeedSq);
            eventBuffer_.push_back(e.angularSpeedSq);
        }
        events_.clear();
        return val(typed_memory_view(eventBuffer_.size(), eventBuffer_.data()));
    }

    // ------------------------------------------------------------------
    // State serialisation
    // ------------------------------------------------------------------
    std::vector<uint8_t> serializeState() {
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

private:
    float gravity_, tableY_, tableHalfW_, tableHalfD_;
    int nextId_;
    std::vector<RigidBody> bodies_;
    std::vector<Contact> contacts_;
    std::vector<CollisionEvent> events_;
    std::vector<float> transformBuffer_;
    std::vector<float> idBuffer_;
    std::vector<float> eventBuffer_;
    DeterministicRNG rng_;
    bool noDrag_ = false;

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
        float angularSpeedSq = -1.0f
    ) {
        return {
            primary.id,
            otherId,
            impactSpeed,
            primary.mass,
            inertiaScalar(primary),
            linearSpeedSq >= 0.0f ? linearSpeedSq : primary.velocity.lengthSq(),
            angularSpeedSq >= 0.0f ? angularSpeedSq : primary.angularVelocity.lengthSq()
        };
    }

    static void wake(RigidBody& b) {
        b.sleeping = false;
        b.sleepTimer = 0.0f;
    }

    void integrate(RigidBody& b, float dt) {
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

    void resolveDieCollisions(float dt) {
        contacts_.clear();
        const float POSITION_SLOP = 0.001f;

        for (size_t i = 0; i < bodies_.size(); ++i) {
            for (size_t j = i + 1; j < bodies_.size(); ++j) {
                auto& a = bodies_[i];
                auto& b = bodies_[j];
                if (a.sleeping && b.sleeping) continue;

                // Broadphase sphere reject
                Vec3 delta = b.position - a.position;
                float distSq = delta.lengthSq();
                float combinedR = a.radius + b.radius;
                if (distSq >= combinedR * combinedR) continue;

                wake(a); wake(b);

                Contact c;
                c.a = static_cast<int>(i);
                c.b = static_cast<int>(j);
                bool hit = false;

                if (a.useHull && b.useHull) {
                    hit = satTest(a.hull, a.position, a.rotation,
                                  b.hull, b.position, b.rotation,
                                  c.normal, c.penetration, c.point);
                } else {
                    sphereContact(a, b, c.normal, c.penetration, c.point);
                    hit = c.penetration > 0;
                }

                if (!hit) continue;

                // Record collision event (only for significant impacts)
                Vec3 relVel = b.velocity - a.velocity;
                float speed = std::abs(Vec3::dot(relVel, c.normal));
                if (speed > 0.5f && events_.size() < static_cast<size_t>(MAX_EVENTS_PER_STEP)) {
                    const float energyA = 0.5f * a.mass * a.velocity.lengthSq() + 0.5f * inertiaScalar(a) * a.angularVelocity.lengthSq();
                    const float energyB = 0.5f * b.mass * b.velocity.lengthSq() + 0.5f * inertiaScalar(b) * b.angularVelocity.lengthSq();
                    events_.push_back(energyA >= energyB ? makeEvent(a, b.id, speed) : makeEvent(b, a.id, speed));
                }

                contacts_.push_back(c);
            }
        }

        // Sequential impulse solver
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

                float denom = a.invMass + b.invMass;
                Vec3 raCrossN = Vec3::cross(rA, c.normal);
                Vec3 rbCrossN = Vec3::cross(rB, c.normal);
                denom += Vec3::dot(raCrossN, a.applyInvInertiaWorld(raCrossN));
                denom += Vec3::dot(rbCrossN, b.applyInvInertiaWorld(rbCrossN));
                if (denom < 1e-6f) continue;

                float rest = std::min(a.restitution, b.restitution);
                float j = -(1.0f + rest) * velN / denom;
                float jOld = c.normalImpulse;
                c.normalImpulse = std::max(jOld + j, 0.0f);
                float jApplied = c.normalImpulse - jOld;

                Vec3 impulse = c.normal * jApplied;
                a.velocity -= impulse * a.invMass;
                b.velocity += impulse * b.invMass;
                a.angularVelocity -= a.applyInvInertiaWorld(Vec3::cross(rA, impulse));
                b.angularVelocity += b.applyInvInertiaWorld(Vec3::cross(rB, impulse));

                // Friction
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
                    a.velocity -= fImpulse * a.invMass;
                    b.velocity += fImpulse * b.invMass;
                    a.angularVelocity -= a.applyInvInertiaWorld(Vec3::cross(rA, fImpulse));
                    b.angularVelocity += b.applyInvInertiaWorld(Vec3::cross(rB, fImpulse));
                }
            }
        }

        // Position correction
        for (auto& c : contacts_) {
            if (c.penetration <= POSITION_SLOP) continue;
            auto& a = bodies_[c.a];
            auto& b = bodies_[c.b];
            float corrMag = (c.penetration - POSITION_SLOP) * 0.6f / (a.invMass + b.invMass);
            Vec3 corr = c.normal * corrMag;
            a.position -= corr * a.invMass;
            b.position += corr * b.invMass;
        }
    }

    void resolveTableCollision(RigidBody& b, float dt) {
        (void)dt;
        const float floorY = tableY_ + b.radius;

        if (b.useHull && !b.hull.verts.empty()) {
            // SAT against table plane
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
                    // Rolling friction
                    const float rollFric = std::max(0.0f, 1.0f - b.rollingFriction);
                    b.velocity.x *= rollFric;
                    b.velocity.z *= rollFric;
                    b.angularVelocity = b.angularVelocity * rollFric;
                }
                // Collision event for table thump
                if (std::abs(minProj) > 0.01f && impactSpeed > 1.0f &&
                    events_.size() < static_cast<size_t>(MAX_EVENTS_PER_STEP)) {
                    events_.push_back(makeEvent(
                        b,
                        -1,
                        impactSpeed,
                        preImpactLinearSpeedSq,
                        preImpactAngularSpeedSq
                    ));
                }
            }
        } else {
            // Sphere fallback
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
                        preImpactAngularSpeedSq
                    ));
                }
            }
        }

        // Side walls
        const float wx = tableHalfW_ - b.radius;
        const float wz = tableHalfD_ - b.radius;
        if (b.position.x >  wx) { b.position.x =  wx; b.velocity.x = -b.velocity.x * b.restitution; }
        if (b.position.x < -wx) { b.position.x = -wx; b.velocity.x = -b.velocity.x * b.restitution; }
        if (b.position.z >  wz) { b.position.z =  wz; b.velocity.z = -b.velocity.z * b.restitution; }
        if (b.position.z < -wz) { b.position.z = -wz; b.velocity.z = -b.velocity.z * b.restitution; }
    }

    void checkSleep(RigidBody& b, float dt) const {
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

// ---------------------------------------------------------------------------
// Embind
// ---------------------------------------------------------------------------

EMSCRIPTEN_BINDINGS(stl_support) {
    register_vector<float>("VectorFloat");
    register_vector<uint8_t>("VectorU8");
}

EMSCRIPTEN_BINDINGS(dice_physics) {
    class_<DicePhysicsEngine>("DicePhysicsEngine")
        .constructor()
        .function("init",              &DicePhysicsEngine::init)
        .function("reset",             &DicePhysicsEngine::reset)
        .function("addDie",            &DicePhysicsEngine::addDie)
        .function("removeDie",         &DicePhysicsEngine::removeDie)
        .function("clearAllDice",      &DicePhysicsEngine::clearAllDice)
        .function("setDieMaterial",    &DicePhysicsEngine::setDieMaterial)
        .function("setDieDrag",        &DicePhysicsEngine::setDieDrag)
        .function("setDieHull",        &DicePhysicsEngine::setDieHull)
        .function("applyImpulse",      &DicePhysicsEngine::applyImpulse)
        .function("applyTorqueImpulse",&DicePhysicsEngine::applyTorqueImpulse)
        .function("setDieTransform",   &DicePhysicsEngine::setDieTransform)
        .function("setDieVelocity",    &DicePhysicsEngine::setDieVelocity)
        .function("step",              &DicePhysicsEngine::step)
        .function("getDieCount",       &DicePhysicsEngine::getDieCount)
        .function("areAllSettled",     &DicePhysicsEngine::areAllSettled)
        .function("getTransforms",     &DicePhysicsEngine::getTransforms)
        .function("getDieIds",         &DicePhysicsEngine::getDieIds)
        .function("seedRNG",           &DicePhysicsEngine::seedRNG)
        .function("randomFloat",       &DicePhysicsEngine::randomFloat)
        .function("getCollisionEvents",&DicePhysicsEngine::getCollisionEvents)
        .function("serializeState",    &DicePhysicsEngine::serializeState)
        .function("deserializeState",  &DicePhysicsEngine::deserializeState)
        ;
}
