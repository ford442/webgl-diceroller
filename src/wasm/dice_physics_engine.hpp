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
#include <array>
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
    // Disable the pipping centre-of-mass bias (?fair-dice).
    static constexpr uint32_t FLAG_FAIR_DICE = 1u << 1;
    static constexpr float DEFAULT_MASS_BIAS_RATIO = 0.0075f;
    static constexpr float MAX_MASS_BIAS_RATIO = 0.05f;
    // Soft cap on dynamic (non-die) rigid-body props — knockable clutter.
    // die×dynamic and dynamic×dynamic pairs share the die uniform grid (see
    // forEachDieDynamicPair / forEachDynamicPair), so this is a memory/event
    // budget cap, not a brute-force-cost cap.
    static constexpr int MAX_DYNAMICS = 256;

    DicePhysicsEngine();

    void setFlags(uint32_t flags);

    /**
     * Pipping bias magnitude as a fraction of die height (?bias-ratio=),
     * clamped to [0, MAX_MASS_BIAS_RATIO]. Each die's direction comes from its
     * own face table (the value-1 normal), so nothing is uploaded per die.
     */
    void setMassBiasRatio(float ratio);

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

    /**
     * Advance the simulation by dt seconds of wall time. dt is fed to an
     * internal accumulator and consumed in fixed FIXED_DT ticks (see
     * dice_contacts.hpp); it is never used as the integration quantum.
     */
    void step(float dt);

    /** Fixed ticks run since construction (monotonic; survives reset). */
    uint64_t getFixedTickCount() const { return fixedTicks_; }

    /** Simulated time banked but not yet consumed by a tick (test hook). */
    double getPendingTime() const { return accumulator_; }

    /**
     * Test hook: override the tick length. The swept-contact tests use it to
     * reach substeps the fixed 1/120 clock never produces (a sub-10 fps
     * caller before the clock existed). Not bound to JS.
     */
    void setFixedDtForTesting(float fixedDt) { fixedDt_ = fixedDt > 0.0f ? fixedDt : FIXED_DT; }

    int getDieCount() const;

    const StepStats& getLastStepStats() const;

    /** Cumulative count of addStatic* calls rejected because MAX_STATICS was reached. */
    uint32_t getStaticCapacityDroppedCount() const;

    /** Test hook: disable broadphase to compare against brute-force pair generation. */
    void setBroadphaseForTesting(bool enabled);

    /**
     * Test hook: the die–die pairs whose bounding spheres overlap (expand 0),
     * as the broadphase walker reports them, without running the solver.
     */
    std::vector<std::pair<size_t, size_t>> collectDiePairsForTesting(bool useBroadphase);

    /** Test hook: the same for (dieIndex, dynamicIndex) pairs. */
    std::vector<std::pair<size_t, size_t>> collectDieDynamicPairsForTesting(bool useBroadphase);

    /** Test hook: enumerate dynamic–dynamic pair indices without running the solver. */
    std::vector<std::pair<size_t, size_t>> collectDynamicPairsForTesting(bool useBroadphase);

    /** hasDice() && allAsleep(): a roll is finished. False for an empty engine. */
    bool areAllSettled() const;
    bool hasDice() const { return !bodies_.empty(); }
    /** Every non-kinematic die is asleep. True for an empty engine. */
    bool allAsleep() const;

    /**
     * Why is it awake? One record of SLEEP_DIAG_STRIDE floats per die, then
     * per dynamic prop:
     *   [0] kind (0 die, 1 dynamic)   [1] id             [2] sleeping
     *   [3] kinematic                 [4] |v|            [5] |w| * radius
     *   [6] sleepTimer                [7] own kinetic energy
     *   [8] island kinetic energy (what updateIslandSleep compares against
     *       SLEEP_ENERGY_THRESHOLD)   [9] island size
     *   [10] manifold count           [11] contact point count
     *   [12] deepest separation (0 when no contacts)
     *   [13..] SLEEP_DIAG_MANIFOLDS x (manifold kind, other id, material tag,
     *       deepest separation); unused slots are -1.
     * Other id: a die/dynamic/static user id, or -1 for the analytic table,
     * walls and container planes. Material tag is a static's tag, else -1.
     */
    static constexpr int SLEEP_DIAG_MANIFOLDS = 4;
    static constexpr int SLEEP_DIAG_STRIDE = 13 + SLEEP_DIAG_MANIFOLDS * 4;
    const std::vector<float>& buildSleepDiagnostics();

    /**
     * True when stepping would change nothing: every die and dynamic prop is
     * asleep and none is kinematic (a held die is moved from outside the
     * step). An empty world is asleep. The worker parks its timer on this.
     */
    bool isWorldAsleep() const;

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

    /** Test hook: the local centre-of-mass offset the bias torque uses (0 when fair). */
    bool getDieComOffset(int id, float& x, float& y, float& z) const;

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
    // Open-addressing index over manifolds_ by (kind, idA, idB, aux), rebuilt
    // at the start of every contact pass and extended as manifolds are
    // created. A slot holds a manifolds_ index or -1; keys are compared
    // against the live manifold, and findManifold returns the lowest
    // matching index, which is what the linear scan it replaced returned.
    std::vector<int32_t> manifoldSlots_;
    /**
     * Struct-of-arrays body state for the contact solve. Slot 0 is the world
     * anchor; dice occupy slots 1..N and dynamic props N+1..N+D.
     * gatherSolverBodies copies the hot fields in once per substep (with each
     * body's world inverse inertia) and binds every manifold to its two
     * slots; scatterSolverBodies writes position, velocity and spin back.
     * The solver iterates manifolds VELOCITY_ITERATIONS times, and building
     * its BodyViews from these rows is a few pointer stores instead of a walk
     * over two RigidBody records.
     */
    struct SolverBodies {
        std::vector<Vec3> position;
        std::vector<Vec3> velocity;
        std::vector<Vec3> angularVelocity;
        std::vector<Mat3> invInertiaWorld;
        std::vector<float> invMass;
        std::vector<uint8_t> kinematic;
    };
    SolverBodies solverBodies_;
    // Per manifold: its A and B slots, or {-1, -1} when either body index is
    // out of range (the manifold is skipped).
    std::vector<std::array<int32_t, 2>> manifoldBodySlots_;
    // Engine-owned scratch the step reuses instead of allocating: the
    // velocity solver's manifold order, the island union-find, and the posed
    // face planes addSatContacts builds for each hull pair.
    std::vector<size_t> solveOrder_;
    std::vector<int> islandParent_;
    std::vector<int> islandRoot_;
    std::vector<float> islandKe_;
    std::vector<HullPlane> satPlanesA_;
    std::vector<HullPlane> satPlanesB_;
    std::vector<CollisionEvent> events_;
    std::vector<ContainerPlane> containerPlanes_;
    mutable std::vector<float> transformBuffer_;
    mutable std::vector<float> idBuffer_;
    mutable std::vector<float> eventBuffer_;
    mutable std::vector<int32_t> faceValueBuffer_;
    mutable std::vector<float> dynamicTransformBuffer_;
    mutable std::vector<float> dynamicIdBuffer_;
    std::vector<float> sleepDiagBuffer_;
    DeterministicRNG rng_;
    bool noDrag_ = false;
    bool fairDice_ = false;
    float massBiasRatio_ = DEFAULT_MASS_BIAS_RATIO;
    bool containerActive_ = false;
    StepStats lastStepStats_;
    double accumulator_ = 0.0;
    uint64_t fixedTicks_ = 0;
    float fixedDt_ = FIXED_DT;
    uint32_t staticCapacityDroppedCount_ = 0;
    uint32_t dynamicCapacityDroppedCount_ = 0;
    bool useBroadphase_ = true;

    static constexpr float GRID_CELL_SIZE = 2.2f;
    /**
     * Uniform XZ bucket grid in CSR form: cell c holds
     * items[start[c] .. start[c + 1]), the bodies whose expanded XZ bounds
     * overlap it, in ascending body index. range holds each body's
     * (minCx, maxCx, minCz, maxCz). Rebuilt by counting sort into storage
     * sized from the population, so a rebuild never grows a per-cell vector.
     */
    struct BroadphaseGrid {
        std::vector<uint32_t> start;
        std::vector<uint32_t> items;
        std::vector<uint32_t> cursor;
        std::vector<int32_t> range;
    };
    // Dice and dynamics share one set of grid dimensions/origin
    // (ensureDieGridDimensions) but are bucketed separately, since a die
    // index and a dynamics_ index are different spaces.
    BroadphaseGrid dieGrid_;
    BroadphaseGrid dynGrid_;
    // The expand both grids were last built with; the walkers' bounding-sphere
    // cull uses the same value.
    float gridExpand_ = 0.0f;
    // Per-walk dedup: stamp[j] == i once j has been offered as i's partner,
    // so a pair that shares several cells is seen once.
    std::vector<int32_t> dieStamp_;
    std::vector<int32_t> dynStamp_;
    // One body's partners, sorted before dispatch so every walker visits
    // pairs in ascending (i, j) — the order the brute-force loops use.
    std::vector<uint32_t> partnerScratch_;
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
    /** One FIXED_DT tick: SUB_STEPS substeps of integrate/contact/solve/sleep. */
    void fixedTick();
    void integrate(RigidBody& b, float dt);
    void sweepClipAgainstStatics(RigidBody& b, const Vec3& from);
    void refreshDieDerived(RigidBody& b) const;
    void refreshDynamicDerived(DynamicBody& b) const;

    void ensureDieGridDimensions();
    int bodyCellXMin(float x, float radius) const;
    int bodyCellXMax(float x, float radius) const;
    int bodyCellZMin(float z, float radius) const;
    int bodyCellZMax(float z, float radius) const;
    /** Bucket dice and dynamics for this substep; the walkers read the result. */
    void rebuildBroadphase(float expand);
    template <typename BodyVec>
    void rebuildGrid(BroadphaseGrid& grid, const BodyVec& bodies, float expand);
    /**
     * The walkers' shared contract: fn(i, j) once for every pair whose
     * expanded bounding spheres overlap (|pj - pi| < ri + rj + expand), in
     * ascending (i, j), whether or not the broadphase is enabled. Returns the
     * number of distinct candidate pairs examined. Grid mode needs
     * rebuildBroadphase(expand) first.
     */
    template <typename Fn>
    uint32_t forEachDiePair(Fn&& fn);
    template <typename Fn>
    uint32_t forEachDieDynamicPair(Fn&& fn);
    template <typename Fn>
    void forEachDynamicPair(Fn&& fn);
    template <typename A, typename B>
    static bool spheresOverlap(const A& a, const B& b, float expand) {
        const Vec3 delta = b.position - a.position;
        const float combinedR = a.radius + b.radius + expand;
        return !(delta.lengthSq() >= combinedR * combinedR);
    }
    void processDiePair(size_t i, size_t j, StepStats& stats, float spec);
    void generateDieDieContacts(float spec, StepStats& stats);

    static constexpr size_t MAX_MANIFOLDS = 8192;
    /**
     * Grow manifolds_ (and the per-manifold solver scratch tied to its
     * capacity) for the current population, outside step(): a dense pile
     * peaks near four manifolds per body after compaction and twice that
     * while a contact pass is still appending, so step() starts with room.
     */
    void reserveContactStorage();
    /**
     * Find-or-create the manifold for this key (nullptr at MAX_MANIFOLDS).
     * Only for a caller about to commit points: anything that just wants to
     * know whether a pair touched this substep uses findManifold, so a miss
     * does not leave an empty manifold behind to take a slot until the pass
     * ends.
     */
    ContactManifold* acquireManifold(ManifoldKind kind, int idA, int idB, int aux);
    ContactManifold* findManifold(ManifoldKind kind, int idA, int idB, int aux);
    void rebuildManifoldIndex();
    void indexManifold(size_t index);
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
    /**
     * Union-find over body-body manifolds (dice + dynamic props; statics and
     * the table never join an island). root[i] is the island of node i (dice
     * first, then dynamics); islandKe[root] is its most energetic member's
     * kinetic energy.
     */
    void computeIslands(std::vector<int>& root, std::vector<float>& islandKe);
    float speculativeFor(const Vec3& velocity, float dt) const;
    void gatherSolverBodies();
    void scatterSolverBodies();
    BodyView solverView(int32_t slot);
    bool bindViews(size_t manifold, BodyView& a, BodyView& b);

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

namespace detail {

/**
 * Gather body `i`'s partners from the cells its range covers into `out`,
 * sorted ascending. `selfGrid` supplies i's range; `otherGrid` the cells to
 * read; `minPartner` skips partners below it (i + 1 within one population, 0
 * across two). Each partner is offered once (stamp) and kept only when
 * keep(j) — the bounding-sphere cull. Returns the distinct partners offered.
 */
template <typename Grid, typename Keep>
uint32_t gatherPartners(const Grid& selfGrid, const Grid& otherGrid, int cols, size_t i,
                        uint32_t minPartner, std::vector<int32_t>& stamp,
                        std::vector<uint32_t>& out, Keep&& keep) {
    out.clear();
    uint32_t offered = 0;
    const int32_t* r = selfGrid.range.data() + i * 4;
    const auto tag = static_cast<int32_t>(i);
    for (int cz = r[2]; cz <= r[3]; ++cz) {
        for (int cx = r[0]; cx <= r[1]; ++cx) {
            const auto c = static_cast<size_t>(cz) * static_cast<size_t>(cols) + static_cast<size_t>(cx);
            const uint32_t* first = otherGrid.items.data() + otherGrid.start[c];
            const uint32_t* last = otherGrid.items.data() + otherGrid.start[c + 1];
            // Cells hold ascending indices: start at the first eligible one.
            for (const uint32_t* it = std::lower_bound(first, last, minPartner); it != last; ++it) {
                const uint32_t j = *it;
                if (stamp[j] == tag) continue;
                stamp[j] = tag;
                ++offered;
                if (keep(j)) out.push_back(j);
            }
        }
    }
    std::sort(out.begin(), out.end());
    return offered;
}

} // namespace detail

template <typename Fn>
uint32_t DicePhysicsEngine::forEachDiePair(Fn&& fn) {
    const size_t n = bodies_.size();
    if (!useBroadphase_ || n < 2) {
        uint32_t offered = 0;
        for (size_t i = 0; i < n; ++i) {
            for (size_t j = i + 1; j < n; ++j) {
                ++offered;
                if (spheresOverlap(bodies_[i], bodies_[j], gridExpand_)) fn(i, j);
            }
        }
        return offered;
    }
    uint32_t offered = 0;
    dieStamp_.assign(n, -1);
    for (size_t i = 0; i < n; ++i) {
        offered += detail::gatherPartners(
            dieGrid_, dieGrid_, gridCols_, i, static_cast<uint32_t>(i + 1), dieStamp_,
            partnerScratch_,
            [&](uint32_t j) { return spheresOverlap(bodies_[i], bodies_[j], gridExpand_); });
        for (const uint32_t j : partnerScratch_) fn(i, static_cast<size_t>(j));
    }
    return offered;
}

// Bipartite (die index space x dynamics index space): a die's range is read
// from the die grid, its partners from the dynamics grid, which shares its
// dimensions, origin and expand.
template <typename Fn>
uint32_t DicePhysicsEngine::forEachDieDynamicPair(Fn&& fn) {
    const size_t n = bodies_.size();
    const size_t d = dynamics_.size();
    if (!useBroadphase_ || n == 0 || d == 0) {
        uint32_t offered = 0;
        for (size_t di = 0; di < n; ++di) {
            for (size_t pi = 0; pi < d; ++pi) {
                ++offered;
                if (spheresOverlap(bodies_[di], dynamics_[pi], gridExpand_)) fn(di, pi);
            }
        }
        return offered;
    }
    uint32_t offered = 0;
    dynStamp_.assign(d, -1);
    for (size_t di = 0; di < n; ++di) {
        offered += detail::gatherPartners(
            dieGrid_, dynGrid_, gridCols_, di, 0u, dynStamp_, partnerScratch_,
            [&](uint32_t pi) { return spheresOverlap(bodies_[di], dynamics_[pi], gridExpand_); });
        for (const uint32_t pi : partnerScratch_) fn(di, static_cast<size_t>(pi));
    }
    return offered;
}

// Every same-cell and forward-neighbour pair, in cell order, duplicates
// included — the walk generateDynamicDynamicContacts has always had.
template <typename Fn>
void DicePhysicsEngine::forEachDynamicPair(Fn&& fn) {
    if (!useBroadphase_ || dynamics_.size() < 2) {
        for (size_t i = 0; i < dynamics_.size(); ++i) {
            for (size_t j = i + 1; j < dynamics_.size(); ++j) {
                fn(i, j);
            }
        }
        return;
    }

    auto cellAt = [&](int cx, int cz) {
        const auto c = static_cast<size_t>(cz) * static_cast<size_t>(gridCols_) + static_cast<size_t>(cx);
        return std::pair<const uint32_t*, const uint32_t*>{
            dynGrid_.items.data() + dynGrid_.start[c], dynGrid_.items.data() + dynGrid_.start[c + 1]};
    };
    for (int cz = 0; cz < gridRows_; ++cz) {
        for (int cx = 0; cx < gridCols_; ++cx) {
            const auto [cellBegin, cellEnd] = cellAt(cx, cz);

            for (const uint32_t* a = cellBegin; a != cellEnd; ++a) {
                for (const uint32_t* b = a + 1; b != cellEnd; ++b) {
                    fn(static_cast<size_t>(*a), static_cast<size_t>(*b));
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

                    const auto [nBegin, nEnd] = cellAt(nx, nz);
                    for (const uint32_t* a = cellBegin; a != cellEnd; ++a) {
                        for (const uint32_t* b = nBegin; b != nEnd; ++b) {
                            if (*a < *b) {
                                fn(static_cast<size_t>(*a), static_cast<size_t>(*b));
                            } else if (*b < *a) {
                                fn(static_cast<size_t>(*b), static_cast<size_t>(*a));
                            }
                        }
                    }
                }
            }
        }
    }
}

} // namespace dice_physics
