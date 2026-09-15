/**
 * dice_physics_engine.hpp — Core C++ dice physics solver.
 *
 * Shared by the Emscripten WASM build (via dice_physics.cpp bindings) and the
 * native solver test harness (solver_tests.cpp).
 *
 * This header declares the DicePhysicsEngine class only. Member functions are
 * defined out-of-line as separate translation units in the dice_physics/
 * dice_engine_*.cpp files (compiled and linked alongside this header's
 * includer — see build.sh / CMakeLists.txt / build_solver_test.sh for the
 * source list). See docs/WASM_ENGINE.md for the module map.
 */

#pragma once

#include <algorithm>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include "dice_physics/dice_math.hpp"
#include "dice_physics/dice_types.hpp"
#include "dice_physics/dice_contacts.hpp"
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
    // Soft cap on dynamic (non-die) rigid-body props — knockable clutter.
    // die×dynamic and dynamic×dynamic pairs share the die uniform grid (see
    // forEachDieDynamicPair / forEachDynamicPair), so this is a memory/event
    // budget cap, not a brute-force-cost cap.
    static constexpr int MAX_DYNAMICS = 256;

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

    void setDieFaceTable(int id, const std::vector<float>& packed);

    int getDieFaceValue(int id) const;

    /** Test hook: force sleep without waiting for integration. */
    void setDieSleepingForTesting(int id, bool sleeping);

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

    // -----------------------------------------------------------------
    // Dynamic (non-die) rigid-body props — knockable clutter.
    // -----------------------------------------------------------------

    /** Remove all registered dynamic props. */
    void clearDynamics();

    bool removeDynamic(int userId);

    void setDynamicKinematic(int userId, bool kinematic);

    void setDynamicTransform(int userId, float px, float py, float pz,
                             float qx, float qy, float qz, float qw);

    void setDynamicVelocity(int userId, float lvx, float lvy, float lvz,
                            float avx, float avy, float avz);

    void applyDynamicImpulse(int userId, float fx, float fy, float fz);

    void applyDynamicTorqueImpulse(int userId, float tx, float ty, float tz);

    /**
     * Axis-aligned box in local space, posed by center + quaternion.
     * mass must be > 0 (use a static collider for immovable geometry).
     * materialTag: 0=default, 1=velvet, 2=wood, 3=metal, 4=leather
     */
    int addDynamicBox(int userId, float mass,
                      float cx, float cy, float cz,
                      float hx, float hy, float hz,
                      float qx, float qy, float qz, float qw,
                      int materialTag);

    /** Convex hull vertices in local space (flat xyz). mass must be > 0. */
    int addDynamicHull(int userId, float mass,
                       float cx, float cy, float cz,
                       float qx, float qy, float qz, float qw,
                       const std::vector<float>& flatVerts,
                       int materialTag);

    int getDynamicCount() const;

    /** Cumulative count of addDynamic* calls rejected because MAX_DYNAMICS was reached. */
    uint32_t getDynamicCapacityDroppedCount() const;

    const std::vector<float>& buildDynamicTransformBuffer();

    const std::vector<float>& buildDynamicIdBuffer();

    void step(float dt);

    int getDieCount() const;

    const StepStats& getLastStepStats() const;

    /** Cumulative count of addStatic* calls rejected because MAX_STATICS was reached. */
    uint32_t getStaticCapacityDroppedCount() const;

    /** Test hook: disable broadphase to compare against brute-force pair generation. */
    void setBroadphaseForTesting(bool enabled);

    /** Test hook: enumerate die–die pair indices without running the solver. */
    std::vector<std::pair<size_t, size_t>> collectDiePairsForTesting(bool useBroadphase);

    /** Test hook: enumerate (dieIndex, dynamicIndex) pairs without running the solver. */
    std::vector<std::pair<size_t, size_t>> collectDieDynamicPairsForTesting(bool useBroadphase);

    /** Test hook: enumerate dynamic–dynamic pair indices without running the solver. */
    std::vector<std::pair<size_t, size_t>> collectDynamicPairsForTesting(bool useBroadphase);

    bool areAllSettled() const;
    bool hasDice() const { return !bodies_.empty(); }

    const std::vector<float>& buildTransformBuffer();

    const std::vector<float>& buildDieIdBuffer();

    const std::vector<float>& buildCollisionEventBuffer();

    const std::vector<int32_t>& buildFaceValueBuffer();

    void seedRNG(uint64_t s);
    float randomFloat();

    std::vector<uint8_t> serializeState() const;

    void deserializeState(const std::vector<uint8_t>& data);

    uint64_t hashSerializedState() const;

    float maxTablePenetration() const;

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
    // Soft cap on registered static colliders (table bounds, tower/jail/tray/
    // bookshelf compounds, clutter mugs/coins via StaticColliderBridge). A
    // high-density table layout can easily exceed the old 128 limit; raised
    // to give real headroom. addStatic* returns -1 and increments
    // staticCapacityDroppedCount_ past this point instead of silently no-oping.
    static constexpr int MAX_STATICS = 512;
    static constexpr int STATIC_EVENT_ID_BASE = -2000;
    static constexpr int TABLE_MATERIAL_TAG = 1; // velvet
    // Collision-event id encoding for dynamic props, well clear of
    // STATIC_EVENT_ID_BASE's range so idA/idB unambiguously identify which
    // kind of body was involved (die id >= 0, static <= STATIC_EVENT_ID_BASE,
    // dynamic prop <= DYNAMIC_EVENT_ID_BASE).
    static constexpr int DYNAMIC_EVENT_ID_BASE = -1000000;

    struct ContainerPlane {
        Vec3 normal;
        float dist;
    };

    float gravity_, tableY_, tableHalfW_, tableHalfD_;
    int nextId_;
    std::vector<RigidBody> bodies_;
    std::vector<StaticBody> statics_;
    std::vector<DynamicBody> dynamics_;
    std::vector<ContactManifold> manifolds_;
    std::vector<CollisionEvent> events_;
    std::vector<ContainerPlane> containerPlanes_;
    mutable std::vector<float> transformBuffer_;
    mutable std::vector<float> idBuffer_;
    mutable std::vector<float> eventBuffer_;
    mutable std::vector<int32_t> faceValueBuffer_;
    mutable std::vector<float> dynamicTransformBuffer_;
    mutable std::vector<float> dynamicIdBuffer_;
    DeterministicRNG rng_;
    bool noDrag_ = false;
    bool containerActive_ = false;
    StepStats lastStepStats_;
    uint32_t staticCapacityDroppedCount_ = 0;
    uint32_t dynamicCapacityDroppedCount_ = 0;
    bool useBroadphase_ = true;

    static constexpr float GRID_CELL_SIZE = 2.2f;
    std::vector<std::vector<size_t>> dieGridCells_;
    // Dynamics share the die grid's dimensions/origin (ensureDieGridDimensions)
    // but get their own per-cell bucket, since a die index and a dynamics_
    // index are different spaces.
    std::vector<std::vector<size_t>> dynGridCells_;
    // Scratch buffer for forEachDieDynamicPair's candidate pairs (cleared and
    // refilled each call) — a die/dynamic straddling a cell boundary can
    // otherwise surface the same (dieIndex, dynIndex) pair from more than one
    // cell in the 3x3 neighbor scan; sort+unique before dispatch removes
    // exactly those duplicates.
    std::vector<std::pair<size_t, size_t>> dieDynamicPairScratch_;
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
    static int dynamicEventOtherId(int userId);

    void resolveStaticPlane(RigidBody& b, const Vec3& n, float d, const StaticBody& s, float spec);
    void resolveStaticHull(RigidBody& b, const StaticBody& s, float spec);
    void resolveStaticOpenCylinder(RigidBody& b, const StaticBody& s, float spec);
    void generateStaticContacts(RigidBody& b, size_t dieIndex, float spec);
    void generateContainerContacts(RigidBody& b, size_t dieIndex, float spec);
    void generateTableContacts(RigidBody& b, size_t dieIndex, float spec);
    void generateWallContacts(RigidBody& b, size_t dieIndex, float spec);

    static void wake(RigidBody& b);
    void integrate(RigidBody& b, float dt);
    void checkSleep(RigidBody& b, float dt) const;
    void refreshDieDerived(RigidBody& b) const;
    void refreshDynamicDerived(DynamicBody& b) const;

    void ensureDieGridDimensions();
    int bodyCellXMin(float x, float radius) const;
    int bodyCellXMax(float x, float radius) const;
    int bodyCellZMin(float z, float radius) const;
    int bodyCellZMax(float z, float radius) const;
    void rebuildDieGrid(float expand);
    void rebuildDynGrid(float expand);
    template <typename Fn>
    void forEachDiePair(Fn&& fn, float expand = 0.0f);
    template <typename Fn>
    void forEachDynamicPair(Fn&& fn, float expand = 0.0f);
    template <typename Fn>
    void forEachDieDynamicPair(Fn&& fn, float expand = 0.0f);
    void processDiePair(size_t i, size_t j, StepStats& stats, float spec);
    void generateDieDieContacts(float spec, StepStats& stats);

    ContactManifold* matchManifold(ManifoldKind kind, int idA, int idB, int aux);
    void commitManifoldPoints(ContactManifold& m, ContactPoint* pts, int count, const Vec3& normal);
    void addPlaneContacts(
        ManifoldKind kind, int idA, int idB, int aux,
        int indexA, int indexB,
        const Vec3& normal, float planeD,
        const std::vector<Vec3>& worldVerts, const Vec3& fallbackPoint, float fallbackRadius,
        float spec, float friction, float restitution
    );
    void addSatContacts(
        ManifoldKind kind, int idA, int idB, int aux,
        int indexA, int indexB,
        const PolyHull& ha, const Vec3& posA, const Quat& rotA, const std::vector<Vec3>& wa,
        const PolyHull& hb, const Vec3& posB, const Quat& rotB, const std::vector<Vec3>& wb,
        float spec, float friction, float restitution, StepStats* stats
    );
    void generateContacts(float dt, StepStats& stats);
    void warmStartManifolds();
    void prepareVelocityConstraints(float dt);
    void solveVelocityConstraints(float dt);
    void solvePositionConstraints();
    void solveContacts(float dt);
    void updateIslandSleep(float dt);
    float speculativeFor(const Vec3& velocity, float dt) const;
    bool bindViews(ContactManifold& m, BodyView& a, BodyView& b, WorldAnchor& world);

    // -- Dynamic (non-die) rigid-body props -----------------------------
    static float inertiaScalar(const DynamicBody& b);
    static CollisionEvent makeEvent(
        const DynamicBody& primary,
        int otherId,
        float impactSpeed,
        float linearSpeedSq = -1.0f,
        float angularSpeedSq = -1.0f,
        int staticColliderId = 0,
        int materialTag = 0
    );
    static void wake(DynamicBody& b);
    void integrateDynamic(DynamicBody& b, float dt);
    void checkSleepDynamic(DynamicBody& b, float dt) const;

    void resolveDynamicStaticPlane(DynamicBody& b, const Vec3& n, float d, const StaticBody& s, float spec);
    void resolveDynamicStaticHull(DynamicBody& b, const StaticBody& s, float spec);
    void resolveDynamicStaticOpenCylinder(DynamicBody& b, const StaticBody& s, float spec);
    void generateDynamicStaticContacts(DynamicBody& b, size_t dynIndex, float spec);
    void generateDynamicContainerContacts(DynamicBody& b, size_t dynIndex, float spec);
    void generateDynamicTableContacts(DynamicBody& b, size_t dynIndex, float spec);
    void generateDynamicWallContacts(DynamicBody& b, size_t dynIndex, float spec);

    void generateDieDynamicContacts(float spec, StepStats& stats);
    void generateDynamicDynamicContacts(float spec, StepStats& stats);
};

template <typename Fn>
void DicePhysicsEngine::forEachDiePair(Fn&& fn, float expand) {
    if (!useBroadphase_ || bodies_.size() < 2) {
        for (size_t i = 0; i < bodies_.size(); ++i) {
            for (size_t j = i + 1; j < bodies_.size(); ++j) {
                fn(i, j);
            }
        }
        return;
    }

    rebuildDieGrid(expand);
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

// Mirrors forEachDiePair exactly, over dynamics_/dynGridCells_ instead of
// bodies_/dieGridCells_ — same-population pairs, so the same "only walk the
// forward half of the 3x3 neighborhood" trick avoids double-counting.
template <typename Fn>
void DicePhysicsEngine::forEachDynamicPair(Fn&& fn, float expand) {
    if (!useBroadphase_ || dynamics_.size() < 2) {
        for (size_t i = 0; i < dynamics_.size(); ++i) {
            for (size_t j = i + 1; j < dynamics_.size(); ++j) {
                fn(i, j);
            }
        }
        return;
    }

    rebuildDynGrid(expand);
    for (int cz = 0; cz < gridRows_; ++cz) {
        for (int cx = 0; cx < gridCols_; ++cx) {
            const auto& cell = dynGridCells_[static_cast<size_t>(cz * gridCols_ + cx)];

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
                        dynGridCells_[static_cast<size_t>(nz * gridCols_ + nx)];
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

// Bipartite (die index space x dynamics index space): unlike forEachDiePair /
// forEachDynamicPair, there is no single canonical ordering to dedupe on, so
// a die or dynamic body that straddles a cell boundary (and is therefore
// bucketed into more than one grid cell) can otherwise surface the same
// (dieIndex, dynIndex) candidate from more than one cell in the 3x3 neighbor
// scan below. Collect candidates into a scratch buffer and sort+unique
// before dispatch, so every pair reaches fn() exactly once regardless of how
// many cells either body overlaps — matching the brute-force branch's
// semantics exactly (verified against it in solver_tests.cpp).
template <typename Fn>
void DicePhysicsEngine::forEachDieDynamicPair(Fn&& fn, float expand) {
    if (!useBroadphase_ || bodies_.empty() || dynamics_.empty()) {
        for (size_t di = 0; di < bodies_.size(); ++di) {
            for (size_t pi = 0; pi < dynamics_.size(); ++pi) {
                fn(di, pi);
            }
        }
        return;
    }

    rebuildDieGrid(expand);
    rebuildDynGrid(expand);

    dieDynamicPairScratch_.clear();
    for (int cz = 0; cz < gridRows_; ++cz) {
        for (int cx = 0; cx < gridCols_; ++cx) {
            const auto& dieCell = dieGridCells_[static_cast<size_t>(cz * gridCols_ + cx)];
            if (dieCell.empty()) continue;

            const int nzMin = std::max(0, cz - 1);
            const int nzMax = std::min(gridRows_ - 1, cz + 1);
            const int nxMin = std::max(0, cx - 1);
            const int nxMax = std::min(gridCols_ - 1, cx + 1);
            for (int nz = nzMin; nz <= nzMax; ++nz) {
                for (int nx = nxMin; nx <= nxMax; ++nx) {
                    const auto& dynCell = dynGridCells_[static_cast<size_t>(nz * gridCols_ + nx)];
                    for (size_t di : dieCell) {
                        for (size_t pi : dynCell) {
                            dieDynamicPairScratch_.emplace_back(di, pi);
                        }
                    }
                }
            }
        }
    }
    std::sort(dieDynamicPairScratch_.begin(), dieDynamicPairScratch_.end());
    dieDynamicPairScratch_.erase(
        std::unique(dieDynamicPairScratch_.begin(), dieDynamicPairScratch_.end()),
        dieDynamicPairScratch_.end());
    for (const auto& pr : dieDynamicPairScratch_) {
        fn(pr.first, pr.second);
    }
}

} // namespace dice_physics
