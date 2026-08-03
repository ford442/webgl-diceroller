/**
 * dice_physics_engine.hpp — Core C++ dice physics solver.
 *
 * Shared by the Emscripten WASM build (via dice_physics.cpp bindings) and the
 * native solver test harness (solver_tests.cpp).
 *
 * This header declares the DicePhysicsEngine class; its member functions are
 * defined out-of-line in the dice_physics/dice_engine_*.hpp modules included
 * at the bottom of this file. See docs/WASM_ENGINE.md for the module map.
 */

#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

#include "dice_physics/dice_math.hpp"
#include "dice_physics/dice_types.hpp"
#include "dice_physics/dice_sat.hpp"

namespace dice_physics {

// ---------------------------------------------------------------------------
// Physics engine
// ---------------------------------------------------------------------------

class DicePhysicsEngine {
public:
    static constexpr int MAX_DICE = 500;
    static constexpr int MAX_VERTICES_PER_HULL = 64;
    static constexpr int MAX_EVENTS_PER_STEP = 1024;
    static constexpr uint32_t FLAG_NO_DRAG = 1u << 0;

    DicePhysicsEngine();

    void setFlags(uint32_t flags);

    void init(float gravity, float tableY, float tableHalfW, float tableHalfD);

    void reset();

    int addDie(int sides, float x, float y, float z);

    void removeDie(int id);

    void clearAllDice();

    void setDieMaterial(int id, float friction, float rollingFriction);

    void setDieDrag(int id, float dragFactor);

    void setDieHull(int id, const std::vector<float>& flatVerts);

    void applyImpulse(int id, float fx, float fy, float fz);

    void applyTorqueImpulse(int id, float tx, float ty, float tz);

    void setDieTransform(int id, float px, float py, float pz,
                         float qx, float qy, float qz, float qw);

    void setDieVelocity(int id, float lvx, float lvy, float lvz,
                        float avx, float avy, float avz);

    void setDieKinematic(int id, bool kinematic);

    /** Enable/disable interior container planes (dice cup walls). */
    void setContainerActive(bool active);

    /**
     * Upload world-space container planes: 4 floats each (nx, ny, nz, d) where
     * dot(normal, point) >= d is the valid interior half-space. Up to 9 planes.
     */
    void setContainerPlanes(const std::vector<float>& flat);

    /** Remove all registered static colliders (table bounds, props, cups). */
    void clearStatics();

    bool removeStatic(int userId);

    /**
     * Axis-aligned box in local space, posed by center + quaternion.
     * materialTag: 0=default, 1=velvet, 2=wood, 3=metal, 4=leather
     */
    int addStaticBox(int userId,
                     float cx, float cy, float cz,
                     float hx, float hy, float hz,
                     float qx, float qy, float qz, float qw,
                     int materialTag);

    /** World-space plane: valid interior half-space is dot(normal, p) >= dist. */
    int addStaticPlane(int userId, float nx, float ny, float nz, float dist, int materialTag);

    /** Convex hull vertices in local space (flat xyz). */
    int addStaticConvexHull(int userId,
                            float cx, float cy, float cz,
                            float qx, float qy, float qz, float qw,
                            const std::vector<float>& flatVerts,
                            int materialTag);

    /**
     * Open cylinder aligned on Y: N inward radial planes + optional bottom cap.
     * segments clamped to [3, 32].
     */
    int addStaticOpenCylinder(int userId,
                              float cx, float cy, float cz,
                              float radius, float halfHeight,
                              int segments, bool closedBottom,
                              int materialTag);

    void step(float dt);

    int getDieCount() const;

    const StepStats& getLastStepStats() const;

    /** Test hook: disable broadphase to compare against brute-force pair generation. */
    void setBroadphaseForTesting(bool enabled);

    /** Test hook: enumerate die–die pair indices without running the solver. */
    std::vector<std::pair<size_t, size_t>> collectDiePairsForTesting(bool useBroadphase);

    bool areAllSettled() const;

    const std::vector<float>& buildTransformBuffer();

    const std::vector<float>& buildDieIdBuffer();

    const std::vector<float>& buildCollisionEventBuffer();

    void seedRNG(uint64_t s);
    float randomFloat();

    std::vector<uint8_t> serializeState() const;

    void deserializeState(const std::vector<uint8_t>& data);

    // Test / fuzz invariant helpers
    bool allBodyStatesFinite() const;

    bool allRotationsUnitLength(float eps = 1e-3f) const;

    bool allBodyStatesInWorldBounds(float margin) const;

    float totalKineticEnergy() const;

    float tableHalfW() const { return tableHalfW_; }
    float tableHalfD() const { return tableHalfD_; }
    float tableY() const { return tableY_; }

    bool getDiePosition(int id, float& x, float& y, float& z) const;

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

    static float radiusForSides(int sides);
    static float inertiaScalar(const RigidBody& b);

    static CollisionEvent makeEvent(
        const RigidBody& primary,
        int otherId,
        float impactSpeed,
        float linearSpeedSq = -1.0f,
        float angularSpeedSq = -1.0f,
        int staticColliderId = 0,
        int materialTag = 0
    );

    static void applyStaticMaterial(StaticBody& s, int tag);
    static int staticEventOtherId(int userId);

    void resolveStaticPlane(RigidBody& b, const Vec3& n, float d, const StaticBody& s);
    void resolveStaticHull(RigidBody& b, const StaticBody& s);
    void resolveStaticOpenCylinder(RigidBody& b, const StaticBody& s);
    void resolveStaticCollisions(RigidBody& b, float dt);
    void resolveContainerCollisions(RigidBody& b, float dt);
    void resolveTableCollision(RigidBody& b, float dt);

    static void wake(RigidBody& b);
    void integrate(RigidBody& b, float dt);
    void checkSleep(RigidBody& b, float dt) const;

    void ensureDieGridDimensions();
    int bodyCellXMin(float x, float radius) const;
    int bodyCellXMax(float x, float radius) const;
    int bodyCellZMin(float z, float radius) const;
    int bodyCellZMax(float z, float radius) const;
    void rebuildDieGrid();
    void forEachDiePair(const std::function<void(size_t, size_t)>& fn);
    void processDiePair(size_t i, size_t j, StepStats& stats);
    void resolveDieCollisions(float dt, StepStats& stats);
};

} // namespace dice_physics

#include "dice_physics/dice_engine_lifecycle.hpp"
#include "dice_physics/dice_engine_step.hpp"
#include "dice_physics/dice_engine_collision_static.hpp"
#include "dice_physics/dice_engine_collision_dynamic.hpp"
#include "dice_physics/dice_engine_integrate.hpp"
