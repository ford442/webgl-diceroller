// Shared contracts for the physics layer (issue #192). `PhysicsEngine` is the
// low-level object each bridge drives (the Embind surface of dice_physics.cpp,
// or a proxy/stub with the same shape). `PhysicsBridgeModule` is the shape
// PhysicsBridge.js, WasmPhysicsBridge.js, and WorkerPhysicsBridge.js must all
// export so they stay drop-in compatible with each other.

export interface PhysicsEngine {
    setFlags(flags: number): void;
    init(gravity: number, tableY: number, tableHalfW: number, tableHalfD: number): void;
    reset(): void;
    step(dt?: number): void;
    addDie(sides: number, x: number, y: number, z: number): number;
    removeDie(id: number): void;
    clearAllDice(): void;
    setDieMaterial(id: number, friction: number, rollingFriction: number): void;
    setDieDrag(id: number, drag: number): void;
    setDieHull(id: number, sidesOrHull: number | unknown): void;
    setDieFaceTable?(id: number, packed: unknown): void;
    getDieFaceValue?(id: number): number;
    getFaceValues?(): Int32Array;
    applyImpulse(id: number, fx: number, fy: number, fz: number): void;
    applyTorqueImpulse(id: number, tx: number, ty: number, tz: number): void;
    setDieTransform(
        id: number,
        px: number,
        py: number,
        pz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number
    ): void;
    setDieVelocity(
        id: number,
        lvx: number,
        lvy: number,
        lvz: number,
        avx: number,
        avy: number,
        avz: number
    ): void;
    setDieKinematic(id: number, kinematic: boolean): void;
    setContainerActive(active: boolean): void;
    setContainerPlanes(planes: Float32Array | number[]): void;
    clearStatics(): void;
    removeStatic(userId: number): boolean;
    addStaticBox(
        userId: number,
        cx: number,
        cy: number,
        cz: number,
        hx: number,
        hy: number,
        hz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number,
        materialTag: number
    ): number;
    addStaticPlane(
        userId: number,
        nx: number,
        ny: number,
        nz: number,
        dist: number,
        materialTag: number
    ): number;
    addStaticConvexHull(
        userId: number,
        cx: number,
        cy: number,
        cz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number,
        flatVerts: number[] | Float32Array,
        materialTag: number
    ): number;
    addStaticOpenCylinder(
        userId: number,
        cx: number,
        cy: number,
        cz: number,
        radius: number,
        halfHeight: number,
        segments: number,
        closedBottom: boolean,
        materialTag: number
    ): number;
    // -- Dynamic (non-die) rigid-body props — knockable clutter --------
    clearDynamics(): void;
    removeDynamic(userId: number): boolean;
    setDynamicKinematic(userId: number, kinematic: boolean): void;
    setDynamicTransform(
        userId: number,
        px: number,
        py: number,
        pz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number
    ): void;
    setDynamicVelocity(
        userId: number,
        lvx: number,
        lvy: number,
        lvz: number,
        avx: number,
        avy: number,
        avz: number
    ): void;
    applyDynamicImpulse(userId: number, fx: number, fy: number, fz: number): void;
    applyDynamicTorqueImpulse(userId: number, tx: number, ty: number, tz: number): void;
    addDynamicBox(
        userId: number,
        mass: number,
        cx: number,
        cy: number,
        cz: number,
        hx: number,
        hy: number,
        hz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number,
        materialTag: number
    ): number;
    addDynamicHull(
        userId: number,
        mass: number,
        cx: number,
        cy: number,
        cz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number,
        flatVerts: number[] | Float32Array,
        materialTag: number
    ): number;
    getDynamicCount(): number;
    /** Cumulative count of addDynamic* calls rejected because MAX_DYNAMICS was reached. */
    getDynamicCapacityDroppedCount?(): number;
    getDynamicTransforms(): Float32Array;
    getDynamicIds(): Float32Array;
    getTransforms(): Float32Array;
    getDieIds(): Float32Array;
    getDieCount(): number;
    getLastStepStats(): {
        pairCandidates: number;
        sphereTests: number;
        satTests: number;
        contacts: number;
    };
    /**
     * Cumulative count of addStatic* calls rejected because MAX_STATICS was
     * reached. Not available synchronously on the worker bridge (fire-and-
     * forget commands can't report engine state back) — undefined there.
     */
    getStaticCapacityDroppedCount?(): number;
    areAllSettled(): boolean;
    seedRNG(seed: number): void;
    randomFloat(): number;
    getCollisionEvents(): Float32Array;
    serializeState(): Uint8Array;
    deserializeState(data: unknown): void;
}

/**
 * An Embind `std::vector<T>` handle. Emscripten hands these back by value and
 * they must be `delete()`d to free the WASM-heap allocation (the binding only
 * defines `delete` when RTTI/policies allow, hence optional).
 */
export interface EmbindVector<T> {
    push_back(value: T): void;
    size(): number;
    get(index: number): T;
    delete?(): void;
}

/**
 * The *raw* Embind surface of `DicePhysicsEngine` as seen inside the physics
 * worker, before the bridges wrap it. It differs from `PhysicsEngine` (the
 * bridge-facing contract) in two places where Embind speaks vectors rather
 * than typed arrays:
 *   • `setContainerPlanes` takes a `VectorFloat`, not a `Float32Array`
 *   • `serializeState()` returns a `VectorU8`, not a `Uint8Array`
 * so this is deliberately not declared as `extends PhysicsEngine`.
 */
export interface EmbindPhysicsEngine {
    setFlags(flags: number): void;
    init(gravity: number, tableY: number, tableHalfW: number, tableHalfD: number): void;
    reset(): void;
    step(dt?: number): void;
    addDie(sides: number, x: number, y: number, z: number): number;
    removeDie(id: number): void;
    clearAllDice(): void;
    setDieMaterial(id: number, friction: number, rollingFriction: number): void;
    setDieDrag(id: number, drag: number): void;
    setDieHull(id: number, hull: EmbindVector<number>): void;
    setDieFaceTable?(id: number, packed: EmbindVector<number>): void;
    getDieFaceValue?(id: number): number;
    getFaceValues(): Int32Array;
    applyImpulse(id: number, fx: number, fy: number, fz: number): void;
    applyTorqueImpulse(id: number, tx: number, ty: number, tz: number): void;
    setDieTransform(
        id: number,
        px: number,
        py: number,
        pz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number
    ): void;
    setDieVelocity(
        id: number,
        lvx: number,
        lvy: number,
        lvz: number,
        avx: number,
        avy: number,
        avz: number
    ): void;
    setDieKinematic(id: number, kinematic: boolean): void;
    setContainerActive(active: boolean): void;
    setContainerPlanes(planes: EmbindVector<number>): void;
    clearStatics(): void;
    removeStatic(userId: number): boolean;
    addStaticBox(
        userId: number,
        cx: number,
        cy: number,
        cz: number,
        hx: number,
        hy: number,
        hz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number,
        materialTag: number
    ): number;
    addStaticPlane(
        userId: number,
        nx: number,
        ny: number,
        nz: number,
        dist: number,
        materialTag: number
    ): number;
    addStaticConvexHull(
        userId: number,
        cx: number,
        cy: number,
        cz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number,
        flatVerts: EmbindVector<number>,
        materialTag: number
    ): number;
    addStaticOpenCylinder(
        userId: number,
        cx: number,
        cy: number,
        cz: number,
        radius: number,
        halfHeight: number,
        segments: number,
        closedBottom: boolean,
        materialTag: number
    ): number;
    // -- Dynamic (non-die) rigid-body props — knockable clutter --------
    clearDynamics(): void;
    removeDynamic(userId: number): boolean;
    setDynamicKinematic(userId: number, kinematic: boolean): void;
    setDynamicTransform(
        userId: number,
        px: number,
        py: number,
        pz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number
    ): void;
    setDynamicVelocity(
        userId: number,
        lvx: number,
        lvy: number,
        lvz: number,
        avx: number,
        avy: number,
        avz: number
    ): void;
    applyDynamicImpulse(userId: number, fx: number, fy: number, fz: number): void;
    applyDynamicTorqueImpulse(userId: number, tx: number, ty: number, tz: number): void;
    addDynamicBox(
        userId: number,
        mass: number,
        cx: number,
        cy: number,
        cz: number,
        hx: number,
        hy: number,
        hz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number,
        materialTag: number
    ): number;
    addDynamicHull(
        userId: number,
        mass: number,
        cx: number,
        cy: number,
        cz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number,
        flatVerts: EmbindVector<number>,
        materialTag: number
    ): number;
    getDynamicCount(): number;
    getDynamicCapacityDroppedCount?(): number;
    getDynamicTransforms(): Float32Array;
    getDynamicIds(): Float32Array;
    getTransforms(): Float32Array;
    getDieIds(): Float32Array;
    getDieCount(): number;
    getLastStepStats(): {
        pairCandidates: number;
        sphereTests: number;
        satTests: number;
        contacts: number;
    };
    getStaticCapacityDroppedCount?(): number;
    areAllSettled(): boolean;
    seedRNG(seed: number): void;
    randomFloat(): number;
    getCollisionEvents(): Float32Array;
    serializeState(): EmbindVector<number>;
    deserializeState(data: EmbindVector<number>): void;
}

/** The instantiated Emscripten module produced by `dice_physics.js`. */
export interface DicePhysicsModule {
    DicePhysicsEngine: new () => EmbindPhysicsEngine;
    VectorFloat: new () => EmbindVector<number>;
    VectorU8: new () => EmbindVector<number>;
}

export interface CollisionEvent {
    idA: number;
    idB: number;
    impactSpeed: number;
    mass: number;
    inertiaScalar: number;
    linearSpeedSq: number;
    angularSpeedSq: number;
    staticColliderId?: number;
    materialTag?: number;
}

export interface PhysicsBridgeModule {
    loadWasmEngine(): Promise<boolean>;
    isWasmAvailable(): boolean;
    isWasmInitialized(): boolean;
    getWasmEngine(): PhysicsEngine;
    loadHullForDie(wasmId: number, sides: number): void;
    pollCollisionEvents(): CollisionEvent[];
    seedPhysicsRNG(seed: number): void;
    randomPhysicsFloat(): number;
    serializePhysicsState(): Promise<Uint8Array>;
    seededPhysicsThrow(
        seed: number,
        dice: { id: number; index: number }[],
        tableSurfaceY: number
    ): void;
    deserializePhysicsState(data: Uint8Array): void;
    setContainerActive(isActive: boolean): void;
    setContainerPlanes(planes: Float32Array | number[]): void;
    flushWorkerCommandBatch?(): void;
    getPhysicsStepStats?(): {
        pairCandidates: number;
        sphereTests: number;
        satTests: number;
        contacts: number;
    } | null;
    getWorkerPhysicsStats?(): {
        usingCommandBatch: boolean;
        usingSAB: boolean;
        msgsPerSecond: number;
        batchRecords: number;
        stepStats?: {
            pairCandidates: number;
            sphereTests: number;
            satTests: number;
            contacts: number;
        } | null;
    } | null;
}
