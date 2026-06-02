/**
 * dice_physics.cpp — Lightweight impulse-based dice physics engine.
 *
 * Compiled to WebAssembly with Emscripten and exposed to JavaScript via
 * Embind.  This is the Phase 1 WASM stub: it implements a self-contained,
 * fast rigid-body solver tailored for polyhedral dice rolling on a flat
 * table surface.  It runs *in parallel* with the existing ammo.js world in
 * Phase 1 so that both engines can be benchmarked side-by-side; ammo.js is
 * still authoritative for rendering.  Full replacement is planned for
 * Phase 2.
 *
 * Build (requires Emscripten SDK):
 *   cd src/wasm && ./build.sh
 *   # or: npm run build:wasm  (from repository root)
 *
 * Outputs:
 *   public/wasm/dice_physics.js    — Emscripten module loader
 *   public/wasm/dice_physics.wasm  — Binary WASM module
 */

#include <emscripten/bind.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

using namespace emscripten;

// ---------------------------------------------------------------------------
// Math helpers
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

    float dot(const Vec3& o)  const { return x * o.x + y * o.y + z * o.z; }
    Vec3  cross(const Vec3& o) const {
        return { y * o.z - z * o.y,
                 z * o.x - x * o.z,
                 x * o.y - y * o.x };
    }
    float lengthSq() const { return x * x + y * y + z * z; }
    float length()   const { return std::sqrt(lengthSq()); }

    Vec3 normalized() const {
        float l = length();
        if (l < 1e-7f) return {};
        return *this * (1.0f / l);
    }
};

struct Quat {
    float x = 0, y = 0, z = 0, w = 1;

    Quat() = default;
    Quat(float x, float y, float z, float w) : x(x), y(y), z(z), w(w) {}

    Quat operator*(const Quat& o) const {
        return {
            w * o.x + x * o.w + y * o.z - z * o.y,
            w * o.y - x * o.z + y * o.w + z * o.x,
            w * o.z + x * o.y - y * o.x + z * o.w,
            w * o.w - x * o.x - y * o.y - z * o.z
        };
    }

    Quat normalized() const {
        float l = std::sqrt(x * x + y * y + z * z + w * w);
        if (l < 1e-7f) return {0, 0, 0, 1};
        float inv = 1.0f / l;
        return {x * inv, y * inv, z * inv, w * inv};
    }

    // Integrate rotation by angular velocity omega over time step dt.
    // Uses the first-order half-angle approximation:
    //   q' = normalize(q + 0.5 * dt * [omega; 0] * q)
    Quat integrate(const Vec3& omega, float dt) const {
        float hx = omega.x * 0.5f * dt;
        float hy = omega.y * 0.5f * dt;
        float hz = omega.z * 0.5f * dt;
        // [hx,hy,hz,0] * q
        Quat dq = {
            hx * w + hy * z - hz * y,
            hy * w + hz * x - hx * z,
            hz * w + hx * y - hy * x,
           -hx * x - hy * y - hz * z
        };
        return Quat{x + dq.x, y + dq.y, z + dq.z, w + dq.w}.normalized();
    }

    // Rotate a vector by this unit quaternion.
    Vec3 rotate(const Vec3& v) const {
        Vec3 qv = {x, y, z};
        Vec3 uv  = qv.cross(v);
        Vec3 uuv = qv.cross(uv);
        return v + (uv * (2.0f * w)) + (uuv * 2.0f);
    }
};

// ---------------------------------------------------------------------------
// Rigid body
// ---------------------------------------------------------------------------

struct RigidBody {
    int   id     = -1;
    int   sides  = 6;     // die face count: 4, 6, 8, 10, 12, 20

    Vec3  position;
    Vec3  velocity;
    Quat  rotation;
    Vec3  angularVelocity;

    float radius      = 0.9f; // bounding-sphere radius (tuned per die type)
    float mass        = 5.0f;
    float invMass     = 0.2f; // 1 / mass
    float invInertia  = 0.0f; // 1 / (0.4 * mass * r^2)  — solid sphere approx.

    float restitution = 0.2f;
    float friction    = 0.6f;

    bool  sleeping    = false;
    float sleepTimer  = 0.0f;
};

// ---------------------------------------------------------------------------
// Physics engine class
// ---------------------------------------------------------------------------

class DicePhysicsEngine {
public:
    DicePhysicsEngine()
        : gravity_(-15.0f),
          tableY_(-2.75f),
          tableHalfW_(18.0f),
          tableHalfD_(18.0f),
          nextId_(0)
    {}

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    /**
     * Initialize (or re-initialize) the simulation world.
     *
     * @param gravity      Downward acceleration (negative Y).  Default -15.
     * @param tableY       Y coordinate of the table surface.  Default -2.75.
     * @param tableHalfW   Half-width  of the playfield (X axis).  Default 18.
     * @param tableHalfD   Half-depth  of the playfield (Z axis).  Default 18.
     */
    void init(float gravity, float tableY, float tableHalfW, float tableHalfD) {
        gravity_    = gravity;
        tableY_     = tableY;
        tableHalfW_ = tableHalfW;
        tableHalfD_ = tableHalfD;
        bodies_.clear();
        nextId_ = 0;
    }

    /** Remove all dice and reset the ID counter. */
    void reset() {
        bodies_.clear();
        nextId_ = 0;
    }

    // ------------------------------------------------------------------
    // Die management
    // ------------------------------------------------------------------

    /**
     * Spawn a new die at the given position.
     *
     * @param sides  Number of faces (4, 6, 8, 10, 12, or 20).
     * @param x/y/z  World-space spawn position.
     * @return       Unique die ID (use with removeDie / applyImpulse).
     */
    int addDie(int sides, float x, float y, float z) {
        RigidBody b;
        b.id       = nextId_++;
        b.sides    = sides;
        b.position = {x, y, z};
        b.rotation = {0, 0, 0, 1};
        b.radius   = radiusForSides(sides);
        b.mass     = 5.0f;
        b.invMass  = 1.0f / b.mass;
        // Moment of inertia: solid sphere I = 2/5 * m * r^2
        b.invInertia = 1.0f / (0.4f * b.mass * b.radius * b.radius);
        bodies_.push_back(b);
        return b.id;
    }

    /** Remove a die by ID. */
    void removeDie(int id) {
        bodies_.erase(
            std::remove_if(bodies_.begin(), bodies_.end(),
                [id](const RigidBody& b) { return b.id == id; }),
            bodies_.end());
    }

    /** Remove all dice. */
    void clearAllDice() {
        bodies_.clear();
    }

    // ------------------------------------------------------------------
    // Force application
    // ------------------------------------------------------------------

    /**
     * Apply a linear impulse (Δvelocity = impulse / mass) to a die.
     * Also wakes the die if it was sleeping.
     */
    void applyImpulse(int id, float fx, float fy, float fz) {
        for (auto& b : bodies_) {
            if (b.id != id) continue;
            b.velocity.x += fx * b.invMass;
            b.velocity.y += fy * b.invMass;
            b.velocity.z += fz * b.invMass;
            wake(b);
            break;
        }
    }

    /**
     * Apply an angular impulse (Δω = torque / I) to a die.
     * Also wakes the die if it was sleeping.
     */
    void applyTorqueImpulse(int id, float tx, float ty, float tz) {
        for (auto& b : bodies_) {
            if (b.id != id) continue;
            b.angularVelocity.x += tx * b.invInertia;
            b.angularVelocity.y += ty * b.invInertia;
            b.angularVelocity.z += tz * b.invInertia;
            wake(b);
            break;
        }
    }

    // ------------------------------------------------------------------
    // Simulation step
    // ------------------------------------------------------------------

    /**
     * Advance the simulation by deltaTime seconds.
     * Uses 4 sub-steps (matching the ammo.js config) for stability.
     */
    void step(float dt) {
        const int   SUB_STEPS = 4;
        const float subDt     = dt / static_cast<float>(SUB_STEPS);

        for (int s = 0; s < SUB_STEPS; ++s) {
            for (auto& b : bodies_) {
                if (b.sleeping) continue;
                integrate(b, subDt);
            }

            resolveDieCollisions();

            for (auto& b : bodies_) {
                resolveTableCollision(b);
                checkSleep(b, subDt);
            }
        }
    }

    // ------------------------------------------------------------------
    // Query
    // ------------------------------------------------------------------

    /** Number of dice currently in the simulation. */
    int getDieCount() const {
        return static_cast<int>(bodies_.size());
    }

    /** True when every die is sleeping (all have settled). */
    bool areAllSettled() const {
        if (bodies_.empty()) return false;
        for (const auto& b : bodies_) {
            if (!b.sleeping) return false;
        }
        return true;
    }

    /**
     * Returns a typed memory view of transform data for all dice.
     *
     * Layout per die (7 floats): [ px, py, pz, qx, qy, qz, qw ]
     *
     * The JS side can read this as a Float32Array for zero-copy transfer.
     * Note: the view is invalidated after the next call to step() or any
     * structural mutation (addDie / removeDie / clearAllDice).
     */
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
        return val(typed_memory_view(
            transformBuffer_.size(), transformBuffer_.data()));
    }

    // ------------------------------------------------------------------
    // Direct die state setters (used to synchronise with ammo.js)
    // ------------------------------------------------------------------

    /** Teleport a die to the given position and zero its velocities. */
    void setDieTransform(int id,
                         float px, float py, float pz,
                         float qx, float qy, float qz, float qw) {
        for (auto& b : bodies_) {
            if (b.id != id) continue;
            b.position       = {px, py, pz};
            b.rotation       = Quat{qx, qy, qz, qw}.normalized();
            b.velocity       = {};
            b.angularVelocity = {};
            wake(b);
            break;
        }
    }

    /** Directly set linear and angular velocity (e.g. from ammo.js readback). */
    void setDieVelocity(int id,
                        float lvx, float lvy, float lvz,
                        float avx, float avy, float avz) {
        for (auto& b : bodies_) {
            if (b.id != id) continue;
            b.velocity        = {lvx, lvy, lvz};
            b.angularVelocity = {avx, avy, avz};
            break;
        }
    }

private:
    float gravity_;
    float tableY_;
    float tableHalfW_;
    float tableHalfD_;
    int   nextId_;

    std::vector<RigidBody> bodies_;
    std::vector<float>     transformBuffer_; // reused across getTransforms() calls

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

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

    static void wake(RigidBody& b) {
        b.sleeping   = false;
        b.sleepTimer = 0.0f;
    }

    void integrate(RigidBody& b, float dt) const {
        // Gravity
        b.velocity.y += gravity_ * dt;

        // Linear damping (simulates air resistance / heavy feel)
        const float linDamp = 1.0f - 0.05f * dt;
        b.velocity = b.velocity * linDamp;

        // Angular damping
        const float angDamp = 1.0f - 0.10f * dt;
        b.angularVelocity = b.angularVelocity * angDamp;

        // Integrate position
        b.position += b.velocity * dt;

        // Integrate rotation
        b.rotation = b.rotation.integrate(b.angularVelocity, dt);
    }

    void resolveDieCollisions() {
        const float POSITION_SLOP = 0.001f;
        const float POSITION_BIAS = 0.80f;

        for (std::size_t i = 0; i < bodies_.size(); ++i) {
            for (std::size_t j = i + 1; j < bodies_.size(); ++j) {
                auto& a = bodies_[i];
                auto& b = bodies_[j];

                if (a.sleeping && b.sleeping) continue;

                Vec3 delta = b.position - a.position;
                float distSq = delta.lengthSq();
                float combinedRadius = a.radius + b.radius;
                float minDistSq = combinedRadius * combinedRadius;
                if (distSq >= minDistSq) continue;

                float dist = std::sqrt(std::max(distSq, 1e-8f));
                Vec3 normal = dist > 1e-4f ? (delta / dist) : Vec3{1.0f, 0.0f, 0.0f};
                float penetration = combinedRadius - dist;

                wake(a);
                wake(b);

                float invMassSum = a.invMass + b.invMass;
                if (invMassSum <= 1e-6f) continue;

                float correctionMag = std::max(penetration - POSITION_SLOP, 0.0f) * POSITION_BIAS / invMassSum;
                Vec3 correction = normal * correctionMag;
                a.position -= correction * a.invMass;
                b.position += correction * b.invMass;

                Vec3 relativeVelocity = b.velocity - a.velocity;
                float normalSpeed = relativeVelocity.dot(normal);
                if (normalSpeed > 0.0f) continue;

                float restitution = std::min(a.restitution, b.restitution);
                float normalImpulseMag = -(1.0f + restitution) * normalSpeed / invMassSum;
                Vec3 normalImpulse = normal * normalImpulseMag;

                a.velocity -= normalImpulse * a.invMass;
                b.velocity += normalImpulse * b.invMass;

                relativeVelocity = b.velocity - a.velocity;
                Vec3 tangent = relativeVelocity - normal * relativeVelocity.dot(normal);
                float tangentLenSq = tangent.lengthSq();
                if (tangentLenSq > 1e-8f) {
                    tangent = tangent / std::sqrt(tangentLenSq);
                    float tangentSpeed = relativeVelocity.dot(tangent);
                    float frictionImpulseMag = -tangentSpeed / invMassSum;
                    float friction = std::sqrt(a.friction * b.friction);
                    float maxFrictionImpulse = normalImpulseMag * friction;
                    frictionImpulseMag = std::clamp(
                        frictionImpulseMag,
                        -maxFrictionImpulse,
                        maxFrictionImpulse
                    );

                    Vec3 frictionImpulse = tangent * frictionImpulseMag;
                    a.velocity -= frictionImpulse * a.invMass;
                    b.velocity += frictionImpulse * b.invMass;
                    a.angularVelocity -= tangent.cross(normal) * (frictionImpulseMag * a.invInertia * 0.25f);
                    b.angularVelocity += tangent.cross(normal) * (frictionImpulseMag * b.invInertia * 0.25f);
                }
            }
        }
    }

    void resolveTableCollision(RigidBody& b) const {
        // --- Floor ---
        const float floorY = tableY_ + b.radius;
        if (b.position.y < floorY) {
            b.position.y = floorY;
            if (b.velocity.y < 0.0f) {
                b.velocity.y = -b.velocity.y * b.restitution;
                // Rolling friction on floor contact
                const float rollingFric = 1.0f - b.friction * 0.1f;
                b.velocity.x       *= rollingFric;
                b.velocity.z       *= rollingFric;
                b.angularVelocity   = b.angularVelocity * rollingFric;
            }
        }

        // --- Side walls ---
        const float wx = tableHalfW_ - b.radius;
        const float wz = tableHalfD_ - b.radius;

        if (b.position.x >  wx) { b.position.x =  wx; b.velocity.x = -b.velocity.x * b.restitution; }
        if (b.position.x < -wx) { b.position.x = -wx; b.velocity.x = -b.velocity.x * b.restitution; }
        if (b.position.z >  wz) { b.position.z =  wz; b.velocity.z = -b.velocity.z * b.restitution; }
        if (b.position.z < -wz) { b.position.z = -wz; b.velocity.z = -b.velocity.z * b.restitution; }
    }

    void checkSleep(RigidBody& b, float dt) const {
        const float SPEED_THRESHOLD = 0.05f; // m/s — combined linear + angular
        const float SLEEP_DELAY     = 0.5f;  // seconds of stillness before sleep

        const float speed = b.velocity.length()
                          + b.angularVelocity.length() * b.radius;

        if (speed < SPEED_THRESHOLD) {
            b.sleepTimer += dt;
            if (b.sleepTimer >= SLEEP_DELAY) {
                b.sleeping        = true;
                b.velocity        = {};
                b.angularVelocity = {};
            }
        } else {
            b.sleepTimer = 0.0f;
        }
    }
};

// ---------------------------------------------------------------------------
// Embind bindings
// ---------------------------------------------------------------------------

EMSCRIPTEN_BINDINGS(dice_physics) {
    class_<DicePhysicsEngine>("DicePhysicsEngine")
        .constructor()
        // Lifecycle
        .function("init",         &DicePhysicsEngine::init)
        .function("reset",        &DicePhysicsEngine::reset)
        // Die management
        .function("addDie",       &DicePhysicsEngine::addDie)
        .function("removeDie",    &DicePhysicsEngine::removeDie)
        .function("clearAllDice", &DicePhysicsEngine::clearAllDice)
        // Force application
        .function("applyImpulse",       &DicePhysicsEngine::applyImpulse)
        .function("applyTorqueImpulse", &DicePhysicsEngine::applyTorqueImpulse)
        // Simulation
        .function("step",             &DicePhysicsEngine::step)
        // Query
        .function("getDieCount",    &DicePhysicsEngine::getDieCount)
        .function("areAllSettled",  &DicePhysicsEngine::areAllSettled)
        .function("getTransforms",  &DicePhysicsEngine::getTransforms)
        // State sync (ammo.js ↔ WASM bridge)
        .function("setDieTransform", &DicePhysicsEngine::setDieTransform)
        .function("setDieVelocity",  &DicePhysicsEngine::setDieVelocity)
        ;
}
